use rusqlite::OptionalExtension;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Runtime};

// This module owns the screen-level top surfaces only. The AI quick panel, its
// `Ctrl+Space` shortcut and the AI mutual-exclusion logic are removed in this
// version; `quick-panel-handle` survives purely as a compatibility window label
// for the Home Indicator / status island.

#[derive(Debug, Clone, Copy)]
struct WorkArea {
    x: i32,
    y: i32,
    width: u32,
}

/// The screen geometry a drag is resolved against, read once when the drag
/// starts. The move path runs on the main thread at pointer-report rate, so it
/// may not re-enumerate monitors: doing that per move is what stalled the event
/// loop long enough for Windows to call the app unresponsive.
#[derive(Debug, Clone, Copy)]
struct DragAnchor {
    work_area: WorkArea,
    scale: f64,
    width: u32,
    /// The rail never leaves the top edge, so y is fixed for the whole drag.
    y: i32,
}

const TOP_MARGIN: f64 = 8.0;
/// Visible surfaces keep their own widths, but the native host always reserves
/// the AI width. Both panels change height only: no horizontal WebView resize
/// or native recentering is allowed at the end of a morph.
const RAIL_WIDTH: f64 = 288.0;
const RAIL_HEIGHT: f64 = 40.0;
const STATUS_HEIGHT: f64 = 288.0;
const ASSISTANT_WIDTH: f64 = 408.0;
const ASSISTANT_HEIGHT: f64 = 440.0;
const RAIL_RADIUS: f64 = 20.0;
const PANEL_RADIUS: f64 = 15.2;
/// A quick pass over the island must not open anything. Only a sustained hover
/// does, and the delay is coordinated natively so it survives the pointer
/// crossing the transparent gap inside the window.
const HOVER_OPEN_DELAY: Duration = Duration::from_millis(300);
/// The window may only shrink back once the sheet has finished collapsing inside
/// the WebView, or the last frames get clipped by the window edge. design.md §10
/// puts both independent morphs at 220ms; add 40ms for a late frame.
const COLLAPSE_ANIMATION: Duration = Duration::from_millis(260);
/// Where the user parked the top surface, as a logical-pixel offset from the
/// work area's horizontal centre. Stored rather than an absolute x so the same
/// value keeps meaning the same place across monitors, resolutions and DPI.
const OFFSET_SETTING_KEY: &str = "status_island_offset_x";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HandlePositions {
    pub visible_y: i32,
    pub hidden_y: i32,
}

/// Which half of the rail owns the single open sheet.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PanelSource {
    /// The status island capsule: today's reminders and summary.
    Island,
    /// The Nowly logo entry and AI assistant.
    Nowly,
}

/// Every details show/hide carries the generation it was requested with, so a
/// late callback can never restore a surface that has since been hidden.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DetailsTransition {
    pub generation: u64,
    pub source: Option<PanelSource>,
}

#[derive(Clone, serde::Serialize)]
struct DetailsOpen {
    generation: u64,
    source: PanelSource,
    /// Which reminder the island sheet is pinned to. `None` for a summary.
    identity: Option<String>,
    hovered: bool,
}

#[derive(Clone, Copy, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DetailsClose {
    generation: u64,
    hide_after_collapse: bool,
    collapse_to_summary: bool,
}

#[derive(Clone, Copy, serde::Serialize)]
struct DetailsClosed {
    generation: u64,
}

pub fn screen_top(monitor_y: i32, _work_area_y: i32) -> i32 {
    monitor_y
}

/// Stable native viewport width for every source, including the compact rail.
pub fn top_surface_size(source: Option<PanelSource>, scale_factor: f64) -> (u32, u32) {
    let height = match source {
        Some(PanelSource::Island) => STATUS_HEIGHT,
        Some(PanelSource::Nowly) => ASSISTANT_HEIGHT,
        None => RAIL_HEIGHT,
    };
    (
        (ASSISTANT_WIDTH * scale_factor).round() as u32,
        (height * scale_factor).round() as u32,
    )
}

fn physical_pixels(logical: f64, scale: f64) -> i32 {
    (logical * scale).round() as i32
}

/// Rounded region in native client pixels. The extra side gutters of the
/// compact rail and status panel must not intercept clicks intended for other
/// applications.
fn surface_region(source: Option<PanelSource>, scale: f64) -> SurfaceRegion {
    let (host_width, height) = top_surface_size(source, scale);
    let width = if source == Some(PanelSource::Nowly) {
        host_width
    } else {
        physical_pixels(RAIL_WIDTH, scale) as u32
    };
    let left = ((host_width - width) / 2) as i32;
    SurfaceRegion {
        left,
        top: 0,
        right: left + width as i32,
        bottom: height as i32,
        radius: physical_pixels(
            if source.is_none() {
                RAIL_RADIUS
            } else {
                PANEL_RADIUS
            },
            scale,
        ),
    }
}

fn surface_client_bounds(source: Option<PanelSource>, scale: f64) -> SurfaceBounds {
    surface_region(source, scale).bounds()
}

/// Negative origins on a left-of-primary monitor must survive, so this stays
/// signed arithmetic rather than unsigned centering.
pub fn centered_x(work_area_x: i32, work_area_width: u32, width: u32) -> i32 {
    work_area_x + (work_area_width.saturating_sub(width) / 2) as i32
}

/// Where the top surface sits: centred, shifted by the user's saved offset, then
/// clamped so the whole surface stays inside the work area. The clamp is what
/// keeps the drag on the top edge only — the surface can be parked anywhere
/// between the left and right edges and nowhere else.
///
/// `offset` is physical pixels here; the stored value is logical, so callers
/// scale it first.
pub fn surface_x(work_area_x: i32, work_area_width: u32, width: u32, offset: f64) -> i32 {
    let span = work_area_width.saturating_sub(width) as i32;
    let desired = centered_x(work_area_x, work_area_width, width) + offset.round() as i32;
    desired.clamp(work_area_x, work_area_x + span)
}

pub fn handle_positions(
    monitor_y: i32,
    handle_height: u32,
    visible_offset: i32,
) -> HandlePositions {
    HandlePositions {
        visible_y: monitor_y + visible_offset,
        hidden_y: monitor_y - handle_height as i32,
    }
}

