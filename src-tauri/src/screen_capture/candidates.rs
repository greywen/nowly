//! Frozen window rectangles only; native identities never reach the renderer.

use super::backend::DisplayInfo;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
pub(crate) struct WindowBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Copy)]
struct WindowSnapshot {
    bounds: WindowBounds,
    visible: bool,
    minimized: bool,
    cloaked: bool,
    excluded: bool,
}

fn eligible(snapshot: &WindowSnapshot) -> bool {
    snapshot.visible
        && !snapshot.minimized
        && !snapshot.cloaked
        && !snapshot.excluded
        && snapshot.bounds.width > 0
        && snapshot.bounds.height > 0
}

pub(crate) fn clip_to_display(
    candidates: &[WindowBounds],
    display: &DisplayInfo,
) -> Vec<WindowBounds> {
    let left = i64::from(display.x);
    let top = i64::from(display.y);
    let right = left + i64::from(display.width);
    let bottom = top + i64::from(display.height);
    candidates
        .iter()
        .filter_map(|candidate| {
            let x = i64::from(candidate.x).max(left);
            let y = i64::from(candidate.y).max(top);
            let end_x = (i64::from(candidate.x) + i64::from(candidate.width)).min(right);
            let end_y = (i64::from(candidate.y) + i64::from(candidate.height)).min(bottom);
            if end_x <= x || end_y <= y {
                return None;
            }
            Some(WindowBounds {
                x: i32::try_from(x - left).ok()?,
                y: i32::try_from(y - top).ok()?,
                width: u32::try_from(end_x - x).ok()?,
                height: u32::try_from(end_y - y).ok()?,
            })
        })
        .collect()
}

