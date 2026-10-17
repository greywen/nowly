use crate::error::CommandError;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, Runtime};

pub const HISTORY_LABEL: &str = "screenshot-history";

#[derive(Default)]
pub struct ScreenshotWindows(Mutex<Option<Vec<String>>>);

fn ensure_idle<R: Runtime>(app: &AppHandle<R>) -> Result<(), CommandError> {
    if app
        .state::<ScreenshotWindows>()
        .0
        .lock()
        .map_err(|_| CommandError::system("Unable to read the screenshot window state."))?
        .is_some()
        || crate::screen_capture::is_active(app)
    {
        return Err(CommandError::system("A screenshot is in progress."));
    }
    Ok(())
}

pub fn open_history<R: Runtime>(app: &AppHandle<R>) -> Result<(), CommandError> {
    ensure_idle(app)?;
    crate::quick_panel::open_history_panel(app).map_err(CommandError::system)
}

fn can_open_history(label: &str) -> bool {
    matches!(label, "main" | "quick-panel-handle" | HISTORY_LABEL)
}

#[tauri::command(async)]
pub fn open_screenshot_history(app: AppHandle, window: tauri::Window) -> Result<(), CommandError> {
    if !can_open_history(window.label()) {
        return Err(CommandError::system("This window cannot open screenshot history."));
    }
    open_history(&app)
}

pub fn suppress_for_capture<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<ScreenshotWindows>();
    let Ok(mut suppressed) = state.0.lock() else {
        return;
    };
    if suppressed.is_some() {
        return;
    }
    let mut labels = app.state::<crate::screenshot_pins::ScreenshotPins>().labels();
    labels.push(HISTORY_LABEL.into());
    let mut visible = Vec::new();
    for label in labels {
        if let Some(window) = app.get_webview_window(&label) {
            if window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(false) {
                visible.push(label);
                let _ = window.hide();
            }
        }
    }
    *suppressed = Some(visible);
}

pub fn restore_after_capture<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<ScreenshotWindows>();
    let Ok(mut suppressed) = state.0.lock() else {
        return;
    };
    if let Some(labels) = suppressed.take() {
        for label in labels {
            if let Some(window) = app.get_webview_window(&label) {
                crate::screenshot_pins::show_without_activation(&window);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn capture_suppression_snapshots_pins_and_restores_without_activation() {
        let source = include_str!("screenshot_windows.rs");
        let suppress = source.split("pub fn suppress_for_capture").nth(1).unwrap().split("pub fn restore_after_capture").next().unwrap();
        assert!(suppress.contains("ScreenshotPins"));
        let restore = source.split("pub fn restore_after_capture").nth(1).unwrap().split("#[cfg(test)]").next().unwrap();
        assert!(restore.contains("show_without_activation"));
        assert!(!restore.contains("set_focus"));
    }

    #[test]
    fn history_does_not_schedule_positioning_back_onto_the_ui_thread() {
        let source = include_str!("screenshot_windows.rs");
        let start = source.find("pub fn open_history<").unwrap();
        let end = start + source[start..].find("\n}").unwrap();
        assert!(!source[start..end].contains("on_main_thread"));
    }

    #[test]
    fn only_real_application_surfaces_can_open_history() {
        for label in ["main", "quick-panel-handle", super::HISTORY_LABEL] {
            assert!(super::can_open_history(label));
        }
        for label in ["untrusted", "screenshot-session-1", "screenshot-overlay-1-0"] {
            assert!(!super::can_open_history(label));
        }
    }
}
