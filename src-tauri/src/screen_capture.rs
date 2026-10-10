//! Session-owned desktop capture, startup readiness, and export commands.

mod backend;
mod candidates;
pub(crate) mod clipboard;
mod composite;
mod dib;
pub(crate) mod encode;
mod export;
mod frames;
mod freeze;
mod gdi;
mod pool;
mod mosaic;
pub(crate) mod output;
#[path = "screenshot_history/mod.rs"]
pub mod history;
#[cfg(test)] mod archive_tests;
mod preview;
mod renderer;
mod save;
mod session;
mod startup;
mod stitcher;
mod window;

use crate::error::CommandError;
use tauri::Manager;

pub(crate) const MAX_OUTPUT_PIXELS: u64 = 64_000_000;
pub(crate) const MAX_OUTPUT_DIMENSION: u64 = 65_535;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CapacityError {
    EmptyImage,
    DimensionLimit,
    PixelLimit,
    ArithmeticOverflow,
}

pub(crate) fn validate_output_dimensions(width: u64, height: u64) -> Result<u64, CapacityError> {
    let pixels = width
        .checked_mul(height)
        .ok_or(CapacityError::ArithmeticOverflow)?;
    if width == 0 || height == 0 {
        return Err(CapacityError::EmptyImage);
    }
    if width > MAX_OUTPUT_DIMENSION || height > MAX_OUTPUT_DIMENSION {
        return Err(CapacityError::DimensionLimit);
    }
    if pixels > MAX_OUTPUT_PIXELS {
        return Err(CapacityError::PixelLimit);
    }
    pixels
        .checked_mul(4)
        .ok_or(CapacityError::ArithmeticOverflow)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CapturePhase {
    Starting,
    Aiming,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct SessionToken {
    pub session_id: u64,
    pub version: u64,
    pub phase: CapturePhase,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SessionError {
    Busy,
    StaleSession,
    InvalidTransition,
}

#[derive(Debug)]
pub(crate) struct CaptureSession {
    next_session_id: u64,
    active: Option<SessionToken>,
    retiring: Option<u64>,
}

impl Default for CaptureSession {
    fn default() -> Self {
        Self {
            next_session_id: 1,
            active: None,
            retiring: None,
        }
    }
}

impl CaptureSession {
    pub fn begin(&mut self) -> Result<SessionToken, SessionError> {
        if self.active.is_some() || self.retiring.is_some() {
            return Err(SessionError::Busy);
        }

        let token = SessionToken {
            session_id: self.next_session_id,
            version: 1,
            phase: CapturePhase::Starting,
        };
        self.next_session_id = self.next_session_id.saturating_add(1);
        self.active = Some(token);
        Ok(token)
    }

    pub fn transition(
        &mut self,
        current: SessionToken,
        next: CapturePhase,
    ) -> Result<SessionToken, SessionError> {
        if self.active != Some(current) {
            return Err(SessionError::StaleSession);
        }
        if !can_transition(current.phase, next) {
            return Err(SessionError::InvalidTransition);
        }

        let token = SessionToken {
            version: current.version.saturating_add(1),
            phase: next,
            ..current
        };
        self.active = Some(token);
        Ok(token)
    }

    pub fn cancel(&mut self, current: SessionToken) -> Result<(), SessionError> {
        if self.active != Some(current) {
            return Err(SessionError::StaleSession);
        }
        self.active = None;
        Ok(())
    }

    pub fn current(&self) -> Option<SessionToken> {
        self.active
    }
}

fn can_transition(current: CapturePhase, next: CapturePhase) -> bool {
    matches!(
        (current, next),
        (CapturePhase::Starting, CapturePhase::Aiming)
    )
}

/// Whether a capture session can be started at all on this build.
///
/// Platform capability only. Per-attempt conditions (a session already running,
/// a process that is not DPI aware, a display that will not yield a frame) are
/// decided by the backend during startup and reported as real failures, rather
/// than hidden behind one boolean here.
pub fn is_available() -> bool {
    cfg!(target_os = "windows")
}

pub fn is_active<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> bool {
    app.state::<ActiveCapture>().is_active()
}

/// One active session, with short state locks and separately owned startup and
/// suppression records. A retiring session blocks a new suppression until the
/// main thread has restored the Bar's current visibility intent.
#[derive(Debug, Default)]
pub struct ActiveCapture {
    session: std::sync::Mutex<CaptureSession>,
    suppression: std::sync::Mutex<Option<(u64, crate::quick_panel::CaptureSuppression)>>,
    startup: std::sync::Mutex<Option<(u64, std::sync::Arc<startup::Startup>)>>,
    export_operation: std::sync::Mutex<()>,
}

impl ActiveCapture {
    pub fn is_active(&self) -> bool {
        let session = self.session.lock().unwrap();
        session.active.is_some() || session.retiring.is_some()
    }
    pub(crate) fn prewarm_target(&self) -> Option<u64> {
        let session = self.session.lock().unwrap();
        if session.active.is_some() || session.retiring.is_some() {
            None
        } else {
            Some(session.next_session_id)
        }
    }

    pub(crate) fn may_build_for(&self, session_id: u64) -> bool {
        let session = self.session.lock().unwrap();
        session.retiring.is_none()
            && match session.active {
                Some(token) => token.session_id == session_id,
                None => session.next_session_id == session_id,
            }
    }

    fn begin(&self) -> Result<(SessionToken, std::sync::Arc<startup::Startup>), SessionError> {
        let mut session = self.session.lock().unwrap();
        let token = session.begin()?;
        let startup = std::sync::Arc::new(startup::Startup::default());
        *self.startup.lock().unwrap() = Some((token.session_id, startup.clone()));
        Ok((token, startup))
    }

    pub(crate) fn is_current(&self, session_id: u64) -> bool {
        self.with_current(session_id, || ()).is_some()
    }

    pub(crate) fn with_current<T>(&self, session_id: u64, body: impl FnOnce() -> T) -> Option<T> {
        let session = self.session.lock().unwrap();
        if session.current()?.session_id != session_id {
            return None;
        }
        Some(body())
    }

    fn caller_token(&self, label: &str) -> Result<SessionToken, CommandError> {
        let id = window::window_session_id(label)
            .ok_or_else(|| CommandError::system("该窗口不能操作截图会话。"))?;
        self.session
            .lock()
            .unwrap()
            .current()
            .filter(|token| token.session_id == id)
            .ok_or_else(|| CommandError::system("截图会话已结束。"))
    }

    fn startup_for(&self, session_id: u64) -> Option<std::sync::Arc<startup::Startup>> {
        self.startup
            .lock()
            .unwrap()
            .as_ref()
            .filter(|(id, _)| *id == session_id)
            .map(|(_, startup)| startup.clone())
    }

    fn suppress_current(
        &self,
        session_id: u64,
        suppress: impl FnOnce() -> crate::quick_panel::CaptureSuppression,
        restore: impl FnOnce(crate::quick_panel::CaptureSuppression),
    ) -> Result<(), session::StartFailure> {
        if !self.is_current(session_id) {
            return Err(session::StartFailure::Cancelled);
        }
        let token = suppress();
        let adopted = self
            .with_current(session_id, || {
                *self.suppression.lock().unwrap() = Some((session_id, token));
            })
            .is_some();
        if adopted {
            Ok(())
        } else {
            restore(token);
            Err(session::StartFailure::Cancelled)
        }
    }

    fn take_suppression(&self, session_id: u64) -> Option<crate::quick_panel::CaptureSuppression> {
        let mut held = self.suppression.lock().unwrap();
        if held.as_ref().is_some_and(|(id, _)| *id == session_id) {
            held.take().map(|(_, token)| token)
        } else {
            None
        }
    }

    /// Clears the session under a short lock and reports whether there was one.
    ///
    /// The lock is released before the caller touches windows, so window work
    /// never runs while this mutex is held.
    fn end_session(&self, session_id: u64) -> bool {
        let mut session = self.session.lock().unwrap();
        match session.current() {
            Some(token) if token.session_id == session_id => {
                let _ = session.cancel(token);
                session.retiring = Some(session_id);
                if let Some(startup) = self.startup_for(session_id) {
                    startup.fail(session::StartFailure::Cancelled);
                }
                true
            }
            _ => false,
        }
    }

    pub(crate) fn finish_retirement(&self, session_id: u64) {
        let mut session = self.session.lock().unwrap();
        if session.retiring == Some(session_id) {
            session.retiring = None;
        }
    }
}

pub use export::OverlayStaging;
pub use frames::FrameStore;
pub use freeze::FreezeLayer;

pub fn prewarm_after_launch<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    pool::schedule_prewarm(app.clone(), session::PREWARM_AFTER_LAUNCH);
}
pub use preview::PreviewStore;

/// The local scheme the overlays load their frozen frame from.
///
/// A local scheme rather than HTTP: §9 restricts the capture windows to local
/// resources and IPC, and forbids pushing pixels through huge Base64 invokes.
pub const FRAME_URI_SCHEME: &str = "nowly-frame";

/// Whether a window label belongs to a capture session.
pub fn is_capture_window(label: &str) -> bool {
    window::is_screenshot_label(label)
}

/// Percent-decodes a request path before it is parsed.
///
/// The front end builds these URLs with Tauri's `convertFileSrc`, which runs the
/// whole path through `encodeURIComponent`. The `/` between the session id and the
/// display id therefore arrives as `%2F`, making the raw path one opaque segment:
/// `parse_frame_path` sees no separator, rejects it as malformed, and the overlay
/// gets a 400 instead of its frozen frame. Tauri's own asset and `tauri://`
/// protocols decode for exactly this reason.
///
/// Decoding cannot widen what is reachable: the parsers still accept nothing but a
/// pair of plain integers, so an encoded `..` decodes into a path that is rejected
/// rather than traversed.
fn decode_request_path(path: &str) -> std::borrow::Cow<'_, str> {
    percent_encoding::percent_decode_str(path).decode_utf8_lossy()
}

fn frame_cors_origin<'a>(
    origin: Option<&'a str>,
    dev_origin: Option<&str>,
) -> Result<Option<&'a str>, ()> {
    let Some(origin) = origin else {
        return Ok(None);
    };
    if matches!(
        origin,
        "tauri://localhost" | "http://tauri.localhost" | "https://tauri.localhost"
    ) || (origin != "null" && Some(origin) == dev_origin)
    {
        Ok(Some(origin))
    } else {
        Err(())
    }
}

