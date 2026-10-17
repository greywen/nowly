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
    if label.starts_with("screenshot-scroll-control-") || label.starts_with("screenshot-scroll-preview-") {
        return matches!(command, "scroll_capture" | "scroll_capture_image");
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
            .resizable(false).focused(false).visible(false)
            .inner_size(display_width, display_height)
            .build().map_err(|_| CommandError::reported("Unable to open the pinned image. Retry."))?;
        let owner = app.clone();
        let own_label = label.clone();
        window.on_window_event(move |event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                owner.state::<ScreenshotPins>().remove(&own_label);
            }
        });
        show_without_activation(&window);
        Ok(label.clone())
    })();
    if result.is_err() { pins.remove(&label); }
    result
}

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
    fn screenshot_pins_zoom_keeps_ratio_and_rejects_non_finite_input() {
        assert_eq!(zoom_size(400, 200, 1.5).unwrap(), (600.0, 300.0));
        assert!(zoom_size(400, 200, f64::NAN).is_err());
        assert!(zoom_size(400, 200, 0.0).is_err());
        assert!(zoom_size(400, 200, 10.0).is_err());
    }
}
