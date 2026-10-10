//! Window layout for a capture session.
//!
//! Two kinds of window, per `2026-09-25-nowly-screenshot-design.md` §3.2 and
//! §3.3:
//!
//! - One session window owns the single taskbar and Alt+Tab entry, showing a
//!   static placeholder. It must never show the frozen desktop, so a suspended
//!   session cannot leak an unredacted thumbnail through Peek.
//! - One auxiliary overlay per display, sized to that display's physical
//!   rectangle, carrying the frozen frame and the selection UI. These skip the
//!   taskbar so a multi-monitor session still produces exactly one task switch
//!   item.
//!
//! The planning here is deliberately pure: labels and physical geometry are
//! decided without touching Tauri, so the coordinate rules are testable without
//! a desktop.

use super::backend::DisplayInfo;

/// Owns the one taskbar/Alt+Tab entry for a session.
pub(crate) const SESSION_WINDOW_LABEL: &str = "screenshot-session-";
/// Auxiliary per-display overlays. Tauri labels allow `-` and digits.
pub(crate) const OVERLAY_LABEL_PREFIX: &str = "screenshot-overlay-";

/// `STARTING`'s fault ceiling from §3.2.7. A failure bound, not a performance
/// goal: exceeding it fails the startup instead of showing a partial desktop.
pub(crate) const STARTUP_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

/// Window-manager chrome for a per-display overlay.
///
/// Kept as data so the freeze bug stays testable without creating a window:
/// Tao defaults `resizable` to true, and an undecorated resizable window still
/// has a native resize border. The overlay is exactly the display, so that
/// border is the screen edge. A full-screen selection's handles sit on it, and
/// dragging them enters the modal size loop of a transparent always-on-top
/// window. The UI thread then stops answering.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct OverlayChrome {
    pub decorations: bool,
    pub shadow: bool,
    pub transparent: bool,
    pub always_on_top: bool,
    pub resizable: bool,
    pub maximizable: bool,
    pub skip_taskbar: bool,
}

