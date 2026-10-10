//! The export transaction.
//!
//! §8.1 of docs/superpowers/specs/2026-09-25-nowly-screenshot-design.md fixes the
//! cancellation semantics, and they are the whole reason this is a state machine
//! rather than one `async fn`:
//!
//! - While encoding or preparing buffers, Esc or "cancel export" aborts this
//!   output, returns to EDITING with the annotations intact, and cleans up this
//!   export's temporary files. Cancellation and version are checked **again**
//!   immediately before writing.
//! - Once the short commit stage begins — the actual clipboard write or file
//!   replacement — the cancel control is disabled and the real result decides
//!   success or failure. It must never claim to have withdrawn a side effect it
//!   could not withdraw.
//! - A busy clipboard may be retried within a bound, then returns a retryable
//!   error rather than blocking the UI forever.
//! - A success callback must validate the session and version, because a late
//!   result from a superseded export must not close the current session.
//!
//! So the sinks are traits: the ordering and the cancellation windows are the
//! requirement, and they have to be assertable without a real clipboard or disk.

use std::time::Duration;

/// Which output is running, so the UI can show the right static status text.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ExportKind {
    Clipboard,
    File,
}

/// §8.1's two stages, plus the terminal states.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ExportPhase {
    /// Encoding and buffer preparation. Cancellable.
    Preparing,
    /// The actual write. Not cancellable.
    Committing,
    Succeeded,
    /// Back to EDITING with everything intact.
    Aborted,
    Failed,
}

/// What a cancel request achieved, reported honestly.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CancelOutcome {
    /// Stopped before any side effect.
    Aborted,
    /// The commit stage had already begun, so nothing was undone.
    TooLate,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ExportError {
    /// The clipboard stayed busy past the retry bound. The user can retry.
    ClipboardBusy,
    /// The write failed. The session stays open with the annotations intact.
    WriteFailed(String),
    /// The save target changed identity between authorisation and commit, so the
    /// overwrite was refused, per §8.2.
    TargetChanged,
    /// The session or version moved on, so this result is discarded.
    Superseded,
}

/// Identifies exactly one export of exactly one document version.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ExportToken {
    pub session_id: u64,
    /// Bumped by every committed annotation transaction, so a late result from a
    /// superseded export is recognisable.
    pub version: u64,
}

/// The encoded bytes plus the dimensions, so a sink never re-encodes.
pub(crate) struct EncodedImage {
    pub png: Vec<u8>,
    /// Straight-alpha RGBA, for the clipboard's bitmap format.
    pub rgba: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

/// Writing to the system clipboard.
pub(crate) trait ClipboardSink {
    /// Returns `Err(ExportError::ClipboardBusy)` while another process holds it, so
    /// the caller can retry within its bound.
    fn write_image(&mut self, image: &EncodedImage) -> Result<(), ExportError>;
    /// The 7-character uppercase HEX, per §4.3.
    fn write_text(&mut self, text: &str) -> Result<(), ExportError>;
}

/// Saving a file with §8.2's safe-replace semantics.
pub(crate) trait FileSink {
    /// Creates the temporary file beside the target and writes the bytes.
    fn stage(&mut self, png: &[u8]) -> Result<(), ExportError>;
    /// Re-checks the target's identity, then replaces it. This is the commit stage.
    fn commit(&mut self) -> Result<(), ExportError>;
    /// Removes this export's temporary file. Only files this export is known to own.
    fn cleanup(&mut self);
}

/// Resolves session ownership at each real output boundary, after preparation.
pub(crate) struct SessionSink<'a, S: ?Sized, F> {
    inner: &'a mut S,
    live: F,
}

impl<'a, S: ?Sized, F: FnMut() -> bool> SessionSink<'a, S, F> {
    pub(crate) fn new(inner: &'a mut S, live: F) -> Self {
        Self { inner, live }
    }

    fn check_session(&mut self) -> Result<(), ExportError> {
        if (self.live)() {
            Ok(())
        } else {
            Err(ExportError::Superseded)
        }
    }
}

impl<S: ClipboardSink + ?Sized, F: FnMut() -> bool> ClipboardSink for SessionSink<'_, S, F> {
    fn write_image(&mut self, image: &EncodedImage) -> Result<(), ExportError> {
        self.check_session()?;
        self.inner.write_image(image)
    }

    fn write_text(&mut self, text: &str) -> Result<(), ExportError> {
        self.check_session()?;
        self.inner.write_text(text)
    }
}