/// Falls back to the primary monitor atomically when the saved target is gone,
/// without overwriting the saved id: unplugging a monitor must not silently
/// rewrite the user's choice, and re-plugging must not migrate back on its own.
pub fn resolve_target_monitor(
    saved: Option<&str>,
    active: Option<&str>,
    ids: &[String],
    primary: Option<usize>,
) -> Option<usize> {
    active
        .and_then(|id| ids.iter().position(|candidate| candidate == id))
        .or_else(|| saved.and_then(|id| ids.iter().position(|candidate| candidate == id)))
        .or(primary)
        .or(if ids.is_empty() { None } else { Some(0) })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SurfaceBounds {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct SurfaceRegion {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
    radius: i32,
}

impl SurfaceRegion {
    fn bounds(self) -> SurfaceBounds {
        SurfaceBounds {
            left: self.left,
            top: self.top,
            right: self.right,
            bottom: self.bottom,
        }
    }
}

/// `CreateRoundRectRgn` is a binary clip with no antialiasing. Clipping it to
/// the exact CSS radius cuts through WebView2's partially covered corner pixels
/// and leaves a jagged fringe. Keep the same bounds but make the native clip one
/// physical pixel fuller, so CSS owns the visible antialiased edge.
fn native_clip_region(region: SurfaceRegion) -> SurfaceRegion {
    SurfaceRegion {
        radius: region.radius.saturating_sub(1),
        ..region
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OutsideClickAction {
    Collapse,
    CollapseThenHide,
}

/// Once a detail has been viewed, collapsing it must leave the aggregate
/// summary visible. Otherwise the live queue head can replace the item the
/// user just inspected (for example, an urgent quadrant task replacing an
/// all-day calendar event).
pub fn collapse_to_summary_after_view() -> bool {
    true
}

pub fn point_is_inside_surface(x: i32, y: i32, bounds: SurfaceBounds) -> bool {
    x >= bounds.left && x < bounds.right && y >= bounds.top && y < bounds.bottom
}

fn point_is_inside_rounded_surface(x: i32, y: i32, region: SurfaceRegion) -> bool {
    if !point_is_inside_surface(x, y, region.bounds()) {
        return false;
    }

    let width = region.right - region.left;
    let height = region.bottom - region.top;
    let radius = region.radius.min(width / 2).min(height / 2).max(0);
    if radius == 0 {
        return true;
    }

    let local_x = x - region.left;
    let local_y = y - region.top;
    if (local_x >= radius && local_x < width - radius)
        || (local_y >= radius && local_y < height - radius)
    {
        return true;
    }

    // Test pixel centres against the same quarter-circle geometry used by the
    // native rounded HRGN. This keeps the low-level outside-click hook aligned
    // with the visible/click-through Windows surface at the four corners.
    let center_x = if local_x < radius {
        radius as f64
    } else {
        (width - radius) as f64
    };
    let center_y = if local_y < radius {
        radius as f64
    } else {
        (height - radius) as f64
    };
    let dx = local_x as f64 + 0.5 - center_x;
    let dy = local_y as f64 + 0.5 - center_y;
    dx * dx + dy * dy <= f64::from(radius * radius)
}

pub fn outside_click_action(notification_mode: &str) -> OutsideClickAction {
    if notification_mode == "notification" {
        OutsideClickAction::CollapseThenHide
    } else {
        OutsideClickAction::Collapse
    }
}

pub fn outside_click_closes_source(source: Option<PanelSource>) -> bool {
    source == Some(PanelSource::Island)
}

#[derive(Debug)]
pub struct PanelController {
    state: Mutex<PanelState>,
    positioning: Mutex<()>,
    visibility: Mutex<()>,
}

#[derive(Debug)]
struct PanelState {
    enabled: bool,
    target_monitor_id: Option<String>,
    active_monitor_id: Option<String>,
    /// Which half of the rail the open sheet belongs to. `None` is collapsed.
    details_source: Option<PanelSource>,
    hover_source: Option<PanelSource>,
    details_generation: u64,
    visibility_generation: u64,
    /// Logical pixels from the work area's horizontal centre.
    offset_x: f64,
    /// `Some` *is* "a drag is in progress".
    drag: Option<Drag>,
}

#[derive(Debug, Clone, Copy)]
struct Drag {
    /// The offset the drag started from. Every move reports its total delta from
    /// that start, so the surface stays glued to the pointer instead of
    /// accumulating rounding.
    origin: f64,
    anchor: DragAnchor,
}

impl PanelState {
    /// A drag in progress refuses to open the sheet: the sheet *is* the rail
    /// grown, and growing it mid-drag would resize the window under the pointer.
    fn allows_details(&self) -> bool {
        self.enabled && self.drag.is_none()
    }
}

impl Default for PanelController {
    fn default() -> Self {
        Self {
            state: Mutex::new(PanelState {
                enabled: true,
                target_monitor_id: None,
                active_monitor_id: None,
                details_source: None,
                hover_source: None,
                details_generation: 0,
                visibility_generation: 0,
                offset_x: 0.0,
                drag: None,
            }),
            positioning: Mutex::new(()),
            visibility: Mutex::new(()),
        }
    }
}

impl PanelController {
    pub fn is_enabled(&self) -> bool {
        self.state.lock().unwrap().enabled
    }

    pub fn target_monitor_id(&self) -> Option<String> {
        self.state.lock().unwrap().target_monitor_id.clone()
    }

    pub fn set_target_monitor_id(&self, target_monitor_id: Option<String>) {
        let mut state = self.state.lock().unwrap();
        state.target_monitor_id = target_monitor_id.clone();
        state.active_monitor_id = target_monitor_id;
    }

    pub fn active_monitor_id(&self) -> Option<String> {
        self.state.lock().unwrap().active_monitor_id.clone()
    }

    pub fn set_active_monitor_id(&self, active_monitor_id: Option<String>) {
        self.state.lock().unwrap().active_monitor_id = active_monitor_id;
    }

    pub fn offset_x(&self) -> f64 {
        self.state.lock().unwrap().offset_x
    }

    pub fn set_offset_x(&self, offset_x: f64) {
        if !offset_x.is_finite() {
            return;
        }
        self.state.lock().unwrap().offset_x = offset_x;
    }

    /// Starts a drag from the current offset, pinned to the geometry the caller
    /// already resolved.
    fn begin_drag(&self, anchor: DragAnchor) -> bool {
        let _positioning = self.positioning.lock().unwrap();
        let mut state = self.state.lock().unwrap();
        if !state.enabled {
            return false;
        }
        state.drag = Some(Drag {
            origin: state.offset_x,
            anchor,
        });
        // The sheet is the rail grown, so moving the rail tears it down.
        state.details_generation += 1;
        state.details_source = None;
        state.hover_source = None;
        true
    }

    /// Reports the pointer's total travel since the drag began and returns where
    /// the surface should now sit. `None` when no drag is in progress, so a
    /// stray move cannot walk the surface.
    fn drag_to(&self, delta_x: f64) -> Option<PhysicalPosition<i32>> {
        if !delta_x.is_finite() {
            return None;
        }
        let mut state = self.state.lock().unwrap();
        let drag = state.drag?;
        state.offset_x = drag.origin + delta_x;
        let anchor = drag.anchor;
        Some(PhysicalPosition::new(
            surface_x(
                anchor.work_area.x,
                anchor.work_area.width,
                anchor.width,
                state.offset_x * anchor.scale,
            ),
            anchor.y,
        ))
    }

    fn end_drag(&self) -> bool {
        self.state.lock().unwrap().drag.take().is_some()
    }

    /// The background monitor watch must not fight the pointer for the window.
    fn is_dragging(&self) -> bool {
        self.state.lock().unwrap().drag.is_some()
    }

    pub fn are_details_open(&self) -> bool {
        self.state.lock().unwrap().details_source.is_some()
    }

    pub fn details_source(&self) -> Option<PanelSource> {
        self.state.lock().unwrap().details_source
    }

    /// Clicking either half toggles the sheet. Clicking the *other* half while
    /// the sheet is open swaps its content rather than closing it: there is only
    /// one sheet, so the two sources cannot both be open.
    pub fn toggle_details(&self, source: PanelSource) -> DetailsTransition {
        let _positioning = self.positioning.lock().unwrap();
        let mut state = self.state.lock().unwrap();
        state.details_generation += 1;
        state.hover_source = None;
        state.details_source = if state.allows_details() && state.details_source != Some(source) {
            Some(source)
        } else {
            None
        };
        DetailsTransition {
            generation: state.details_generation,
            source: state.details_source,
        }
    }

    /// Reserves a hover-open without opening yet, so the 300ms wait can be
    /// abandoned if anything else happens first.
    pub fn reserve_hover_open(&self, source: PanelSource) -> Option<u64> {
        let _positioning = self.positioning.lock().unwrap();
        let mut state = self.state.lock().unwrap();
        if !state.allows_details() || state.details_source.is_some() {
            return None;
        }
        state.details_generation += 1;
        state.hover_source = Some(source);
        Some(state.details_generation)
    }

    pub fn complete_hover_open(&self, generation: u64) -> bool {
        let _positioning = self.positioning.lock().unwrap();
        let mut state = self.state.lock().unwrap();
        if state.details_generation != generation
            || !state.allows_details()
            || state.details_source.is_some()
        {
            return false;
        }
        state.details_source = state.hover_source.take();
        true
    }

    pub fn close_details(&self) -> DetailsTransition {
        let _positioning = self.positioning.lock().unwrap();
        let mut state = self.state.lock().unwrap();
        state.details_generation += 1;
        state.details_source = None;
        state.hover_source = None;
        DetailsTransition {
            generation: state.details_generation,
            source: None,
        }
    }

    pub fn is_details_current(&self, generation: u64) -> bool {
        self.state.lock().unwrap().details_generation == generation
    }

    pub fn visibility_generation(&self) -> u64 {
        self.state.lock().unwrap().visibility_generation
    }

    pub fn mark_visible(&self) {
        self.state.lock().unwrap().visibility_generation += 1;
    }

    pub fn show_serialized<T>(&self, show: impl FnOnce() -> T) -> T {
        let _visibility = self.visibility.lock().unwrap();
        self.mark_visible();
        show()
    }

    pub fn hide_serialized<T>(&self, hide: impl FnOnce() -> T) -> T {
        let _visibility = self.visibility.lock().unwrap();
        hide()
    }

    pub fn hide_if_visibility_current<T>(
        &self,
        generation: u64,
        hide: impl FnOnce() -> T,
    ) -> Option<T> {
        let _visibility = self.visibility.lock().unwrap();
        if !self.is_visibility_current(generation) {
            return None;
        }
        Some(hide())
    }

    pub fn hide_if_current<T>(
        &self,
        details_generation: u64,
        visibility_generation: u64,
        hide: impl FnOnce() -> T,
    ) -> Option<T> {
        let _positioning = self.positioning.lock().unwrap();
        let _visibility = self.visibility.lock().unwrap();
        let state = self.state.lock().unwrap();
        if state.details_generation != details_generation
            || state.visibility_generation != visibility_generation
        {
            return None;
        }
        drop(state);
        Some(hide())
    }

    pub fn is_visibility_current(&self, generation: u64) -> bool {
        self.state.lock().unwrap().visibility_generation == generation
    }

    pub fn set_enabled(&self, enabled: bool) {
        let mut state = self.state.lock().unwrap();
        state.enabled = enabled;
        state.details_generation += 1;
        state.hover_source = None;
        if !enabled {
            state.details_source = None;
        }
    }
}

pub fn initialize<R: Runtime>(app: &AppHandle<R>, notification_mode: &str) -> Result<(), String> {
    let handle = app
        .get_webview_window("quick-panel-handle")
        .ok_or_else(|| "quick-panel-handle window not found".to_owned())?;
    let initialized = (|| {
        normalize_handle_window_style(&handle)
            .map_err(|error| format!("failed to normalize popup window style: {error}"))?;
        configure_transparent_webview(&handle)
            .map_err(|error| format!("failed to configure transparent WebView: {error}"))?;
        reposition_handle(app)
            .map_err(|error| format!("failed to position native Bar surface: {error}"))?;
        if starts_visible(notification_mode) {
            handle.show()
        } else {
            handle.hide()
        }
        .map_err(|error| error.to_string())
    })();
    if let Err(error) = initialized {
        if let Err(hide_error) = handle.hide() {
            return Err(format!(
                "{error}; additionally failed to hide quick-panel-handle: {hide_error}"
            ));
        }
        return Err(error);
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn transparent_webview_background(
) -> webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_COLOR {
    webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_COLOR {
        R: 0,
        G: 0,
        B: 0,
        A: 0,
    }
}

#[cfg(target_os = "windows")]
fn configure_transparent_webview<R: Runtime>(
    handle: &tauri::WebviewWindow<R>,
) -> Result<(), String> {
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Controller2;
    use windows::core::Interface;

    let result = std::sync::Arc::new(Mutex::new(Ok(())));
    let callback_result = result.clone();
    handle
        .with_webview(move |webview| unsafe {
            let controller = webview.controller();
            let configured = controller
                .cast::<ICoreWebView2Controller2>()
                .map_err(|error| {
                    format!("failed to access the status rail WebView2 controller: {error}")
                })
                .and_then(|controller| {
                    controller
                        .SetDefaultBackgroundColor(transparent_webview_background())
                        .map_err(|error| {
                            format!(
                                "failed to make the status rail WebView background transparent: {error}"
                            )
                        })
                });
            *callback_result.lock().unwrap() = configured;
        })
        .map_err(|error| error.to_string())?;
    let configured = result.lock().unwrap().clone();
    configured
}

#[cfg(not(target_os = "windows"))]
fn configure_transparent_webview<R: Runtime>(
    _handle: &tauri::WebviewWindow<R>,
) -> Result<(), String> {
    Ok(())
}

fn starts_visible(notification_mode: &str) -> bool {
    notification_mode == "persistent"
}

fn target_monitor<R: Runtime>(window: &tauri::WebviewWindow<R>) -> Result<tauri::Monitor, String> {
    let monitors = window
        .available_monitors()
        .map_err(|error| error.to_string())?;
    let primary = window
        .primary_monitor()
        .map_err(|error| error.to_string())?;
    let saved = window
        .app_handle()
        .state::<PanelController>()
        .target_monitor_id();
    let active = window
        .app_handle()
        .state::<PanelController>()
        .active_monitor_id();
    let ids: Vec<String> = monitors
        .iter()
        .map(|monitor| {
            let position = monitor.position();
            crate::monitors::monitor_id(monitor.name().map(String::as_str), position.x, position.y)
        })
        .collect();
    let primary_index = primary.as_ref().and_then(|primary| {
        let position = primary.position();
        let id =
            crate::monitors::monitor_id(primary.name().map(String::as_str), position.x, position.y);
        ids.iter().position(|candidate| *candidate == id)
    });
    let resolved = resolve_target_monitor(saved.as_deref(), active.as_deref(), &ids, primary_index);
    if let Some(index) = resolved {
        window
            .app_handle()
            .state::<PanelController>()
            .set_active_monitor_id(ids.get(index).cloned());
    }
    resolved
        .and_then(|index| monitors.get(index).cloned())
        .or_else(|| primary.clone())
        .ok_or_else(|| "no monitor available".to_owned())
}

#[cfg(target_os = "windows")]
fn monitor_work_area(monitor: &tauri::Monitor) -> Result<WorkArea, String> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromPoint, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };

    let position = monitor.position();
    let size = monitor.size();
    let point = POINT {
        x: position.x + (size.width / 2) as i32,
        y: position.y + (size.height / 2) as i32,
    };
    unsafe {
        let handle = MonitorFromPoint(point, MONITOR_DEFAULTTONEAREST);
        if handle.is_invalid() {
            return Err("failed to resolve target monitor work area".to_owned());
        }
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if !GetMonitorInfoW(handle, &mut info).as_bool() {
            return Err("failed to read target monitor work area".to_owned());
        }
        Ok(WorkArea {
            x: info.rcWork.left,
            y: info.rcWork.top,
            width: (info.rcWork.right - info.rcWork.left).max(0) as u32,
        })
    }
}

#[cfg(not(target_os = "windows"))]
fn monitor_work_area(monitor: &tauri::Monitor) -> Result<WorkArea, String> {
    let position = monitor.position();
    let size = monitor.size();
    Ok(WorkArea {
        x: position.x,
        y: position.y,
        width: size.width,
    })
}

#[cfg(target_os = "windows")]
fn handle_position_flags() -> windows::Win32::UI::WindowsAndMessaging::SET_WINDOW_POS_FLAGS {
    use windows::Win32::UI::WindowsAndMessaging::{SWP_NOACTIVATE, SWP_NOCOPYBITS, SWP_NOZORDER};
    // Moving the centered host while shrinking 408 -> 288 changes the WebView's
    // client origin. Preserved client pixels still belong to the old viewport:
    // Windows can briefly copy that image into the moved, narrower window,
    // shifting the capsule and clipping the Logo before WebView2 repaints.
    // Discard those pixels; keep normal repainting and do not hide the host.
    SWP_NOACTIVATE | SWP_NOZORDER | SWP_NOCOPYBITS
}

#[cfg(target_os = "windows")]
fn normalized_handle_style(
    style: windows::Win32::UI::WindowsAndMessaging::WINDOW_STYLE,
) -> windows::Win32::UI::WindowsAndMessaging::WINDOW_STYLE {
    use windows::Win32::UI::WindowsAndMessaging::{
        WINDOW_STYLE, WS_CAPTION, WS_MAXIMIZEBOX, WS_MINIMIZEBOX, WS_POPUP, WS_SYSMENU,
        WS_THICKFRAME,
    };
    let forbidden = WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX;
    WINDOW_STYLE((style | WS_POPUP).0 & !forbidden.0)
}

#[cfg(target_os = "windows")]
fn normalize_handle_window_style<R: Runtime>(
    handle: &tauri::WebviewWindow<R>,
) -> Result<(), String> {
    use windows::Win32::Foundation::{GetLastError, SetLastError, WIN32_ERROR};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, GWL_STYLE, SWP_FRAMECHANGED,
        SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, WINDOW_STYLE,
    };

    let hwnd = handle.hwnd().map_err(|error| error.to_string())?;
    unsafe {
        SetLastError(WIN32_ERROR(0));
        let current_raw = GetWindowLongPtrW(hwnd, GWL_STYLE);
        let read_error = GetLastError();
        if current_raw == 0 && read_error != WIN32_ERROR(0) {
            return Err(windows::core::Error::from_win32().to_string());
        }
        let current = WINDOW_STYLE(current_raw as u32);
        let normalized = normalized_handle_style(current);
        if current == normalized {
            return Ok(());
        }

        SetLastError(WIN32_ERROR(0));
        let previous = SetWindowLongPtrW(hwnd, GWL_STYLE, normalized.0 as isize);
        let write_error = GetLastError();
        if previous == 0 && write_error != WIN32_ERROR(0) {
            return Err(windows::core::Error::from_win32().to_string());
        }
        SetWindowPos(
            hwnd,
            None,
            0,
            0,
            0,
            0,
            SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
        )
        .map_err(|error| error.to_string())
    }
}

#[cfg(not(target_os = "windows"))]
fn normalize_handle_window_style<R: Runtime>(
    _handle: &tauri::WebviewWindow<R>,
) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "windows")]
fn set_handle_bounds<R: Runtime>(
    handle: &tauri::WebviewWindow<R>,
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    region: SurfaceRegion,
) -> Result<(), String> {
    use windows::Win32::UI::WindowsAndMessaging::SetWindowPos;

    let hwnd = handle.hwnd().map_err(|error| error.to_string())?;
    unsafe {
        SetWindowPos(
            hwnd,
            None,
            position.x,
            position.y,
            size.width as i32,
            size.height as i32,
            handle_position_flags(),
        )
        .map_err(|error| error.to_string())?;
    }
    set_handle_region(handle, region)
}

#[cfg(target_os = "windows")]
fn set_handle_region<R: Runtime>(
    handle: &tauri::WebviewWindow<R>,
    region: SurfaceRegion,
) -> Result<(), String> {
    use windows::Win32::Graphics::Gdi::{
        CreateRectRgn, CreateRoundRectRgn, DeleteObject, EqualRgn, GetWindowRgn, SetWindowRgn,
    };
    let hwnd = handle.hwnd().map_err(|error| error.to_string())?;
    unsafe {
        let region = native_clip_region(region);
        let diameter = region.radius.saturating_mul(2);
        let clip = CreateRoundRectRgn(
            region.left,
            region.top,
            region.right,
            region.bottom,
            diameter,
            diameter,
        );
        if clip.is_invalid() {
            return Err("failed to create status rail rounded window region".into());
        }
        let current = CreateRectRgn(0, 0, 0, 0);
        if !current.is_invalid() {
            let _ = GetWindowRgn(hwnd, current);
            let same = EqualRgn(clip, current).as_bool();
            let _ = DeleteObject(current.into());
            if same {
                let _ = DeleteObject(clip.into());
                return Ok(());
            }
        }
        if SetWindowRgn(hwnd, Some(clip), true) == 0 {
            let _ = DeleteObject(clip.into());
            return Err("failed to set status rail window region".into());
        }
        // Windows owns clip after a successful SetWindowRgn.
        Ok(())
    }
}

#[cfg(not(target_os = "windows"))]
fn set_handle_bounds<R: Runtime>(
    handle: &tauri::WebviewWindow<R>,
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    _region: SurfaceRegion,
) -> Result<(), String> {
    handle.set_size(size).map_err(|error| error.to_string())?;
    handle
        .set_position(position)
        .map_err(|error| error.to_string())
}

pub fn reposition_handle<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    if !app.state::<PanelController>().is_enabled() {
        return Ok(());
    }
    let handle = app
        .get_webview_window("quick-panel-handle")
        .ok_or_else(|| "quick-panel-handle window not found".to_owned())?;
    normalize_handle_window_style(&handle)?;
    let monitor = target_monitor(&handle)?;
    let work_area = monitor_work_area(&monitor)?;
    let top = screen_top(monitor.position().y, work_area.y);
    let source = app.state::<PanelController>().details_source();
    let desired_size = top_surface_size(source, monitor.scale_factor());
    let physical_size = PhysicalSize::new(desired_size.0, desired_size.1);
    let handle_x = surface_x(
        work_area.x,
        work_area.width,
        desired_size.0,
        app.state::<PanelController>().offset_x() * monitor.scale_factor(),
    );
    let visible_offset = (TOP_MARGIN * monitor.scale_factor()).round() as i32;
    let positions = handle_positions(top, desired_size.1, visible_offset);
    let handle_position = PhysicalPosition::new(handle_x, positions.visible_y);
    let current_size = handle.outer_size().map_err(|error| error.to_string())?;
    let current_position = handle.outer_position().map_err(|error| error.to_string())?;
    if current_size != physical_size || current_position != handle_position {
        set_handle_bounds(
            &handle,
            handle_position,
            physical_size,
            surface_region(source, monitor.scale_factor()),
        )?;
    } else {
        // Also initialize the region when startup bounds already match.
        #[cfg(target_os = "windows")]
        set_handle_region(&handle, surface_region(source, monitor.scale_factor()))?;
    }
    Ok(())
}

