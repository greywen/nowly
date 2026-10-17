use super::{
    scroll_target::{Region, Target},
    scroll_worker::{FrameSampler, ScrollMachine, ScrollPhase},
    stitcher::{RejectReason, StitchConfig, StitchOutcome, Stitcher},
};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};
#[derive(Default)]
pub struct ScrollCapture(
    pub(crate) Mutex<Option<Arc<Mutex<Session>>>>,
    Mutex<Option<(u64, bool)>>,
);
impl ScrollCapture {
    pub(crate) fn remember_main(&self, id: u64, visible: bool) {
        let mut held = self.1.lock().unwrap();
        if held.is_none() {
            *held = Some((id, visible));
        }
    }
    pub(crate) fn take_main(&self, id: u64) -> Option<bool> {
        let mut held = self.1.lock().unwrap();
        if held.as_ref().is_some_and(|(owner, _)| *owner == id) {
            held.take().map(|(_, visible)| visible)
        } else {
            None
        }
    }
}
pub(crate) struct Session {
    id: u64,
    owner: String,
    seams: Vec<u32>,
    revision: u64,
    machine: ScrollMachine,
    target: Target,
    stitcher: Option<Stitcher>,
    last_frame: Option<Vec<u8>>,
    worker: bool,
}
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Descriptor {
    session_id: String,
    revision: u64,
    phase: ScrollPhase,
    width: u32,
    height: u32,
    point: (i32, i32),
    region: Region,
    seams: Vec<u32>,
    reason: Option<String>,
}
impl Session {
    fn descriptor(&self) -> Descriptor {
        Descriptor {
            session_id: self.id.to_string(),
            revision: self.revision,
            phase: self.machine.phase,
            width: self.target.region.width,
            height: self.stitcher.as_ref().map_or(0, |s| s.height()),
            point: self.target.point,
            region: self.target.region,
            seams: self.seams.clone(),
            reason: self.machine.reason.clone(),
        }
    }
}
fn error(message: impl Into<String>) -> crate::error::CommandError {
    let message = message.into();
    eprintln!("scroll capture: {message}");
    crate::error::CommandError::system(message)
}
fn authorize(
    app: &tauri::AppHandle,
    window: &tauri::WebviewWindow,
) -> Result<u64, crate::error::CommandError> {
    let label = window.label();
    let id = super::window::window_session_id(label)
        .or_else(|| {
            label
                .strip_prefix("screenshot-scroll-control-")
                .or_else(|| label.strip_prefix("screenshot-scroll-preview-"))
                .and_then(|s| s.parse().ok())
        })
        .ok_or_else(|| error("Unauthorized scroll window"))?;
    if !app.state::<super::ActiveCapture>().is_current(id) {
        return Err(error("Screenshot session ended"));
    }
    Ok(id)
}
fn notify(app: &tauri::AppHandle, s: &Session) {
    let descriptor = s.descriptor();
    let _ = app.emit_to(&s.owner, "screenshot-scroll-state", descriptor.clone());
    for suffix in ["control", "preview"] {
        let _ = app.emit_to(
            format!("screenshot-scroll-{suffix}-{}", s.id),
            "screenshot-scroll-state",
            descriptor.clone(),
        );
    }
}
fn surfaces(app: &tauri::AppHandle, id: u64, show: bool) {
    let app = app.clone();
    let handle = app.clone();
    let (sent, received) = std::sync::mpsc::sync_channel(1);
    if app
        .run_on_main_thread(move || {
            surfaces_on_main(&handle, id, show);
            let _ = sent.send(());
        })
        .is_ok()
    {
        if received
            .recv_timeout(std::time::Duration::from_secs(2))
            .is_err()
        {
            eprintln!("scroll capture: visibility main-thread dispatch timed out");
        }
    }
}
fn surfaces_on_main(app: &tauri::AppHandle, id: u64, show: bool) {
    if !show {
        if let Some(main) = app.get_webview_window("main") {
            let visible = main.is_visible().unwrap_or(false);
            app.state::<ScrollCapture>().remember_main(id, visible);
            if visible {
                let _ = main.hide();
            }
        }
    } else {
        restore_main(app, id);
    }
    for (_, w) in app.webview_windows() {
        if super::window::window_session_id(w.label()) == Some(id) {
            let _ = if show { w.show() } else { w.hide() };
        }
    }
    #[cfg(windows)]
    if let Some(f) = app.try_state::<super::FreezeLayer>() {
        for display in 0..32 {
            if let Some(h) = f.window_for(id, display) {
                unsafe {
                    let _ = windows::Win32::UI::WindowsAndMessaging::ShowWindow(
                        windows::Win32::Foundation::HWND(h as *mut _),
                        if show {
                            windows::Win32::UI::WindowsAndMessaging::SW_SHOWNOACTIVATE
                        } else {
                            windows::Win32::UI::WindowsAndMessaging::SW_HIDE
                        },
                    );
                }
            }
        }
    }
}
fn restore_main<R: tauri::Runtime>(app: &tauri::AppHandle<R>, id: u64) {
    if app.state::<ScrollCapture>().take_main(id) == Some(true) {
        if let Some(main) = app.get_webview_window("main") {
            crate::screenshot_pins::show_without_activation(&main);
        }
    }
}
pub fn cancel<R: tauri::Runtime>(app: &tauri::AppHandle<R>, id: u64) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || restore_main(&handle, id));
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let _ = app.global_shortcut().unregister("Escape");
    if let Some(state) = app.try_state::<ScrollCapture>() {
        let mut held = state.0.lock().unwrap();
        if held.as_ref().is_some_and(|s| s.lock().unwrap().id == id) {
            if let Some(s) = held.take() {
                s.lock().unwrap().machine.cancel();
            }
        }
    }
    for suffix in ["control", "preview"] {
        if let Some(w) = app.get_webview_window(&format!("screenshot-scroll-{suffix}-{id}")) {
            let _ = w.close();
        }
    }
}
fn auxiliary(app: &tauri::AppHandle, id: u64, region: Region) -> Result<(), String> {
    let label = format!("screenshot-scroll-control-{id}");
    let monitor = app
        .available_monitors()
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|m| {
            let p = m.position();
            let size = m.size();
            region.x >= p.x
                && region.y >= p.y
                && region.x as i64 + region.width as i64 <= p.x as i64 + size.width as i64
                && region.y as i64 + region.height as i64 <= p.y as i64 + size.height as i64
        })
        .ok_or("Selection monitor unavailable")?;
    let scale = monitor.scale_factor();
    let size = monitor.size();
    let origin = monitor.position();
    let placement = super::scroll_target::control_placement(
        region,
        Region {
            x: origin.x,
            y: origin.y,
            width: size.width,
            height: size.height,
        },
        (432. * scale).ceil() as u32,
        (240. * scale).ceil() as u32,
    )
    .ok_or("No safe room for capture controls outside selection; choose a smaller region")?;
    let window = tauri::WebviewWindowBuilder::new(
        app,
        &label,
        tauri::WebviewUrl::App("screenshot.html".into()),
    )
    .title("Scroll capture")
    .inner_size(432., 240.)
    .position(placement.x as f64 / scale, placement.y as f64 / scale)
    .decorations(false)
    .resizable(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .focused(false)
    .visible(false)
    .build()
    .map_err(|e| e.to_string())?;
    #[cfg(windows)]
    {
        use windows::Win32::UI::WindowsAndMessaging::*;
        let handle = window.hwnd().map_err(|e| e.to_string())?;
        unsafe {
            let style = GetWindowLongPtrW(handle, GWL_EXSTYLE);
            SetWindowLongPtrW(handle, GWL_EXSTYLE, style | WS_EX_NOACTIVATE.0 as isize);
            SetWindowDisplayAffinity(handle, WDA_EXCLUDEFROMCAPTURE)
                .map_err(|_| "Cannot safely exclude scroll controls from capture")?;
        }
    }
    let handle = app.clone();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            let handle = handle.clone();
            std::thread::spawn(move || {
                let state = handle.state::<ScrollCapture>();
                let session = state.0.lock().unwrap().as_ref().cloned();
                if let Some(session) = session {
                    let mut session = session.lock().unwrap();
                    if session.id == id {
                        session.machine.cancel();
                        notify(&handle, &session);
                        drop(session);
                        cancel(&handle, id);
                        surfaces(&handle, id, true);
                    }
                }
            });
        }
    });
    window.show().map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command(async)]