impl<S: FileSink + ?Sized, F: FnMut() -> bool> FileSink for SessionSink<'_, S, F> {
    fn stage(&mut self, png: &[u8]) -> Result<(), ExportError> {
        self.check_session()?;
        self.inner.stage(png)
    }

    fn commit(&mut self) -> Result<(), ExportError> {
        self.check_session()?;
        self.inner.commit()
    }

    fn cleanup(&mut self) {
        self.inner.cleanup();
    }
}

/// How long a busy clipboard is retried before returning a retryable error.
const CLIPBOARD_RETRY_BOUND: Duration = Duration::from_millis(1500);
const CLIPBOARD_RETRY_DELAY: Duration = Duration::from_millis(50);

/// One export attempt.
pub(crate) struct ExportTransaction {
    kind: ExportKind,
    token: ExportToken,
    phase: ExportPhase,
    cancel_requested: bool,
}

impl ExportTransaction {
    pub(crate) fn new(kind: ExportKind, token: ExportToken) -> Self {
        Self {
            kind,
            token,
            phase: ExportPhase::Preparing,
            cancel_requested: false,
        }
    }

    pub(crate) fn kind(&self) -> ExportKind {
        self.kind
    }

    pub(crate) fn phase(&self) -> ExportPhase {
        self.phase
    }

    /// Whether the UI should offer a cancel control, per §8.1.
    pub(crate) fn is_cancellable(&self) -> bool {
        self.phase == ExportPhase::Preparing
    }

    /// Requests cancellation, and says truthfully what that achieved.
    pub(crate) fn request_cancel(&mut self) -> CancelOutcome {
        match self.phase {
            ExportPhase::Preparing => {
                self.cancel_requested = true;
                CancelOutcome::Aborted
            }
            // The write is already in flight. Claiming otherwise would tell the user
            // the clipboard or file was untouched when it may not be.
            _ => CancelOutcome::TooLate,
        }
    }

    /// Runs the clipboard export.
    ///
    /// `current` is the session's live token, checked immediately before the write
    /// so a superseded export cannot overwrite the clipboard.
    pub(crate) fn run_clipboard(
        &mut self,
        sink: &mut dyn ClipboardSink,
        image: &EncodedImage,
        current: ExportToken,
        mut sleep: impl FnMut(Duration),
        mut elapsed: impl FnMut() -> Duration,
    ) -> Result<(), ExportError> {
        // The last cancellation and version check before any side effect, per §8.1.
        self.check_before_commit(current)?;

        self.phase = ExportPhase::Committing;
        loop {
            match sink.write_image(image) {
                Ok(()) => {
                    self.phase = ExportPhase::Succeeded;
                    return Ok(());
                }
                Err(ExportError::ClipboardBusy) => {
                    // A bounded retry: another process may hold the clipboard for a
                    // moment, but the UI must not block forever.
                    if elapsed() >= CLIPBOARD_RETRY_BOUND {
                        self.phase = ExportPhase::Failed;
                        return Err(ExportError::ClipboardBusy);
                    }
                    sleep(CLIPBOARD_RETRY_DELAY);
                }
                Err(error) => {
                    self.phase = ExportPhase::Failed;
                    return Err(error);
                }
            }
        }
    }

    /// Runs the file export: stage while cancellable, then commit.
    pub(crate) fn run_file(
        &mut self,
        sink: &mut dyn FileSink,
        png: &[u8],
        current: ExportToken,
    ) -> Result<(), ExportError> {
        // Staging happens in the cancellable phase, so a cancel here leaves only a
        // temporary file, which is then removed.
        if let Err(error) = sink.stage(png) {
            sink.cleanup();
            self.phase = ExportPhase::Failed;
            return Err(error);
        }

        if let Err(error) = self.check_before_commit(current) {
            // Cancelled or superseded after staging: clean up this export's own
            // temporary file and leave the target untouched.
            sink.cleanup();
            return Err(error);
        }

        self.phase = ExportPhase::Committing;
        match sink.commit() {
            Ok(()) => {
                self.phase = ExportPhase::Succeeded;
                // The staged file became the target, so cleanup only removes
                // leftovers; the saved file belongs to the user now.
                sink.cleanup();
                Ok(())
            }
            Err(error) => {
                sink.cleanup();
                self.phase = ExportPhase::Failed;
                Err(error)
            }
        }
    }

    /// The final gate before any side effect.
    fn check_before_commit(&mut self, current: ExportToken) -> Result<(), ExportError> {
        if self.cancel_requested {
            self.phase = ExportPhase::Aborted;
            // Not an error the user needs to see: they asked for it.
            return Err(ExportError::Superseded);
        }
        if current != self.token {
            self.phase = ExportPhase::Aborted;
            return Err(ExportError::Superseded);
        }
        Ok(())
    }

