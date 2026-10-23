//! The quick-create window: a borderless, always-on-top surface hanging below
//! the Bar that hosts the app's own create dialogs, so an event, a matrix task
//! or a note can be added without bringing up the main window.
//!
//! The window is created on first use and hidden, not destroyed, on close. Every
//! open issues a new request; the frontend answers with the dialog it renders
//! and that dialog's height, and the first answer to a request reveals it.

use crate::error::CommandError;
use crate::quick_panel::BarAnchor;
use std::sync::Mutex;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Runtime, WebviewUrl,
    WebviewWindowBuilder,
};

pub const LABEL: &str = "quick-create";
pub const OPEN_EVENT: &str = "quick-create-open";
pub const CLOSE_REQUESTED_EVENT: &str = "quick-create-close-requested";

/// Space below the Bar, and the inset from the sides of the work area.
const GAP: f64 = 8.0;
const BOTTOM_MARGIN: f64 = 16.0;
/// A short screen still gets room for a dialog header, a field and a footer.
const MIN_MAX_HEIGHT: f64 = 240.0;
const MIN_HEIGHT: f64 = 120.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum QuickCreateKind {
    Event,
    Task,
    Note,
}

impl QuickCreateKind {
    /// Logical width of each dialog, the same as inside the app.
    pub fn width(self) -> f64 {
        match self {
            Self::Event => 720.0,
            Self::Task => 680.0,
            Self::Note => 760.0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickCreateRequest {
    pub id: u64,
    pub kind: QuickCreateKind,
    /// Logical height the dialog may grow to before its body scrolls.
    pub max_height: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Bounds {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct LayoutStep {
    bounds: Bounds,
    reveal: bool,
}

#[derive(Debug, Clone, Copy)]
struct Pending {
    request: QuickCreateRequest,
    anchor: BarAnchor,
    shown: bool,
}

#[derive(Debug, Default)]
struct Requests {
    next_id: u64,
    pending: Option<Pending>,
}

impl Requests {
    fn begin(&mut self, kind: QuickCreateKind, anchor: BarAnchor) -> QuickCreateRequest {
        self.next_id += 1;
        let request = QuickCreateRequest {
            id: self.next_id,
            kind,
            max_height: max_height(&anchor),
        };
        self.pending = Some(Pending {
            request,
            anchor,
            shown: false,
        });
        request
    }

    fn current(&self) -> Option<QuickCreateRequest> {
        self.pending.map(|pending| pending.request)
    }

    /// `kind` is what the frontend shows, which can still be the previous
    /// dialog while the user decides whether to discard its draft.
    fn layout(
        &mut self,
        id: u64,
        kind: QuickCreateKind,
        height: f64,
        can_reveal: bool,
    ) -> Option<LayoutStep> {
        let pending = self
            .pending
            .as_mut()
            .filter(|pending| pending.request.id == id)?;
        if !height.is_finite() || height <= 0.0 {
            return None;
        }
        let height = clamp_height(height, pending.request.max_height);
        let reveal = can_reveal && !pending.shown;
        pending.shown |= reveal;
        Some(LayoutStep {
            bounds: bounds(&pending.anchor, kind.width(), height),
            reveal,
        })
    }

    fn close(&mut self, id: u64) -> bool {
        if self.current().is_some_and(|request| request.id == id) {
            self.pending = None;
            return true;
        }
        false
    }
}

#[derive(Default)]
pub struct QuickCreateState {
    requests: Mutex<Requests>,
    /// Window placement happens outside the request lock; this keeps layout
    /// passes from landing out of order.
    placing: Mutex<()>,
}

fn physical(logical: f64, scale: f64) -> i32 {
    (logical * scale).round() as i32
}

fn top(anchor: &BarAnchor) -> i32 {
    anchor.bottom_y.max(anchor.work_top) + physical(GAP, anchor.scale)
}

fn max_height(anchor: &BarAnchor) -> f64 {
    let available = f64::from(anchor.work_bottom - top(anchor)) / anchor.scale - BOTTOM_MARGIN;
    available.max(MIN_MAX_HEIGHT)
}

fn clamp_height(height: f64, max_height: f64) -> f64 {
    height.clamp(MIN_HEIGHT.min(max_height), max_height)
}

/// Centred on the Bar and kept inside the work area; a work area narrower
/// than the dialog narrows the window rather than pushing it off screen.
fn bounds(anchor: &BarAnchor, width: f64, height: f64) -> Bounds {
    let inset = physical(GAP, anchor.scale);
    let left = anchor.work_left + inset;
    let room = (anchor.work_right - inset - left).max(1);
    let width = physical(width, anchor.scale).clamp(1, room);
    Bounds {
        x: (anchor.center_x - width / 2).clamp(left, left + room - width),
        y: top(anchor),
        width: width as u32,
        height: physical(height, anchor.scale).max(1) as u32,
    }
}

fn apply_bounds<R: Runtime>(window: &tauri::WebviewWindow<R>, bounds: Bounds) -> tauri::Result<()> {
    let position = PhysicalPosition::new(bounds.x, bounds.y);
    let size = PhysicalSize::new(bounds.width, bounds.height);
    // Moving onto a monitor with another DPI makes the system rescale the
    // window, so the size goes on after the move and both are checked again.
    for _ in 0..2 {
        if window.outer_position()? != position {
            window.set_position(position)?;
        }
        if window.inner_size()? != size {
            window.set_size(size)?;
        }
    }
    Ok(())
}

fn ensure_window<R: Runtime>(app: &AppHandle<R>) -> Result<tauri::WebviewWindow<R>, String> {
    if let Some(window) = app.get_webview_window(LABEL) {
        return Ok(window);
    }
    let window = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html".into()))
        .title("Nowly")
        .decorations(false)
        .shadow(false)
        .transparent(true)
        .background_color(tauri::utils::config::Color(0, 0, 0, 0))
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .minimizable(false)
        .maximizable(false)
        .disable_drag_drop_handler()
        .focused(false)
        .visible(false)
        .build()
        .map_err(|error| error.to_string())?;
    // The same chrome fixes as the Bar: no caption flashing on show/hide and
    // no opaque erase behind the transparent WebView.
    let configured = crate::quick_panel::normalize_handle_window_style(&window)
        .and_then(|()| crate::quick_panel::configure_transparent_webview(&window));
    if let Err(error) = configured {
        let _ = window.destroy();
        return Err(error);
    }
    Ok(window)
}

fn can_open(label: &str) -> bool {
    matches!(label, "main" | "quick-panel-handle")
}

fn ensure_own(label: &str) -> Result<(), CommandError> {
    if label == LABEL {
        Ok(())
    } else {
        Err(CommandError::reported("Only the quick-create window can do this."))
    }
}

/// Shared by the Bar menu and the global shortcuts.
pub fn open<R: Runtime>(app: &AppHandle<R>, kind: QuickCreateKind) -> Result<(), CommandError> {
    if crate::screenshot_windows::capture_in_progress(app) {
        return Ok(());
    }
    let panel = app.state::<crate::quick_panel::PanelController>();
    if panel.details_source() == Some(crate::quick_panel::PanelSource::Menu) {
        crate::quick_panel::close_details_for_navigation(app).map_err(CommandError::system)?;
    }
    let anchor = crate::quick_panel::bar_anchor(app).map_err(CommandError::system)?;
    let state = app.state::<QuickCreateState>();
    let _placing = state.placing.lock().unwrap();
    let window = ensure_window(app).map_err(CommandError::system)?;
    let request = state.requests.lock().unwrap().begin(kind, anchor);
    if !window.is_visible().unwrap_or(false) {
        // Lay the hidden window out where it will appear, so the dialog is
        // measured at its final width and DPI before it is revealed.
        apply_bounds(&window, bounds(&anchor, kind.width(), request.max_height))
            .map_err(CommandError::system)?;
    }
    // A window created just now is not listening yet; it pulls the request.
    window
        .emit_to(LABEL, OPEN_EVENT, request)
        .map_err(CommandError::system)
}

#[tauri::command(async)]
pub fn open_quick_create(
    app: AppHandle,
    window: tauri::Window,
    kind: QuickCreateKind,
) -> Result<(), CommandError> {
    if !can_open(window.label()) {
        return Err(CommandError::reported("This window cannot open quick create."));
    }
    open(&app, kind)
}

#[tauri::command(async)]
pub fn get_quick_create_request(
    app: AppHandle,
    window: tauri::Window,
) -> Result<Option<QuickCreateRequest>, CommandError> {
    ensure_own(window.label())?;
    Ok(app.state::<QuickCreateState>().requests.lock().unwrap().current())
}

#[tauri::command(async)]
pub fn quick_create_layout(
    app: AppHandle,
    window: tauri::WebviewWindow,
    request_id: u64,
    kind: QuickCreateKind,
    height: f64,
) -> Result<(), CommandError> {
    ensure_own(window.label())?;
    let state = app.state::<QuickCreateState>();
    let _placing = state.placing.lock().unwrap();
    let can_reveal = !crate::screenshot_windows::capture_in_progress(&app);
    let step = state
        .requests
        .lock()
        .unwrap()
        .layout(request_id, kind, height, can_reveal);
    let Some(step) = step else {
        return Ok(());
    };
    apply_bounds(&window, step.bounds).map_err(CommandError::system)?;
    if step.reveal {
        window.show().map_err(CommandError::system)?;
        window.set_focus().map_err(CommandError::system)?;
    }
    Ok(())
}

#[tauri::command(async)]
pub fn close_quick_create(
    app: AppHandle,
    window: tauri::WebviewWindow,
    request_id: u64,
) -> Result<(), CommandError> {
    ensure_own(window.label())?;
    let state = app.state::<QuickCreateState>();
    let _placing = state.placing.lock().unwrap();
    // A newer request may already be on its way to the frontend; it wins.
    if state.requests.lock().unwrap().close(request_id) {
        window.hide().map_err(CommandError::system)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A 1920×1080 monitor at the origin with a bottom taskbar and a centred Bar.
    fn anchor(scale: f64) -> BarAnchor {
        BarAnchor {
            scale,
            center_x: 960,
            bottom_y: physical(56.0, scale),
            work_left: 0,
            work_top: 0,
            work_right: 1920,
            work_bottom: 1032,
        }
    }

    #[test]
    fn each_kind_keeps_its_in_app_dialog_width() {
        assert_eq!(QuickCreateKind::Event.width(), 720.0);
        assert_eq!(QuickCreateKind::Task.width(), 680.0);
        assert_eq!(QuickCreateKind::Note.width(), 760.0);
        assert_eq!(serde_json::to_value(QuickCreateKind::Note).unwrap(), "note");
        assert_eq!(
            serde_json::from_value::<QuickCreateKind>("task".into()).unwrap(),
            QuickCreateKind::Task
        );
        assert!(serde_json::from_value::<QuickCreateKind>("screenshot".into()).is_err());
    }

    #[test]
    fn hangs_eight_pixels_below_the_bar_and_centred_on_it() {
        assert_eq!(
            bounds(&anchor(1.0), 720.0, 500.0),
            Bounds { x: 600, y: 64, width: 720, height: 500 }
        );
        assert_eq!(
            bounds(&anchor(1.5), 720.0, 500.0),
            Bounds { x: 420, y: 96, width: 1080, height: 750 }
        );
    }

    #[test]
    fn stays_inside_the_work_area_when_the_bar_is_parked_at_an_edge() {
        let left = BarAnchor { center_x: 216, ..anchor(1.0) };
        assert_eq!(bounds(&left, 760.0, 400.0).x, 8);
        let right = BarAnchor { center_x: 1920 - 216, ..anchor(1.0) };
        assert_eq!(bounds(&right, 760.0, 400.0).x, 1920 - 8 - 760);
        // Monitors left of the primary have negative origins.
        let negative = BarAnchor {
            center_x: -1704,
            work_left: -1920,
            work_right: 0,
            ..anchor(1.0)
        };
        assert_eq!(bounds(&negative, 720.0, 400.0).x, -1912);
    }

    #[test]
    fn a_top_taskbar_pushes_the_window_below_the_work_area_top() {
        let top_taskbar = BarAnchor { work_top: 72, ..anchor(1.0) };
        assert_eq!(bounds(&top_taskbar, 680.0, 400.0).y, 80);
    }

    #[test]
    fn a_narrow_work_area_narrows_the_window_instead_of_overflowing() {
        let narrow = BarAnchor { center_x: 320, work_right: 640, ..anchor(1.0) };
        let placed = bounds(&narrow, 760.0, 400.0);
        assert_eq!((placed.x, placed.width), (8, 624));
    }

    #[test]
    fn height_follows_the_dialog_up_to_the_bottom_of_the_work_area() {
        assert_eq!(max_height(&anchor(1.0)), 1032.0 - 64.0 - 16.0);
        assert_eq!(max_height(&anchor(1.5)), (1032.0 - 96.0) / 1.5 - 16.0);
        assert_eq!(clamp_height(500.0, 952.0), 500.0);
        assert_eq!(clamp_height(5000.0, 952.0), 952.0);
        assert_eq!(clamp_height(10.0, 952.0), MIN_HEIGHT);
        let short = BarAnchor { work_bottom: 200, ..anchor(1.0) };
        assert_eq!(max_height(&short), MIN_MAX_HEIGHT);
    }

    #[test]
    fn only_the_newest_request_lays_out_and_only_its_first_pass_reveals() {
        let mut requests = Requests::default();
        let first = requests.begin(QuickCreateKind::Event, anchor(1.0));
        let second = requests.begin(QuickCreateKind::Note, anchor(1.0));
        assert!(second.id > first.id);
        assert_eq!(requests.current(), Some(second));
        assert_eq!(requests.layout(first.id, QuickCreateKind::Event, 400.0, true), None);
        let shown = requests.layout(second.id, QuickCreateKind::Note, 400.0, true).unwrap();
        assert!(shown.reveal);
        assert_eq!((shown.bounds.width, shown.bounds.height), (760, 400));
        let resized = requests.layout(second.id, QuickCreateKind::Note, 420.0, true).unwrap();
        assert!(!resized.reveal);
        assert_eq!(resized.bounds.height, 420);
    }

    #[test]
    fn the_window_keeps_the_width_of_the_dialog_still_on_screen() {
        // An event draft stays up while the user decides whether to discard it for a note.
        let mut requests = Requests::default();
        let request = requests.begin(QuickCreateKind::Note, anchor(1.0));
        let step = requests.layout(request.id, QuickCreateKind::Event, 400.0, true).unwrap();
        assert_eq!(step.bounds.width, 720);
    }

    #[test]
    fn invalid_heights_and_blocked_reveals_are_not_applied() {
        let mut requests = Requests::default();
        let request = requests.begin(QuickCreateKind::Task, anchor(1.0));
        assert_eq!(requests.layout(request.id, QuickCreateKind::Task, f64::NAN, true), None);
        assert_eq!(requests.layout(request.id, QuickCreateKind::Task, 0.0, true), None);
        assert!(!requests.layout(request.id, QuickCreateKind::Task, 400.0, false).unwrap().reveal);
        assert!(requests.layout(request.id, QuickCreateKind::Task, 400.0, true).unwrap().reveal);
    }

    #[test]
    fn closing_clears_only_the_current_request() {
        let mut requests = Requests::default();
        let old = requests.begin(QuickCreateKind::Event, anchor(1.0));
        let current = requests.begin(QuickCreateKind::Event, anchor(1.0));
        assert!(!requests.close(old.id));
        assert_eq!(requests.current(), Some(current));
        assert!(requests.close(current.id));
        assert_eq!(requests.current(), None);
        assert_eq!(requests.layout(current.id, QuickCreateKind::Event, 400.0, true), None);
    }

    #[test]
    fn requests_reach_the_frontend_in_camel_case() {
        let mut requests = Requests::default();
        let request = requests.begin(QuickCreateKind::Task, anchor(1.0));
        assert_eq!(
            serde_json::to_value(request).unwrap(),
            serde_json::json!({ "id": 1, "kind": "task", "maxHeight": 952.0 })
        );
    }

    #[test]
    fn only_app_surfaces_open_it_and_only_the_window_itself_lays_out() {
        assert!(can_open("main"));
        assert!(can_open("quick-panel-handle"));
        for label in [LABEL, "screenshot-history", "screenshot-pin-1", "screenshot-overlay-1-0"] {
            assert!(!can_open(label));
        }
        assert!(ensure_own(LABEL).is_ok());
        assert!(ensure_own("main").is_err());
    }

    #[test]
    fn commands_stay_off_the_ui_thread() {
        // Building or placing a window from a synchronous command deadlocks on Windows.
        let source = include_str!("quick_create.rs").split("#[cfg(test)]").next().unwrap();
        for command in [
            "open_quick_create",
            "get_quick_create_request",
            "quick_create_layout",
            "close_quick_create",
        ] {
            let start = source.find(&format!("pub fn {command}(")).unwrap();
            assert!(
                source[..start].trim_end().ends_with("#[tauri::command(async)]"),
                "{command} must be an async command"
            );
        }
    }
}
