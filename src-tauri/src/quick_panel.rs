use std::sync::Mutex;
use std::time::Duration;
use rusqlite::OptionalExtension;
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
/// The rail: a 240 capsule, an 8px transparent gap, and the 40px Nowly entry.
/// One window holds all of it, because the panel is the capsule grown rather
/// than a second surface, and a native window cannot grow into another one.
const RAIL_WIDTH: f64 = 288.0;
const RAIL_HEIGHT: f64 = 40.0;
/// The rail expanded: 40 of header plus 248 of panel, as one sheet.
const EXPANDED_HEIGHT: f64 = 288.0;
/// A quick pass over the island must not open anything. Only a sustained hover
/// does, and the delay is coordinated natively so it survives the pointer
/// crossing the transparent gap inside the window.
const HOVER_OPEN_DELAY: Duration = Duration::from_millis(300);
/// The window may only shrink back once the sheet has finished collapsing inside
/// the WebView, or the last frames get clipped by the window edge. design.md §10
/// puts the collapse at 160ms; the rest is margin for a late frame.
const COLLAPSE_ANIMATION: Duration = Duration::from_millis(200);
/// Where the user parked the top surface, as a logical-pixel offset from the
/// work area's horizontal centre. Stored rather than an absolute x so the same
/// value keeps meaning the same place across monitors, resolutions and DPI.
const OFFSET_SETTING_KEY: &str = "status_island_offset_x";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HandlePositions {
    pub visible_y: i32,
    pub hidden_y: i32,
}

/// Which half of the rail the sheet was opened from. The sheet is the same
/// surface either way; only what it carries differs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PanelSource {
    /// The status island capsule: today's reminders and summary.
    Island,
    /// The Nowly entry dot.
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
    source: PanelSource,
    /// Which reminder the island sheet is pinned to. `None` for the Nowly sheet,
    /// which is not about any one reminder.
    identity: Option<String>,
    hovered: bool,
}

pub fn screen_top(monitor_y: i32, _work_area_y: i32) -> i32 {
    monitor_y
}

/// The rail never changes width: collapsed it shows the capsule and the dot,
/// expanded it shows the same 288 as one sheet. Only the height moves, so the
/// saved horizontal offset keeps meaning the same place in both states.
pub fn top_surface_size(expanded: bool, scale_factor: f64) -> (u32, u32) {
    let height = if expanded { EXPANDED_HEIGHT } else { RAIL_HEIGHT };
    (
        (RAIL_WIDTH * scale_factor).round() as u32,
        (height * scale_factor).round() as u32,
    )
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
    ids: &[String],
    primary: Option<usize>,
) -> Option<usize> {
    saved
        .and_then(|id| ids.iter().position(|candidate| candidate == id))
        .or(primary)
        .or(if ids.is_empty() { None } else { Some(0) })
}

#[derive(Debug)]
pub struct PanelController {
    state: Mutex<PanelState>,
    positioning: Mutex<()>,
}

#[derive(Debug)]
struct PanelState {
    enabled: bool,
    target_monitor_id: Option<String>,
    /// Which half of the rail the open sheet belongs to. `None` is collapsed.
    details_source: Option<PanelSource>,
    hover_source: Option<PanelSource>,
    details_generation: u64,
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
                details_source: None,
                hover_source: None,
                details_generation: 0,
                offset_x: 0.0,
                drag: None,
            }),
            positioning: Mutex::new(()),
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
        self.state.lock().unwrap().target_monitor_id = target_monitor_id;
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
        let mut state = self.state.lock().unwrap();
        if !state.allows_details() || state.details_source.is_some() {
            return None;
        }
        state.details_generation += 1;
        state.hover_source = Some(source);
        Some(state.details_generation)
    }

    pub fn complete_hover_open(&self, generation: u64) -> bool {
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

pub fn initialize<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    reposition_handle(app)?;
    let handle = app
        .get_webview_window("quick-panel-handle")
        .ok_or_else(|| "quick-panel-handle window not found".to_owned())?;
    handle.show().map_err(|error| error.to_string())
}

