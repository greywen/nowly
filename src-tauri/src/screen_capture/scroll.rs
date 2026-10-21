//! Scrolling capture inside the screenshot overlay itself.
//!
//! Choosing it starts at once. The frozen desktop is hidden so the live screen
//! shows through the overlay's dim mask, and the overlay is cut open over the
//! selection so the pointer and wheel reach the real window underneath. The user
//! scrolls that window; every stable new view is matched against the confirmed
//! end and the new rows are appended. Frames that cannot be matched are skipped,
//! never guessed, and never end the capture.

use super::{
    scroll_target::Region,
    scroll_worker::{FrameSampler, ScrollHint, ScrollPhase},
    stitcher::{RejectReason, StitchConfig, StitchOutcome, Stitcher},
};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};

const FRAME_QUEUE_BYTES: usize = 64 * 1024 * 1024;

#[derive(Default)]
pub struct ScrollCapture(pub(crate) Mutex<Option<Arc<SessionCell>>>);

/// The session lock. Windows mutexes are not fair: the worker re-locks right
/// after unlocking while frames are queued, which would starve the preview
/// command for as long as the user keeps scrolling. The worker therefore steps
/// aside whenever anyone else is waiting.
pub(crate) struct SessionCell {
    inner: Mutex<Session>,
    waiting: std::sync::atomic::AtomicUsize,
}

impl SessionCell {
    fn new(session: Session) -> Self {
        Self { inner: Mutex::new(session), waiting: Default::default() }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Session> {
        use std::sync::atomic::Ordering;
        self.waiting.fetch_add(1, Ordering::AcqRel);
        let guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        self.waiting.fetch_sub(1, Ordering::AcqRel);
        guard
    }

    fn lock_for_worker(&self) -> std::sync::MutexGuard<'_, Session> {
        while self.waiting.load(std::sync::atomic::Ordering::Acquire) > 0 {
            std::thread::yield_now();
        }
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }
}

/// The confirmed long image and the frames that build it. Pure, so the whole
/// skip-and-continue policy is testable without a screen.
pub(crate) struct Capture {
    width: u32,
    height: u32,
    max_height: u32,
    sampler: FrameSampler,
    stitcher: Option<Stitcher>,
    last_frame: Option<Vec<u8>>,
    /// The last view the stitcher turned down. A user who stops on it would
    /// otherwise have it re-matched against the whole history every sample.
    rejected: Option<Vec<u8>>,
    pub(crate) revision: u64,
    pub(crate) hint: Option<ScrollHint>,
    pub(crate) grew_upward: bool,
}

impl Capture {
    pub(crate) fn new(width: u32, height: u32, max_height: u32) -> Self {
        Self {
            width,
            height,
            max_height,
            sampler: FrameSampler::default(),
            stitcher: None,
            last_frame: None,
            rejected: None,
            revision: 0,
            hint: None,
            grew_upward: false,
        }
    }

    pub(crate) fn confirmed_height(&self) -> u32 {
        self.stitcher.as_ref().map_or(0, |s| s.height())
    }

    pub(crate) fn snapshot(&self) -> Option<(u32, u32, Vec<u8>)> {
        self.stitcher
            .as_ref()
            .map(|s| (s.width(), s.height(), s.confirmed().to_vec()))
    }

    pub(crate) fn set_hint(&mut self, hint: Option<ScrollHint>) -> bool {
        let changed = self.hint != hint;
        self.hint = hint;
        changed
    }

