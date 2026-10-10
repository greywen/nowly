//! Writing the PNG to disk safely.
//!
//! §8.2 of the design requires the write to be atomic from the user's point of view:
//! a crash or a full disk must never leave a truncated file where their screenshot
//! used to be. So the bytes go to a temporary file in the *same directory* (a
//! different volume would make the replace a copy, which is not atomic), then the
//! target's identity is re-checked, then the replace happens.
//!
//! The identity re-check is the part that is easy to get wrong. Between the dialog
//! closing and the commit, the chosen path may have become a different file: another
//! program may have created it, or the user may have replaced it. Overwriting blindly
//! would destroy data the user never agreed to destroy.

use std::path::{Path, PathBuf};

use chrono::{DateTime, Local};

use super::output::{ExportError, FileSink};

/// The default file name, per §8.2.
///
/// Takes the timestamp rather than reading the clock, so the name is a pure
/// function of it and can be asserted exactly.
pub(crate) fn default_file_name(now: DateTime<Local>) -> String {
    format!("Nowly-截图-{}.png", now.format("%Y%m%d-%H%M%S"))
}

/// What the target looked like when the user chose it.
///
/// `None` means it did not exist. That is a meaningful state: if it exists at commit
/// time, something else created it in between.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TargetIdentity {
    existed: bool,
    len: u64,
    modified: Option<std::time::SystemTime>,
}

impl TargetIdentity {
    pub(crate) fn observe(path: &Path) -> Self {
        match std::fs::metadata(path) {
            Ok(metadata) => Self {
                existed: true,
                len: metadata.len(),
                modified: metadata.modified().ok(),
            },
            Err(_) => Self {
                existed: false,
                len: 0,
                modified: None,
            },
        }
    }
}

/// Writes through a same-directory temporary file and an identity-checked replace.
pub(crate) struct SafeFileSink {
    target: PathBuf,
    /// Recorded when the sink is created, which is when the user chose the path.
    identity: TargetIdentity,
    /// Only ever a file this export created, so cleanup cannot remove anything else.
    temp: Option<PathBuf>,
}

impl SafeFileSink {
    pub(crate) fn new(target: PathBuf) -> Self {
        let identity = TargetIdentity::observe(&target);
        Self {
            target,
            identity,
            temp: None,
        }
    }

    /// The temporary path: same directory, distinct name, so the replace is a rename
    /// within one volume.
    fn temp_path(&self) -> Result<PathBuf, ExportError> {
        let directory = self
            .target
            .parent()
            .ok_or_else(|| ExportError::WriteFailed("the target has no directory".into()))?;
        let stem = self
            .target
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| ExportError::WriteFailed("the target has no file name".into()))?;
        // The process id keeps two Nowly instances from colliding.
        Ok(directory.join(format!(".{stem}.{}.nowly-tmp", std::process::id())))
    }
}

impl FileSink for SafeFileSink {
    fn stage(&mut self, png: &[u8]) -> Result<(), ExportError> {
        let temp = self.temp_path()?;
        // Recorded before the write, so a partial write still leaves a path to clean
        // up rather than an orphaned file.
        self.temp = Some(temp.clone());
        std::fs::write(&temp, png)
            .map_err(|error| ExportError::WriteFailed(format!("staging failed: {error}")))
    }

    fn commit(&mut self) -> Result<(), ExportError> {
        let Some(temp) = self.temp.clone() else {
            return Err(ExportError::WriteFailed("nothing was staged".into()));
        };

        // §8.2: the identity is re-checked immediately before the replace.
        if TargetIdentity::observe(&self.target) != self.identity {
            return Err(ExportError::TargetChanged);
        }

        // `rename` replaces an existing file on Windows only via the Win32 layer;
        // std's rename does replace on Windows for files, which is what we want here.
        std::fs::rename(&temp, &self.target)
            .map_err(|error| ExportError::WriteFailed(format!("the replace failed: {error}")))?;
        // The temporary file is gone now, so cleanup must not try to remove it.
        self.temp = None;
        Ok(())
    }