fn frame_png_response(png: Vec<u8>, origin: Option<&str>) -> tauri::http::Response<Vec<u8>> {
    let mut response = tauri::http::Response::builder()
        .status(tauri::http::StatusCode::OK)
        .header(tauri::http::header::CONTENT_TYPE, "image/png")
        .header(tauri::http::header::CACHE_CONTROL, "no-store");
    if let Some(origin) = origin {
        response = response
            .header(tauri::http::header::ACCESS_CONTROL_ALLOW_ORIGIN, origin)
            .header(tauri::http::header::VARY, "Origin");
    }
    response
        .body(png)
        .expect("fixed image headers form a valid response")
}

/// Answers a frame request from a capture overlay.
///
/// Checks the requesting webview as well as the URL: a window that is not part of
/// this session gets nothing, so the scheme cannot be used as a general screen
/// reader by any other page in the app.
pub fn serve_frame<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    caller_label: &str,
    request: tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    let deny = |status: tauri::http::StatusCode| {
        tauri::http::Response::builder()
            .status(status)
            .body(Vec::new())
            .expect("a bodyless response always builds")
    };

    if !window::is_screenshot_label(caller_label) {
        return deny(tauri::http::StatusCode::FORBIDDEN);
    }
    let request_origin = match request.headers().get(tauri::http::header::ORIGIN) {
        Some(value) => match value.to_str() {
            Ok(origin) => Some(origin),
            Err(_) => return deny(tauri::http::StatusCode::FORBIDDEN),
        },
        None => None,
    };
    let dev_origin = if cfg!(debug_assertions) {
        app.config()
            .build
            .dev_url
            .as_ref()
            .map(|url| url.origin().ascii_serialization())
    } else {
        None
    };
    let allowed_origin = match frame_cors_origin(request_origin, dev_origin.as_deref()) {
        Ok(origin) => origin,
        Err(()) => return deny(tauri::http::StatusCode::FORBIDDEN),
    };
    let path = decode_request_path(request.uri().path());
    // A preview request is routed first, because its prefix is not a valid display
    // frame path and would otherwise be rejected as malformed.
    if let Some((session_id, serial)) = preview::parse_preview_path(&path) {
        if !window::can_serve_session(caller_label, session_id)
            || !app.state::<ActiveCapture>().is_current(session_id)
        {
            return deny(tauri::http::StatusCode::FORBIDDEN);
        }
        let Some(png) = app.state::<PreviewStore>().png(session_id, serial) else {
            return deny(tauri::http::StatusCode::NOT_FOUND);
        };
        return frame_png_response(png.as_ref().clone(), allowed_origin);
    }

    let Some((session_id, display_id)) = frames::parse_frame_path(&path) else {
        return deny(tauri::http::StatusCode::BAD_REQUEST);
    };
    if !window::can_serve_session(caller_label, session_id)
        || !app.state::<ActiveCapture>().is_current(session_id)
    {
        return deny(tauri::http::StatusCode::FORBIDDEN);
    }
    let Some(bitmap) = app.state::<FrameStore>().bitmap(session_id, display_id) else {
        return deny(tauri::http::StatusCode::NOT_FOUND);
    };

    let mut response = frame_png_response(bitmap, allowed_origin);
    response.headers_mut().insert(
        tauri::http::header::CONTENT_TYPE,
        tauri::http::HeaderValue::from_static("image/bmp"),
    );
    response
}