    /// Offers one live frame. True when the image or the hint changed.
    pub(crate) fn offer(&mut self, pixels: Vec<u8>) -> bool {
        let back_at_end = self
            .last_frame
            .as_deref()
            .is_some_and(|last| super::scroll_worker::frames_close(last, &pixels));
        let Some(pixels) = self.sampler.sample(pixels, self.last_frame.as_deref()) else {
            // Back at the confirmed end is exactly what a lost-track hint asks for.
            if back_at_end && self.hint != Some(ScrollHint::Full) {
                return self.set_hint(None);
            }
            return false;
        };
        let (width, height) = (self.width, self.height);
        let Some(stitcher) = self.stitcher.as_mut() else {
            if self.max_height < height {
                return self.set_hint(Some(ScrollHint::Full));
            }
            match Stitcher::new(
                StitchConfig::default(),
                width,
                height,
                pixels.clone(),
                self.max_height,
            ) {
                Some(stitcher) => {
                    self.stitcher = Some(stitcher);
                    self.last_frame = Some(pixels);
                    self.revision += 1;
                    self.hint = None;
                    return true;
                }
                None => return self.set_hint(Some(ScrollHint::CaptureFailed)),
            }
        };
        if self
            .rejected
            .as_deref()
            .is_some_and(|rejected| super::scroll_worker::frames_close(rejected, &pixels))
        {
            return false;
        }
        let outcome = stitcher.offer(width, height, &pixels);
        if matches!(outcome, StitchOutcome::Accepted { .. } | StitchOutcome::Prepended { .. }) {
            self.grew_upward = matches!(outcome, StitchOutcome::Prepended { .. });
            self.last_frame = Some(pixels);
            self.rejected = None;
            self.revision += 1;
            self.hint = None;
            return true;
        }
        let hint = match outcome {
            // Not moved, scrolled back over captured rows, or a blank stretch:
            // nothing to add, and nothing wrong either.
            StitchOutcome::Rejected(
                RejectReason::NoNewContent | RejectReason::LowInformation { .. },
            ) => None,
            StitchOutcome::Rejected(RejectReason::CapacityReached) => Some(ScrollHint::Full),
            _ => {
                let fixed = self.last_frame.as_deref().is_some_and(|last| {
                    super::scroll_regions::fixed_edges(last, &pixels, width, height)
                });
                Some(if fixed {
                    ScrollHint::FixedEdges
                } else {
                    ScrollHint::LostTrack
                })
            }
        };
        self.rejected = Some(pixels);
        self.set_hint(hint)
    }
}

pub(crate) struct Session {
    id: u64,
    owner: String,
    region: Region,
    sequence: u64,
    phase: ScrollPhase,
    capture: Capture,
    queue: Arc<super::scroll_queue::FrameQueue>,
    producer_stop: Arc<std::sync::atomic::AtomicBool>,
    finishing: bool,
    worker_done: bool,
    terminal_failure: bool,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Descriptor {
    session_id: String,
    revision: u64,
    sequence: u64,
    phase: ScrollPhase,
    width: u32,
    height: u32,
    region: Region,
    hint: Option<ScrollHint>,
    grew_upward: bool,
    worker_done: bool,
}

impl Session {
    fn offer_frame(&mut self, pixels: Vec<u8>) -> Option<Descriptor> {
        if self.capture.offer(pixels) {
            self.sequence += 1;
            Some(self.descriptor())
        } else { None }
    }

    fn complete_worker(&mut self) {
        self.worker_done = true;
        if self.terminal_failure && self.phase == ScrollPhase::Capturing {
            self.capture.set_hint(Some(ScrollHint::CaptureFailed));
        }
    }

