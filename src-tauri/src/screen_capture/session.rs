//! Capture work runs independently of its bounded startup supervisor.
//! The frozen desktop is presented natively as soon as pixels exist; frontend
//! acknowledgements then establish that every interactive surface is usable.

use std::sync::Arc;
use std::time::Instant;

use super::backend::CaptureBackendError;
use super::startup::Startup;
use super::window::{overlay_plan, session_label};
use super::SessionToken;
use tauri::{Emitter, Manager};

/// Tells already-loaded capture surfaces that their session's frames exist.
pub(crate) const BEGIN_EVENT: &str = "screenshot-capture-begin";

/// Lets the restored Bar and desktop settle before building the next windows.
const PREWARM_AFTER_SESSION: std::time::Duration = std::time::Duration::from_millis(400);
/// Keeps prewarming out of the application's own launch.
pub(crate) const PREWARM_AFTER_LAUNCH: std::time::Duration = std::time::Duration::from_secs(2);

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum StartFailure {
    Busy,
    Cancelled,
    Capture(CaptureBackendError),
    Window(String),
    TimedOut,
}

impl From<CaptureBackendError> for StartFailure {
    fn from(error: CaptureBackendError) -> Self {
        Self::Capture(error)
    }
}

fn bounded_dispatch(
    deadline: Instant,
    schedule: impl FnOnce(Box<dyn FnOnce() + Send>) -> Result<(), String>,
    work: impl FnOnce() -> Result<(), StartFailure> + Send + 'static,
) -> Result<(), StartFailure> {
    let (sender, receiver) = std::sync::mpsc::channel();
    schedule(Box::new(move || {
        let _ = sender.send(work());
    }))
    .map_err(StartFailure::Window)?;
    receiver
        .recv_timeout(deadline.saturating_duration_since(Instant::now()))
        .map_err(|_| StartFailure::TimedOut)?
}

pub(crate) fn suppress_bar<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    session_id: u64,
    deadline: Instant,
) -> Result<(), StartFailure> {
    let main_app = app.clone();
    bounded_dispatch(
        deadline,
        |work| {
            app.run_on_main_thread(work)
                .map_err(|error| error.to_string())
        },
        move || {
            main_app.state::<super::ActiveCapture>().suppress_current(
                session_id,
                || crate::quick_panel::suppress_for_capture(&main_app),
                |token| crate::quick_panel::restore_after_capture(&main_app, token),
            )
        },
    )
}

/// A native capture can outlive its budget, so the supervisor never joins it.
fn supervise(
    startup: Arc<Startup>,
    deadline: Instant,
    work: impl FnOnce(&Arc<Startup>) -> Result<(), StartFailure> + Send + 'static,
) -> Result<(), StartFailure> {
    let worker_startup = startup.clone();
    std::thread::Builder::new()
        .name("capture-startup".into())
        .spawn(move || {
            let result =
                std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| work(&worker_startup)));
            match result {
                Ok(Ok(())) => worker_startup.created(),
                Ok(Err(failure)) => worker_startup.fail(failure),
                Err(_) => worker_startup.fail(StartFailure::Window(
                    "capture startup worker panicked".into(),
                )),
            }
        })
        .map_err(|error| StartFailure::Window(error.to_string()))?;
    startup.wait(deadline)
}

pub(crate) fn start_capture<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    token: SessionToken,
    startup: Arc<Startup>,
    started: Instant,
    deadline: Instant,
) -> Result<(), StartFailure> {
    if Instant::now() >= deadline {
        startup.fail(StartFailure::TimedOut);
        return Err(StartFailure::TimedOut);
    }
    let effects = TauriEffects::new(app, token.session_id, startup.clone(), started);
    let worker = effects.clone();
    supervise(startup, deadline, move |_| worker.prepare())?;
    effects.trace("all-windows-ready");
    effects.show_windows(deadline)?;
    effects.trace("windows-shown");
    Ok(())
}

struct TauriEffects<R: tauri::Runtime> {
    app: tauri::AppHandle<R>,
    session_id: u64,
    startup: Arc<Startup>,
    started: Instant,
}

