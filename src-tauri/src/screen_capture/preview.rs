//! Serving the mosaicked preview image.
//!
//! §5.3 requires the preview to show real mosaic pixels. Drawing an outline where a
//! mosaic will be is worse than showing nothing: the user reads it as "covered" and
//! copies an image that still contains what they meant to hide.
//!
//! `mosaic.rs` is the only implementation of the algorithm, so the preview cannot be
//! recomputed in the WebView. Instead, committing a mosaic asks Rust for a freshly
//! rendered image of the selection and displays that. This is a discrete user action,
//! not a per-frame cost, so a round trip is affordable. §9 still applies: the pixels
//! travel over the local URI scheme, never as Base64 through an invoke.

use std::sync::{Arc, Mutex};

/// The current mosaicked preview, if one has been rendered.
///
/// One at a time: an older preview is never useful, because the document it belonged
/// to has already changed.
#[derive(Debug, Default)]
pub struct PreviewStore(Mutex<Option<Preview>>);

#[derive(Debug)]
struct Preview {
    session_id: u64,
    /// Increments per render so each preview gets a URL the WebView has not cached.
    serial: u64,
    png: Arc<Vec<u8>>,
}

impl PreviewStore {
    /// Stores a rendered preview and returns its serial for the URL.
    pub(crate) fn store(&self, session_id: u64, png: Vec<u8>) -> u64 {
        let mut guard = self.0.lock().unwrap();
        // Continuing the count within a session, so a re-render of the same selection
        // cannot collide with the previous URL in the WebView's cache.
        let serial = match guard.as_ref() {
            Some(previous) if previous.session_id == session_id => previous.serial + 1,
            _ => 1,
        };
        *guard = Some(Preview {
            session_id,
            serial,
            png: Arc::new(png),
        });
        serial
    }

    /// Returns the preview only for the exact session and serial requested.
    pub(crate) fn png(&self, session_id: u64, serial: u64) -> Option<Arc<Vec<u8>>> {
        let guard = self.0.lock().unwrap();
        let preview = guard.as_ref()?;
        if preview.session_id != session_id || preview.serial != serial {
            return None;
        }
        Some(Arc::clone(&preview.png))
    }

    /// §8.3: the session's buffers are released when it ends.
    pub(crate) fn clear(&self) {
        *self.0.lock().unwrap() = None;
    }

    pub(crate) fn clear_if_session(&self, session_id: u64) {
        let mut held = self.0.lock().unwrap();
        if held
            .as_ref()
            .is_some_and(|preview| preview.session_id == session_id)
        {
            *held = None;
        }
    }
}

/// Parses `/preview/<session>/<serial>`.
///
/// A distinct prefix rather than a third number, so the display-frame parser keeps
/// accepting exactly two numbers and the two kinds of request cannot be confused.
pub(crate) fn parse_preview_path(path: &str) -> Option<(u64, u64)> {
    let rest = path.trim_start_matches('/').strip_prefix("preview/")?;
    let mut parts = rest.split('/');
    let session = parts.next()?.parse::<u64>().ok()?;
    let serial = parts.next()?.parse::<u64>().ok()?;
    if parts.next().is_some() {
        return None;
    }
    Some((session, serial))
}

#[cfg(test)]
mod tests {
    use super::{parse_preview_path, PreviewStore};

    #[test]
    fn parses_a_session_and_serial_pair() {
        assert_eq!(parse_preview_path("/preview/7/2"), Some((7, 2)));
        assert_eq!(parse_preview_path("preview/7/2"), Some((7, 2)));
    }

    #[test]
    fn rejects_paths_that_are_not_previews() {
        // The display-frame shape must not be served as a preview.
        assert_eq!(parse_preview_path("/7/2"), None);
        assert_eq!(parse_preview_path("/preview/7"), None);
        assert_eq!(parse_preview_path("/preview/7/2/3"), None);
        assert_eq!(parse_preview_path("/preview/a/2"), None);
        assert_eq!(parse_preview_path("/preview//2"), None);
        assert_eq!(parse_preview_path("/preview/-1/2"), None);
    }

    #[test]
    fn serves_the_stored_preview() {
        let store = PreviewStore::default();

        let serial = store.store(7, vec![1, 2, 3]);

        assert_eq!(store.png(7, serial).as_deref(), Some(&vec![1, 2, 3]));
    }

    #[test]
    fn numbers_previews_from_one_within_a_session() {
        let store = PreviewStore::default();

        assert_eq!(store.store(7, vec![1]), 1);
        assert_eq!(store.store(7, vec![2]), 2);
        assert_eq!(store.store(7, vec![3]), 3);
    }

    #[test]
    fn a_new_serial_does_not_collide_with_the_previous_url() {
        // Otherwise the WebView could show a cached older preview, which would mean
        // showing the user a mosaic state that is not the one they are exporting.
        let store = PreviewStore::default();
        let first = store.store(7, vec![1]);

        let second = store.store(7, vec![2]);

        assert_ne!(first, second);
        assert_eq!(store.png(7, second).as_deref(), Some(&vec![2]));
    }

    #[test]
    fn only_the_newest_preview_is_served() {
        // An older preview belongs to a document that has already changed.
        let store = PreviewStore::default();
        let first = store.store(7, vec![1]);
        store.store(7, vec![2]);

        assert_eq!(store.png(7, first), None);
    }

    #[test]
    fn refuses_a_request_from_another_session() {
        let store = PreviewStore::default();
        let serial = store.store(7, vec![1]);

        assert_eq!(store.png(8, serial), None);
    }

    #[test]
    fn a_new_session_restarts_the_count() {
        let store = PreviewStore::default();
        store.store(7, vec![1]);
        store.store(7, vec![2]);

        assert_eq!(store.store(8, vec![3]), 1);
    }

    #[test]
    fn clearing_releases_the_preview() {
        let store = PreviewStore::default();
        let serial = store.store(7, vec![1]);

        store.clear();

        assert_eq!(store.png(7, serial), None);
    }

    #[test]
    fn old_cleanup_does_not_clear_a_new_preview() {
        let store = PreviewStore::default();
        let serial = store.store(2, vec![1, 2, 3]);
        store.clear_if_session(1);
        assert!(store.png(2, serial).is_some());
        store.clear_if_session(2);
        assert!(store.png(2, serial).is_none());
    }

    #[test]
    fn serves_the_same_buffer_rather_than_copying_it() {
        // A preview of a large selection is several megabytes; serving it should not
        // duplicate the buffer per request.
        let store = PreviewStore::default();
        let serial = store.store(7, vec![1, 2, 3]);

        let first = store.png(7, serial).expect("the preview should be served");
        let second = store.png(7, serial).expect("the preview should be served");

        assert!(std::sync::Arc::ptr_eq(&first, &second));
    }
}