pub fn reconcile_positions<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let controller = app.state::<PanelController>();
    let _positioning = controller.positioning.lock().unwrap();
    reposition_handle(app)
}

fn reconcile_positions_if_current<R: Runtime>(
    app: &AppHandle<R>,
    generation: u64,
) -> Result<bool, String> {
    let controller = app.state::<PanelController>();
    let _positioning = controller.positioning.lock().unwrap();
    if !controller.is_details_current(generation) {
        return Ok(false);
    }
    reposition_handle(app)?;
    Ok(true)
}

pub fn request_position_reconcile<R: Runtime>(app: AppHandle<R>) {
    std::thread::spawn(move || {
        if let Err(error) = reconcile_positions(&app) {
            eprintln!("failed to reposition status island windows: {error}");
        }
    });
}

pub fn start_monitor_watch<R: Runtime>(app: AppHandle<R>) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(2));
        let controller = app.state::<PanelController>();
        // Never while the pointer owns the window: the two would fight over its
        // position, and the reconcile would block the drag on the same mutex.
        if controller.is_enabled() && !controller.is_dragging() {
            if let Err(error) = reconcile_positions(&app) {
                eprintln!("failed to keep status island windows positioned: {error}");
            }
        }
    });
}

pub fn set_enabled<R: Runtime>(
    app: &AppHandle<R>,
    enabled: bool,
    notification_mode: &str,
) -> Result<(), String> {
    let controller = app.state::<PanelController>();
    if controller.is_enabled() == enabled {
        return Ok(());
    }
    controller.set_enabled(enabled);
    let _positioning = controller.positioning.lock().unwrap();
    if enabled {
        if let Err(error) = initialize(app, notification_mode) {
            controller.set_enabled(false);
            return Err(error);
        }
        return Ok(());
    }
    let handle = app.get_webview_window("quick-panel-handle");
    let result = (|| {
        if let Some(handle) = &handle {
            handle.hide().map_err(|error| error.to_string())?;
        }
        Ok(())
    })();
    if let Err(error) = result {
        controller.set_enabled(true);
        if let Some(handle) = &handle {
            let _ = handle.show();
        }
        return Err(error);
    }
    Ok(())
}