    /// Whether a completion callback belongs to the live session and version.
    pub(crate) fn accepts_result(&self, current: ExportToken) -> bool {
        current == self.token
    }
}

#[cfg(test)]
mod tests {
    use super::{
        CancelOutcome, ClipboardSink, EncodedImage, ExportError, ExportKind, ExportPhase,
        ExportToken, ExportTransaction, FileSink,
    };
    use std::time::Duration;

    fn token(version: u64) -> ExportToken {
        ExportToken {
            session_id: 7,
            version,
        }
    }

    fn image() -> EncodedImage {
        EncodedImage {
            png: vec![1, 2, 3],
            rgba: vec![0; 16],
            width: 2,
            height: 2,
        }
    }

    #[derive(Default)]
    struct FakeClipboard {
        /// How many more attempts report busy before one succeeds.
        busy_for: u32,
        attempts: u32,
        images: u32,
        texts: Vec<String>,
        fail_with: Option<ExportError>,
    }

    impl ClipboardSink for FakeClipboard {
        fn write_image(&mut self, _image: &EncodedImage) -> Result<(), ExportError> {
            self.attempts += 1;
            if let Some(error) = &self.fail_with {
                return Err(error.clone());
            }
            if self.busy_for > 0 {
                self.busy_for -= 1;
                return Err(ExportError::ClipboardBusy);
            }
            self.images += 1;
            Ok(())
        }

        fn write_text(&mut self, text: &str) -> Result<(), ExportError> {
            self.texts.push(text.to_string());
            Ok(())
        }
    }

    #[derive(Default)]
    struct FakeFile {
        staged: bool,
        committed: bool,
        cleanups: u32,
        stage_error: Option<ExportError>,
        commit_error: Option<ExportError>,
        on_stage: Option<Box<dyn FnMut()>>,
    }

    impl FileSink for FakeFile {
        fn stage(&mut self, _png: &[u8]) -> Result<(), ExportError> {
            if let Some(error) = &self.stage_error {
                return Err(error.clone());
            }
            self.staged = true;
            if let Some(action) = self.on_stage.as_mut() {
                action();
            }
            Ok(())
        }

        fn commit(&mut self) -> Result<(), ExportError> {
            if let Some(error) = &self.commit_error {
                return Err(error.clone());
            }
            self.committed = true;
            Ok(())
        }

        fn cleanup(&mut self) {
            self.cleanups += 1;
        }
    }

    /// A clock that never reaches the retry bound.
    fn quick_clock() -> impl FnMut() -> Duration {
        || Duration::from_millis(0)
    }

    #[test]
    fn starts_cancellable_in_the_preparing_phase() {
        let export = ExportTransaction::new(ExportKind::Clipboard, token(1));

        assert_eq!(export.phase(), ExportPhase::Preparing);
        assert!(export.is_cancellable());
    }

    #[test]
    fn copies_to_the_clipboard_and_succeeds() {
        let mut export = ExportTransaction::new(ExportKind::Clipboard, token(1));
        let mut clipboard = FakeClipboard::default();

        export
            .run_clipboard(&mut clipboard, &image(), token(1), |_| {}, quick_clock())
            .expect("the copy should succeed");

        assert_eq!(clipboard.images, 1);
        assert_eq!(export.phase(), ExportPhase::Succeeded);
    }

    #[test]
    fn a_cancel_while_preparing_touches_nothing() {
        // §8.1: a normal cancel does not change the clipboard.
        let mut export = ExportTransaction::new(ExportKind::Clipboard, token(1));
        let mut clipboard = FakeClipboard::default();

        assert_eq!(export.request_cancel(), CancelOutcome::Aborted);
        let result =
            export.run_clipboard(&mut clipboard, &image(), token(1), |_| {}, quick_clock());

        assert!(result.is_err());
        assert_eq!(clipboard.attempts, 0);
        assert_eq!(export.phase(), ExportPhase::Aborted);
    }

    #[test]
    fn a_cancel_during_the_commit_says_it_was_too_late() {
        // §8.1 forbids claiming a side effect was withdrawn when it was not.
        let mut export = ExportTransaction::new(ExportKind::Clipboard, token(1));
        let mut clipboard = FakeClipboard::default();
        export
            .run_clipboard(&mut clipboard, &image(), token(1), |_| {}, quick_clock())
            .expect("the copy should succeed");

        assert_eq!(export.request_cancel(), CancelOutcome::TooLate);
    }