/// What this overlay should render: its display, that display's pixel size and
/// the frame URL path.
///
/// Pixels never travel through this command; only the path to fetch them.
#[tauri::command(async)]
pub fn describe_capture_frame(
    app: tauri::AppHandle,
    window: tauri::Window,
) -> Result<Option<FramePlan>, CommandError> {
    let Some(display_id) = window::overlay_display_id(window.label()) else {
        return Err(CommandError::system("该窗口不是截图覆盖层。"));
    };
    let session_id = window::window_session_id(window.label())
        .ok_or_else(|| CommandError::system("该窗口不能操作截图会话。"))?;
    let state = app.state::<ActiveCapture>();
    let Some(startup) = state.startup_for(session_id) else {
        return Ok(None);
    };
    if !startup
        .frames_ready()
        .map_err(|failure| CommandError::reported(start_failure_message(&failure)))?
    {
        return Ok(None);
    }
    let store = app.state::<FrameStore>();
    let Some(frame) = store.descriptor_for(session_id, display_id) else {
        return Err(CommandError::system("找不到该屏幕的截图帧。"));
    };

    Ok(Some(FramePlan {
        path: format!("{session_id}/{display_id}"),
        width: frame.width,
        height: frame.height,
        origin_x: frame.origin_x,
        origin_y: frame.origin_y,
        window_candidates: frame.window_candidates,
    }))
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FramePlan {
    /// Appended to the frame scheme's root by the front end.
    pub path: String,
    pub width: u32,
    pub height: u32,
    pub origin_x: i32,
    pub origin_y: i32,
    pub window_candidates: Vec<candidates::WindowBounds>,
}

/// Tears down a session that ended by some route other than cancel: a capture
/// window destroyed by Alt+F4, the task bar or a front-end crash.
///
/// The destroyed window's generation prevents a queued old event from ending
/// a newly started session.
pub fn abandon_session(app: &tauri::AppHandle, label: &str) {
    let Some(session_id) = window::window_session_id(label) else {
        return;
    };
    if app.state::<ActiveCapture>().is_current(session_id) {
        app.state::<crate::quick_panel::PanelController>()
            .capture_startup_succeeded();
    }
    finish_capture(app, session_id);
}

fn finish_capture<R: tauri::Runtime>(app: &tauri::AppHandle<R>, session_id: u64) {
    let state = app.state::<ActiveCapture>();
    if state.end_session(session_id) {
        if let Some(history) = app.try_state::<history::HistoryState>() {
            history.0.clear_session(session_id);
        }
        app.state::<FrameStore>().retire(session_id);
        session::teardown(app, session_id, state.take_suppression(session_id));
    }
}

/// The caller waits for real frontend readiness, bounded independently from
/// compositor/capture work. Native visibility calls are not forcibly interruptible.
#[tauri::command(async)]
pub fn start_screen_capture(app: tauri::AppHandle) -> Result<(), CommandError> {
    if !is_available() {
        return Err(CommandError::reported("截图功能尚未可用。"));
    }

    let started = std::time::Instant::now();
    let deadline = started + window::STARTUP_TIMEOUT;
    let state = app.state::<ActiveCapture>();
    let (token, startup) = state
        .begin()
        .map_err(|_| CommandError::reported(start_failure_message(&session::StartFailure::Busy)))?;
    app.state::<FrameStore>().activate(token.session_id);
    eprintln!(
        "capture session={} phase=suppress-start elapsed_ms=0",
        token.session_id
    );
    let outcome = session::suppress_bar(&app, token.session_id, deadline)
        .and_then(|()| {
            eprintln!(
                "capture session={} phase=suppressed elapsed_ms={}",
                token.session_id,
                started.elapsed().as_millis()
            );
            session::start_capture(app.clone(), token, startup.clone(), started, deadline)
        })
        .and_then(|()| {
            state
                .session
                .lock()
                .unwrap()
                .transition(token, CapturePhase::Aiming)
                .map(|_| ())
                .map_err(|_| session::StartFailure::Cancelled)
        });
    if let Err(failure) = &outcome {
        startup.fail(failure.clone());
        // Cancelling is not a retryable startup error and must not reopen Menu.
        if *failure == session::StartFailure::Cancelled {
            app.state::<crate::quick_panel::PanelController>()
                .capture_startup_succeeded();
        }
        finish_capture(&app, token.session_id);
        // Teardown queues restoration on the main thread. Wait behind it so the
        // menu's fresh details-open event precedes the rejected IPC result.
        let (restored, wait) = std::sync::mpsc::sync_channel(1);
        if app.run_on_main_thread(move || { let _ = restored.send(()); }).is_ok() {
            let _ = wait.recv_timeout(window::STARTUP_TIMEOUT);
        }
    } else {
        app.state::<crate::quick_panel::PanelController>()
            .capture_startup_succeeded();
    }
    if outcome == Err(session::StartFailure::Cancelled) {
        return Ok(());
    }
    outcome.map_err(|failure| {
        // The restored menu shows this error inline and allows a retry.
        eprintln!(
            "capture session={} phase=failed elapsed_ms={} reason={failure:?}",
            token.session_id,
            started.elapsed().as_millis()
        );
        CommandError::reported(start_failure_message(&failure))
    })
}

/// Ends the session and restores the bar. Idempotent: a second call after the
/// session is gone is a no-op rather than an error.
///
/// A stale window can only cancel its own session.
#[tauri::command(async)]
pub fn cancel_screen_capture(
    app: tauri::AppHandle,
    window: tauri::Window,
) -> Result<(), CommandError> {
    // §9: a sensitive command checks its calling window rather than trusting the
    // front end to only call it from the right place.
    let session_id = window::window_session_id(window.label())
        .ok_or_else(|| CommandError::system("该窗口不能操作截图会话。"))?;
    if app.state::<ActiveCapture>().is_current(session_id) {
        app.state::<crate::quick_panel::PanelController>()
            .capture_startup_succeeded();
    }
    finish_capture(&app, session_id);
    Ok(())
}

#[tauri::command]
pub fn capture_window_ready(
    app: tauri::AppHandle,
    window: tauri::Window,
) -> Result<(), CommandError> {
    let session_id = window::window_session_id(window.label())
        .ok_or_else(|| CommandError::system("该窗口不能操作截图会话。"))?;
    if let Some(startup) = app.state::<ActiveCapture>().startup_for(session_id) {
        if startup.ready(window.label()) {
            eprintln!(
                "capture session={session_id} phase=window-ready label={}",
                window.label()
            );
        }
    }
    Ok(())
}

#[tauri::command]
pub fn capture_window_failed(
    app: tauri::AppHandle,
    window: tauri::Window,
) -> Result<(), CommandError> {
    let session_id = window::window_session_id(window.label())
        .ok_or_else(|| CommandError::system("该窗口不能操作截图会话。"))?;
    if let Some(startup) = app.state::<ActiveCapture>().startup_for(session_id) {
        startup.fail(session::StartFailure::Window(
            "capture frontend did not load".into(),
        ));
    }
    finish_capture(&app, session_id);
    Ok(())
}

fn start_failure_message(failure: &session::StartFailure) -> &'static str {
    match failure {
        session::StartFailure::Busy => "截图已在进行中。",
        session::StartFailure::Cancelled => "截图已取消。",
        session::StartFailure::Capture(backend::CaptureBackendError::NotDpiAware) => {
            "当前进程无法读取物理像素，无法截图。"
        }
        session::StartFailure::Capture(backend::CaptureBackendError::SessionBudgetExceeded) => {
            "当前屏幕超出截图内存预算。"
        }
        session::StartFailure::Capture(backend::CaptureBackendError::AccessDenied) => {
            "系统暂时不允许读取屏幕，请解锁桌面后重试。"
        }
        session::StartFailure::Capture(_) => "无法获取屏幕内容。",
        session::StartFailure::Window(_) => "无法创建截图界面。",
        session::StartFailure::TimedOut => "截图启动超时。",
    }
}

