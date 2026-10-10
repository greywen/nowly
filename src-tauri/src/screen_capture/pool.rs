//! Capture WebViews built ahead of the click.
//!
//! Creating a WebView2 controller, loading `screenshot.html` and mounting React
//! costs hundreds of milliseconds per window, so doing it after the click puts
//! all of that between the frozen desktop and the first usable overlay. Instead,
//! while no capture is running, the windows for the *next* session id are built
//! hidden and left idle. The click then only repositions them.
//!
//! Prewarmed windows carry the label of the session that will use them, so every
//! existing per-session rule — ownership checks, teardown destroying all of a
//! session's windows, a fresh document per session — applies unchanged. Nothing
//! is captured while prewarming, and hidden windows never appear in a capture.

use std::sync::Mutex;
use std::time::Duration;

use super::session::StartFailure;
use super::window::{session_label, OverlayPlan};
use tauri::Manager;

/// Serialises window creation, so a prewarm and a starting session can never
/// both build the same label.
static BUILDING: Mutex<()> = Mutex::new(());

/// The document every capture surface loads.
///
/// Deliberately not `WebviewUrl::default()` (`index.html`): that entry pulls the
/// dashboard, its data layer and the editor stack onto the startup critical
/// path. `screenshot.html` imports only the capture surfaces.
fn capture_surface_url() -> tauri::WebviewUrl {
    tauri::WebviewUrl::App("screenshot.html".into())
}

/// Gives `session_id` a session window and one overlay per planned display,
/// creating only what does not already exist. Returns how many overlays were
/// reused from a prewarm.
///
/// `guard` is consulted between native calls; a window built after it fails is
/// destroyed again, because it may already have missed its session's teardown.
/// Overlays for displays no longer in the plan are left hidden: destroying one
/// here could end a session that has just begun, and teardown removes them.
pub(crate) fn reconcile<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    session_id: u64,
    plan: &[OverlayPlan],
    guard: &dyn Fn() -> Result<(), StartFailure>,
) -> Result<usize, StartFailure> {
    use tauri::WebviewWindowBuilder;

    let _building = BUILDING
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let built = |window: &tauri::WebviewWindow<R>| {
        if let Err(failure) = guard() {
            let _ = window.destroy();
            return Err(failure);
        }
        Ok(())
    };

    guard()?;
    let label = session_label(session_id);
    if app.get_webview_window(&label).is_none() {
        let window = WebviewWindowBuilder::new(app, label, capture_surface_url())
            .title("Nowly")
            .inner_size(480.0, 320.0)
            .resizable(false)
            .maximizable(false)
            .focused(false)
            .visible(false)
            .skip_taskbar(false)
            .build()
            .map_err(|error| StartFailure::Window(format!("session window: {error}")))?;
        built(&window)?;
    }

    let mut reused = 0;
    let chrome = super::window::overlay_chrome();
    for overlay in plan {
        guard()?;
        let window = match app.get_webview_window(&overlay.label) {
            Some(window) => {
                reused += 1;
                window
            }
            None => {
                let window = WebviewWindowBuilder::new(app, &overlay.label, capture_surface_url())
                    .title("Nowly")
                    .decorations(chrome.decorations)
                    .shadow(chrome.shadow)
                    .transparent(chrome.transparent)
                    .always_on_top(chrome.always_on_top)
                    .resizable(chrome.resizable)
                    .maximizable(chrome.maximizable)
                    .skip_taskbar(chrome.skip_taskbar)
                    .focused(false)
                    .visible(false)
                    .build()
                    .map_err(|error| StartFailure::Window(format!("overlay window: {error}")))?;
                built(&window)?;
                window
            }
        };
        // Reused prewarmed windows were built earlier in this process. Reapply
        // the chrome so a window created before the flag was set cannot keep a
        // native resize border into the session that is about to be shown.
        window
            .set_resizable(chrome.resizable)
            .map_err(|error| StartFailure::Window(error.to_string()))?;
        window
            .set_maximizable(chrome.maximizable)
            .map_err(|error| StartFailure::Window(error.to_string()))?;
        let position = tauri::PhysicalPosition::new(overlay.x, overlay.y);
        let size = tauri::PhysicalSize::new(overlay.width, overlay.height);
        if window.outer_position().ok() != Some(position) {
            window
                .set_position(position)
                .map_err(|error| StartFailure::Window(error.to_string()))?;
        }
        if window.inner_size().ok() != Some(size) {
            window
                .set_size(size)
                .map_err(|error| StartFailure::Window(error.to_string()))?;
        }
        built(&window)?;
    }
    Ok(reused)
}

/// Builds the next session's windows after `delay`, unless a capture is running.
pub(crate) fn schedule_prewarm<R: tauri::Runtime>(app: tauri::AppHandle<R>, delay: Duration) {
    let spawned = std::thread::Builder::new()
        .name("capture-prewarm".into())
        .spawn(move || {
            std::thread::sleep(delay);
            prewarm(&app);
        });
    if let Err(error) = spawned {
        eprintln!("capture prewarm could not start: {error}");
    }
}

fn prewarm<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let state = app.state::<super::ActiveCapture>();
    let Some(session_id) = state.prewarm_target() else {
        return;
    };
    #[cfg(target_os = "windows")]
    let displays = {
        use super::backend::CaptureSource;
        match super::gdi::GdiSource.displays() {
            Ok(displays) => displays,
            Err(error) => {
                eprintln!("capture prewarm skipped: {error:?}");
                return;
            }
        }
    };
    #[cfg(not(target_os = "windows"))]
    let displays: Vec<super::backend::DisplayInfo> = Vec::new();
    if displays.is_empty() {
        return;
    }
    let plan = super::window::overlay_plan(session_id, &displays);
    let started = std::time::Instant::now();
    let guard = || {
        if state.may_build_for(session_id) {
            Ok(())
        } else {
            Err(StartFailure::Cancelled)
        }
    };
    match reconcile(app, session_id, &plan, &guard) {
        Ok(reused) => eprintln!(
            "capture session={session_id} phase=prewarmed overlays={} reused={reused} elapsed_ms={}",
            plan.len(),
            started.elapsed().as_millis()
        ),
        Err(failure) => {
            eprintln!("capture session={session_id} phase=prewarm-stopped reason={failure:?}")
        }
    }
}
