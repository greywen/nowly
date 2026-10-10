use crate::error::CommandError;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, Runtime};

pub const HISTORY_LABEL: &str = "screenshot-history";

#[derive(Default)]
pub struct ScreenshotWindows(Mutex<Option<bool>>);

fn ensure_idle<R: Runtime>(app: &AppHandle<R>) -> Result<(), CommandError> {
    if app
        .state::<ScreenshotWindows>()
        .0
        .lock()
        .map_err(|_| CommandError::system("无法读取截图窗口状态。"))?
        .is_some()
        || crate::screen_capture::is_active(app)
    {
        return Err(CommandError::system("截图正在进行中。"));
    }
    Ok(())
}

fn on_main_thread<R: Runtime>(
    app: &AppHandle<R>,
    action: impl FnOnce(&AppHandle<R>) -> Result<(), CommandError> + Send + 'static,
) -> Result<(), CommandError> {
    let (send, receive) = std::sync::mpsc::sync_channel(1);
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let _ = send.send(action(&handle));
    })
    .map_err(|_| CommandError::system("无法调度截图窗口。"))?;
    receive
        .recv()
        .map_err(|_| CommandError::system("截图窗口操作已中断。"))?
}

pub fn open_history<R: Runtime>(app: &AppHandle<R>) -> Result<(), CommandError> {
    on_main_thread(app, |app| {
        ensure_idle(app)?;
        crate::quick_panel::open_history_panel(app).map_err(CommandError::system)
    })
}

fn can_open_history(label: &str) -> bool {
    matches!(label, "main" | "quick-panel-handle" | HISTORY_LABEL)
}

#[tauri::command(async)]
pub fn open_screenshot_history(app: AppHandle, window: tauri::Window) -> Result<(), CommandError> {
    if !can_open_history(window.label()) {
        return Err(CommandError::system("该窗口不能打开截图历史。"));
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
    let history = app.get_webview_window(HISTORY_LABEL);
    let visible = history.as_ref().is_some_and(|window| {
        window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(false)
    });
    if let Some(history) = history {
        let _ = history.hide();
    }
    *suppressed = Some(visible);
}

pub fn restore_after_capture<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<ScreenshotWindows>();
    let Ok(mut suppressed) = state.0.lock() else {
        return;
    };
    if suppressed.take() == Some(true) {
        if let Some(history) = app.get_webview_window(HISTORY_LABEL) {
            #[cfg(windows)]
            if let Ok(hwnd) = history.hwnd() {
                unsafe {
                    let _ = windows::Win32::UI::WindowsAndMessaging::ShowWindow(
                        hwnd,
                        windows::Win32::UI::WindowsAndMessaging::SW_SHOWNOACTIVATE,
                    );
                }
            }
            #[cfg(not(windows))]
            let _ = history.show();
        }
    }
}

#[cfg(test)]
mod tests {
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