/// Stages the rasterised annotation layer for the next export.
///
/// The pixels arrive as a raw binary body: §9 line 393 forbids pushing them through
/// a large Base64/JSON `invoke`. The geometry arrives as headers, because a command
/// taking a raw body cannot also deserialise named arguments from it.
///
/// Staging is separate from exporting so the version recorded here and the version
/// asserted at export time come from different moments, which is what makes the
/// staleness check meaningful.
#[tauri::command]
pub fn stage_capture_overlay(
    app: tauri::AppHandle,
    window: tauri::Window,
    request: tauri::ipc::Request<'_>,
) -> Result<(), CommandError> {
    // §9: a sensitive command checks its calling window.
    if !window::is_screenshot_label(window.label()) {
        return Err(CommandError::system("该窗口不能操作截图会话。"));
    }

    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(CommandError::system("标注图层必须以二进制体上传。"));
    };

    let version = header_number(&request, "x-overlay-version")?;
    let width = u32::try_from(header_number(&request, "x-overlay-width")?)
        .map_err(|_| CommandError::system("标注图层尺寸超出范围。"))?;
    let height = u32::try_from(header_number(&request, "x-overlay-height")?)
        .map_err(|_| CommandError::system("标注图层尺寸超出范围。"))?;

    let expected = (width as usize)
        .checked_mul(height as usize)
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or_else(|| CommandError::system("标注图层尺寸超出范围。"))?;
    if bytes.len() != expected {
        // A mismatch means the frontend and the selection disagree, which would
        // otherwise paint an offset layer into the exported file.
        return Err(CommandError::system("标注图层大小与选区不符。"));
    }

    let state = app.state::<ActiveCapture>();
    let token = state.caller_token(window.label())?;

    let rgba = bytes.clone();
    state
        .with_current(token.session_id, || {
            app.state::<export::OverlayStaging>().stage(
                token.session_id,
                version,
                width,
                height,
                rgba,
            );
        })
        .ok_or_else(|| CommandError::system("截图会话已结束。"))?;
    Ok(())
}

/// Reads a non-negative integer header, rejecting anything else.
fn header_number(request: &tauri::ipc::Request<'_>, name: &str) -> Result<u64, CommandError> {
    request
        .headers()
        .get(name)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .ok_or_else(|| CommandError::system("标注图层参数无效。"))
}

