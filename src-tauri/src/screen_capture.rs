//! The seam the Nowly Bar's screenshot button calls.
//!
//! The capture session itself is specified in
//! `docs/superpowers/specs/2026-09-25-nowly-screenshot-design.md` and is not
//! implemented yet. This module exists so the bar button has one real, named
//! entry point from the start: when the session lands it replaces the body of
//! `start_screen_capture`, and nothing in the bar, the settings UI or the
//! front-end registry has to change.
//!
//! Until then the command reports "not available" rather than silently doing
//! nothing, so the button never looks like it worked.

use crate::error::CommandError;

/// Whether a capture session can be started. Flips to a real check (single
/// session, monitor availability, capture permissions) with the implementation.
pub fn is_available() -> bool {
    false
}

/// Starts a desktop capture session.
///
/// Callers must be prepared for a rejection: the bar button renders the returned
/// message beside itself as static text, per design.md §11's Error state.
#[tauri::command]
pub fn start_screen_capture() -> Result<(), CommandError> {
    if !is_available() {
        return Err(CommandError::system("截图功能尚未可用。"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn the_seam_reports_unavailable_until_capture_is_implemented() {
        // Guards against the button shipping as a silent no-op: as long as the
        // session is unimplemented, the command must fail loudly.
        assert!(!super::is_available());
        assert!(super::start_screen_capture().is_err());
    }
}
