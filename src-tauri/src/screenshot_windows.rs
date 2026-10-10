use crate::error::CommandError;
use serde::Deserialize;
use std::sync::Mutex;
use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, Runtime, WebviewUrl,
    WebviewWindowBuilder,
};

pub const HISTORY_LABEL: &str = "screenshot-history";
pub const MENU_LABEL: &str = "screenshot-menu";
const MENU_WIDTH: f64 = 320.0;
const MENU_HEIGHT: f64 = 136.0;

#[derive(Default)]
pub struct ScreenshotWindows(Mutex<Option<bool>>);

#[derive(Clone, Copy)]
struct DesktopRect {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[derive(Deserialize)]
pub struct MenuAnchor {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl MenuAnchor {
    fn valid(&self) -> bool {
        // WebView rectangles can round past CSS bounds; the lane also overlaps
        // the shell's top border by 1px (top: -1px).
        const ROUNDING_EPSILON: f64 = 0.0001;
        [self.x, self.y, self.width, self.height]
            .iter()
            .all(|value| value.is_finite())
            && self.x >= -ROUNDING_EPSILON
            && self.y >= -1.0 - ROUNDING_EPSILON
            && self.x <= 432.0 + ROUNDING_EPSILON
            && self.y <= 440.0 + ROUNDING_EPSILON
            && self.width > 0.0
            && self.width <= 48.0 + ROUNDING_EPSILON
            && self.height > 0.0
            && self.height <= 40.0 + ROUNDING_EPSILON
    }
}

fn menu_position(anchor: DesktopRect, bounds: DesktopRect, scale: f64) -> (i32, i32) {
    let width = (MENU_WIDTH * scale).round() as i32;
    let height = (MENU_HEIGHT * scale).round() as i32;
    let gap = (8.0 * scale).round() as i32;
    let right = bounds.x.saturating_add(bounds.width as i32);
    let bottom = bounds.y.saturating_add(bounds.height as i32);
    let below = anchor
        .y
        .saturating_add(anchor.height as i32)
        .saturating_add(gap);
    let y = if below.saturating_add(height) <= bottom {
        below
    } else {
        anchor.y.saturating_sub(height).saturating_sub(gap)
    };
    (
        anchor
            .x
            .clamp(bounds.x, right.saturating_sub(width).max(bounds.x)),
        y.clamp(bounds.y, bottom.saturating_sub(height).max(bounds.y)),
    )
}

fn ensure_idle<R: Runtime>(app: &AppHandle<R>) -> Result<(), CommandError> {
    if app
        .state::<ScreenshotWindows>()
        .0
        .lock()
        .map_err(|_| CommandError::system("无法读取截图窗口状态。"))?
        .is_some()
    {
        return Err(CommandError::system("截图正在进行中。"));
    }
    if crate::screen_capture::is_active(app) {
        return Err(CommandError::system("截图正在进行中。"));
    }
    Ok(())
}

pub fn close_menu<R: Runtime>(app: &AppHandle<R>) -> Result<(), CommandError> {
    if let Some(menu) = app.get_webview_window(MENU_LABEL) {
        menu.hide()
            .map_err(|_| CommandError::system("无法关闭截图菜单。"))?;
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
    on_main_thread(app, open_history_on_main)
}

fn open_history_on_main<R: Runtime>(app: &AppHandle<R>) -> Result<(), CommandError> {
    ensure_idle(app)?;
    close_menu(app)?;
    crate::quick_panel::open_history_panel(app).map_err(CommandError::system)
}

#[tauri::command(async)]
pub fn open_screenshot_history(app: AppHandle, window: tauri::Window) -> Result<(), CommandError> {
    if !matches!(
        window.label(),
        "main" | "quick-panel-handle" | MENU_LABEL | HISTORY_LABEL
    ) {
        return Err(CommandError::system("该窗口不能打开截图历史。"));
    }
    open_history(&app)
}

#[tauri::command]
pub fn close_screenshot_menu(app: AppHandle, window: tauri::Window) -> Result<(), CommandError> {
    if !matches!(window.label(), MENU_LABEL | "quick-panel-handle") {
        return Err(CommandError::system("该窗口不能操作截图菜单。"));
    }
    close_menu(&app)
}

#[tauri::command(async)]
pub fn toggle_screenshot_menu(
    app: AppHandle,
    window: tauri::Window,
    anchor: MenuAnchor,
) -> Result<(), CommandError> {
    if window.label() != "quick-panel-handle" || !anchor.valid() {
        return Err(CommandError::system("截图菜单位置无效。"));
    }
    on_main_thread(&app, move |app| toggle_menu_on_main(app, window, anchor))
}

fn toggle_menu_on_main(
    app: &AppHandle,
    window: tauri::Window,
    anchor: MenuAnchor,
) -> Result<(), CommandError> {
    ensure_idle(app)?;
    if let Some(menu) = app.get_webview_window(MENU_LABEL) {
        if menu.is_visible().unwrap_or(false) {
            return close_menu(&app);
        }
    }
    let scale = window
        .scale_factor()
        .map_err(|_| CommandError::system("无法读取屏幕缩放。"))?;
    let origin = window
        .inner_position()
        .map_err(|_| CommandError::system("无法定位截图按钮。"))?;
    let monitor = window
        .current_monitor()
        .map_err(|_| CommandError::system("无法读取屏幕位置。"))?
        .ok_or_else(|| CommandError::system("无法读取屏幕位置。"))?;
    let bounds = DesktopRect {
        x: monitor.position().x,
        y: monitor.position().y,
        width: monitor.size().width,
        height: monitor.size().height,
    };
    let button = DesktopRect {
        x: origin.x + (anchor.x * scale).round() as i32,
        y: origin.y + (anchor.y * scale).round() as i32,
        width: (anchor.width * scale).round() as u32,
        height: (anchor.height * scale).round() as u32,
    };
    let (x, y) = menu_position(button, bounds, scale);
    let menu = match app.get_webview_window(MENU_LABEL) {
        Some(menu) => menu,
        None => WebviewWindowBuilder::new(app, MENU_LABEL, WebviewUrl::App("index.html".into()))
            .title("Nowly — 截图菜单")
            .inner_size(MENU_WIDTH, MENU_HEIGHT)
            .transparent(true)
            .decorations(false)
            .resizable(false)
            .maximizable(false)
            .minimizable(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .shadow(false)
            .visible(false)
            .build()
            .map_err(|_| CommandError::system("无法打开截图菜单。"))?,
    };
    menu.set_size(LogicalSize::new(MENU_WIDTH, MENU_HEIGHT))
        .map_err(|_| CommandError::system("无法调整截图菜单。"))?;
    menu.set_position(PhysicalPosition::new(x, y))
        .map_err(|_| CommandError::system("无法定位截图菜单。"))?;
    #[cfg(windows)]
    if let Ok(hwnd) = menu.hwnd() {
        use windows::Win32::Graphics::Gdi::{CreateRoundRectRgn, DeleteObject, SetWindowRgn};
        let menu_scale = menu.scale_factor().unwrap_or(scale);
        let width = (MENU_WIDTH * menu_scale).round() as i32;
        let height = (MENU_HEIGHT * menu_scale).round() as i32;
        let diameter = (30.4 * menu_scale).round() as i32;
        unsafe {
            let region = CreateRoundRectRgn(0, 0, width + 1, height + 1, diameter, diameter);
            if !region.0.is_null() && SetWindowRgn(hwnd, Some(region), true) == 0 {
                let _ = DeleteObject(region.into());
            }
        }
    }
    menu.show()
        .map_err(|_| CommandError::system("无法显示截图菜单。"))?;
    menu.set_focus()
        .map_err(|_| CommandError::system("无法聚焦截图菜单。"))?;
    let _ = menu.emit("screenshot-menu-opened", ());
    Ok(())
}

pub fn suppress_for_capture<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<ScreenshotWindows>();
    let Ok(mut suppressed) = state.0.lock() else {
        return;
    };
    if suppressed.is_some() {
        return;
    }
    let _ = close_menu(app);
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
    use super::*;

    #[test]
    fn positions_menu_under_button_without_leaving_monitor() {
        let bounds = DesktopRect {
            x: -1920,
            y: 0,
            width: 1920,
            height: 1080,
        };
        assert_eq!(
            menu_position(
                DesktopRect {
                    x: -28,
                    y: 8,
                    width: 28,
                    height: 28
                },
                bounds,
                1.0
            ),
            (-320, 44)
        );
        assert_eq!(
            menu_position(
                DesktopRect {
                    x: -1900,
                    y: 1020,
                    width: 28,
                    height: 28
                },
                bounds,
                1.0
            ),
            (-1900, 876)
        );
    }

    #[test]
    fn menu_position_accounts_for_display_scale_and_negative_origin() {
        let bounds = DesktopRect {
            x: -2560,
            y: -100,
            width: 2560,
            height: 1440,
        };
        assert_eq!(
            menu_position(
                DesktopRect {
                    x: -50,
                    y: -80,
                    width: 42,
                    height: 42
                },
                bounds,
                1.5
            ),
            (-480, -26)
        );
    }

    #[test]
    fn accepts_button_geometry_with_fractional_webview_rounding() {
        assert!(MenuAnchor {
            x: 323.5714416503906,
            y: -0.4285714626312256,
            width: 48.000003814697266,
            height: 40.0,
        }
        .valid());
        assert!(MenuAnchor {
            x: 384.0,
            y: 0.0,
            width: 48.0,
            height: 40.000003814697266,
        }
        .valid());
    }

    #[test]
    fn rejects_non_finite_or_outside_anchor_geometry() {
        assert!(!MenuAnchor {
            x: f64::NAN,
            y: 0.0,
            width: 28.0,
            height: 28.0
        }
        .valid());
        assert!(!MenuAnchor {
            x: -1.0,
            y: 0.0,
            width: 28.0,
            height: 28.0
        }
        .valid());
        for anchor in [
            MenuAnchor {
                x: 300.0,
                y: -1.01,
                width: 48.0,
                height: 40.0,
            },
            MenuAnchor {
                x: 300.0,
                y: 0.0,
                width: 48.01,
                height: 40.0,
            },
            MenuAnchor {
                x: 300.0,
                y: 0.0,
                width: 48.0,
                height: 40.01,
            },
            MenuAnchor {
                x: 433.0,
                y: 0.0,
                width: 48.0,
                height: 40.0,
            },
            MenuAnchor {
                x: 300.0,
                y: 441.0,
                width: 48.0,
                height: 40.0,
            },
            MenuAnchor {
                x: 300.0,
                y: 0.0,
                width: 0.0,
                height: 40.0,
            },
            MenuAnchor {
                x: 300.0,
                y: 0.0,
                width: 48.0,
                height: f64::INFINITY,
            },
        ] {
            assert!(!anchor.valid());
        }
        assert!(MenuAnchor {
            x: 300.0,
            y: 6.0,
            width: 28.0,
            height: 28.0
        }
        .valid());
    }
}