/// The selection and mosaics for one export, in physical pixels.
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportGeometry {
    /// Virtual-desktop coordinates, so a secondary display's negative origin works.
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    /// Selection-local, in creation order.
    #[serde(default)]
    pub mosaics: Vec<ExportMosaic>,
    /// The annotation document version this export is for.
    pub version: u64,
    /// False when the document has no annotations, so no overlay is expected.
    #[serde(default)]
    pub has_overlay: bool,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportMosaic {
    pub x: i64,
    pub y: i64,
    pub width: u32,
    pub height: u32,
    pub block_size: u32,
}

/// Archives the final image before copying; failures preserve the live editor.
#[tauri::command(async)]
pub fn copy_capture_to_clipboard(
    app: tauri::AppHandle,
    window: tauri::Window,
    geometry: ExportGeometry,
) -> Result<(), CommandError> {
    if !window::is_screenshot_label(window.label()) {
        return Err(CommandError::reported("该窗口不能操作截图会话。"));
    }
    let state = app.state::<ActiveCapture>();
    let _operation = state.export_operation.try_lock()
        .map_err(|_| CommandError::reported("截图正在完成，请稍候。"))?;
    let token = state.caller_token(window.label())?;
    let request = build_export_request(&app, token.session_id, &geometry)?;
    let image = export::render_request(&app.state::<FrameStore>(), &request)
        .map_err(export_error_message)?;
    let encoded = encode::encode_export(image).map_err(export_error_message)?;
    state.with_current(token.session_id, || {
        history::archive(&app, token.session_id, geometry.version, &encoded)
    }).ok_or_else(|| CommandError::reported("截图会话已结束。"))??;
    let owner = window.hwnd()
        .map_err(|_| archived_copy_error())?;
    let mut clipboard = clipboard::WindowsClipboard::guarded(owner, || state.is_current(token.session_id));
    let mut sink = output::SessionSink::new(&mut clipboard, || state.is_current(token.session_id));
    let mut transaction = output::ExportTransaction::new(output::ExportKind::Clipboard, request.token);
    let start = std::time::Instant::now();
    transaction.run_clipboard(&mut sink, &encoded, request.token, std::thread::sleep, || start.elapsed())
        .map_err(|_| archived_copy_error())?;
    finish_capture(&app, token.session_id);
    Ok(())
}

fn archived_copy_error() -> CommandError {
    CommandError { code: "archived_copy_failed".into(), message: "图片已保存，但复制失败，请重试。".into(), field: None }
}

/// Saves directly to the system Pictures archive. True means the PNG is ready.
#[tauri::command(async)]
pub fn save_capture_to_file(
    app: tauri::AppHandle,
    window: tauri::Window,
    geometry: ExportGeometry,
) -> Result<bool, CommandError> {
    if !window::is_screenshot_label(window.label()) {
        return Err(CommandError::reported("该窗口不能操作截图会话。"));
    }
    let state = app.state::<ActiveCapture>();
    let _operation = state.export_operation.try_lock()
        .map_err(|_| CommandError::reported("截图正在完成，请稍候。"))?;
    let token = state.caller_token(window.label())?;
    let request = build_export_request(&app, token.session_id, &geometry)?;
    let image = export::render_request(&app.state::<FrameStore>(), &request)
        .map_err(export_error_message)?;
    let encoded = encode::encode_export(image).map_err(export_error_message)?;
    state.with_current(token.session_id, || {
        history::archive(&app, token.session_id, geometry.version, &encoded)
    }).ok_or_else(|| CommandError::reported("截图会话已结束。"))??;
    finish_capture(&app, token.session_id);
    Ok(true)
}
/// Shared by both exports, so the clipboard and the file are built from the same
/// geometry and the same staged overlay rules.
fn build_export_request(
    app: &tauri::AppHandle,
    session_id: u64,
    geometry: &ExportGeometry,
) -> Result<export::ExportRequest, CommandError> {
    let staging = app.state::<export::OverlayStaging>();
    let overlay = if geometry.has_overlay {
        let Some(bytes) = staging.take(
            session_id,
            geometry.version,
            geometry.width,
            geometry.height,
        ) else {
            return Err(CommandError::system("标注已变更，请重试。"));
        };
        Some(bytes)
    } else {
        // No annotations, so any leftover layer must not be blended in.
        staging.clear_if_session(session_id);
        None
    };

    Ok(export::ExportRequest {
        token: output::ExportToken {
            session_id,
            version: geometry.version,
        },
        selection: composite::SelectionRect {
            x: geometry.x,
            y: geometry.y,
            width: geometry.width,
            height: geometry.height,
        },
        overlay,
        mosaics: geometry
            .mosaics
            .iter()
            .map(|mosaic| mosaic::MosaicRegion {
                x: mosaic.x,
                y: mosaic.y,
                width: mosaic.width,
                height: mosaic.height,
                block_size: mosaic.block_size,
            })
            .collect(),
    })
}

/// Renders the selection with its mosaics applied and returns the path to fetch it.
///
/// §5.3: the preview must show real mosaic pixels, and `mosaic.rs` is the only
/// implementation, so the image the user looks at is rendered by the same code that
/// renders the export. Pixels travel over the local scheme, never through this
/// command's return value.
#[tauri::command]
pub fn render_mosaic_preview(
    app: tauri::AppHandle,
    window: tauri::Window,
    geometry: ExportGeometry,
) -> Result<PreviewPlan, CommandError> {
    if !window::is_screenshot_label(window.label()) {
        return Err(CommandError::system("该窗口不能操作截图会话。"));
    }

    let state = app.state::<ActiveCapture>();
    let token = state.caller_token(window.label())?;

    // The preview deliberately excludes the annotation overlay: the WebView already
    // draws those on top, and blending them in here would show them twice.
    let request = export::ExportRequest {
        token: output::ExportToken {
            session_id: token.session_id,
            version: geometry.version,
        },
        selection: composite::SelectionRect {
            x: geometry.x,
            y: geometry.y,
            width: geometry.width,
            height: geometry.height,
        },
        overlay: None,
        mosaics: geometry
            .mosaics
            .iter()
            .map(|mosaic| mosaic::MosaicRegion {
                x: mosaic.x,
                y: mosaic.y,
                width: mosaic.width,
                height: mosaic.height,
                block_size: mosaic.block_size,
            })
            .collect(),
    };

    let image = export::render_request(&app.state::<FrameStore>(), &request)
        .map_err(export_error_message)?;
    let encoded = encode::encode_export(image).map_err(export_error_message)?;
    let serial = state
        .with_current(token.session_id, || {
            app.state::<PreviewStore>()
                .store(token.session_id, encoded.png)
        })
        .ok_or_else(|| CommandError::system("截图会话已结束。"))?;

    Ok(PreviewPlan {
        path: format!("preview/{}/{serial}", token.session_id),
        width: geometry.width,
        height: geometry.height,
    })
}

/// Where to fetch the mosaicked preview, and its size.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewPlan {
    pub path: String,
    pub width: u32,
    pub height: u32,
}