    fn cleanup(&mut self) {
        if let Some(temp) = self.temp.take() {
            // Best effort: a leftover temporary file is a smaller problem than a
            // failed export reporting an error about cleanup.
            let _ = std::fs::remove_file(temp);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{default_file_name, SafeFileSink, TargetIdentity};
    use crate::screen_capture::output::{ExportError, FileSink};
    use chrono::TimeZone;

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("nowly-save-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("the test directory should be creatable");
        dir
    }

    #[test]
    fn builds_the_documented_file_name() {
        // §8.2's pattern, hand-written rather than read back from the formatter.
        let when = chrono::Local
            .with_ymd_and_hms(2026, 9, 25, 14, 3, 7)
            .single()
            .expect("a valid local time");

        assert_eq!(default_file_name(when), "Nowly-截图-20260925-140307.png");
    }

    #[test]
    fn pads_single_digit_components() {
        let when = chrono::Local
            .with_ymd_and_hms(2026, 1, 2, 3, 4, 5)
            .single()
            .expect("a valid local time");

        assert_eq!(default_file_name(when), "Nowly-截图-20260102-030405.png");
    }

    #[test]
    fn writes_the_bytes_to_the_chosen_path() {
        let dir = temp_dir("write");
        let target = dir.join("shot.png");
        let mut sink = SafeFileSink::new(target.clone());

        sink.stage(b"PNGDATA").expect("staging should succeed");
        sink.commit().expect("the commit should succeed");

        assert_eq!(std::fs::read(&target).unwrap(), b"PNGDATA");
    }

    #[test]
    fn stages_in_the_targets_own_directory() {
        // A different volume would make the replace a copy, which is not atomic.
        let dir = temp_dir("same-dir");
        let target = dir.join("shot.png");
        let mut sink = SafeFileSink::new(target.clone());

        sink.stage(b"PNGDATA").expect("staging should succeed");

        let staged = std::fs::read_dir(&dir)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .collect::<Vec<_>>();
        assert_eq!(staged.len(), 1);
        assert_eq!(staged[0].parent(), target.parent());
        // And the target itself is untouched until the commit.
        assert!(!target.exists());
    }

    #[test]
    fn overwrites_a_file_the_user_chose_to_replace() {
        // The identity was observed with the file already there, so replacing it is
        // what the user agreed to in the dialog.
        let dir = temp_dir("overwrite");
        let target = dir.join("shot.png");
        std::fs::write(&target, b"OLD").unwrap();
        let mut sink = SafeFileSink::new(target.clone());

        sink.stage(b"NEW").expect("staging should succeed");
        sink.commit().expect("the commit should succeed");

        assert_eq!(std::fs::read(&target).unwrap(), b"NEW");
    }

    #[test]
    fn refuses_to_replace_a_file_that_appeared_after_the_dialog() {
        // §8.2: something else created the path in between, so overwriting would
        // destroy data the user never agreed to destroy.
        let dir = temp_dir("appeared");
        let target = dir.join("shot.png");
        let mut sink = SafeFileSink::new(target.clone());
        sink.stage(b"NEW").expect("staging should succeed");

        std::fs::write(&target, b"SOMEONE ELSE").unwrap();

        assert_eq!(sink.commit(), Err(ExportError::TargetChanged));
        // The other program's file is intact.
        assert_eq!(std::fs::read(&target).unwrap(), b"SOMEONE ELSE");
    }

    #[test]
    fn refuses_to_replace_a_file_whose_contents_changed() {
        let dir = temp_dir("changed");
        let target = dir.join("shot.png");
        std::fs::write(&target, b"OLD").unwrap();
        let mut sink = SafeFileSink::new(target.clone());
        sink.stage(b"NEW").expect("staging should succeed");

        // A different length is enough to prove it is not the file that was observed.
        std::fs::write(&target, b"OLD BUT LONGER").unwrap();

        assert_eq!(sink.commit(), Err(ExportError::TargetChanged));
        assert_eq!(std::fs::read(&target).unwrap(), b"OLD BUT LONGER");
    }

    #[test]
    fn refuses_to_replace_a_target_that_was_deleted() {
        // The user chose to overwrite a file that no longer exists; writing anyway
        // would be creating a file they did not ask for at a path they may have just
        // cleaned up.
        let dir = temp_dir("deleted");
        let target = dir.join("shot.png");
        std::fs::write(&target, b"OLD").unwrap();
        let mut sink = SafeFileSink::new(target.clone());
        sink.stage(b"NEW").expect("staging should succeed");

        std::fs::remove_file(&target).unwrap();

        assert_eq!(sink.commit(), Err(ExportError::TargetChanged));
    }

    #[test]
    fn cleanup_removes_only_this_exports_temporary_file() {
        let dir = temp_dir("cleanup");
        let target = dir.join("shot.png");
        let bystander = dir.join("someone-else.png");
        std::fs::write(&bystander, b"KEEP").unwrap();
        let mut sink = SafeFileSink::new(target.clone());
        sink.stage(b"NEW").expect("staging should succeed");

        sink.cleanup();

        assert_eq!(std::fs::read(&bystander).unwrap(), b"KEEP");
        let left = std::fs::read_dir(&dir)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .collect::<Vec<_>>();
        assert_eq!(left, vec![bystander]);
    }

    #[test]
    fn cleanup_after_a_commit_does_not_remove_the_saved_file() {
        // The temporary file became the target, so a later cleanup must not delete it.
        let dir = temp_dir("cleanup-after-commit");
        let target = dir.join("shot.png");
        let mut sink = SafeFileSink::new(target.clone());
        sink.stage(b"NEW").expect("staging should succeed");
        sink.commit().expect("the commit should succeed");

        sink.cleanup();

        assert_eq!(std::fs::read(&target).unwrap(), b"NEW");
    }

    #[test]
    fn committing_without_staging_is_an_error() {
        let dir = temp_dir("no-stage");
        let mut sink = SafeFileSink::new(dir.join("shot.png"));

        assert!(matches!(sink.commit(), Err(ExportError::WriteFailed(_))));
    }

    #[test]
    fn a_missing_file_and_an_empty_file_are_different_identities() {
        // Otherwise a zero-length file appearing at the path would pass the check.
        let dir = temp_dir("identity");
        let path = dir.join("probe");
        let missing = TargetIdentity::observe(&path);

        std::fs::write(&path, b"").unwrap();

        assert_ne!(TargetIdentity::observe(&path), missing);
    }
}
