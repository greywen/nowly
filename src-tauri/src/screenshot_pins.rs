use crate::error::CommandError;
use image::RgbaImage;
use std::{collections::HashMap, sync::{Arc, Mutex}, sync::atomic::{AtomicU64, Ordering}};
use tauri::{AppHandle, Manager, Runtime, WebviewUrl, WebviewWindowBuilder};

static NEXT_PIN: AtomicU64 = AtomicU64::new(1);
const LIMIT: usize = 5;

pub(crate) fn allows_command(label: &str, command: &str) -> bool {
    if label.starts_with("screenshot-pin-") {
        return matches!(command, "capture_pin_image" | "zoom_capture_pin");
    }
    true
}

#[derive(Default)]
pub struct ScreenshotPins(Mutex<HashMap<String, Option<PinImage>>>);
struct PinImage { bytes: Arc<Vec<u8>>, width: u32, height: u32 }

impl ScreenshotPins {
    fn reserve(&self) -> Result<String, CommandError> {
        let mut slots = self.0.lock().unwrap();
        if slots.len() >= LIMIT {
            return Err(CommandError { code: "pin_limit".into(), message: "Up to five images can be pinned. Close one and retry.".into(), field: None });
        }
        let label = format!("screenshot-pin-{}", NEXT_PIN.fetch_add(1, Ordering::Relaxed));
        slots.insert(label.clone(), None);
        Ok(label)
    }
    fn commit(&self, label: &str, bytes: Vec<u8>, width: u32, height: u32) -> Result<(), CommandError> {
        let mut slots = self.0.lock().unwrap();
        let slot = slots.get_mut(label).ok_or_else(|| CommandError::reported("The pinned image was closed."))?;
        *slot = Some(PinImage { bytes: Arc::new(bytes), width, height });
        Ok(())
    }
    fn remove(&self, label: &str) { self.0.lock().unwrap().remove(label); }
    fn image(&self, label: &str) -> Result<Vec<u8>, CommandError> {
        let image = self.0.lock().unwrap().get(label).and_then(|p| p.as_ref()).map(|p| p.bytes.clone())
            .ok_or_else(|| CommandError::reported("This window cannot read a pinned image."))?;
        Ok((*image).clone())
    }
    pub(crate) fn labels(&self) -> Vec<String> { self.0.lock().unwrap().keys().cloned().collect() }
}

fn zoom_size(width: u32, height: u32, scale: f64) -> Result<(f64, f64), CommandError> {
    if !scale.is_finite() || !(0.1..=4.0).contains(&scale) || width == 0 || height == 0 {
        return Err(CommandError::reported("The pinned image scale is out of range."));
    }
    Ok((f64::from(width) * scale, f64::from(height) * scale))
}

fn initial_size(width: u32, height: u32, max_width: f64, max_height: f64) -> (f64, f64) {
    let image_space = (max_height - 48.0).max(1.0);
    let scale = (max_width / f64::from(width)).min(image_space / f64::from(height)).min(1.0);
    ((f64::from(width) * scale).max(240.0).min(max_width), (f64::from(height) * scale + 48.0).min(max_height))
}

pub fn create_pin<R: Runtime>(app: &AppHandle<R>, image: RgbaImage) -> Result<String, CommandError> {
    let pins = app.state::<ScreenshotPins>();
    let label = pins.reserve()?;
    let result = (|| {
        let (width, height) = image.dimensions();
        let bytes = crate::screen_capture::encode_bitmap_pixels(width, height, image.as_raw())
            .ok_or_else(|| CommandError::reported("Unable to encode the pinned image."))?;
        pins.commit(&label, bytes, width, height)?;
        let monitor = app.primary_monitor().ok().flatten();
        let (max_width, max_height) = monitor.as_ref().map(|m| {
            (800.0_f64.min(m.work_area().size.width as f64 / m.scale_factor()),
             648.0_f64.min(m.work_area().size.height as f64 / m.scale_factor()))
        }).unwrap_or((800.0, 648.0));
        let (display_width, display_height) = initial_size(width, height, max_width, max_height);
        let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("screenshot.html".into()))
            .title("Nowly — pinned image").decorations(false).always_on_top(true).skip_taskbar(true)
            .resizable(true).min_inner_size(240.0, 96.0).focused(false).visible(false)
            .inner_size(display_width, display_height)
            .build().map_err(|_| CommandError::reported("Unable to open the pinned image. Retry."))?;
        let owner = app.clone();
        let own_label = label.clone();
        window.on_window_event(move |event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                owner.state::<ScreenshotPins>().remove(&own_label);
            }
        });
        if let Err(error) = install_proportional_resize(&window, (display_width - 2.0) / (display_height - 51.0).max(1.0)) {
            let _ = window.close();
            return Err(error);
        }
        show_without_activation(&window);
        Ok(label.clone())
    })();
    if result.is_err() { pins.remove(&label); }
    result
}