impl<R: tauri::Runtime> Clone for TauriEffects<R> {
    fn clone(&self) -> Self {
        Self {
            app: self.app.clone(),
            session_id: self.session_id,
            startup: self.startup.clone(),
            started: self.started,
        }
    }
}

impl<R: tauri::Runtime> TauriEffects<R> {
    fn new(
        app: tauri::AppHandle<R>,
        session_id: u64,
        startup: Arc<Startup>,
        started: Instant,
    ) -> Self {
        Self {
            app,
            session_id,
            startup,
            started,
        }
    }

    fn trace(&self, phase: &str) {
        eprintln!(
            "capture session={} phase={} elapsed_ms={}",
            self.session_id,
            phase,
            self.started.elapsed().as_millis()
        );
    }

    fn check_current(&self) -> Result<(), StartFailure> {
        if self.startup.is_cancelled()
            || !self
                .app
                .state::<super::ActiveCapture>()
                .is_current(self.session_id)
        {
            return Err(StartFailure::Cancelled);
        }
        Ok(())
    }

    fn prepare(&self) -> Result<(), StartFailure> {
        self.check_current()?;
        self.trace("composition-wait");
        #[cfg(target_os = "windows")]
        unsafe {
            windows::Win32::Graphics::Dwm::DwmFlush()
                .map_err(|error| StartFailure::Window(format!("composition failed: {error}")))?;
        }
        self.check_current()?;
        let candidates = super::candidates::snapshot(&self.app).map_err(StartFailure::Window)?;
        self.trace("window-candidates-frozen");
        self.check_current()?;
        self.trace("capture-start");
        #[cfg(target_os = "windows")]
        let frames = {
            let source = super::gdi::GdiSource;
            let natives = super::backend::capture_native(&source).map_err(StartFailure::Capture)?;
            self.check_current()?;
            self.trace("capture-complete");
            self.present_freeze(&natives)?;
            self.trace("frozen-visible");
            super::backend::to_frames(&source, &natives).map_err(StartFailure::Capture)?
        };
        #[cfg(not(target_os = "windows"))]
        let frames: Vec<super::backend::CapturedDisplay> =
            return Err(StartFailure::Capture(CaptureBackendError::NoDisplays));
        self.check_current()?;
        let displays: Vec<_> = frames.iter().map(|frame| frame.display.clone()).collect();
        let plan = overlay_plan(self.session_id, &displays);
        if plan.is_empty() {
            return Err(StartFailure::Capture(CaptureBackendError::NoDisplays));
        }
        self.startup.expect(
            std::iter::once(session_label(self.session_id))
                .chain(plan.iter().map(|overlay| overlay.label.clone())),
        );
        if !self.app.state::<super::FrameStore>().store_if_current(
            self.session_id,
            frames,
            candidates,
        ) {
            return Err(StartFailure::Cancelled);
        }
        self.check_current()?;
        // Prewarmed surfaces are already listening; ones built below ask on load.
        self.startup.frames_available();
        let _ = self.app.emit(BEGIN_EVENT, self.session_id);
        self.trace("frames-stored");
        let guard = || self.check_current();
        let reused = super::pool::reconcile(&self.app, self.session_id, &plan, &guard)?;
        self.trace(&format!("windows-ready-awaiting-ack reused={reused}/{}", plan.len()));
        Ok(())
    }