pub fn scroll_capture(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    action: String,
    revision: Option<u64>,
    region: Option<Region>,
    point: Option<(i32, i32)>,
) -> Result<Option<Descriptor>, crate::error::CommandError> {
    let id = authorize(&app, &window)?;
    let state = app.state::<ScrollCapture>();
    if action == "prepare" {
        if state.0.lock().unwrap().is_some() {
            return Err(error("A scroll capture already exists"));
        }
        let region = region.ok_or_else(|| error("Select a region first"))?;
        super::validate_output_dimensions(region.width as u64, region.height as u64)
            .map_err(|_| error("Selection exceeds capture limits"))?;
        if region.height < 72 || region.width < 16 {
            return Err(error("Choose a larger scrolling region"));
        }
        let valid = app
            .state::<super::FrameStore>()
            .with_frames(id, |frames| {
                frames.iter().any(|f| {
                    region.x >= f.display.x
                        && region.y >= f.display.y
                        && region.x as i64 + region.width as i64
                            <= f.display.x as i64 + f.display.width as i64
                        && region.y as i64 + region.height as i64
                            <= f.display.y as i64 + f.display.height as i64
                })
            })
            .unwrap_or(false);
        if !valid {
            return Err(error("Scroll capture must stay on one screen"));
        }
        let point = point.unwrap_or((
            region.x + region.width as i32 / 2,
            region.y + region.height as i32 / 2,
        ));
        if point.0 < region.x
            || point.1 < region.y
            || point.0 as i64 >= region.x as i64 + region.width as i64
            || point.1 as i64 >= region.y as i64 + region.height as i64
        {
            return Err(error("Scroll point must be within selection"));
        }
        surfaces(&app, id, false);
        // Hiding our focused overlay lets Windows restore the previous app; never
        // activate or click an external target to make this safety check succeed.
        std::thread::sleep(std::time::Duration::from_millis(120));
        let target = match Target::bind(region, point) {
            Ok(t) => t,
            Err(e) => {
                surfaces(&app, id, true);
                return Err(error(e));
            }
        };

        use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
        let handle = app.clone();
        if let Err(e) = app
            .global_shortcut()
            .on_shortcut("Escape", move |_, _, event| {
                if event.state == ShortcutState::Pressed {
                    if let Some(session) =
                        handle.state::<ScrollCapture>().0.lock().unwrap().as_ref()
                    {
                        let mut s = session.lock().unwrap();
                        s.machine.escape();
                        notify(&handle, &s);
                        if s.machine.phase == ScrollPhase::Cancelled {
                            let id = s.id;
                            let app = handle.clone();
                            std::thread::spawn(move || {
                                cancel(&app, id);
                                surfaces(&app, id, true);
                            });
                        }
                    }
                }
            })
        {
            cancel(&app, id);
            surfaces(&app, id, true);
            return Err(error(e.to_string()));
        }
        let session = Session {
            id,
            owner: window.label().to_string(),
            seams: Vec::new(),
            revision: 1,
            machine: ScrollMachine::default(),
            target,
            stitcher: None,
            last_frame: None,
            worker: false,
        };
        let descriptor = session.descriptor();
        *state.0.lock().unwrap() = Some(Arc::new(Mutex::new(session)));
        if let Err(e) = auxiliary(&app, id, region) {
            cancel(&app, id);
            surfaces(&app, id, true);
            return Err(error(e));
        }
        return Ok(Some(descriptor));
    }
    let session = state
        .0
        .lock()
        .unwrap()
        .as_ref()
        .cloned()
        .ok_or_else(|| error("No scroll session"))?;
    let mut s = session.lock().unwrap();
    if s.id != id {
        return Err(error("Stale scroll session"));
    }
    if revision.is_some_and(|r| r != s.revision)
        && !matches!(action.as_str(), "pause" | "stop" | "discard" | "describe")
    {
        return Err(error("Stale scroll revision"));
    }
    match action.as_str() {
        "describe" => {}
        "point" => {
            if s.machine.phase != ScrollPhase::Prepare {
                return Err(error("Scroll point is locked after start"));
            }
            let p = point.ok_or_else(|| error("Missing scroll point"))?;
            let r = s.target.region;
            if p.0 < r.x
                || p.1 < r.y
                || p.0 as i64 >= r.x as i64 + r.width as i64
                || p.1 as i64 >= r.y as i64 + r.height as i64
            {
                return Err(error("Scroll point must stay inside selection"));
            }
            s.target = Target::bind(r, p).map_err(error)?;
        }
        "start" | "continue" => {
            if s.worker {
                return Err(error("Wait for the current capture step to finish"));
            }
            if let Err(reason) = s.target.validate() {
                s.machine.fail(&reason);
                notify(&app, &s);
                return Err(error(reason));
            }
            s.machine.start().map_err(error)?;
            if !s.worker {
                s.worker = true;
                let app = app.clone();
                let session = session.clone();
                std::thread::spawn(move || run(app, session));
            }
        }
        "pause" => s.machine.pause("Paused"),
        "stop" => s.machine.review("Stopped; review the confirmed portion"),
        "discard" => {
            s.machine.cancel();
            notify(&app, &s);
            drop(s);
            cancel(&app, id);
            surfaces(&app, id, true);
            return Ok(None);
        }
        "adopt" => {
            if s.machine.phase != ScrollPhase::Review || s.worker {
                return Err(error("Stop and wait for review first"));
            }
            let stitch = s
                .stitcher
                .as_ref()
                .ok_or_else(|| error("No confirmed pixels"))?;
            app.state::<super::FrameStore>()
                .adopt_long_image(
                    id,
                    s.revision,
                    stitch.width(),
                    stitch.height(),
                    stitch.confirmed().to_vec(),
                )
                .map_err(error)?;
            let descriptor = s.descriptor();
            let _ = app.emit_to(&s.owner, "screenshot-scroll-adopted", descriptor.clone());
            s.machine.cancel();
            notify(&app, &s);
            drop(s);
            cancel(&app, id);
            surfaces(&app, id, true);
            return Ok(Some(descriptor));
        }
        _ => return Err(error("Unknown scroll action")),
    }
    notify(&app, &s);
    Ok(Some(s.descriptor()))
}
fn run(app: tauri::AppHandle, session: Arc<Mutex<Session>>) {
    let mut sampler = FrameSampler::default();
    let result = (|| -> Result<(), String> {
        loop {
            let target = {
                let s = session.lock().unwrap();
                if !s.machine.may_capture() || !app.state::<super::ActiveCapture>().is_current(s.id)
                {
                    return Ok(());
                }
                s.target.clone()
            };
            std::thread::sleep(std::time::Duration::from_millis(120));
            {
                let s = session.lock().unwrap();
                if !s.machine.may_capture() || !app.state::<super::ActiveCapture>().is_current(s.id)
                {
                    return Ok(());
                }
            }
            let current = target.capture()?;
            let mut s = session.lock().unwrap();
            if !s.machine.may_publish() || !app.state::<super::ActiveCapture>().is_current(s.id) {
                return Ok(());
            }
            let Some(pixels) = sampler.sample(current, s.last_frame.as_deref()) else {
                continue;
            };
            let first = s.stitcher.is_none();
            if first {
                let r = target.region;
                let desktop = app
                    .state::<super::FrameStore>()
                    .with_frames(s.id, |frames| {
                        frames.iter().map(|f| f.rgba.len() as u64).sum::<u64>()
                    })
                    .unwrap_or(0);
                let working = 384u64 * 1024 * 1024;
                let viewport = r.width as u64 * r.height as u64 * 4;
                let available = working.saturating_sub(desktop).saturating_sub(viewport * 4) / 2;
                let max = (super::MAX_OUTPUT_PIXELS / r.width as u64)
                    .min(super::MAX_OUTPUT_DIMENSION)
                    .min(available / (r.width as u64 * 4)) as u32;
                if max < r.height {
                    return Err("Capture working memory budget reached".into());
                }
                s.stitcher = Stitcher::new(
                    StitchConfig::default(),
                    r.width,
                    r.height,
                    pixels.clone(),
                    max,
                );
                if s.stitcher.is_none() {
                    return Err("Invalid first frame".into());
                }
            } else {
                let r = target.region;
                if super::scroll_regions::fixed_edges(
                    s.last_frame.as_deref().unwrap_or(&pixels),
                    &pixels,
                    r.width,
                    r.height,
                ) {
                    return Err("Fixed header/footer cannot be verified; narrow selection to scrolling content".into());
                }
                match s.stitcher.as_mut().unwrap().offer(r.width, r.height, &pixels) {
                    StitchOutcome::Accepted { appended_rows, .. } => {
                        let seam = s.stitcher.as_ref().unwrap().height() - appended_rows;
                        s.seams.push(seam);
                    }
                    StitchOutcome::Rejected(RejectReason::NoNewContent) => continue,
                    StitchOutcome::Rejected(reason) => return Err(format!(
                        "Unconfirmed overlap ({reason:?}); use confirmed portion or narrow the selection to scrolling content"
                    )),
                }
            }
            s.last_frame = Some(pixels);
            s.revision += 1;
            notify(&app, &s);
        }
    })();
    let mut s = session.lock().unwrap();
    s.worker = false;
    if let Err(e) = result {
        s.machine.fail(&e);
    }
    notify(&app, &s);
}
#[tauri::command(async)]
pub fn scroll_capture_image(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    revision: u64,
) -> Result<tauri::ipc::Response, crate::error::CommandError> {
    let id = authorize(&app, &window)?;
    let state = app.state::<ScrollCapture>();
    let held = state.0.lock().unwrap();
    if let Some(session) = held.as_ref() {
        let s = session.lock().unwrap();
        if s.id == id && s.revision == revision {
            let stitch = s.stitcher.as_ref().ok_or_else(|| error("No preview yet"))?;
            let image = image::RgbaImage::from_raw(
                stitch.width(),
                stitch.height(),
                stitch.confirmed().to_vec(),
            )
            .ok_or_else(|| error("Invalid preview"))?;
            let mut bytes = std::io::Cursor::new(Vec::new());
            image
                .write_to(&mut bytes, image::ImageFormat::Png)
                .map_err(|e| error(e.to_string()))?;
            return Ok(tauri::ipc::Response::new(bytes.into_inner()));
        }
    }
    app.state::<super::FrameStore>()
        .long_image_bitmap(id, revision)
        .map(tauri::ipc::Response::new)
        .ok_or_else(|| error("Stale preview"))
}