/// Formats a sampled colour as the seven characters §4.1 line 156 specifies.
///
/// Uppercase `#RRGGBB` and nothing else: no coordinates, no newline, no alpha. Separate
/// from the command so the format is assertable without a clipboard.
pub(crate) fn format_hex(rgb: [u8; 3]) -> String {
    format!("#{:02X}{:02X}{:02X}", rgb[0], rgb[1], rgb[2])
}

/// Copies the colour under the pointer to the clipboard.
///
/// §4.1 line 157 requires the sample to come from the frozen base image's own pixels,
/// so the coordinate travels and Rust reads the frame. Sampling in the WebView and
/// sending a string would let a canvas colour-management difference change the value the
/// user is told they copied.
///
/// Returns false when the coordinate lands in a desktop gap. §4.1 line 159 requires the
/// clipboard to be left alone in that case, not filled with the previous colour.
#[tauri::command]
pub fn copy_capture_color(
    app: tauri::AppHandle,
    window: tauri::Window,
    x: i32,
    y: i32,
) -> Result<bool, CommandError> {
    if !window::is_screenshot_label(window.label()) {
        return Err(CommandError::system("该窗口不能操作截图会话。"));
    }

    let state = app.state::<ActiveCapture>();
    let token = state.caller_token(window.label())?;

    let sampled = app
        .state::<FrameStore>()
        .with_frames(token.session_id, |frames| {
            composite::sample_pixel(frames, x, y)
        })
        .ok_or_else(|| CommandError::system("截图会话已结束。"))?;

    // A gap between displays has no pixel to copy.
    let Some(rgb) = sampled else {
        return Ok(false);
    };

    let owner = window
        .hwnd()
        .map_err(|_| CommandError::system("无法定位截图窗口。"))?;
    let mut clipboard =
        clipboard::WindowsClipboard::guarded(owner, || state.is_current(token.session_id));
    let mut sink = output::SessionSink::new(&mut clipboard, || state.is_current(token.session_id));
    output::ClipboardSink::write_text(&mut sink, &format_hex(rgb)).map_err(export_error_message)?;
    Ok(true)
}

fn export_error_message(error: output::ExportError) -> CommandError {
    // §8.3: the message carries a category, never a path or pixel content.
    CommandError::system(match error {
        output::ExportError::ClipboardBusy => "剪贴板被占用，请重试或保存图片。",
        output::ExportError::Superseded => "标注已变更，请重试。",
        output::ExportError::TargetChanged => "保存位置已变化，请重新选择。",
        output::ExportError::WriteFailed(_) => "复制失败，请重试或保存图片。",
    })
}

#[cfg(test)]
mod tests {
    use super::{
        validate_output_dimensions, CapacityError, CapturePhase, CaptureSession, SessionError,
        MAX_OUTPUT_DIMENSION, MAX_OUTPUT_PIXELS,
    };

    #[test]
    fn idle_prewarm_target_does_not_activate_or_block_first_capture() {
        let state = super::ActiveCapture::default();
        let target = state.prewarm_target().unwrap();
        assert!(state.may_build_for(target));
        assert!(!state.is_active());
        let (token, _) = state.begin().unwrap();
        assert_eq!(token.session_id, target);
        assert!(state.is_active());
        assert!(state.end_session(token.session_id));
        assert!(state.is_active());
        state.finish_retirement(token.session_id);
        assert!(!state.is_active());
        assert!(state.begin().is_ok());
    }

    #[test]
    fn the_seam_reports_platform_capability() {
        // Platform capability only: a Windows build offers capture, and the real
        // per-attempt failures come from the backend during startup rather than
        // from this flag.
        assert_eq!(super::is_available(), cfg!(target_os = "windows"));
    }

    #[test]
    fn only_one_capture_session_can_start() {
        let mut session = CaptureSession::default();

        let started = session.begin().expect("first capture should start");

        assert_eq!(started.phase, CapturePhase::Starting);
        assert_eq!(session.begin(), Err(SessionError::Busy));
    }

    #[test]
    fn transitions_increment_the_session_version() {
        let mut session = CaptureSession::default();
        let started = session.begin().expect("capture should start");

        let aiming = session
            .transition(started, CapturePhase::Aiming)
            .expect("current transition should succeed");

        assert_eq!(aiming.session_id, started.session_id);
        assert_eq!(aiming.version, started.version + 1);
        assert_eq!(aiming.phase, CapturePhase::Aiming);
    }

    #[test]
    fn stale_async_results_cannot_advance_a_new_session() {
        let mut session = CaptureSession::default();
        let old = session.begin().expect("capture should start");
        session.cancel(old).expect("capture should cancel");
        let current = session.begin().expect("new capture should start");

        assert_ne!(old.session_id, current.session_id);
        assert_eq!(
            session.transition(old, CapturePhase::Aiming),
            Err(SessionError::StaleSession)
        );
        assert_eq!(session.current(), Some(current));
    }

    #[test]
    fn an_old_destroy_event_cannot_cancel_a_replacement_session() {
        let state = super::ActiveCapture::default();
        let (old, old_startup) = state.begin().unwrap();
        assert!(state.end_session(old.session_id));
        state.finish_retirement(old.session_id);
        let (current, _) = state.begin().unwrap();

        assert!(!state.end_session(old.session_id));
        assert!(state.is_current(current.session_id));
        assert!(old_startup.is_cancelled());
        assert!(state
            .caller_token(&super::window::overlay_label(old.session_id, 0))
            .is_err());
        assert_eq!(
            state
                .caller_token(&super::window::overlay_label(current.session_id, 0))
                .unwrap(),
            current
        );
    }