    /// Creates and shows one freeze window per display on the main thread.
    ///
    /// Ownership is recorded there too, and only while the session is still
    /// current: teardown also runs on the main thread, so a cancelled session
    /// either finds the windows to destroy or this destroys them itself.
    #[cfg(target_os = "windows")]
    fn present_freeze(
        &self,
        natives: &[super::backend::NativeCapture<Arc<super::gdi::DibFrame>>],
    ) -> Result<(), StartFailure> {
        use super::freeze::native;
        let surfaces: Vec<_> = natives
            .iter()
            .map(|capture| (capture.display.clone(), capture.native.clone()))
            .collect();
        let effects = self.clone();
        let deadline = Instant::now() + super::window::STARTUP_TIMEOUT;
        bounded_dispatch(
            deadline,
            |work| {
                self.app
                    .run_on_main_thread(work)
                    .map_err(|error| error.to_string())
            },
            move || {
                effects.check_current()?;
                let mut created = Vec::with_capacity(surfaces.len());
                for (display, frame) in surfaces {
                    match native::create(&display, frame) {
                        Ok(window) => created.push((display.id, window)),
                        Err(error) => {
                            created.into_iter().for_each(|(_, window)| native::destroy(window));
                            return Err(StartFailure::Window(error));
                        }
                    }
                }
                let windows: Vec<isize> = created.iter().map(|(_, window)| *window).collect();
                let layer = effects.app.state::<super::freeze::FreezeLayer>();
                let adopted = effects
                    .app
                    .state::<super::ActiveCapture>()
                    .with_current(effects.session_id, || {
                        layer.adopt(effects.session_id, created)
                    });
                let Some(stale) = adopted else {
                    windows.into_iter().for_each(native::destroy);
                    return Err(StartFailure::Cancelled);
                };
                stale.into_iter().for_each(native::destroy);
                windows.into_iter().for_each(native::show);
                Ok(())
            },
        )
    }

    fn check_built_window(&self, window: &tauri::WebviewWindow<R>) -> Result<(), StartFailure> {
        if let Err(failure) = self.check_current() {
            // A builder may register after timeout's window scan already ran.
            let _ = window.destroy();
            return Err(failure);
        }
        Ok(())
    }

    fn show_windows(&self, deadline: Instant) -> Result<(), StartFailure> {
        let (sender, receiver) = std::sync::mpsc::channel();
        let effects = self.clone();
        let labels = self.startup.expected_labels();
        self.app
            .run_on_main_thread(move || {
                let result = (|| {
                    effects.check_current()?;
                    // Only this session's planned surfaces: a prewarmed overlay for
                    // a display that has since gone stays hidden until teardown.
                    let mut windows = labels
                        .iter()
                        .map(|label| {
                            effects.app.get_webview_window(label).ok_or_else(|| {
                                StartFailure::Window(format!("missing capture window {label}"))
                            })
                        })
                        .collect::<Result<Vec<_>, _>>()?;
                    windows.sort_by_key(|window| {
                        (
                            super::window::presentation_priority(window.label()),
                            window.label().to_owned(),
                        )
                    });
                    for window in &windows {
                        effects.check_built_window(window)?;
                        if let Some(display_id) = super::window::overlay_display_id(window.label())
                        {
                            window
                                .show()
                                .map_err(|error| StartFailure::Window(error.to_string()))?;
                            #[cfg(target_os = "windows")]
                            {
                                let overlay = window
                                    .hwnd()
                                    .map_err(|error| StartFailure::Window(error.to_string()))?;
                                let freeze = effects
                                    .app
                                    .state::<super::freeze::FreezeLayer>()
                                    .window_for(effects.session_id, display_id);
                                super::freeze::native::stack_under(freeze, overlay);
                            }
                            #[cfg(not(target_os = "windows"))]
                            let _ = display_id;
                        } else {
                            show_session_without_activation(window)?;
                        }
                        effects.check_built_window(window)?;
                    }
                    if let Some(overlay) = windows
                        .iter()
                        .find(|window| super::window::overlay_display_id(window.label()).is_some())
                    {
                        overlay
                            .set_focus()
                            .map_err(|error| StartFailure::Window(error.to_string()))?;
                    }
                    Ok(())
                })();
                let _ = sender.send(result);
            })
            .map_err(|error| StartFailure::Window(error.to_string()))?;
        receiver
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .map_err(|_| StartFailure::TimedOut)?
    }
}

fn show_session_without_activation<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
) -> Result<(), StartFailure> {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_SHOWNOACTIVATE};
        let hwnd = window
            .hwnd()
            .map_err(|error| StartFailure::Window(error.to_string()))?;
        // Decoded, always-on-top overlays already cover every display. This
        // non-topmost static entry stays beneath them without taking focus.
        unsafe {
            let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        }
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    window
        .show()
        .map_err(|error| StartFailure::Window(error.to_string()))
}