#[cfg(windows)]
fn proportional_bounds(rect: &mut windows::Win32::Foundation::RECT, edge: usize, ratio: f64, chrome: (i32, i32), minimum: (i32, i32)) {
    let proposed_width = (rect.right - rect.left - chrome.0).max(1) as f64;
    let proposed_height = (rect.bottom - rect.top - chrome.1).max(1) as f64;
    let from_width = proposed_width;
    let from_height = proposed_height * ratio;
    let width = match edge {
        1 | 2 => from_width,
        3 | 6 => from_height,
        // Project corner movement onto the fixed aspect ratio.
        _ => (proposed_width + proposed_height / ratio) / (1.0 + 1.0 / (ratio * ratio)),
    }.max((minimum.0 - chrome.0) as f64).max((minimum.1 - chrome.1) as f64 * ratio);
    let height = (width / ratio).round() as i32 + chrome.1;
    let width = width.round() as i32 + chrome.0;
    if matches!(edge, 1 | 4 | 7) { rect.left = rect.right - width; } else { rect.right = rect.left + width; }
    if matches!(edge, 3 | 4 | 5) { rect.top = rect.bottom - height; } else { rect.bottom = rect.top + height; }
}

#[cfg(windows)]
unsafe extern "system" fn pin_resize_subclass(
    hwnd: windows::Win32::Foundation::HWND, message: u32,
    wparam: windows::Win32::Foundation::WPARAM, lparam: windows::Win32::Foundation::LPARAM,
    subclass_id: usize, data: usize,
) -> windows::Win32::Foundation::LRESULT {
    use windows::Win32::Foundation::{LRESULT, RECT};
    use windows::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass};
    use windows::Win32::UI::WindowsAndMessaging::{GetClientRect, GetWindowRect, WM_NCDESTROY, WM_SIZING};
    if message == WM_NCDESTROY {
        let _ = RemoveWindowSubclass(hwnd, Some(pin_resize_subclass), subclass_id);
        drop(Box::from_raw(data as *mut f64));
        return DefSubclassProc(hwnd, message, wparam, lparam);
    }
    if message == WM_SIZING && lparam.0 != 0 {
        let mut outer = RECT::default();
        let mut client = RECT::default();
        if GetWindowRect(hwnd, &mut outer).is_ok() && GetClientRect(hwnd, &mut client).is_ok() {
            let dpi = windows::Win32::UI::HiDpi::GetDpiForWindow(hwnd) as f64 / 96.0;
            let chrome = (outer.right - outer.left - client.right + client.left + (2.0 * dpi).round() as i32,
                outer.bottom - outer.top - client.bottom + client.top + (51.0 * dpi).round() as i32);
            proportional_bounds(&mut *(lparam.0 as *mut RECT), wparam.0, *(data as *const f64), chrome,
                ((240.0 * dpi).round() as i32, (96.0 * dpi).round() as i32));
            return LRESULT(1);
        }
    }
    DefSubclassProc(hwnd, message, wparam, lparam)
}

#[cfg(windows)]
fn install_proportional_resize<R: Runtime>(window: &tauri::WebviewWindow<R>, ratio: f64) -> Result<(), CommandError> {
    let native_window = window.clone();
    let (sender, receiver) = std::sync::mpsc::channel();
    window.run_on_main_thread(move || {
        let result = native_window.hwnd().map_err(|_| CommandError::reported("Unable to access the pinned window.")).and_then(|hwnd| {
            let data = Box::into_raw(Box::new(ratio));
            let installed = unsafe { windows::Win32::UI::Shell::SetWindowSubclass(hwnd, Some(pin_resize_subclass), 2, data as usize).as_bool() };
            if installed { Ok(()) } else {
                unsafe { drop(Box::from_raw(data)); }
                Err(CommandError::reported("Unable to enable proportional resizing."))
            }
        });
        let _ = sender.send(result);
    }).map_err(|_| CommandError::reported("Unable to configure the pinned window."))?;
    receiver.recv().map_err(|_| CommandError::reported("Unable to configure proportional resizing."))?
}

#[cfg(not(windows))]
fn install_proportional_resize<R: Runtime>(_window: &tauri::WebviewWindow<R>, _ratio: f64) -> Result<(), CommandError> { Ok(()) }

pub(crate) fn close_pin<R: Runtime>(app: &AppHandle<R>, label: &str) {
    app.state::<ScreenshotPins>().remove(label);
    if let Some(window) = app.get_webview_window(label) { let _ = window.close(); }
}