fn target_monitor<R: Runtime>(window: &tauri::WebviewWindow<R>) -> Result<tauri::Monitor, String> {
    let monitors = window
        .available_monitors()
        .map_err(|error| error.to_string())?;
    let primary = window.primary_monitor().map_err(|error| error.to_string())?;
    let saved = window
        .app_handle()
        .state::<PanelController>()
        .target_monitor_id();
    let ids: Vec<String> = monitors
        .iter()
        .map(|monitor| {
            let position = monitor.position();
            crate::monitors::monitor_id(monitor.name().map(String::as_str), position.x, position.y)
        })
        .collect();
    let primary_index = primary.as_ref().and_then(|primary| {
        let position = primary.position();
        let id = crate::monitors::monitor_id(
            primary.name().map(String::as_str),
            position.x,
            position.y,
        );
        ids.iter().position(|candidate| *candidate == id)
    });
    resolve_target_monitor(saved.as_deref(), &ids, primary_index)
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

pub fn reposition_handle<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    if !app.state::<PanelController>().is_enabled() {
        return Ok(());
    }
    let handle = app
        .get_webview_window("quick-panel-handle")
        .ok_or_else(|| "quick-panel-handle window not found".to_owned())?;
    let monitor = target_monitor(&handle)?;
    let work_area = monitor_work_area(&monitor)?;
    let top = screen_top(monitor.position().y, work_area.y);
    let expanded = app.state::<PanelController>().are_details_open();
    let desired_size = top_surface_size(expanded, monitor.scale_factor());
    let physical_size = PhysicalSize::new(desired_size.0, desired_size.1);
    if handle.outer_size().map_err(|error| error.to_string())? != physical_size {
        handle
            .set_size(physical_size)
            .map_err(|error| error.to_string())?;
    }
    let handle_x = surface_x(
        work_area.x,
        work_area.width,
        desired_size.0,
        app.state::<PanelController>().offset_x() * monitor.scale_factor(),
    );
    let visible_offset = (TOP_MARGIN * monitor.scale_factor()).round() as i32;
    let positions = handle_positions(top, desired_size.1, visible_offset);
    let handle_position = PhysicalPosition::new(handle_x, positions.visible_y);
    let current_position = handle.outer_position().map_err(|error| error.to_string())?;
    if current_position != handle_position {
        handle
            .set_position(handle_position)
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub fn reconcile_positions<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let controller = app.state::<PanelController>();
    let _positioning = controller.positioning.lock().unwrap();
    reposition_handle(app)
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

pub fn set_enabled<R: Runtime>(app: &AppHandle<R>, enabled: bool) -> Result<(), String> {
    let controller = app.state::<PanelController>();
    if controller.is_enabled() == enabled {
        return Ok(());
    }
    controller.set_enabled(enabled);
    let _positioning = controller.positioning.lock().unwrap();
    if enabled {
        if let Err(error) = initialize(app) {
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
fn show_details<R: Runtime>(
    app: &AppHandle<R>,
    generation: u64,
    source: PanelSource,
    focus: bool,
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
    // Nowly sheet is about no reminder at all, so it pins to nothing.
    let identity = match source {
        PanelSource::Island => crate::status_island::primary_identity(app),
        PanelSource::Nowly => None,
    };
    handle
        .emit(
            "status-island-details-open",
            DetailsOpen {
                source,
                identity,
                hovered: !focus,
            },
        )
        .map_err(|error| error.to_string())?;
    if source == PanelSource::Island {
        // The sheet is now genuinely on screen and readable by assistive tech,
        // so this is the moment the current reminder counts as seen.
        crate::status_island::acknowledge_primary(app);
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
fn hide_details<R: Runtime>(app: &AppHandle<R>, generation: u64) -> Result<(), String> {
    let Some(handle) = app.get_webview_window("quick-panel-handle") else {
        return Ok(());
    };
    let _ = handle.emit("status-island-details-close", ());
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(COLLAPSE_ANIMATION);
        if !app.state::<PanelController>().is_details_current(generation) {
            return;
        }
        if let Err(error) = reconcile_positions(&app) {
            eprintln!("failed to shrink the status island rail: {error}");
        }
    });
    Ok(())
}

pub fn close_details_for_navigation<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let transition = app.state::<PanelController>().close_details();
    hide_details(app, transition.generation)
}

#[tauri::command]
pub fn toggle_status_island_details(app: AppHandle) -> Result<(), crate::error::CommandError> {
    toggle_panel(app, PanelSource::Island)
}

/// The Nowly entry dot at the right end of the rail.
#[tauri::command]
pub fn toggle_nowly_panel(app: AppHandle) -> Result<(), crate::error::CommandError> {
    toggle_panel(app, PanelSource::Nowly)
}

fn toggle_panel(app: AppHandle, source: PanelSource) -> Result<(), crate::error::CommandError> {
    let transition = app.state::<PanelController>().toggle_details(source);
    match transition.source {
        Some(source) => show_details(&app, transition.generation, source, true)
            .map_err(crate::error::CommandError::system),
        None => hide_details(&app, transition.generation).map_err(crate::error::CommandError::system),
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
            .and_then(|reminders| reminders.lock().ok().map(|lifecycle| lifecycle.island_present()))
            .unwrap_or(false);
        if !still_present || !controller.is_details_current(generation) {
            return;
        }
        if !controller.complete_hover_open(generation) {
            return;
        }
        if let Err(error) = show_details(&app, generation, source, false) {
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
pub fn hover_nowly_panel(app: AppHandle) -> Result<(), crate::error::CommandError> {
    hover_panel(app, PanelSource::Nowly)
}

#[tauri::command]
pub fn close_status_island_details(app: AppHandle) -> Result<(), crate::error::CommandError> {
    close_details_for_navigation(&app).map_err(crate::error::CommandError::system)
}

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
    let (width, _) = top_surface_size(controller.are_details_open(), scale);
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
    let (width, _) = top_surface_size(false, scale);
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
    use super::{
        centered_x, handle_positions, load_offset_x, resolve_target_monitor, screen_top, surface_x,
        top_surface_size, DragAnchor, PanelController, PanelSource, WorkArea,
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

        assert_eq!(handle["width"], 288);
        assert_eq!(handle["height"], 40);
    }

    #[test]
    fn top_surfaces_ignore_a_top_taskbar_work_area_inset() {
        assert_eq!(screen_top(0, 48), 0);
        assert_eq!(screen_top(-900, -852), -900);
    }

    #[test]
    fn the_rail_only_changes_height_and_scales_with_dpi() {
        // Collapsed: the 240 capsule, an 8px gap and the 40px Nowly dot.
        assert_eq!(top_surface_size(false, 1.0), (288, 40));
        // Expanded: the same width, because the sheet *is* the capsule grown and
        // the saved horizontal offset has to keep meaning the same place.
        assert_eq!(top_surface_size(true, 1.0), (288, 288));
        // Every edge lands on a whole device pixel at the scales Windows uses.
        assert_eq!(top_surface_size(false, 1.5), (432, 60));
        assert_eq!(top_surface_size(true, 1.5), (432, 432));
        assert_eq!(top_surface_size(false, 2.0), (576, 80));
        assert_eq!(top_surface_size(true, 2.0), (576, 576));
        assert_eq!(handle_positions(-900, 60, 12).visible_y, -888);
    }

    #[test]
    fn opening_the_other_half_swaps_the_sheet_instead_of_closing_it() {
        let controller = PanelController::default();

        let island = controller.toggle_details(PanelSource::Island);
        assert_eq!(island.source, Some(PanelSource::Island));

        // One sheet, two sources: the Nowly dot takes it over rather than
        // opening a second surface next to it.
        let nowly = controller.toggle_details(PanelSource::Nowly);
        assert_eq!(nowly.source, Some(PanelSource::Nowly));
        assert!(controller.are_details_open());

        // The same half again closes it.
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
        assert_eq!(controller.drag_to(40.0), Some(PhysicalPosition::new(856, 8)));
        assert_eq!(controller.offset_x(), 40.0);
        assert_eq!(controller.drag_to(-15.0), Some(PhysicalPosition::new(801, 8)));
        assert_eq!(controller.offset_x(), -15.0);

        assert!(controller.end_drag());
        // A move after the drag ended cannot walk the surface.
        assert_eq!(controller.drag_to(500.0), None);
        assert_eq!(controller.offset_x(), -15.0);
        assert!(!controller.end_drag());

        // A second drag starts from where the first left it.
        assert!(controller.begin_drag(anchor()));
        assert_eq!(controller.drag_to(10.0), Some(PhysicalPosition::new(811, 8)));
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
        assert_eq!(controller.toggle_details(PanelSource::Nowly).source, None);

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

        let second = controller.reserve_hover_open(PanelSource::Nowly).unwrap();
        assert!(controller.complete_hover_open(second));
        assert_eq!(controller.details_source(), Some(PanelSource::Nowly));
        // An already open sheet does not reserve another hover open.
        assert!(controller.reserve_hover_open(PanelSource::Island).is_none());
    }

    #[test]
    fn a_disabled_controller_opens_nothing() {
        let controller = PanelController::default();
        controller.set_enabled(false);

        assert_eq!(controller.toggle_details(PanelSource::Island).source, None);
        assert_eq!(controller.toggle_details(PanelSource::Nowly).source, None);
        assert!(controller.reserve_hover_open(PanelSource::Island).is_none());
        assert!(!controller.are_details_open());
    }

    #[test]
    fn a_disconnected_target_monitor_falls_back_to_primary_without_overwriting_the_saved_id() {
        let ids = vec!["primary".to_owned(), "side".to_owned()];

        assert_eq!(resolve_target_monitor(Some("side"), &ids, Some(0)), Some(1));

        // The side monitor is unplugged: fall back atomically to primary.
        let remaining = vec!["primary".to_owned()];
        assert_eq!(
            resolve_target_monitor(Some("side"), &remaining, Some(0)),
            Some(0)
        );

        // The saved id is untouched, so re-plugging restores the user's choice
        // rather than pinning them to primary.
        assert_eq!(resolve_target_monitor(Some("side"), &ids, Some(0)), Some(1));

        let controller = PanelController::default();
        controller.set_target_monitor_id(Some("side".to_owned()));
        assert_eq!(controller.target_monitor_id().as_deref(), Some("side"));
    }

    #[test]
    fn monitor_resolution_degrades_when_no_primary_is_reported() {
        let ids = vec!["only".to_owned()];

        assert_eq!(resolve_target_monitor(None, &ids, None), Some(0));
        assert_eq!(resolve_target_monitor(Some("missing"), &ids, None), Some(0));
        assert_eq!(resolve_target_monitor(None, &[], None), None);
    }
}