    #[test]
    fn a_new_suppression_waits_until_the_previous_bar_restore_finishes() {
        let state = super::ActiveCapture::default();
        let (old, _) = state.begin().unwrap();
        assert!(state.end_session(old.session_id));
        assert!(matches!(state.begin(), Err(SessionError::Busy)));
        state.finish_retirement(old.session_id + 1);
        assert!(matches!(state.begin(), Err(SessionError::Busy)));
        state.finish_retirement(old.session_id);
        assert!(state.begin().is_ok());
    }

    #[test]
    fn a_stale_commit_never_runs_its_resource_mutation() {
        let state = super::ActiveCapture::default();
        let (old, _) = state.begin().unwrap();
        assert!(state.end_session(old.session_id));
        state.finish_retirement(old.session_id);
        let (current, _) = state.begin().unwrap();
        assert_eq!(
            state.with_current(old.session_id, || panic!("stale commit")),
            None::<()>
        );
        assert_eq!(state.with_current(current.session_id, || 7), Some(7));
    }

    #[test]
    fn a_delayed_suppression_callback_cannot_hide_a_newer_session() {
        let state = super::ActiveCapture::default();
        let (old, _) = state.begin().unwrap();
        state.end_session(old.session_id);
        state.finish_retirement(old.session_id);
        let (current, _) = state.begin().unwrap();
        let panel = crate::quick_panel::PanelController::default();
        let calls = std::cell::Cell::new(0);
        let result = state.suppress_current(
            old.session_id,
            || {
                calls.set(calls.get() + 1);
                panel.begin_capture_suppression(|| true, |_| (), || ()).0
            },
            |_| (),
        );
        assert_eq!(result, Err(super::session::StartFailure::Cancelled));
        assert_eq!(calls.get(), 0);
        assert!(state.is_current(current.session_id));
    }

    #[test]
    fn suppression_completed_after_retirement_is_restored_not_adopted() {
        let state = super::ActiveCapture::default();
        let (old, _) = state.begin().unwrap();
        let panel = crate::quick_panel::PanelController::default();
        let restored = std::cell::Cell::new(0);
        let result = state.suppress_current(
            old.session_id,
            || {
                let suppression = panel.begin_capture_suppression(|| true, |_| (), || ()).0;
                state.end_session(old.session_id);
                suppression
            },
            |suppression| {
                panel.end_capture_suppression(suppression, || restored.set(restored.get() + 1));
            },
        );
        assert_eq!(result, Err(super::session::StartFailure::Cancelled));
        assert_eq!(restored.get(), 1);
        assert!(state.take_suppression(old.session_id).is_none());
    }

    #[test]
    fn output_capacity_accepts_the_documented_pixel_boundary() {
        assert_eq!(
            validate_output_dimensions(8_000, 8_000),
            Ok(MAX_OUTPUT_PIXELS * 4)
        );
    }

    #[test]
    fn output_capacity_rejects_empty_oversized_and_overflowing_dimensions() {
        assert_eq!(
            validate_output_dimensions(0, 1),
            Err(CapacityError::EmptyImage)
        );
        assert_eq!(
            validate_output_dimensions(MAX_OUTPUT_DIMENSION + 1, 1),
            Err(CapacityError::DimensionLimit)
        );
        assert_eq!(
            validate_output_dimensions(8_001, 8_000),
            Err(CapacityError::PixelLimit)
        );
        assert_eq!(
            validate_output_dimensions(u64::MAX, u64::MAX),
            Err(CapacityError::ArithmeticOverflow)
        );
    }
}

#[cfg(test)]
mod dispatch_tests {
    #[test]
    fn frame_encoding_is_dispatched_from_an_asynchronous_protocol() {
        let source = include_str!("main.rs");
        let registration = source.find("screen_capture::FRAME_URI_SCHEME").unwrap();
        assert!(
            source[..registration]
                .trim_end()
                .ends_with(".register_asynchronous_uri_scheme_protocol("),
            "PNG encoding must not execute inside a synchronous main-thread protocol callback"
        );
        let callback =
            &source[registration..source[registration..].find(".plugin(").unwrap() + registration];
        assert!(callback.contains("std::thread::spawn(move ||"));
        assert!(callback.contains("responder.respond"));
    }

    /// The startup supervisor and blocking export/dialog operations must stay
    /// off the event-loop thread. Readiness IPC itself remains synchronous and
    /// short so it can acknowledge while startup is waiting.
    #[test]
    fn window_driving_capture_commands_are_dispatched_off_the_main_thread() {
        let source = include_str!("screen_capture.rs");

        // Keep these operations off the event-loop thread.
        for command in [
            "pub fn start_screen_capture",
            "pub fn describe_capture_frame",
            "pub fn cancel_screen_capture",
            "pub fn copy_capture_to_clipboard",
            "pub fn save_capture_to_file",
        ] {
            let at = source
                .find(command)
                .unwrap_or_else(|| panic!("{command} should exist"));
            let preceding = &source[..at];
            let attribute = preceding
                .rfind("#[tauri::command")
                .map(|start| &preceding[start..])
                .unwrap_or_else(|| panic!("{command} should carry a command attribute"));

            assert!(
                attribute.starts_with("#[tauri::command(async)]"),
                "{command} must be #[tauri::command(async)] so startup/export cannot block readiness IPC"
            );
        }
    }

    /// Guards the assertion above against silently passing on a renamed attribute.
    #[test]
    fn the_dispatch_check_can_tell_the_two_attributes_apart() {
        let source = include_str!("screen_capture.rs");
        // A command that does no window work is deliberately left blocking, so the
        // check above would be vacuous if it could not distinguish them.
        let at = source
            .find("pub fn capture_window_ready")
            .expect("capture_window_ready should exist");
        let attribute = source[..at]
            .rfind("#[tauri::command")
            .map(|start| &source[..at][start..])
            .expect("it should carry a command attribute");

        assert!(attribute.starts_with("#[tauri::command]"));
        assert!(!attribute.starts_with("#[tauri::command(async)]"));
    }
}

#[cfg(test)]
mod failure_message_tests {
    use super::{backend::CaptureBackendError, session::StartFailure, start_failure_message};