/// Grows the rail into the sheet. The window has to be the full expanded size
/// *before* the WebView starts animating, or the sheet would be clipped by the
/// window edge on every frame (design.md §10).
fn acknowledgement_identity(
    source: PanelSource,
    explicit: bool,
    identity: Option<String>,
) -> Option<String> {
    if source == PanelSource::Island && explicit {
        identity
    } else {
        None
    }
}

fn show_details<R: Runtime>(
    app: &AppHandle<R>,
    generation: u64,
    source: PanelSource,
    focus: bool,
    identity: Option<String>,
) -> Result<(), String> {
    let controller = app.state::<PanelController>();
    let handle = app
        .get_webview_window("quick-panel-handle")
        .ok_or_else(|| "quick-panel-handle window not found".to_owned())?;
    reconcile_positions(app)?;
    // Re-check after positioning: a close may have landed while we were laying
    // the window out, and a stale show must not resurrect a collapsed sheet.
    if !controller.is_details_current(generation) {
        return Ok(());
    }
    // The island sheet is opened *for* one reminder. Sending that identity lets
    // the view pin itself to it, so a later queue head change cannot swap the
    // sheet's content — and its action buttons' target — under the user. The
    handle
        .emit(
            "status-island-details-open",
            DetailsOpen {
                generation,
                source,
                identity: identity.clone(),
                hovered: !focus,
            },
        )
        .map_err(|error| error.to_string())?;
    if let Some(identity) = acknowledgement_identity(source, focus, identity.clone()) {
        // Only an explicit click/keyboard open of one concrete reminder counts
        // as seen. Hover is a preview, and an aggregate has no single reminder.
        crate::status_island::acknowledge_identity(app, &identity);
    }
    if focus {
        // Active click/keyboard opens receive Escape; passive hover must not
        // steal focus from whichever application the user is working in.
        handle.set_focus().map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// Collapses the sheet back into the rail. The window may only shrink once the
/// WebView has finished collapsing, so the shrink is deferred; the generation
/// check makes a reopen in the meantime cancel it rather than snap the window
/// back under an open sheet.
fn hide_details_with_action<R: Runtime>(
    app: &AppHandle<R>,
    generation: u64,
    action: OutsideClickAction,
    collapse_to_summary: bool,
) -> Result<(), String> {
    let Some(handle) = app.get_webview_window("quick-panel-handle") else {
        return Ok(());
    };
    let visibility_generation = app.state::<PanelController>().visibility_generation();
    let _ = handle.emit(
        "status-island-details-close",
        DetailsClose {
            generation,
            hide_after_collapse: action == OutsideClickAction::CollapseThenHide,
            collapse_to_summary,
        },
    );
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(COLLAPSE_ANIMATION);
        match reconcile_positions_if_current(&app, generation) {
            Ok(true) => {}
            Ok(false) => return,
            Err(error) => {
                eprintln!("failed to shrink the status island rail: {error}");
                return;
            }
        }
        if let Some(handle) = app.get_webview_window("quick-panel-handle") {
            let _ = handle.emit("status-island-details-closed", DetailsClosed { generation });
        }
        if action == OutsideClickAction::CollapseThenHide {
            if let Some(handle) = app.get_webview_window("quick-panel-handle") {
                let hidden = app.state::<PanelController>().hide_if_current(
                    generation,
                    visibility_generation,
                    || handle.hide(),
                );
                if let Some(Err(error)) = hidden {
                    eprintln!("failed to hide notification-only status island: {error}");
                }
            }
        }
    });
    Ok(())
}

fn hide_details<R: Runtime>(app: &AppHandle<R>, generation: u64) -> Result<(), String> {
    hide_details_with_action(
        app,
        generation,
        OutsideClickAction::Collapse,
        collapse_to_summary_after_view(),
    )
}

pub fn close_details_for_navigation<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let transition = app.state::<PanelController>().close_details();
    hide_details(app, transition.generation)
}