pub(crate) fn teardown<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    session_id: u64,
    suppression: Option<crate::quick_panel::CaptureSuppression>,
) {
    for window in session_windows(app, session_id) {
        let _ = window.destroy();
    }
    // Restore before buffer cleanup, which can wait for an in-flight encoder.
    let restore_app = app.clone();
    if let Err(error) = app.run_on_main_thread(move || {
        // After the overlays' destroy requests, which were queued first, so the
        // interactive layer never sits over a live desktop.
        #[cfg(target_os = "windows")]
        for window in restore_app
            .state::<super::freeze::FreezeLayer>()
            .take_if_session(session_id)
        {
            super::freeze::native::destroy(window);
        }
        if let Some(suppression) = suppression {
            crate::quick_panel::restore_after_capture(&restore_app, suppression);
        }
        restore_app
            .state::<super::ActiveCapture>()
            .finish_retirement(session_id);
        super::pool::schedule_prewarm(restore_app.clone(), PREWARM_AFTER_SESSION);
    }) {
        eprintln!("capture session={session_id} phase=restore-dispatch-failed reason={error}");
        // A stopped event loop cannot restore a native window; do not leave the
        // session state wedged as well.
        app.state::<super::ActiveCapture>()
            .finish_retirement(session_id);
    }
    let cleanup_app = app.clone();
    std::thread::spawn(move || {
        cleanup_app
            .state::<super::FrameStore>()
            .clear_if_session(session_id);
        cleanup_app
            .state::<super::PreviewStore>()
            .clear_if_session(session_id);
        cleanup_app
            .state::<super::OverlayStaging>()
            .clear_if_session(session_id);
    });
}

fn session_windows<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    session_id: u64,
) -> Vec<tauri::WebviewWindow<R>> {
    app.webview_windows()
        .into_iter()
        .filter(|(label, _)| super::window::window_session_id(label) == Some(session_id))
        .map(|(_, window)| window)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{mpsc, Mutex};
    use std::time::Duration;

    #[test]
    fn delayed_suppression_dispatch_obeys_the_original_deadline() {
        let (sender, receiver) = mpsc::channel();
        let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let work_calls = calls.clone();
        let result = bounded_dispatch(
            Instant::now() + Duration::from_millis(20),
            move |work| {
                sender.send(work).unwrap();
                Ok(())
            },
            move || {
                work_calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                Ok(())
            },
        );
        assert_eq!(result, Err(StartFailure::TimedOut));
        assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 0);
        receiver.recv_timeout(Duration::from_secs(1)).unwrap()();
        assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 1);
    }

    #[test]
    fn supervisor_times_out_while_capture_worker_is_still_blocked() {
        let startup = Arc::new(Startup::default());
        let (release, blocked) = mpsc::channel();
        let (done, finished) = mpsc::channel();
        let stored = Arc::new(Mutex::new(false));
        let worker_stored = stored.clone();
        let result = supervise(
            startup.clone(),
            Instant::now() + Duration::from_millis(30),
            move |run| {
                blocked.recv().unwrap();
                if !run.is_cancelled() {
                    *worker_stored.lock().unwrap() = true;
                }
                done.send(()).unwrap();
                Ok(())
            },
        );
        assert_eq!(result, Err(StartFailure::TimedOut));
        assert!(
            finished.try_recv().is_err(),
            "supervisor must not join blocked worker"
        );
        release.send(()).unwrap();
        finished.recv_timeout(Duration::from_secs(1)).unwrap();
        assert!(
            !*stored.lock().unwrap(),
            "late captured pixels must be discarded"
        );
    }

    #[test]
    fn worker_error_wakes_the_supervisor_before_the_deadline() {
        let result = supervise(
            Arc::new(Startup::default()),
            Instant::now() + Duration::from_secs(5),
            |_| Err(StartFailure::Capture(CaptureBackendError::AccessDenied)),
        );
        assert_eq!(
            result,
            Err(StartFailure::Capture(CaptureBackendError::AccessDenied))
        );
    }

    #[test]
    fn worker_panic_is_reported_instead_of_stranding_startup() {
        let result = supervise(
            Arc::new(Startup::default()),
            Instant::now() + Duration::from_secs(5),
            |_| panic!("injected capture failure"),
        );
        assert!(matches!(result, Err(StartFailure::Window(_))));
    }
}