    #[test]
    fn a_refused_screen_read_is_reported_as_retryable() {
        // E_ACCESSDENIED from BitBlt is environmental: a locked or switched-away
        // desktop, a detached remote session, or a secure desktop owning input. The
        // user can retry, so it must not read as a generic failure.
        assert_eq!(
            start_failure_message(&StartFailure::Capture(CaptureBackendError::AccessDenied)),
            "系统暂时不允许读取屏幕，请解锁桌面后重试。"
        );
    }

    #[test]
    fn every_start_failure_has_its_own_message() {
        // The bar can only show this text, so two different causes reading the same
        // way would leave the user with no idea what to do differently.
        let messages = [
            start_failure_message(&StartFailure::Busy),
            start_failure_message(&StartFailure::Capture(CaptureBackendError::AccessDenied)),
            start_failure_message(&StartFailure::Capture(CaptureBackendError::NotDpiAware)),
            start_failure_message(&StartFailure::Capture(
                CaptureBackendError::SessionBudgetExceeded,
            )),
            start_failure_message(&StartFailure::Capture(CaptureBackendError::CaptureFailed)),
            start_failure_message(&StartFailure::TimedOut),
        ];

        for (index, message) in messages.iter().enumerate() {
            assert!(!message.is_empty());
            assert!(
                !messages[..index].contains(message),
                "duplicate failure message: {message}"
            );
        }
    }
}

#[cfg(test)]
mod request_path_tests {
    use super::decode_request_path;
    use super::frames::parse_frame_path;
    use super::preview::parse_preview_path;

    #[test]
    fn frame_cors_allows_only_exact_application_origins() {
        for origin in [
            "tauri://localhost",
            "http://tauri.localhost",
            "https://tauri.localhost",
            "http://localhost:1420",
        ] {
            let allowed =
                super::frame_cors_origin(Some(origin), Some("http://localhost:1420")).unwrap();
            let response = super::frame_png_response(vec![1, 2, 3], allowed);
            assert_eq!(
                response
                    .headers()
                    .get("access-control-allow-origin")
                    .unwrap(),
                origin
            );
            assert_eq!(response.headers().get("vary").unwrap(), "Origin");
        }
    }

    #[test]
    fn frame_cors_refuses_remote_opaque_and_lookalike_origins() {
        for origin in [
            "https://attacker.example",
            "null",
            "http://tauri.localhost.attacker.example",
            "http://localhost:1421",
            "https://localhost:1420",
        ] {
            assert!(super::frame_cors_origin(Some(origin), Some("http://localhost:1420")).is_err());
        }
        assert!(super::frame_cors_origin(Some("http://localhost:1420"), None).is_err());
    }

    #[test]
    fn frame_cors_does_not_add_a_wildcard_to_requests_without_an_origin() {
        let origin = super::frame_cors_origin(None, Some("http://localhost:1420")).unwrap();
        let response = super::frame_png_response(vec![1], origin);
        assert!(!response
            .headers()
            .contains_key("access-control-allow-origin"));
    }

    #[test]
    fn decodes_the_separator_convert_file_src_encodes() {
        // `convertFileSrc` runs the whole path through `encodeURIComponent`, so the
        // separator arrives encoded. Without decoding, the path is one opaque
        // segment and the frame is answered with a 400.
        assert_eq!(decode_request_path("/1%2F0"), "/1/0");
        assert_eq!(decode_request_path("/preview%2F1%2F2"), "/preview/1/2");
    }

    #[test]
    fn leaves_an_already_plain_path_alone() {
        // Not every platform encodes the same way, so both forms must work.
        assert_eq!(decode_request_path("/7/3"), "/7/3");
        assert_eq!(decode_request_path("/preview/7/2"), "/preview/7/2");
    }

    #[test]
    fn a_decoded_frame_path_parses() {
        // The regression itself: the encoded form has to reach the parser as a
        // session/display pair rather than as one unparsable segment.
        assert_eq!(parse_frame_path("/1%2F0"), None);
        assert_eq!(
            parse_frame_path(&decode_request_path("/1%2F0")),
            Some((1, 0))
        );
    }

    #[test]
    fn a_decoded_preview_path_parses() {
        assert_eq!(parse_preview_path("/preview%2F1%2F2"), None);
        assert_eq!(
            parse_preview_path(&decode_request_path("/preview%2F1%2F2")),
            Some((1, 2))
        );
    }

    #[test]
    fn decoding_does_not_widen_what_can_be_reached() {
        // §9: this path selects which desktop pixels are served. Decoding must not
        // turn an encoded traversal into a served frame, so the parsers still accept
        // nothing but a pair of plain integers.
        assert_eq!(
            parse_frame_path(&decode_request_path("/..%2F..%2Fetc")),
            None
        );
        assert_eq!(parse_frame_path(&decode_request_path("/1%2F0%2F9")), None);
        assert_eq!(parse_frame_path(&decode_request_path("/-1%2F0")), None);
        assert_eq!(
            parse_preview_path(&decode_request_path("/preview%2F..%2F2")),
            None
        );
    }
}

#[cfg(test)]
mod hex_tests {
    use super::format_hex;

    #[test]
    fn formats_seven_uppercase_characters() {
        // §4.1 line 156: exactly `#RRGGBB`, uppercase, nothing else.
        assert_eq!(format_hex([240, 100, 69]), "#F06445");
        assert_eq!(format_hex([0, 0, 0]), "#000000");
        assert_eq!(format_hex([255, 255, 255]), "#FFFFFF");
    }

    #[test]
    fn pads_single_digit_channels() {
        // Without padding this would be "#A0B", which is not a colour the user can paste.
        assert_eq!(format_hex([10, 0, 11]), "#0A000B");
    }

    #[test]
    fn is_always_exactly_seven_characters() {
        for value in [0u8, 1, 15, 16, 127, 200, 254, 255] {
            assert_eq!(format_hex([value, value, value]).len(), 7);
        }
    }

    #[test]
    fn uses_uppercase_hex_letters() {
        // Lowercase would still parse, but §4.1 fixes the case so what the user pastes
        // matches what the magnifier showed them.
        let hex = format_hex([171, 205, 239]);
        assert_eq!(hex, "#ABCDEF");
        assert!(!hex.chars().any(|c| c.is_ascii_lowercase()));
    }
}