fn current_notification_mode<R: Runtime>(app: &AppHandle<R>) -> String {
    let Some(db) = app.try_state::<crate::db::AppDb>() else {
        return "persistent".to_owned();
    };
    let Ok(connection) = db.0.lock() else {
        return "persistent".to_owned();
    };
    crate::settings::read_app_settings(&connection)
        .map(|settings| settings.notification_mode)
        .unwrap_or_else(|_| "persistent".to_owned())
}

pub fn close_details_after_outside_click<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let controller = app.state::<PanelController>();
    if !outside_click_closes_source(controller.details_source()) {
        return Ok(());
    }
    let action = outside_click_action(&current_notification_mode(app));
    let transition = controller.close_details();
    hide_details_with_action(app, transition.generation, action, true)
}

#[tauri::command]
pub fn toggle_status_island_details(
    app: AppHandle,
    identity: Option<String>,
) -> Result<(), crate::error::CommandError> {
    toggle_panel(app, PanelSource::Island, identity)
}

#[tauri::command]
pub fn toggle_nowly_panel(app: AppHandle) -> Result<(), crate::error::CommandError> {
    toggle_panel(app, PanelSource::Nowly, None)
}

fn toggle_panel(
    app: AppHandle,
    source: PanelSource,
    identity: Option<String>,
) -> Result<(), crate::error::CommandError> {
    let transition = app.state::<PanelController>().toggle_details(source);
    match transition.source {
        Some(source) => show_details(&app, transition.generation, source, true, identity)
            .map_err(crate::error::CommandError::system),
        None => {
            hide_details(&app, transition.generation).map_err(crate::error::CommandError::system)
        }
    }
}

fn hover_panel(app: AppHandle, source: PanelSource) -> Result<(), crate::error::CommandError> {
    let Some(generation) = app.state::<PanelController>().reserve_hover_open(source) else {
        return Ok(());
    };
    std::thread::spawn(move || {
        std::thread::sleep(HOVER_OPEN_DELAY);
        let controller = app.state::<PanelController>();
        // Still the newest hover, and the pointer never left in between.
        let still_present = app
            .try_state::<crate::status_island::ManagedReminders>()
            .and_then(|reminders| {
                reminders
                    .lock()
                    .ok()
                    .map(|lifecycle| lifecycle.island_present())
            })
            .unwrap_or(false);
        if !still_present || !controller.is_details_current(generation) {
            return;
        }
        if !controller.complete_hover_open(generation) {
            return;
        }
        let identity = crate::status_island::primary_identity(&app);
        if let Err(error) = show_details(&app, generation, source, false, identity) {
            eprintln!("failed to open status island details on hover: {error}");
            let transition = controller.close_details();
            let _ = hide_details(&app, transition.generation);
        }
    });
    Ok(())
}

/// Opening is deferred so a quick pass opens neither half of the rail.
#[tauri::command]
pub fn hover_status_island_details(app: AppHandle) -> Result<(), crate::error::CommandError> {
    hover_panel(app, PanelSource::Island)
}

#[tauri::command]
pub fn close_status_island_details(app: AppHandle) -> Result<(), crate::error::CommandError> {
    close_details_for_navigation(&app).map_err(crate::error::CommandError::system)
}

#[cfg(target_os = "windows")]
mod outside_click_watch {
    use super::{
        close_details_after_outside_click, native_clip_region, point_is_inside_rounded_surface,
        surface_region, PanelController, SurfaceRegion, ASSISTANT_WIDTH,
    };
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::OnceLock;
    use tauri::{AppHandle, Manager};
    use windows::Win32::Foundation::{LPARAM, LRESULT, RECT, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, DispatchMessageW, GetMessageW, GetWindowRect, SetWindowsHookExW,
        TranslateMessage, MSG, MSLLHOOKSTRUCT, WH_MOUSE_LL, WM_LBUTTONDOWN, WM_MBUTTONDOWN,
        WM_RBUTTONDOWN,
    };

    static APP: OnceLock<AppHandle> = OnceLock::new();
    static HANDLING_OUTSIDE_CLICK: AtomicBool = AtomicBool::new(false);

    unsafe extern "system" fn mouse_hook_proc(
        code: i32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        if code >= 0
            && matches!(
                wparam.0 as u32,
                WM_LBUTTONDOWN | WM_RBUTTONDOWN | WM_MBUTTONDOWN
            )
        {
            let _ = std::panic::catch_unwind(|| {
                let Some(app) = APP.get() else {
                    return;
                };
                if !app.state::<PanelController>().are_details_open() {
                    return;
                }
                let Some(window) = app.get_webview_window("quick-panel-handle") else {
                    return;
                };
                let Ok(hwnd) = window.hwnd() else {
                    return;
                };
                let mut rect = RECT::default();
                if unsafe { GetWindowRect(hwnd, &mut rect) }.is_err() {
                    return;
                }
                let data = unsafe { &*(lparam.0 as *const MSLLHOOKSTRUCT) };
                let content = native_clip_region(surface_region(
                    app.state::<PanelController>().details_source(),
                    f64::from(rect.right - rect.left) / ASSISTANT_WIDTH,
                ));
                let region = SurfaceRegion {
                    left: rect.left + content.left,
                    top: rect.top + content.top,
                    right: rect.left + content.right,
                    bottom: rect.top + content.bottom,
                    radius: content.radius,
                };
                if point_is_inside_rounded_surface(data.pt.x, data.pt.y, region)
                    || HANDLING_OUTSIDE_CLICK.swap(true, Ordering::SeqCst)
                {
                    return;
                }
                let app = app.clone();
                let spawn = std::thread::Builder::new()
                    .name("status-island-outside-click".into())
                    .spawn(move || {
                        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                            close_details_after_outside_click(&app)
                        }));
                        if let Ok(Err(error)) = result {
                            eprintln!("failed to close status island after outside click: {error}");
                        }
                        HANDLING_OUTSIDE_CLICK.store(false, Ordering::SeqCst);
                    });
                if spawn.is_err() {
                    HANDLING_OUTSIDE_CLICK.store(false, Ordering::SeqCst);
                }
            });
        }
        unsafe { CallNextHookEx(None, code, wparam, lparam) }
    }

    pub fn start(app: AppHandle) {
        if APP.set(app).is_err() {
            return;
        }
        std::thread::spawn(move || unsafe {
            let hook = match SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_hook_proc), None, 0) {
                Ok(hook) => hook,
                Err(error) => {
                    eprintln!("failed to install status island outside-click hook: {error}");
                    return;
                }
            };
            let mut message = MSG::default();
            while GetMessageW(&mut message, None, 0, 0).as_bool() {
                let _ = TranslateMessage(&message);
                DispatchMessageW(&message);
            }
            let _ = windows::Win32::UI::WindowsAndMessaging::UnhookWindowsHookEx(hook);
        });
    }
}

#[cfg(target_os = "windows")]
pub fn start_outside_click_watch(app: AppHandle) {
    outside_click_watch::start(app);
}

#[cfg(not(target_os = "windows"))]
pub fn start_outside_click_watch(_app: AppHandle) {}