    fn descriptor(&self) -> Descriptor {
        Descriptor {
            session_id: self.id.to_string(),
            revision: self.capture.revision,
            sequence: self.sequence,
            phase: self.phase,
            width: self.region.width,
            height: self.capture.confirmed_height(),
            region: self.region,
            hint: self.capture.hint,
            grew_upward: self.capture.grew_upward,
            worker_done: self.worker_done,
        }
    }
}

fn error(message: impl Into<String>) -> crate::error::CommandError {
    let message = message.into();
    eprintln!("scroll capture: {message}");
    crate::error::CommandError::system(message)
}

/// A failure the overlay explains in its own words, keyed by `code`.
fn coded(code: &str, message: &str) -> crate::error::CommandError {
    eprintln!("scroll capture: {message}");
    crate::error::CommandError {
        code: code.into(),
        message: message.into(),
        field: None,
    }
}

/// Only an overlay of the live screenshot session may drive or read the capture.
fn authorize(
    app: &tauri::AppHandle,
    window: &tauri::WebviewWindow,
) -> Result<u64, crate::error::CommandError> {
    let label = window.label();
    let id = super::window::window_session_id(label)
        .filter(|_| super::window::overlay_display_id(label).is_some())
        .ok_or_else(|| error("Unauthorized scroll window"))?;
    if !app.state::<super::ActiveCapture>().is_current(id) {
        return Err(error("Screenshot session ended"));
    }
    Ok(id)
}

fn notify(app: &tauri::AppHandle, s: &mut Session) {
    s.sequence += 1;
    let _ = app.emit_to(&s.owner, "screenshot-scroll-state", s.descriptor());
}

fn current(app: &tauri::AppHandle, id: u64) -> Option<Arc<SessionCell>> {
    app.state::<ScrollCapture>()
        .0
        .lock()
        .unwrap()
        .as_ref()
        .filter(|s| s.lock().id == id)
        .cloned()
}

/// Ends the scrolling capture of `id`. Its windows are destroyed by the
/// screenshot teardown that calls this, so nothing has to be restored.
pub fn cancel<R: tauri::Runtime>(app: &tauri::AppHandle<R>, id: u64) {
    let Some(state) = app.try_state::<ScrollCapture>() else {
        return;
    };
    let mut held = state.0.lock().unwrap();
    if held.as_ref().is_some_and(|s| s.lock().id == id) {
        if let Some(s) = held.take() {
            let mut session = s.lock();
            session.phase = ScrollPhase::Cancelled;
            session.producer_stop.store(true, std::sync::atomic::Ordering::Release);
            session.queue.close();
        }
        drop(held);
        use tauri_plugin_global_shortcut::GlobalShortcutExt;
        let _ = app.global_shortcut().unregister("Escape");
    }
}

/// Runs `live_on_main` on the thread that owns the windows and waits for it.
fn go_live(app: &tauri::AppHandle, id: u64, owner: &str, region: Region) -> Result<(), String> {
    let handle = app.clone();
    let owner = owner.to_string();
    let (sent, received) = std::sync::mpsc::sync_channel(1);
    app.run_on_main_thread(move || {
        let _ = sent.send(live_on_main(&handle, id, &owner, region));
    })
    .map_err(|e| e.to_string())?;
    received
        .recv_timeout(std::time::Duration::from_secs(2))
        .map_err(|_| "Overlay did not respond".to_string())?
}

#[cfg(windows)]
fn live_on_main(
    app: &tauri::AppHandle,
    id: u64,
    owner: &str,
    region: Region,
) -> Result<(), String> {
    use windows::Win32::Graphics::Gdi::{
        CombineRgn, CreateRectRgn, DeleteObject, SetWindowRgn, HGDIOBJ, RGN_DIFF,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowDisplayAffinity, ShowWindow, SW_HIDE, WDA_NONE,
    };
    let window = app
        .get_webview_window(owner)
        .ok_or("Screenshot overlay unavailable")?;
    let position = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;
    let (left, top, right, bottom) = super::scroll_target::window_hole(
        region,
        Region {
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
        },
    )
    .ok_or("Selection is outside its screen")?;
    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    unsafe {
        // The overlay keeps everything outside the selection: the mask, border,
        // hint, preview and toolbar. The selection itself becomes a hole, so the
        // wheel and pointer go straight to the window being scrolled.
        let shape = CreateRectRgn(0, 0, size.width as i32, size.height as i32);
        let hole = CreateRectRgn(left, top, right, bottom);
        CombineRgn(Some(shape), Some(shape), Some(hole), RGN_DIFF);
        let _ = DeleteObject(HGDIOBJ(hole.0));
        if SetWindowRgn(hwnd, Some(shape), true) == 0 {
            let _ = DeleteObject(HGDIOBJ(shape.0));
            return Err("Cannot open the selection for scrolling".into());
        }
    }
    for (label, overlay) in app.webview_windows() {
        if super::window::window_session_id(&label) == Some(id)
            && super::window::overlay_display_id(&label).is_some()
        {
            if let Ok(hwnd) = overlay.hwnd() {
                // The native region removes the selection from the overlay.
                // Capture exclusion can black out a layered window's bounding
                // rectangle in Desktop Duplication, including its transparent hole.
                unsafe { SetWindowDisplayAffinity(hwnd, WDA_NONE) }
                    .map_err(|e| format!("Cannot expose the live selection to capture: {e}"))?;
            }
        }
    }
    if let Some(freeze) = app.try_state::<super::FreezeLayer>() {
        let displays = app
            .state::<super::FrameStore>()
            .with_frames(id, |frames| {
                frames.iter().map(|f| f.display.id).collect::<Vec<_>>()
            })
            .unwrap_or_default();
        for display in displays {
            if let Some(h) = freeze.window_for(id, display) {
                unsafe {
                    let _ = ShowWindow(windows::Win32::Foundation::HWND(h as *mut _), SW_HIDE);
                }
            }
        }
    }
    // Do not start Desktop Duplication against the old frozen composition.
    unsafe { windows::Win32::Graphics::Dwm::DwmFlush() }
        .map_err(|e| format!("Cannot synchronize the live desktop: {e}"))?;
    Ok(())
}

#[cfg(not(windows))]
fn live_on_main(_: &tauri::AppHandle, _: u64, _: &str, _: Region) -> Result<(), String> {
    Err("Scroll capture requires Windows.".into())
}

#[tauri::command(async)]
pub fn scroll_capture(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    action: String,
    region: Option<Region>,
) -> Result<Descriptor, crate::error::CommandError> {
    let id = authorize(&app, &window)?;
    match action.as_str() {
        "start" => start(&app, &window, id, region),
        "finish" => finish(&app, id),
        _ => Err(error("Unknown scroll action")),
    }
}

fn start(
    app: &tauri::AppHandle,
    window: &tauri::WebviewWindow,
    id: u64,
    region: Option<Region>,
) -> Result<Descriptor, crate::error::CommandError> {
    let state = app.state::<ScrollCapture>();
    if let Some(existing) = current(app, id) {
        let s = existing.lock();
        return if s.phase == ScrollPhase::Capturing {
            Ok(s.descriptor())
        } else {
            Err(error("Scrolling capture already finished"))
        };
    }
    let region = region.ok_or_else(|| error("Select a region first"))?;
    super::validate_output_dimensions(region.width as u64, region.height as u64)
        .map_err(|_| coded("scroll_too_large", "Selection exceeds capture limits"))?;
    if region.height < 72 || region.width < 16 {
        return Err(coded(
            "scroll_too_small",
            "Choose a larger scrolling region",
        ));
    }
    let desktop = app.state::<super::FrameStore>().with_frames(id, |frames| {
        let inside = frames.iter().any(|f| {
            region.x >= f.display.x
                && region.y >= f.display.y
                && region.x as i64 + region.width as i64
                    <= f.display.x as i64 + f.display.width as i64
                && region.y as i64 + region.height as i64
                    <= f.display.y as i64 + f.display.height as i64
        });
        (
            inside,
            frames.iter().map(|f| f.rgba.len() as u64).sum::<u64>(),
        )
    });
    let Some((true, desktop)) = desktop else {
        return Err(coded(
            "scroll_one_screen",
            "Scroll capture must stay on one screen",
        ));
    };
    let working = 384u64 * 1024 * 1024;
    let row = region.width as u64 * 4;
    let viewport = row * region.height as u64;
    let available = working.saturating_sub(desktop).saturating_sub(viewport * 4) / 2;
    let max_height = (super::MAX_OUTPUT_PIXELS / region.width as u64)
        .min(super::MAX_OUTPUT_DIMENSION)
        .min(available / row) as u32;

    go_live(app, id, window.label(), region).map_err(|e| coded("scroll_live_failed", &e))?;
    if !app.state::<super::ActiveCapture>().is_current(id) {
        return Err(error("Screenshot session ended"));
    }

    use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
    let handle = app.clone();
    // Clicking the page under the hole moves keyboard focus away from the
    // overlay, so Esc has to be caught globally while scrolling.
    let _ = app
        .global_shortcut()
        .on_shortcut("Escape", move |_, _, event| {
            if event.state == ShortcutState::Pressed {
                let app = handle.clone();
                std::thread::spawn(move || super::cancel_session(&app, id));
            }
        });

    let session = Arc::new(SessionCell::new(Session {
        id,
        owner: window.label().to_string(),
        region,
        sequence: 1,
        phase: ScrollPhase::Capturing,
        capture: Capture::new(region.width, region.height, max_height),
        queue: Arc::new(super::scroll_queue::FrameQueue::new(FRAME_QUEUE_BYTES)),
        producer_stop: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        finishing: false,
        worker_done: false,
        terminal_failure: false,
    }));
    let descriptor = session.lock().descriptor();
    *state.0.lock().unwrap() = Some(session.clone());
    let app = app.clone();
    std::thread::spawn(move || run(app, session));
    Ok(descriptor)
}

/// Freezes the confirmed image and hands it to the screenshot output, which then
/// copies or saves it like any other screenshot.
fn finish(app: &tauri::AppHandle, id: u64) -> Result<Descriptor, crate::error::CommandError> {
    let session = current(app, id).ok_or_else(|| error("No scroll session"))?;
    {
        let mut s = session.lock();
        if s.phase == ScrollPhase::Finished { return Ok(s.descriptor()); }
        s.finishing = true;
        s.producer_stop.store(true, std::sync::atomic::Ordering::Release);
    }
    // The worker drains captured frames before announcing its final phase.
    loop {
        let s = session.lock();
        if s.worker_done || s.phase != ScrollPhase::Capturing { break; }
        drop(s);
        std::thread::sleep(std::time::Duration::from_millis(2));
    }
    let mut s = session.lock();
    if s.phase == ScrollPhase::Cancelled { return Err(error("Screenshot session ended")); }
    let (width, height, pixels) = s
        .capture
        .snapshot()
        .ok_or_else(|| coded("scroll_nothing_yet", "Nothing captured yet"))?;
    app.state::<super::FrameStore>()
        .adopt_long_image(id, s.capture.revision, width, height, pixels)
        .map_err(error)?;
    s.phase = ScrollPhase::Finished;
    notify(app, &mut s);
    Ok(s.descriptor())
}

fn run(app: tauri::AppHandle, session: Arc<SessionCell>) {
    let (id, region, queue, stop) = {
        let s = session.lock();
        (s.id, s.region, s.queue.clone(), s.producer_stop.clone())
    };
    let producer_queue = queue.clone();
    let producer_session = session.clone();
    let producer_app = app.clone();
    let producer_stop = stop.clone();
    let producer = std::thread::spawn(move || {
        #[cfg(windows)]
        let result = (|| -> Result<(), String> {
            let mut source = super::scroll_dxgi::ScrollFrameSource::new(region)?;
            let mut use_desktop = false;
            let mut frames = 0u64;
            let mut report_at = std::time::Instant::now();
            eprintln!("scroll capture: session={id} producer started width={} height={}", region.width, region.height);
            while !producer_stop.load(std::sync::atomic::Ordering::Acquire)
                && producer_app.state::<super::ActiveCapture>().is_current(id) {
                let frame = if use_desktop {
                    Some(super::scroll_target::capture_region(region)?)
                } else {
                    source.next_frame(16)?
                };
                if let Some(frame) = frame {
                    let (frame, incompatible) = if use_desktop { (frame, false) } else {
                        super::scroll_target::validate_black_frame(frame,
                            || super::scroll_target::capture_region(region))?
                    };
                    if incompatible {
                        eprintln!("scroll capture: DXGI black surface differs from live desktop; using desktop capture");
                        use_desktop = true;
                    }
                    frames += 1;
                    let bytes = frame.len();
                    producer_queue.push(frame).map_err(|_| format!(
                        "Scroll frame buffer exhausted: session={id} frames={frames} frame_bytes={bytes}"
                    ))?;
                    if frames == 1 || report_at.elapsed() >= std::time::Duration::from_secs(1) {
                        eprintln!("scroll capture: session={id} captured_frames={frames} backend={}",
                            if use_desktop { "desktop" } else { "dxgi" });
                        report_at = std::time::Instant::now();
                    }
                }
            }
            Ok(())
        })();
        #[cfg(not(windows))]
        let result: Result<(), String> = Err("Scroll capture requires Windows".into());
        if let Err(message) = result {
            eprintln!("scroll capture: {message}");
            let mut s = producer_session.lock();
            if s.phase == ScrollPhase::Capturing {
                s.terminal_failure = true;
                s.capture.set_hint(Some(ScrollHint::CaptureFailed));
                notify(&producer_app, &mut s);
            }
        }
        producer_queue.close();
    });
    let mut processed = 0u64;
    let mut report_at = std::time::Instant::now();
    let mut max_offer_ms = 0u128;
    while let Some(pixels) = queue.pop() {
        let mut s = session.lock_for_worker();
        if s.phase != ScrollPhase::Capturing || !app.state::<super::ActiveCapture>().is_current(id) {
            stop.store(true, std::sync::atomic::Ordering::Release);
            break;
        }
        let started = std::time::Instant::now();
        let descriptor = s.offer_frame(pixels);
        max_offer_ms = max_offer_ms.max(started.elapsed().as_millis());
        processed += 1;
        if let Some(descriptor) = descriptor {
            if let Err(error) = app.emit_to(&s.owner, "screenshot-scroll-state", descriptor) {
                eprintln!("scroll capture: session={id} preview event failed: {error}");
            }
        }
        if processed == 1 || report_at.elapsed() >= std::time::Duration::from_secs(1) {
            eprintln!("scroll capture: session={id} processed_frames={processed} revision={} height={} hint={:?} max_offer_ms={max_offer_ms}",
                s.capture.revision, s.capture.confirmed_height(), s.capture.hint);
            report_at = std::time::Instant::now();
            max_offer_ms = 0;
        }
        if s.capture.hint == Some(ScrollHint::Full) {
            stop.store(true, std::sync::atomic::Ordering::Release);
            break;
        }
    }
    stop.store(true, std::sync::atomic::Ordering::Release);
    queue.close();
    let _ = producer.join();
    let mut s = session.lock();
    s.complete_worker();
    notify(&app, &mut s);
    drop(s);
    if !app.state::<super::ActiveCapture>().is_current(id) { cancel(&app, id); }
}

/// The confirmed image as PNG, scaled down to `max_width` for the live preview.
#[tauri::command(async)]
pub fn scroll_capture_image(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    revision: u64,
    max_width: Option<u32>,
) -> Result<tauri::ipc::Response, crate::error::CommandError> {
    let id = authorize(&app, &window)?;
    let snapshot = current(&app, id).and_then(|session| {
        let s = session.lock();
        if s.capture.revision >= revision {
            s.capture.stitcher.as_ref().map(|stitcher| stitcher.preview(max_width.unwrap_or(160)))
        } else {
            None
        }
    });
    let (width, height, pixels) = snapshot.ok_or_else(|| error("Stale preview"))?;
    // Encoding happens after the session lock is released.
    let mut image = image::RgbaImage::from_raw(width, height, pixels)
        .ok_or_else(|| error("Invalid preview"))?;
    if let Some(max) = max_width.filter(|max| *max > 0 && *max < width) {
        let scaled = ((height as u64 * max as u64) / width as u64).max(1) as u32;
        image = image::imageops::resize(&image, max, scaled, image::imageops::FilterType::Triangle);
    }
    let mut bytes = std::io::Cursor::new(Vec::new());
    image
        .write_to(&mut bytes, image::ImageFormat::Png)
        .map_err(|e| error(e.to_string()))?;
    Ok(tauri::ipc::Response::new(bytes.into_inner()))
}

#[cfg(test)]
mod worker_completion_tests {
    use super::*;