    #[test]
    fn the_cancel_control_disappears_once_committing() {
        let mut export = ExportTransaction::new(ExportKind::Clipboard, token(1));
        let mut clipboard = FakeClipboard {
            fail_with: Some(ExportError::WriteFailed("boom".into())),
            ..FakeClipboard::default()
        };

        let _ = export.run_clipboard(&mut clipboard, &image(), token(1), |_| {}, quick_clock());

        // It reached the commit stage, so it is no longer cancellable.
        assert!(!export.is_cancellable());
    }

    #[test]
    fn refuses_to_write_for_a_superseded_version() {
        // A late export must not overwrite the clipboard for a document the user has
        // since changed.
        let mut export = ExportTransaction::new(ExportKind::Clipboard, token(1));
        let mut clipboard = FakeClipboard::default();

        let result =
            export.run_clipboard(&mut clipboard, &image(), token(2), |_| {}, quick_clock());

        assert_eq!(result, Err(ExportError::Superseded));
        assert_eq!(clipboard.attempts, 0);
        assert_eq!(export.phase(), ExportPhase::Aborted);
    }

    #[test]
    fn retries_a_busy_clipboard_within_the_bound() {
        let mut export = ExportTransaction::new(ExportKind::Clipboard, token(1));
        let mut clipboard = FakeClipboard {
            busy_for: 3,
            ..FakeClipboard::default()
        };
        let mut sleeps = 0;

        export
            .run_clipboard(
                &mut clipboard,
                &image(),
                token(1),
                |_| sleeps += 1,
                quick_clock(),
            )
            .expect("it should succeed after the retries");

        assert_eq!(clipboard.attempts, 4);
        assert_eq!(sleeps, 3);
    }

    #[test]
    fn gives_up_on_a_busy_clipboard_after_the_bound() {
        // §8.1: past the bound it returns a retryable error rather than blocking.
        let mut export = ExportTransaction::new(ExportKind::Clipboard, token(1));
        let mut clipboard = FakeClipboard {
            busy_for: u32::MAX,
            ..FakeClipboard::default()
        };

        let result = export.run_clipboard(
            &mut clipboard,
            &image(),
            token(1),
            |_| {},
            // Already past the bound.
            || Duration::from_secs(10),
        );

        assert_eq!(result, Err(ExportError::ClipboardBusy));
        assert_eq!(export.phase(), ExportPhase::Failed);
    }

    #[test]
    fn saves_a_file_by_staging_then_committing() {
        let mut export = ExportTransaction::new(ExportKind::File, token(1));
        let mut file = FakeFile::default();

        export
            .run_file(&mut file, &[1, 2, 3], token(1))
            .expect("the save should succeed");

        assert!(file.staged);
        assert!(file.committed);
        assert_eq!(export.phase(), ExportPhase::Succeeded);
    }

    #[test]
    fn a_cancel_after_staging_removes_the_temporary_file_and_keeps_the_target() {
        // §8.1: cancelling cleans up this export's temporary files; §8.2: the target
        // is never left half-written.
        let mut export = ExportTransaction::new(ExportKind::File, token(1));
        let mut file = FakeFile::default();
        export.request_cancel();

        let result = export.run_file(&mut file, &[1, 2, 3], token(1));

        assert!(result.is_err());
        assert!(file.staged);
        assert!(!file.committed);
        assert_eq!(file.cleanups, 1);
        assert_eq!(export.phase(), ExportPhase::Aborted);
    }

    #[test]
    fn a_failed_stage_cleans_up_and_keeps_the_session() {
        let mut export = ExportTransaction::new(ExportKind::File, token(1));
        let mut file = FakeFile {
            stage_error: Some(ExportError::WriteFailed("no space".into())),
            ..FakeFile::default()
        };

        let result = export.run_file(&mut file, &[1], token(1));

        assert_eq!(result, Err(ExportError::WriteFailed("no space".into())));
        assert_eq!(file.cleanups, 1);
        assert!(!file.committed);
        assert_eq!(export.phase(), ExportPhase::Failed);
    }

    #[test]
    fn refuses_to_overwrite_when_the_target_changed() {
        // §8.2: a junction or symlink swapped after authorisation must not be
        // followed to another target.
        let mut export = ExportTransaction::new(ExportKind::File, token(1));
        let mut file = FakeFile {
            commit_error: Some(ExportError::TargetChanged),
            ..FakeFile::default()
        };

        let result = export.run_file(&mut file, &[1], token(1));

        assert_eq!(result, Err(ExportError::TargetChanged));
        assert!(!file.committed);
        assert_eq!(file.cleanups, 1);
    }