pub(crate) fn overlay_chrome() -> OverlayChrome {
    OverlayChrome {
        decorations: false,
        shadow: false,
        transparent: true,
        always_on_top: true,
        resizable: false,
        maximizable: false,
        skip_taskbar: true,
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct OverlayPlan {
    pub label: String,
    /// Signed virtual-desktop physical pixels, straight from the display.
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

pub(crate) fn session_label(session_id: u64) -> String {
    format!("{SESSION_WINDOW_LABEL}{session_id}")
}

pub(crate) fn overlay_label(session_id: u64, display_id: u32) -> String {
    format!("{OVERLAY_LABEL_PREFIX}{session_id}-{display_id}")
}

/// Every window this session owns, used to route the front end and to reject
/// capture commands arriving from any other window.
pub(crate) fn is_screenshot_label(label: &str) -> bool {
    window_session_id(label).is_some()
}

pub(crate) fn can_serve_session(label: &str, session_id: u64) -> bool {
    window_session_id(label) == Some(session_id)
}

pub(crate) fn presentation_priority(label: &str) -> u8 {
    u8::from(overlay_display_id(label).is_none())
}

pub(crate) fn window_session_id(label: &str) -> Option<u64> {
    if let Some(id) = label.strip_prefix(SESSION_WINDOW_LABEL) {
        return decimal(id);
    }
    let (session, display) = label.strip_prefix(OVERLAY_LABEL_PREFIX)?.split_once('-')?;
    decimal::<u32>(display)?;
    decimal(session)
}

fn decimal<T: std::str::FromStr>(value: &str) -> Option<T> {
    if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    value.parse().ok()
}

/// The display an overlay window belongs to, or `None` for anything that is not
/// an overlay label.
///
/// Strict: the suffix must be digits only, so a label cannot be coaxed into
/// reading another display's frame.
pub(crate) fn overlay_display_id(label: &str) -> Option<u32> {
    window_session_id(label)?;
    let (_, display) = label.strip_prefix(OVERLAY_LABEL_PREFIX)?.split_once('-')?;
    decimal(display)
}

/// One overlay per display, each covering exactly its own physical rectangle so
/// no display is resampled to a shared DPI.
pub(crate) fn overlay_plan(session_id: u64, displays: &[DisplayInfo]) -> Vec<OverlayPlan> {
    displays
        .iter()
        .map(|display| OverlayPlan {
            label: overlay_label(session_id, display.id),
            x: display.x,
            y: display.y,
            width: display.width,
            height: display.height,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::super::backend::DisplayInfo;
    use super::{
        is_screenshot_label, overlay_display_id, overlay_label, overlay_plan, OverlayPlan,
        SESSION_WINDOW_LABEL, STARTUP_TIMEOUT,
    };

    #[test]
    fn session_labels_are_owned_by_one_generation() {
        assert!(is_screenshot_label("screenshot-session-42"));
        assert!(is_screenshot_label("screenshot-overlay-42-0"));
        assert!(!is_screenshot_label("screenshot-session"));
        assert!(!is_screenshot_label("screenshot-overlay-0"));
        assert!(!is_screenshot_label("screenshot-overlay-42-0-extra"));
    }

    #[test]
    fn frame_ownership_rejects_other_sessions_even_from_capture_windows() {
        assert!(super::can_serve_session("screenshot-overlay-8-0", 8));
        assert!(!super::can_serve_session("screenshot-overlay-7-0", 8));
        assert!(!super::can_serve_session("screenshot-session-7", 8));
        assert!(!super::can_serve_session("main", 8));
    }

    #[test]
    fn decoded_overlays_are_presented_before_the_static_task_switch_entry() {
        let mut labels = [
            "screenshot-session-4",
            "screenshot-overlay-4-1",
            "screenshot-overlay-4-0",
        ];
        labels.sort_by_key(|label| (super::presentation_priority(label), *label));
        assert_eq!(
            labels,
            [
                "screenshot-overlay-4-0",
                "screenshot-overlay-4-1",
                "screenshot-session-4"
            ]
        );
        assert!(
            super::presentation_priority("screenshot-overlay-4-0")
                < super::presentation_priority("screenshot-session-4")
        );
    }

    fn display(id: u32, x: i32, y: i32, width: u32, height: u32, scale: f32) -> DisplayInfo {
        DisplayInfo {
            id,
            x,
            y,
            width,
            height,
            scale_factor: scale,
            is_primary: id == 0,
        }
    }

    #[test]
    fn plans_one_overlay_per_display_in_physical_pixels() {
        // A 2.0-scale display above and left of a 1.0-scale primary: each overlay
        // keeps its own physical rectangle, including negative origins.
        let displays = vec![
            display(0, 0, 0, 2240, 1400, 1.5),
            display(1, -1920, -200, 1920, 1080, 1.0),
        ];

        let plan = overlay_plan(1, &displays);

        assert_eq!(
            plan,
            vec![
                OverlayPlan {
                    label: "screenshot-overlay-1-0".to_owned(),
                    x: 0,
                    y: 0,
                    width: 2240,
                    height: 1400,
                },
                OverlayPlan {
                    label: "screenshot-overlay-1-1".to_owned(),
                    x: -1920,
                    y: -200,
                    width: 1920,
                    height: 1080,
                },
            ]
        );
    }

    #[test]
    fn plans_nothing_without_displays() {
        assert!(overlay_plan(1, &[]).is_empty());
    }

    #[test]
    fn overlay_labels_are_unique_per_display() {
        let displays = vec![display(0, 0, 0, 8, 8, 1.0), display(3, 8, 0, 8, 8, 1.0)];

        let labels: Vec<String> = overlay_plan(1, &displays)
            .into_iter()
            .map(|plan| plan.label)
            .collect();

        assert_eq!(
            labels,
            vec!["screenshot-overlay-1-0", "screenshot-overlay-1-3"]
        );
        // The session window must never collide with an overlay: it is the only
        // taskbar entry and shows a placeholder, not desktop pixels.
        assert!(!labels.contains(&SESSION_WINDOW_LABEL.to_owned()));
    }

    #[test]
    fn recognises_only_this_session_s_windows() {
        assert!(is_screenshot_label(&super::session_label(1)));
        assert!(is_screenshot_label(&overlay_label(1, 0)));
        assert!(is_screenshot_label(&overlay_label(1, 12)));

        // Guards §9's rule that sensitive commands check the calling window.
        assert!(!is_screenshot_label("main"));
        assert!(!is_screenshot_label("quick-panel-handle"));
        assert!(!is_screenshot_label("screenshot"));
        assert!(!is_screenshot_label(""));
    }

    #[test]
    fn reads_the_display_id_from_an_overlay_label() {
        assert_eq!(overlay_display_id("screenshot-overlay-1-0"), Some(0));
        assert_eq!(overlay_display_id("screenshot-overlay-1-12"), Some(12));
    }

    #[test]
    fn refuses_a_display_id_from_anything_else() {
        // This id selects which display's pixels are served, so nothing but a
        // plain digit suffix may parse.
        assert_eq!(overlay_display_id(SESSION_WINDOW_LABEL), None);
        assert_eq!(overlay_display_id("main"), None);
        assert_eq!(overlay_display_id("screenshot-overlay-"), None);
        assert_eq!(overlay_display_id("screenshot-overlay-1x"), None);
        assert_eq!(overlay_display_id("screenshot-overlay--1"), None);
        assert_eq!(overlay_display_id("screenshot-overlay-+1"), None);
        // Wider than u32: must not wrap into a valid id.
        assert_eq!(overlay_display_id("screenshot-overlay-4294967296"), None);
    }

    #[test]
    fn the_startup_ceiling_is_the_documented_five_seconds() {
        assert_eq!(STARTUP_TIMEOUT.as_secs(), 5);
    }

    #[test]
    fn an_overlay_is_not_a_resizable_window() {
        // The overlay is sized to the display. Tao's default `resizable: true`
        // gives an undecorated window a native resize border (WS_SIZEBOX plus
        // WM_NCHITTEST). A full-screen selection's edge handles sit on that
        // border, so dragging them enters the modal size loop of a transparent
        // always-on-top window and the UI thread stops answering.
        let chrome = super::overlay_chrome();
        assert!(!chrome.resizable);
        assert!(!chrome.maximizable);
        assert!(!chrome.decorations);
        assert!(!chrome.shadow);
        assert!(chrome.transparent);
        assert!(chrome.always_on_top);
    }
}