/// Where the user parked the surface, in logical pixels from the work area's
/// horizontal centre. A missing or unreadable row means it was never dragged, so
/// the surface stays centred rather than failing to place itself.
pub fn load_offset_x(connection: &rusqlite::Connection) -> f64 {
    connection
        .query_row(
            "SELECT value FROM settings WHERE key=?1",
            [OFFSET_SETTING_KEY],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .ok()
        .flatten()
        .and_then(|raw| serde_json::from_str::<f64>(&raw).ok())
        .filter(|offset| offset.is_finite())
        .unwrap_or(0.0)
}

fn save_offset_x<R: Runtime>(app: &AppHandle<R>, offset_x: f64) {
    let Some(db) = app.try_state::<crate::db::AppDb>() else {
        return;
    };
    let Ok(connection) = db.0.lock() else {
        return;
    };
    let Ok(raw) = serde_json::to_string(&offset_x) else {
        return;
    };
    if let Err(error) = connection.execute(
        "INSERT INTO settings(key,value,updated_at)
         VALUES (?1,?2,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
        rusqlite::params![OFFSET_SETTING_KEY, raw],
    ) {
        // The surface is already where the user put it; only the memory of it is
        // lost, so this must not fail the drag.
        eprintln!("failed to persist the status island position: {error}");
    }
}

/// Reduces the live offset to what the current monitor can actually show. The
/// drag itself is allowed to overshoot, because the pointer can leave the screen;
/// what gets stored has to be a position the surface really occupies, or a
/// restart would place it as an invisible overhang.
fn settle_offset<R: Runtime>(app: &AppHandle<R>) -> Result<f64, String> {
    let handle = app
        .get_webview_window("quick-panel-handle")
        .ok_or_else(|| "quick-panel-handle window not found".to_owned())?;
    let monitor = target_monitor(&handle)?;
    let work_area = monitor_work_area(&monitor)?;
    let scale = monitor.scale_factor();
    let controller = app.state::<PanelController>();
    let (width, _) = top_surface_size(controller.details_source(), scale);
    let x = surface_x(
        work_area.x,
        work_area.width,
        width,
        controller.offset_x() * scale,
    );
    let settled = f64::from(x - centered_x(work_area.x, work_area.width, width)) / scale;
    controller.set_offset_x(settled);
    Ok(settled)
}

/// The screen geometry the whole drag is resolved against. Read once, here,
/// because resolving it is expensive and nothing it describes can change while
/// the pointer is held down — and if it somehow does, `end_drag` re-settles.
/// Width and y are the same collapsed or expanded, so the sheet closing under
/// the drag cannot invalidate this.
fn drag_anchor<R: Runtime>(app: &AppHandle<R>) -> Result<DragAnchor, String> {
    let handle = app
        .get_webview_window("quick-panel-handle")
        .ok_or_else(|| "quick-panel-handle window not found".to_owned())?;
    let monitor = target_monitor(&handle)?;
    let work_area = monitor_work_area(&monitor)?;
    let scale = monitor.scale_factor();
    let (width, _) = top_surface_size(None, scale);
    let top = screen_top(monitor.position().y, work_area.y);
    Ok(DragAnchor {
        work_area,
        scale,
        width,
        y: top + (TOP_MARGIN * scale).round() as i32,
    })
}

/// Long press on the rail. The sheet cannot stay open across a drag: it is the
/// rail grown, so moving the rail would resize the window under the pointer.
#[tauri::command]
pub fn begin_status_island_drag(app: AppHandle) -> Result<bool, crate::error::CommandError> {
    if !app.state::<PanelController>().is_enabled() {
        return Ok(false);
    }
    let anchor = drag_anchor(&app).map_err(crate::error::CommandError::system)?;
    if !app.state::<PanelController>().begin_drag(anchor) {
        return Ok(false);
    }
    close_details_for_navigation(&app).map_err(crate::error::CommandError::system)?;
    Ok(true)
}

/// The pointer's total travel since the drag began, in logical pixels. Only the
/// x axis is carried: the surface belongs to the top edge, so its y never moves.
///
/// Tauri runs synchronous commands on the main thread, and this one is called
/// once per pointer frame, so it may do nothing but move the window. Everything
/// it needs was resolved at `begin_status_island_drag`.
#[tauri::command]
pub fn drag_status_island(app: AppHandle, delta_x: f64) -> Result<(), crate::error::CommandError> {
    let Some(position) = app.state::<PanelController>().drag_to(delta_x) else {
        return Ok(());
    };
    let Some(handle) = app.get_webview_window("quick-panel-handle") else {
        return Ok(());
    };
    handle
        .set_position(position)
        .map_err(crate::error::CommandError::system)
}

#[tauri::command]
pub fn end_status_island_drag(app: AppHandle) -> Result<(), crate::error::CommandError> {
    if !app.state::<PanelController>().end_drag() {
        return Ok(());
    }
    let settled = settle_offset(&app).map_err(crate::error::CommandError::system)?;
    save_offset_x(&app, settled);
    reposition_handle(&app).map_err(crate::error::CommandError::system)
}

#[cfg(test)]
mod tests {
    #[cfg(target_os = "windows")]
    #[test]
    fn native_resize_discards_old_pixels_without_hiding_or_suppressing_redraw() {
        use windows::Win32::UI::WindowsAndMessaging::{
            SWP_HIDEWINDOW, SWP_NOACTIVATE, SWP_NOCOPYBITS, SWP_NOREDRAW, SWP_NOZORDER,
        };
        let flags = super::handle_position_flags();
        assert!(
            flags.contains(SWP_NOCOPYBITS),
            "resized WebView must not inherit old client pixels"
        );
        assert!(flags.contains(SWP_NOACTIVATE | SWP_NOZORDER));
        assert_eq!((flags & (SWP_HIDEWINDOW | SWP_NOREDRAW)).0, 0);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn webview_clear_color_is_fully_transparent() {
        let color = super::transparent_webview_background();
        assert_eq!((color.R, color.G, color.B, color.A), (0, 0, 0, 0));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn handle_style_is_a_popup_without_native_window_controls() {
        use windows::Win32::UI::WindowsAndMessaging::{
            WINDOW_STYLE, WS_CAPTION, WS_CLIPSIBLINGS, WS_MAXIMIZEBOX, WS_MINIMIZEBOX, WS_POPUP,
            WS_SYSMENU, WS_THICKFRAME, WS_VISIBLE,
        };

        let original = WINDOW_STYLE(
            WS_CAPTION.0
                | WS_THICKFRAME.0
                | WS_SYSMENU.0
                | WS_MINIMIZEBOX.0
                | WS_MAXIMIZEBOX.0
                | WS_VISIBLE.0
                | WS_CLIPSIBLINGS.0,
        );
        let normalized = super::normalized_handle_style(original);
        let forbidden = WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX;

        assert!(normalized.contains(WS_POPUP));
        assert_eq!((normalized & forbidden).0, 0);
        assert!(normalized.contains(WS_VISIBLE | WS_CLIPSIBLINGS));
        assert_eq!(super::normalized_handle_style(normalized), normalized);
    }

    #[test]
    fn both_morphs_finish_before_native_collapse() {
        // Geometry-independent: status and AI share 220ms + a 40ms frame margin.
        assert_eq!(super::COLLAPSE_ANIMATION.as_millis(), 260);
    }

    use super::{
        acknowledgement_identity, centered_x, collapse_to_summary_after_view, handle_positions,
        load_offset_x, outside_click_action, outside_click_closes_source, point_is_inside_surface,
        resolve_target_monitor, screen_top, starts_visible, surface_x, top_surface_size,
        DragAnchor, OutsideClickAction, PanelController, PanelSource, SurfaceBounds, WorkArea,
    };
    use tauri::PhysicalPosition;

    /// A 1920-wide work area at 1x, where the centred 288 rail sits at x=816.
    fn anchor() -> DragAnchor {
        DragAnchor {
            work_area: WorkArea {
                x: 0,
                y: 0,
                width: 1920,
            },
            scale: 1.0,
            width: 288,
            y: 8,
        }
    }

    #[test]
    fn handle_window_has_no_native_shadow_or_background() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let handle = config["app"]["windows"]
            .as_array()
            .unwrap()
            .iter()
            .find(|window| window["label"] == "quick-panel-handle")
            .unwrap();
        assert_eq!(handle["decorations"], false);
        assert_eq!(handle["shadow"], false);
        assert_eq!(handle["transparent"], true);
        assert_eq!(handle["backgroundColor"], "#00000000");
        assert_eq!(handle["resizable"], false);
        assert_eq!(handle["minimizable"], false);
        assert_eq!(handle["maximizable"], false);
    }

    #[test]
    fn only_an_explicit_open_of_a_specific_reminder_acknowledges_it() {
        let identity = Some("event:a:reminder:15".to_owned());

        assert_eq!(
            acknowledgement_identity(PanelSource::Island, true, identity.clone()),
            identity
        );
        assert_eq!(
            acknowledgement_identity(PanelSource::Island, false, Some("event:a".into())),
            None
        );
        assert_eq!(
            acknowledgement_identity(PanelSource::Island, true, None),
            None
        );
    }

    #[test]
    fn the_top_rail_is_the_only_floating_window() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let labels: Vec<&str> = config["app"]["windows"]
            .as_array()
            .unwrap()
            .iter()
            .map(|window| window["label"].as_str().unwrap())
            .collect();

        assert!(!labels.contains(&"quick-panel"));
        assert!(labels.contains(&"quick-panel-handle"));
        // The sheet is the rail grown, not a second window. A native window
        // cannot grow into another one, so there must not be another one.
        assert!(!labels.contains(&"status-island-details"));
    }

    #[test]
    fn the_startup_window_geometry_matches_the_collapsed_rail() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let handle = config["app"]["windows"]
            .as_array()
            .unwrap()
            .iter()
            .find(|window| window["label"] == "quick-panel-handle")
            .unwrap();

        assert_eq!(handle["width"], 408);
        assert_eq!(handle["height"], 40);
    }

    #[test]
    fn notification_only_startup_stays_hidden_until_the_webview_finds_an_unseen_reminder() {
        assert!(starts_visible("persistent"));
        assert!(!starts_visible("notification"));
        assert!(!starts_visible("unexpected"));
    }

    #[test]
    fn outside_click_collapses_both_modes_and_only_hides_notification_mode() {
        assert_eq!(
            outside_click_action("persistent"),
            OutsideClickAction::Collapse
        );
        assert_eq!(
            outside_click_action("notification"),
            OutsideClickAction::CollapseThenHide
        );
    }

    #[test]
    fn outside_click_only_collapses_status_details_not_the_nowly_conversation() {
        assert!(outside_click_closes_source(Some(PanelSource::Island)));
        assert!(!outside_click_closes_source(Some(PanelSource::Nowly)));
        assert!(!outside_click_closes_source(None));
    }

    #[test]
    fn a_viewed_detail_collapses_to_the_summary_instead_of_the_next_reminder() {
        assert!(collapse_to_summary_after_view());
    }

    #[test]
    fn showing_the_surface_cancels_a_pending_notification_only_hide() {
        let controller = PanelController::default();
        let before = controller.visibility_generation();

        controller.show_serialized(|| ());

        assert!(controller.visibility_generation() > before);
    }

    #[test]
    fn visibility_operations_serialize_the_generation_check_with_hide() {
        use std::sync::{mpsc, Arc};

        let controller = Arc::new(PanelController::default());
        let generation = controller.visibility_generation();
        let (hide_started_tx, hide_started_rx) = mpsc::channel();
        let (release_hide_tx, release_hide_rx) = mpsc::channel();
        let (show_finished_tx, show_finished_rx) = mpsc::channel();

        let hiding = Arc::clone(&controller);
        let hide_thread = std::thread::spawn(move || {
            hiding.hide_if_visibility_current(generation, || {
                hide_started_tx.send(()).unwrap();
                release_hide_rx.recv().unwrap();
            })
        });
        hide_started_rx.recv().unwrap();

        let showing = Arc::clone(&controller);
        let show_thread = std::thread::spawn(move || {
            showing.show_serialized(|| ());
            show_finished_tx.send(()).unwrap();
        });

        assert!(show_finished_rx.try_recv().is_err());
        release_hide_tx.send(()).unwrap();
        hide_thread.join().unwrap();
        show_thread.join().unwrap();
        show_finished_rx.recv().unwrap();
        assert!(controller.visibility_generation() > generation);
    }

    #[test]
    fn a_stale_details_generation_cannot_hide_a_reopened_surface() {
        let controller = PanelController::default();
        let closed = controller.close_details();
        let visibility_generation = controller.visibility_generation();
        controller.toggle_details(PanelSource::Nowly);

        let hidden = controller.hide_if_current(closed.generation, visibility_generation, || ());

        assert!(hidden.is_none());
        assert!(controller.are_details_open());
    }

    #[test]
    fn clicks_on_the_status_bar_or_expanded_panel_are_not_outside_clicks() {
        let bounds = SurfaceBounds {
            left: 816,
            top: 8,
            right: 1104,
            bottom: 296,
        };

        assert!(point_is_inside_surface(900, 20, bounds));
        assert!(point_is_inside_surface(900, 200, bounds));
        assert!(!point_is_inside_surface(815, 20, bounds));
        assert!(!point_is_inside_surface(900, 297, bounds));
    }

    #[test]
    fn rounded_surface_hit_testing_excludes_transparent_corner_pixels() {
        let region = super::surface_region(None, 1.0);

        assert!(!super::point_is_inside_rounded_surface(60, 0, region));
        assert!(!super::point_is_inside_rounded_surface(347, 0, region));
        assert!(super::point_is_inside_rounded_surface(204, 0, region));
        assert!(super::point_is_inside_rounded_surface(60, 20, region));
        assert!(super::point_is_inside_rounded_surface(204, 20, region));
    }

    #[test]
    fn top_surfaces_ignore_a_top_taskbar_work_area_inset() {
        assert_eq!(screen_top(0, 48), 0);
        assert_eq!(screen_top(-900, -852), -900);
    }

    #[test]
    fn top_surface_sizes_are_source_specific_and_scale_with_dpi() {
        assert_eq!(top_surface_size(None, 1.0), (408, 40));
        assert_eq!(top_surface_size(Some(PanelSource::Island), 1.0), (408, 288));
        assert_eq!(top_surface_size(Some(PanelSource::Nowly), 1.0), (408, 440));
        // Every edge lands on a whole device pixel at the scales Windows uses.
        assert_eq!(top_surface_size(None, 1.5), (612, 60));
        assert_eq!(top_surface_size(Some(PanelSource::Island), 1.5), (612, 432));
        assert_eq!(top_surface_size(Some(PanelSource::Nowly), 1.5), (612, 660));
        assert_eq!(top_surface_size(None, 2.0), (816, 80));
        assert_eq!(top_surface_size(Some(PanelSource::Island), 2.0), (816, 576));
        assert_eq!(top_surface_size(Some(PanelSource::Nowly), 2.0), (816, 880));
        assert_eq!(handle_positions(-900, 60, 12).visible_y, -888);
    }

    #[test]
    fn both_panels_keep_the_same_native_x_even_at_screen_edges() {
        for scale in [1.0, 1.25, 1.5, 1.75, 2.0] {
            for offset in [-5000.0, 0.0, 5000.0] {
                let collapsed = top_surface_size(None, scale);
                for source in [PanelSource::Island, PanelSource::Nowly] {
                    let expanded = top_surface_size(Some(source), scale);
                    assert_eq!(expanded.0, collapsed.0);
                    assert_eq!(
                        surface_x(-1920, 1920, expanded.0, offset),
                        surface_x(-1920, 1920, collapsed.0, offset)
                    );
                }
            }
        }
    }

    #[test]
    fn transparent_host_gutters_are_outside_the_status_hit_region_at_each_dpi() {
        for scale in [1.0, 1.25, 1.5, 1.75, 2.0] {
            for source in [None, Some(PanelSource::Island)] {
                let bounds = super::surface_client_bounds(source, scale);
                let host = top_surface_size(source, scale);
                assert_eq!(bounds.left, (60.0 * scale) as i32);
                assert_eq!(bounds.right, (348.0 * scale) as i32);
                assert!(!point_is_inside_surface(bounds.left - 1, 1, bounds));
                assert!(point_is_inside_surface(bounds.left, 1, bounds));
                assert!(point_is_inside_surface(bounds.right - 1, 1, bounds));
                assert!(!point_is_inside_surface(bounds.right, 1, bounds));
                assert_eq!(bounds.bottom, host.1 as i32);
            }
            let ai = super::surface_client_bounds(Some(PanelSource::Nowly), scale);
            assert_eq!(ai.left, 0);
            assert_eq!(ai.right, top_surface_size(None, scale).0 as i32);
        }
    }

    #[test]
    fn native_regions_match_each_visible_rounded_surface_at_every_supported_dpi() {
        for scale in [1.0, 1.25, 1.5, 1.75, 2.0] {
            let collapsed = super::surface_region(None, scale);
            assert_eq!(collapsed.left, (60.0_f64 * scale).round() as i32);
            assert_eq!(collapsed.top, 0);
            assert_eq!(collapsed.right, (348.0_f64 * scale).round() as i32);
            assert_eq!(collapsed.bottom, (40.0_f64 * scale).round() as i32);
            assert_eq!(collapsed.radius, (20.0_f64 * scale).round() as i32);

            let status = super::surface_region(Some(PanelSource::Island), scale);
            assert_eq!(status.left, (60.0_f64 * scale).round() as i32);
            assert_eq!(status.top, 0);
            assert_eq!(status.right, (348.0_f64 * scale).round() as i32);
            assert_eq!(status.bottom, (288.0_f64 * scale).round() as i32);
            assert_eq!(status.radius, (15.2_f64 * scale).round() as i32);

            let assistant = super::surface_region(Some(PanelSource::Nowly), scale);
            assert_eq!(assistant.left, 0);
            assert_eq!(assistant.top, 0);
            assert_eq!(assistant.right, (408.0_f64 * scale).round() as i32);
            assert_eq!(assistant.bottom, (440.0_f64 * scale).round() as i32);
            assert_eq!(assistant.radius, (15.2_f64 * scale).round() as i32);
        }
    }

    #[test]
    fn native_clip_leaves_one_physical_pixel_for_css_corner_antialiasing() {
        for scale in [1.0, 1.25, 1.5, 1.75, 2.0] {
            for source in [None, Some(PanelSource::Island), Some(PanelSource::Nowly)] {
                let visual = super::surface_region(source, scale);
                let clip = super::native_clip_region(visual);

                assert_eq!(clip.bounds(), visual.bounds());
                assert_eq!(clip.radius, visual.radius.saturating_sub(1));
            }
        }
    }

    #[test]
    fn native_clip_hit_testing_includes_the_css_antialiasing_margin() {
        let visual = super::surface_region(None, 1.0);
        let clip = super::native_clip_region(visual);

        assert!(!super::point_is_inside_rounded_surface(75, 0, visual));
        assert!(super::point_is_inside_rounded_surface(75, 0, clip));
    }

    #[test]
    fn opening_the_other_half_swaps_the_sheet_instead_of_closing_it() {
        let controller = PanelController::default();

        let island = controller.toggle_details(PanelSource::Island);
        assert_eq!(island.source, Some(PanelSource::Island));

        let nowly = controller.toggle_details(PanelSource::Nowly);
        assert_eq!(nowly.source, Some(PanelSource::Nowly));
        assert!(controller.are_details_open());

        assert_eq!(controller.toggle_details(PanelSource::Nowly).source, None);
        assert!(!controller.are_details_open());
    }

    #[test]
    fn an_idle_rail_still_opens_its_sheet() {
        // The Home Indicator bar is gone: there is no state in which the top
        // surface refuses to open, only one in which it has nothing to report.
        let controller = PanelController::default();

        assert_eq!(
            controller.toggle_details(PanelSource::Island).source,
            Some(PanelSource::Island)
        );
        assert!(controller.reserve_hover_open(PanelSource::Island).is_none());
    }

    #[test]
    fn negative_monitor_origins_are_preserved_when_centering() {
        assert_eq!(centered_x(0, 1920, 288), 816);
        assert_eq!(centered_x(-1920, 1920, 288), -1104);
        // A surface wider than the work area clamps instead of wrapping.
        assert_eq!(centered_x(-1920, 100, 288), -1920);
    }

    #[test]
    fn the_saved_offset_moves_the_surface_along_the_top_edge_only() {
        // No offset is the old behaviour exactly: centred.
        assert_eq!(surface_x(0, 1920, 288, 0.0), 816);
        assert_eq!(surface_x(0, 1920, 288, -200.0), 616);
        assert_eq!(surface_x(0, 1920, 288, 200.0), 1016);
        // The surface belongs to the top edge, so it can reach either end and
        // stops there rather than leaving the screen.
        assert_eq!(surface_x(0, 1920, 288, -5000.0), 0);
        assert_eq!(surface_x(0, 1920, 288, 5000.0), 1632);
        // A monitor left of primary keeps its negative origin.
        assert_eq!(surface_x(-1920, 1920, 288, -5000.0), -1920);
        assert_eq!(surface_x(-1920, 1920, 288, 5000.0), -288);
        // Offsets are logical pixels, so a scaled monitor multiplies them.
        assert_eq!(surface_x(0, 2880, 432, 200.0 * 1.5), 1524);
    }

    #[test]
    fn the_rail_can_be_dragged_from_any_state_and_reports_total_travel() {
        let controller = PanelController::default();

        // There is no idle bar any more: the rail is always parkable.
        assert!(controller.begin_drag(anchor()));
        // Each move carries the pointer's travel since the press, not an
        // increment, so the surface stays glued to the pointer. It also answers
        // with the window position outright: the move path never re-resolves the
        // monitor, because it runs on the main thread once per pointer frame.
        assert_eq!(
            controller.drag_to(40.0),
            Some(PhysicalPosition::new(856, 8))
        );
        assert_eq!(controller.offset_x(), 40.0);
        assert_eq!(
            controller.drag_to(-15.0),
            Some(PhysicalPosition::new(801, 8))
        );
        assert_eq!(controller.offset_x(), -15.0);

        assert!(controller.end_drag());
        // A move after the drag ended cannot walk the surface.
        assert_eq!(controller.drag_to(500.0), None);
        assert_eq!(controller.offset_x(), -15.0);
        assert!(!controller.end_drag());

        // A second drag starts from where the first left it.
        assert!(controller.begin_drag(anchor()));
        assert_eq!(
            controller.drag_to(10.0),
            Some(PhysicalPosition::new(811, 8))
        );
        assert_eq!(controller.offset_x(), -5.0);

        // Garbage never reaches the position.
        assert_eq!(controller.drag_to(f64::NAN), None);
        assert_eq!(controller.offset_x(), -5.0);
    }

    #[test]
    fn a_drag_holds_off_the_monitor_watch_and_clamps_to_its_own_anchor() {
        let controller = PanelController::default();
        assert!(!controller.is_dragging());

        assert!(controller.begin_drag(anchor()));
        assert!(controller.is_dragging());
        // The anchor is the whole truth for the drag, clamp included: the pointer
        // may run off the screen, the window may not.
        assert_eq!(
            controller.drag_to(9000.0),
            Some(PhysicalPosition::new(1632, 8))
        );

        controller.end_drag();
        assert!(!controller.is_dragging());
    }

    #[test]
    fn a_drag_closes_the_sheet_and_refuses_to_reopen_it() {
        let controller = PanelController::default();
        let opened = controller.toggle_details(PanelSource::Island);
        assert_eq!(opened.source, Some(PanelSource::Island));

        assert!(controller.begin_drag(anchor()));

        // The sheet is the rail grown, so moving the rail tears it down instead
        // of resizing the window under the pointer.
        assert!(!controller.are_details_open());
        assert!(!controller.is_details_current(opened.generation));
        assert!(controller.reserve_hover_open(PanelSource::Island).is_none());
        assert_eq!(controller.toggle_details(PanelSource::Island).source, None);

        controller.end_drag();
        assert!(controller.reserve_hover_open(PanelSource::Island).is_some());
    }

    #[test]
    fn a_disabled_surface_cannot_be_dragged() {
        let controller = PanelController::default();
        controller.set_enabled(false);

        assert!(!controller.begin_drag(anchor()));
        assert_eq!(controller.drag_to(40.0), None);
        assert_eq!(controller.offset_x(), 0.0);
    }

    #[test]
    fn the_parked_position_survives_a_restart_and_degrades_to_centred() {
        let mut connection = rusqlite::Connection::open_in_memory().unwrap();
        crate::db::migrate(&mut connection).unwrap();

        // Never dragged: centred.
        assert_eq!(load_offset_x(&connection), 0.0);

        connection
            .execute(
                "INSERT INTO settings(key,value,updated_at)
                 VALUES ('status_island_offset_x','-412.5','2026-01-01T00:00:00.000Z')",
                [],
            )
            .unwrap();
        assert_eq!(load_offset_x(&connection), -412.5);

        // A value no build of ours writes must not leave the surface unplaceable.
        for corrupt in ["\"left\"", "null", "not json"] {
            connection
                .execute(
                    "UPDATE settings SET value=?1 WHERE key='status_island_offset_x'",
                    [corrupt],
                )
                .unwrap();
            assert_eq!(load_offset_x(&connection), 0.0);
        }
    }

    #[test]
    fn a_stale_details_generation_cannot_restore_a_collapsed_sheet() {
        let controller = PanelController::default();
        let opened = controller.toggle_details(PanelSource::Island);
        assert_eq!(opened.source, Some(PanelSource::Island));

        let closed = controller.close_details();

        assert!(!controller.is_details_current(opened.generation));
        assert!(controller.is_details_current(closed.generation));
        assert!(!controller.are_details_open());
    }

    #[test]
    fn a_hover_open_is_abandoned_when_anything_else_happens_first() {
        let controller = PanelController::default();

        let reserved = controller.reserve_hover_open(PanelSource::Island).unwrap();
        controller.close_details();
        assert!(!controller.complete_hover_open(reserved));
        assert!(!controller.are_details_open());

        let second = controller.reserve_hover_open(PanelSource::Island).unwrap();
        assert!(controller.complete_hover_open(second));
        assert_eq!(controller.details_source(), Some(PanelSource::Island));
        // An already open sheet does not reserve another hover open.
        assert!(controller.reserve_hover_open(PanelSource::Island).is_none());
    }

    #[test]
    fn a_disabled_controller_opens_nothing() {
        let controller = PanelController::default();
        controller.set_enabled(false);

        assert_eq!(controller.toggle_details(PanelSource::Island).source, None);
        assert!(controller.reserve_hover_open(PanelSource::Island).is_none());
        assert!(!controller.are_details_open());
    }

    #[test]
    fn a_disconnected_target_monitor_falls_back_to_primary_without_overwriting_the_saved_id() {
        let ids = vec!["primary".to_owned(), "side".to_owned()];

        assert_eq!(
            resolve_target_monitor(Some("side"), Some("side"), &ids, Some(0)),
            Some(1)
        );

        // The side monitor is unplugged: fall back atomically to primary.
        let remaining = vec!["primary".to_owned()];
        assert_eq!(
            resolve_target_monitor(Some("side"), Some("side"), &remaining, Some(0)),
            Some(0)
        );

        // The saved preference is untouched, but the effective fallback is now
        // primary. Re-plugging must not move the surface without a fresh user
        // selection.
        assert_eq!(
            resolve_target_monitor(Some("side"), Some("primary"), &ids, Some(0)),
            Some(0)
        );

        let controller = PanelController::default();
        controller.set_target_monitor_id(Some("side".to_owned()));
        assert_eq!(controller.target_monitor_id().as_deref(), Some("side"));
        assert_eq!(controller.active_monitor_id().as_deref(), Some("side"));
    }

    #[test]
    fn monitor_resolution_degrades_when_no_primary_is_reported() {
        let ids = vec!["only".to_owned()];

        assert_eq!(resolve_target_monitor(None, None, &ids, None), Some(0));
        assert_eq!(
            resolve_target_monitor(Some("missing"), Some("missing"), &ids, None),
            Some(0)
        );
        assert_eq!(resolve_target_monitor(None, None, &[], None), None);
    }
}