pub(crate) fn show_without_activation<R: Runtime>(window: &tauri::WebviewWindow<R>) {
    #[cfg(windows)]
    if let Ok(hwnd) = window.hwnd() {
        unsafe { let _ = windows::Win32::UI::WindowsAndMessaging::ShowWindow(hwnd, windows::Win32::UI::WindowsAndMessaging::SW_SHOWNOACTIVATE); }
    }
    #[cfg(not(windows))]
    let _ = window.show();
}

#[tauri::command(async)]
pub fn capture_pin_image(app: AppHandle, window: tauri::WebviewWindow) -> Result<tauri::ipc::Response, CommandError> {
    app.state::<ScreenshotPins>().image(window.label()).map(tauri::ipc::Response::new)
}

#[tauri::command(async)]
pub fn zoom_capture_pin(app: AppHandle, window: tauri::WebviewWindow, scale: f64) -> Result<(), CommandError> {
    let (width, height) = {
        let pins = app.state::<ScreenshotPins>();
        let slots = pins.0.lock().unwrap();
        let image = slots.get(window.label()).and_then(|p| p.as_ref())
            .ok_or_else(|| CommandError::reported("The pinned image was closed."))?;
        (image.width, image.height)
    };
    let (width, height) = zoom_size(width, height, scale)?;
    let monitor = window.current_monitor().ok().flatten();
    let factor = window.scale_factor().unwrap_or(1.0);
    let (max_width, max_height) = monitor.map(|m| (m.size().width as f64 / factor, m.size().height as f64 / factor))
        .unwrap_or((1280.0, 800.0));
    // Large images scroll inside the viewport; the close action never leaves it.
    window.set_size(tauri::LogicalSize::new(width.max(240.0).min(max_width), (height + 48.0).min(max_height)))
        .map_err(|_| CommandError::reported("Unable to resize the pinned image."))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn screenshot_pins_atomically_reserves_only_five_slots() {
        let pins = Arc::new(ScreenshotPins::default());
        let threads: Vec<_> = (0..20).map(|_| {
            let pins = pins.clone();
            std::thread::spawn(move || pins.reserve().ok())
        }).collect();
        let slots: Vec<_> = threads.into_iter().filter_map(|t| t.join().unwrap()).collect();
        assert_eq!(slots.len(), 5);
        assert!(pins.reserve().is_err());
        pins.remove(&slots[0]);
        assert!(pins.reserve().is_ok());
    }

    #[test]
    fn screenshot_pins_authorizes_only_the_live_unique_window() {
        let pins = ScreenshotPins::default();
        let label = pins.reserve().unwrap();
        assert!(pins.image(&label).is_err());
        pins.commit(&label, vec![1, 2, 3], 400, 200).unwrap();
        assert_eq!(pins.image(&label).unwrap(), vec![1, 2, 3]);
        assert!(pins.image("main").is_err());
        assert!(pins.image("screenshot-pin-0").is_err());
        pins.remove(&label);
        assert!(pins.image(&label).is_err());
        assert_ne!(pins.reserve().unwrap(), label);
    }

    #[test]
    fn screenshot_pins_initial_size_fits_work_area_and_keeps_image_ratio() {
        let (width, height) = initial_size(1000, 100000, 1200.0, 800.0);
        assert!(width <= 1200.0 && height <= 800.0);
        let (width, height) = initial_size(4000, 2000, 800.0, 600.0);
        assert_eq!((width, height), (800.0, 448.0));
    }

    #[test]
    fn screenshot_pins_failed_creation_releases_reservation() {
        let pins = ScreenshotPins::default();
        let label = pins.reserve().unwrap();
        pins.remove(&label);
        for _ in 0..5 { assert!(pins.reserve().is_ok()); }
    }

    #[test]
    fn screenshot_pins_finishes_session_only_after_final_image_creation() {
        let source = include_str!("screen_capture.rs");
        let body = source.split("pub fn pin_capture(").nth(1).expect("pin output must be connected").split("\n}").next().unwrap();
        let render = body.find("export::render_request").unwrap();
        let create = body.find("screenshot_pins::create_pin").unwrap();
        let finish = body.find("finish_capture").unwrap();
        assert!(render < create && create < finish);
        assert!(!body.contains("history::archive"));
        assert!(!body.contains("Clipboard"));
    }

    #[test]
    fn screenshot_pins_does_not_enter_main_window_hide_to_tray_lifecycle() {
        let source = include_str!("main.rs");
        let body = source.split(".on_window_event(").nth(1).unwrap();
        let pin = body.find("window.label().starts_with(\"screenshot-pin-\")").expect("pins must bypass main lifecycle");
        let history = body.find("window.label() == screenshot_windows::HISTORY_LABEL").unwrap();
        assert!(pin < history);
        assert!(body[pin..history].contains("return;"));
    }

    #[test]
    fn screenshot_pins_window_can_invoke_only_pin_commands() {
        assert!(allows_command("screenshot-pin-1", "capture_pin_image"));
        assert!(allows_command("screenshot-pin-1", "zoom_capture_pin"));
        assert!(!allows_command("screenshot-pin-1", "get_app_settings"));
        assert!(!allows_command("screenshot-pin-1", "read_attachment"));
        assert!(allows_command("main", "get_app_settings"));
    }

    #[test]
    fn screenshot_pins_allows_native_resizing_with_a_usable_minimum() {
        let source = include_str!("screenshot_pins.rs");
        let body = source.split("pub fn create_pin").nth(1).unwrap().split("pub(crate) fn close_pin").next().unwrap();
        assert!(body.contains(".resizable(true).min_inner_size(240.0, 96.0)"));
        let capability = include_str!("../capabilities/screenshot-pin.json");
        assert!(capability.contains("core:window:allow-start-resize-dragging"));
        assert!(!capability.contains("core:window:allow-set-size"));
    }

    #[cfg(windows)]
    #[test]
    fn screenshot_pins_resize_locks_ratio_for_all_edges_and_corners() {
        use windows::Win32::Foundation::RECT;
        for ratio in [2.0, 0.5, 1.0] {
            for dpi in [1.0, 1.5, 2.0] {
                let chrome = ((2.0 * dpi) as i32, (51.0 * dpi) as i32);
                let minimum = ((240.0 * dpi) as i32, (96.0 * dpi) as i32);
                for edge in 1..=8 {
                    for size in [(700, 450), (50, 60)] {
                        let mut rect = RECT { left: 100, top: 200, right: 100 + size.0, bottom: 200 + size.1 };
                        let original = rect;
                        proportional_bounds(&mut rect, edge, ratio, chrome, minimum);
                        let width = rect.right - rect.left;
                        let height = rect.bottom - rect.top;
                        assert!(width >= minimum.0 && height >= minimum.1);
                        assert!(((width - chrome.0) as f64 - (height - chrome.1) as f64 * ratio).abs() <= ratio.max(1.0));
                        if matches!(edge, 1 | 4 | 7) { assert_eq!(rect.right, original.right); }
                        else { assert_eq!(rect.left, original.left); }
                        if matches!(edge, 3 | 4 | 5) { assert_eq!(rect.bottom, original.bottom); }
                        else { assert_eq!(rect.top, original.top); }
                    }
                }
            }
        }
    }

    #[cfg(windows)]
    #[test]
    fn screenshot_pins_native_sizing_message_applies_ratio_before_resize() {
        use windows::Win32::Foundation::{LPARAM, RECT, WPARAM};
        use windows::Win32::UI::Shell::SetWindowSubclass;
        use windows::Win32::UI::WindowsAndMessaging::{CreateWindowExW, DestroyWindow, SendMessageW, WINDOW_EX_STYLE, WM_SIZING, WS_POPUP};
        unsafe {
            let hwnd = CreateWindowExW(WINDOW_EX_STYLE::default(), windows::core::w!("STATIC"), windows::core::w!("pin resize test"),
                WS_POPUP, 0, 0, 402, 251, None, None, None, None).unwrap();
            let data = Box::into_raw(Box::new(2.0_f64));
            assert!(SetWindowSubclass(hwnd, Some(pin_resize_subclass), 2, data as usize).as_bool());
            let dpi = windows::Win32::UI::HiDpi::GetDpiForWindow(hwnd) as f64 / 96.0;
            for edge in 1..=8 {
                let mut rect = RECT { left: 0, top: 0, right: 700, bottom: 400 };
                let result = SendMessageW(hwnd, WM_SIZING, Some(WPARAM(edge)), Some(LPARAM(&mut rect as *mut RECT as isize)));
                assert_eq!(result.0, 1);
                let width = rect.right - rect.left - (2.0 * dpi).round() as i32;
                let height = rect.bottom - rect.top - (51.0 * dpi).round() as i32;
                assert!((width - height * 2).abs() <= 2);
            }
            DestroyWindow(hwnd).unwrap();
        }
    }

    #[test]
    fn screenshot_pins_zoom_keeps_ratio_and_rejects_non_finite_input() {
        assert_eq!(zoom_size(400, 200, 1.5).unwrap(), (600.0, 300.0));
        assert!(zoom_size(400, 200, f64::NAN).is_err());
        assert!(zoom_size(400, 200, 0.0).is_err());
        assert!(zoom_size(400, 200, 10.0).is_err());
    }
}