    #[test]
    fn last_scrolled_frame_publishes_even_within_the_previous_notification_interval() {
        let mut session = Session {
            id: 1, owner: String::new(), region: Region { x:0, y:0, width:32, height:128 },
            sequence: 1, phase: ScrollPhase::Capturing, capture: Capture::new(32,128,1024),
            queue: Arc::new(super::super::scroll_queue::FrameQueue::new(1024)),
            producer_stop: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            finishing: false, worker_done: false, terminal_failure: false,
        };
        let frame = |start: u32| -> Vec<u8> {
            (start..start + 128).flat_map(|row| (0..32u32).flat_map(move |column| {
                let value = row.wrapping_mul(747796405).wrapping_add(column.wrapping_mul(2891336453));
                [value as u8, (value >> 11) as u8, (value >> 19) as u8, 255]
            })).collect()
        };
        let first = session.offer_frame(frame(0)).unwrap();
        let next = session.offer_frame(frame(32))
            .expect("last accepted frame must reach preview without waiting for another scroll");
        assert_eq!(next.height, 160);
        assert!(next.revision > first.revision);
        assert!(next.sequence > first.sequence);
    }

    #[test]
    fn preview_reads_are_not_starved_by_a_busy_worker() {
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::time::{Duration, Instant};
        let cell = Arc::new(SessionCell::new(Session {
            id: 1, owner: String::new(), region: Region { x:0, y:0, width:32, height:128 },
            sequence: 1, phase: ScrollPhase::Capturing, capture: Capture::new(32,128,1024),
            queue: Arc::new(super::super::scroll_queue::FrameQueue::new(1024)),
            producer_stop: Arc::new(AtomicBool::new(false)),
            finishing: false, worker_done: false, terminal_failure: false,
        }));
        let stop = Arc::new(AtomicBool::new(false));
        let worker = {
            let (cell, stop) = (cell.clone(), stop.clone());
            // A frame backlog: the worker re-locks the moment it unlocks.
            std::thread::spawn(move || while !stop.load(Ordering::Relaxed) {
                let mut s = cell.lock_for_worker();
                let started = Instant::now();
                while started.elapsed() < Duration::from_millis(8) { std::hint::spin_loop(); }
                s.sequence += 1;
            })
        };
        std::thread::sleep(Duration::from_millis(50));
        let mut worst = Duration::ZERO;
        for _ in 0..20 {
            let started = Instant::now();
            drop(cell.lock());
            worst = worst.max(started.elapsed());
            std::thread::sleep(Duration::from_millis(10));
        }
        stop.store(true, Ordering::Relaxed);
        worker.join().unwrap();
        assert!(worst < Duration::from_millis(200), "preview waited {worst:?}");
    }

    #[test]
    fn terminal_capture_failure_survives_draining_accepted_frames() {
        let mut s = Session {
            id: 1, owner: String::new(), region: Region { x:0, y:0, width:32, height:128 },
            sequence: 1, phase: ScrollPhase::Capturing, capture: Capture::new(32,128,1024),
            queue: Arc::new(super::super::scroll_queue::FrameQueue::new(1024)),
            producer_stop: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            finishing: false, worker_done: false, terminal_failure: true,
        };
        s.capture.set_hint(Some(ScrollHint::CaptureFailed));
        s.capture.offer(vec![255; 32 * 128 * 4]);
        assert_eq!(s.capture.hint, None);
        s.complete_worker();
        assert_eq!(s.capture.hint, Some(ScrollHint::CaptureFailed));
        assert!(s.worker_done);
    }
}