    #[test]
    fn a_superseded_save_never_touches_the_target() {
        let mut export = ExportTransaction::new(ExportKind::File, token(1));
        let mut file = FakeFile::default();

        let result = export.run_file(&mut file, &[1], token(9));

        assert_eq!(result, Err(ExportError::Superseded));
        assert!(!file.committed);
        assert_eq!(file.cleanups, 1);
    }

    #[test]
    fn rejects_a_late_result_from_a_superseded_export() {
        // §8.1: the success callback validates session and version.
        let export = ExportTransaction::new(ExportKind::Clipboard, token(1));

        assert!(export.accepts_result(token(1)));
        assert!(!export.accepts_result(token(2)));
        assert!(!export.accepts_result(ExportToken {
            session_id: 8,
            version: 1
        }));
    }

    #[test]
    fn writes_the_hex_as_text() {
        let mut clipboard = FakeClipboard::default();

        clipboard
            .write_text("#4FC9DA")
            .expect("the text should write");

        assert_eq!(clipboard.texts, vec!["#4FC9DA".to_string()]);
    }

    #[test]
    fn session_retirement_after_preparation_prevents_clipboard_write() {
        let state = crate::screen_capture::ActiveCapture::default();
        let (session, _) = state.begin().unwrap();
        let request = ExportToken {
            session_id: session.session_id,
            version: 1,
        };
        let encoded = image();
        state.end_session(session.session_id);
        state.finish_retirement(session.session_id);
        let (replacement, _) = state.begin().unwrap();
        let mut clipboard = FakeClipboard::default();
        let mut sink =
            super::SessionSink::new(&mut clipboard, || state.is_current(session.session_id));
        let mut export = ExportTransaction::new(ExportKind::Clipboard, request);
        let result = export.run_clipboard(&mut sink, &encoded, request, |_| {}, quick_clock());
        assert_eq!(result, Err(ExportError::Superseded));
        assert_eq!(clipboard.attempts, 0);
        assert!(state.is_current(replacement.session_id));
    }

    #[test]
    fn session_retirement_during_clipboard_retry_prevents_the_next_write_attempt() {
        let state = crate::screen_capture::ActiveCapture::default();
        let (session, _) = state.begin().unwrap();
        let request = ExportToken {
            session_id: session.session_id,
            version: 1,
        };
        let mut clipboard = FakeClipboard {
            busy_for: 1,
            ..FakeClipboard::default()
        };
        let mut sink =
            super::SessionSink::new(&mut clipboard, || state.is_current(session.session_id));
        let mut export = ExportTransaction::new(ExportKind::Clipboard, request);
        let result = export.run_clipboard(
            &mut sink,
            &image(),
            request,
            |_| {
                state.end_session(session.session_id);
            },
            quick_clock(),
        );
        assert_eq!(result, Err(ExportError::Superseded));
        assert_eq!(clipboard.attempts, 1);
        assert_eq!(clipboard.images, 0);
    }

    #[test]
    fn session_retirement_during_file_staging_cleans_up_without_committing() {
        let state = std::sync::Arc::new(crate::screen_capture::ActiveCapture::default());
        let (session, _) = state.begin().unwrap();
        let request = ExportToken {
            session_id: session.session_id,
            version: 1,
        };
        let retiring = state.clone();
        let mut file = FakeFile {
            on_stage: Some(Box::new(move || {
                retiring.end_session(session.session_id);
            })),
            ..FakeFile::default()
        };
        let mut sink = super::SessionSink::new(&mut file, || state.is_current(session.session_id));
        let mut export = ExportTransaction::new(ExportKind::File, request);
        let result = export.run_file(&mut sink, &[1, 2, 3], request);
        assert_eq!(result, Err(ExportError::Superseded));
        assert!(file.staged);
        assert!(!file.committed);
        assert_eq!(file.cleanups, 1);
    }

    #[test]
    fn session_retirement_during_save_dialog_prevents_even_temporary_file_write() {
        let state = crate::screen_capture::ActiveCapture::default();
        let (session, _) = state.begin().unwrap();
        let request = ExportToken {
            session_id: session.session_id,
            version: 1,
        };
        state.end_session(session.session_id);
        let mut file = FakeFile::default();
        let mut sink = super::SessionSink::new(&mut file, || state.is_current(session.session_id));
        let mut export = ExportTransaction::new(ExportKind::File, request);
        let result = export.run_file(&mut sink, &[1, 2, 3], request);
        assert_eq!(result, Err(ExportError::Superseded));
        assert!(!file.staged);
        assert!(!file.committed);
    }
}