#[cfg(target_os = "windows")]
pub(crate) fn snapshot<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<Vec<WindowBounds>, String> {
    use std::collections::HashSet;
    use tauri::Manager;
    use windows::core::BOOL;
    use windows::Win32::Foundation::{HWND, LPARAM, RECT};
    use windows::Win32::Graphics::Dwm::{
        DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowRect, IsIconic, IsWindowVisible,
    };

    struct Enumeration {
        excluded: HashSet<usize>,
        bounds: Vec<WindowBounds>,
    }

    unsafe extern "system" fn visit(hwnd: HWND, parameter: LPARAM) -> BOOL {
        let enumeration = &mut *(parameter.0 as *mut Enumeration);
        let excluded = enumeration.excluded.contains(&(hwnd.0 as usize));
        let visible = IsWindowVisible(hwnd).as_bool();
        let minimized = IsIconic(hwnd).as_bool();
        if excluded || !visible || minimized {
            return BOOL(1);
        }
        let mut cloaked: u32 = 0;
        if DwmGetWindowAttribute(
            hwnd,
            DWMWA_CLOAKED,
            (&mut cloaked as *mut u32).cast(),
            std::mem::size_of::<u32>() as u32,
        )
        .is_err()
        {
            // A window that vanished or cannot be inspected is not a target.
            return BOOL(1);
        }
        let mut rect = RECT::default();
        if DwmGetWindowAttribute(
            hwnd,
            DWMWA_EXTENDED_FRAME_BOUNDS,
            (&mut rect as *mut RECT).cast(),
            std::mem::size_of::<RECT>() as u32,
        )
        .is_err()
            && GetWindowRect(hwnd, &mut rect).is_err()
        {
            return BOOL(1);
        }
        let width = i64::from(rect.right) - i64::from(rect.left);
        let height = i64::from(rect.bottom) - i64::from(rect.top);
        let (Ok(width), Ok(height)) = (u32::try_from(width), u32::try_from(height)) else {
            return BOOL(1);
        };
        let snapshot = WindowSnapshot {
            bounds: WindowBounds {
                x: rect.left,
                y: rect.top,
                width,
                height,
            },
            visible,
            minimized,
            cloaked: cloaked != 0,
            excluded,
        };
        if eligible(&snapshot) {
            enumeration.bounds.push(snapshot.bounds);
        }
        BOOL(1)
    }

    let excluded = app
        .webview_windows()
        .into_iter()
        .filter(|(label, _)| {
            label == "quick-panel-handle" || super::window::is_screenshot_label(label)
        })
        .filter_map(|(_, window)| window.hwnd().ok().map(|handle| handle.0 as usize))
        .collect();
    let mut enumeration = Enumeration {
        excluded,
        bounds: Vec::new(),
    };
    // Preserve top-level z-order. EnumWindows avoids following destroyed HWND
    // links or entering the unbounded traversal possible with GetWindow loops.
    unsafe {
        EnumWindows(
            Some(visit),
            LPARAM((&mut enumeration as *mut Enumeration) as isize),
        )
        .map_err(|_| "could not enumerate capture window candidates".to_owned())?;
    }
    Ok(enumeration.bounds)
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn snapshot<R: tauri::Runtime>(
    _app: &tauri::AppHandle<R>,
) -> Result<Vec<WindowBounds>, String> {
    Ok(Vec::new())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot() -> WindowSnapshot {
        WindowSnapshot {
            bounds: WindowBounds {
                x: 20,
                y: 30,
                width: 640,
                height: 480,
            },
            visible: true,
            minimized: false,
            cloaked: false,
            excluded: false,
        }
    }

    fn display() -> DisplayInfo {
        DisplayInfo {
            id: 1,
            x: -1920,
            y: -200,
            width: 1920,
            height: 1080,
            scale_factor: 1.5,
            is_primary: false,
        }
    }

    #[test]
    fn eligibility_rejects_hidden_minimized_cloaked_empty_and_helper_windows() {
        assert!(
            eligible(&snapshot()),
            "an ordinary visible app window is eligible"
        );
        let invalid = [
            WindowSnapshot {
                visible: false,
                ..snapshot()
            },
            WindowSnapshot {
                minimized: true,
                ..snapshot()
            },
            WindowSnapshot {
                cloaked: true,
                ..snapshot()
            },
            WindowSnapshot {
                excluded: true,
                ..snapshot()
            },
            WindowSnapshot {
                bounds: WindowBounds {
                    width: 0,
                    ..snapshot().bounds
                },
                ..snapshot()
            },
            WindowSnapshot {
                bounds: WindowBounds {
                    height: 0,
                    ..snapshot().bounds
                },
                ..snapshot()
            },
        ];
        for candidate in invalid {
            assert!(!eligible(&candidate), "ineligible candidate: {candidate:?}");
        }
    }

    #[test]
    fn clips_negative_origins_to_display_local_physical_pixels_without_rescaling() {
        let candidates = [
            WindowBounds {
                x: -1900,
                y: -170,
                width: 640,
                height: 480,
            },
            WindowBounds {
                x: -2000,
                y: -250,
                width: 180,
                height: 150,
            },
            WindowBounds {
                x: -20,
                y: 860,
                width: 200,
                height: 200,
            },
            WindowBounds {
                x: 0,
                y: 0,
                width: 400,
                height: 300,
            },
        ];
        assert_eq!(
            clip_to_display(&candidates, &display()),
            vec![
                WindowBounds {
                    x: 20,
                    y: 30,
                    width: 640,
                    height: 480
                },
                WindowBounds {
                    x: 0,
                    y: 0,
                    width: 100,
                    height: 100
                },
                WindowBounds {
                    x: 1900,
                    y: 1060,
                    width: 20,
                    height: 20
                },
            ]
        );
    }

    #[test]
    fn clipping_preserves_topmost_first_order_and_removes_empty_rectangles() {
        let top = WindowBounds {
            x: -1800,
            y: 0,
            width: 100,
            height: 80,
        };
        let bottom = WindowBounds {
            x: -1800,
            y: 0,
            width: 800,
            height: 600,
        };
        let empty = WindowBounds { width: 0, ..top };
        assert_eq!(
            clip_to_display(&[top, empty, bottom], &display()),
            vec![
                WindowBounds {
                    x: 120,
                    y: 200,
                    width: 100,
                    height: 80
                },
                WindowBounds {
                    x: 120,
                    y: 200,
                    width: 800,
                    height: 600
                },
            ]
        );
    }

    #[test]
    fn clipping_uses_wide_arithmetic_at_virtual_desktop_extremes() {
        let candidate = WindowBounds {
            x: i32::MIN,
            y: i32::MIN,
            width: u32::MAX,
            height: u32::MAX,
        };
        assert_eq!(
            clip_to_display(&[candidate], &display()),
            vec![WindowBounds {
                x: 0,
                y: 0,
                width: 1920,
                height: 1080
            },]
        );
    }
}
