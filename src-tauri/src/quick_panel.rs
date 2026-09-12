use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, Runtime};

const PANEL_ANIMATION_DURATION: Duration = Duration::from_millis(220);
const HANDLE_ANIMATION_DURATION: Duration = Duration::from_millis(120);
const OPEN_PANEL_DELAY: Duration = Duration::from_millis(60);
const CLOSE_HANDLE_DELAY: Duration = Duration::from_millis(100);
const FRAME_DURATION: Duration = Duration::from_millis(16);
const PANEL_TOP_MARGIN: f64 = 16.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PanelPhase {
    Opening,
    Closing,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PanelTransition {
    pub generation: u64,
    pub phase: PanelPhase,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PanelPositions {
    pub x: i32,
    pub expanded_y: i32,
    pub collapsed_y: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HandlePositions {
    pub visible_y: i32,
    pub hidden_y: i32,
}

pub fn panel_positions(
    monitor_width: u32,
    monitor_x: i32,
    panel_width: u32,
    panel_height: u32,
    scale_factor: f64,
) -> PanelPositions {
    PanelPositions {
        x: monitor_x + (monitor_width.saturating_sub(panel_width) / 2) as i32,
        expanded_y: (PANEL_TOP_MARGIN * scale_factor).round() as i32,
        collapsed_y: -(panel_height as i32),
    }
}

pub fn handle_positions(monitor_y: i32, handle_height: u32) -> HandlePositions {
    HandlePositions {
        visible_y: monitor_y,
        hidden_y: monitor_y - handle_height as i32,
    }
}

fn handle_visible(phase: PanelPhase, completed: bool) -> bool {
    phase == PanelPhase::Closing && completed
}

fn ease_out(progress: f64) -> f64 {
    fn bezier(value: f64, first: f64, second: f64) -> f64 {
        let inverse = 1.0 - value;
        3.0 * inverse * inverse * value * first
            + 3.0 * inverse * value * value * second
            + value * value * value
    }

    fn derivative(value: f64, first: f64, second: f64) -> f64 {
        3.0 * (1.0 - value).powi(2) * first
            + 6.0 * (1.0 - value) * value * (second - first)
            + 3.0 * value.powi(2) * (1.0 - second)
    }

    let mut parameter = progress;
    for _ in 0..5 {
        let slope = derivative(parameter, 0.23, 0.32);
        if slope.abs() < f64::EPSILON {
            break;
        }
        parameter =
            (parameter - (bezier(parameter, 0.23, 0.32) - progress) / slope).clamp(0.0, 1.0);
    }
    bezier(parameter, 1.0, 1.0)
}

fn delayed_progress(elapsed: Duration, delay: Duration, duration: Duration) -> f64 {
    elapsed.checked_sub(delay).map_or(0.0, |active| {
        (active.as_secs_f64() / duration.as_secs_f64()).clamp(0.0, 1.0)
    })
}

fn opening_progress(elapsed: Duration) -> (f64, f64) {
    (
        delayed_progress(elapsed, Duration::ZERO, HANDLE_ANIMATION_DURATION),
        delayed_progress(elapsed, OPEN_PANEL_DELAY, PANEL_ANIMATION_DURATION),
    )
}

fn closing_progress(elapsed: Duration) -> (f64, f64) {
    (
        delayed_progress(elapsed, Duration::ZERO, PANEL_ANIMATION_DURATION),
        delayed_progress(elapsed, CLOSE_HANDLE_DELAY, HANDLE_ANIMATION_DURATION),
    )
}

#[derive(Debug)]
pub struct PanelController {
    state: Mutex<PanelState>,
    animation: Mutex<()>,
}

#[derive(Debug)]
struct PanelState {
    generation: u64,
    enabled: bool,
    open: bool,
}

impl Default for PanelController {
    fn default() -> Self {
        Self {
            state: Mutex::new(PanelState {
                generation: 0,
                enabled: true,
                open: false,
            }),
            animation: Mutex::new(()),
        }
    }
}

impl PanelController {
    pub fn is_open(&self) -> bool {
        self.state.lock().unwrap().open
    }

    pub fn is_enabled(&self) -> bool {
        self.state.lock().unwrap().enabled
    }

    pub fn request_open(&self) -> Option<PanelTransition> {
        let mut state = self.state.lock().unwrap();
        if !state.enabled {
            return None;
        }
        state.generation += 1;
        state.open = true;
        Some(PanelTransition {
            generation: state.generation,
            phase: PanelPhase::Opening,
        })
    }

    pub fn request_close(&self) -> PanelTransition {
        let mut state = self.state.lock().unwrap();
        state.generation += 1;
        state.open = false;
        PanelTransition {
            generation: state.generation,
            phase: PanelPhase::Closing,
        }
    }

    pub fn is_current(&self, generation: u64) -> bool {
        self.state.lock().unwrap().generation == generation
    }

    fn may_restore_handle(&self, generation: u64) -> bool {
        let state = self.state.lock().unwrap();
        state.enabled && !state.open && state.generation == generation
    }

    pub fn set_enabled(&self, enabled: bool) -> u64 {
        let mut state = self.state.lock().unwrap();
        state.generation += 1;
        state.enabled = enabled;
        if !enabled {
            state.open = false;
        }
        state.generation
    }

    fn restore(&self, enabled: bool, open: bool) {
        let mut state = self.state.lock().unwrap();
        state.generation += 1;
        state.enabled = enabled;
        state.open = open;
    }

    fn reconcile(&self, generation: u64, open: bool) {
        let mut state = self.state.lock().unwrap();
        if state.generation == generation {
            state.open = open;
        }
    }
}

fn window_positions<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<(PanelPositions, i32, HandlePositions), String> {
    let panel = app
        .get_webview_window("quick-panel")
        .ok_or_else(|| "quick-panel window not found".to_owned())?;
    let handle = app
        .get_webview_window("quick-panel-handle")
        .ok_or_else(|| "quick-panel-handle window not found".to_owned())?;
    let monitor = panel
        .primary_monitor()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "primary monitor not found".to_owned())?;
    let monitor_position = monitor.position();
    let monitor_size = monitor.size();
    let panel_size = panel.outer_size().map_err(|error| error.to_string())?;
    let mut positions = panel_positions(
        monitor_size.width,
        monitor_position.x,
        panel_size.width,
        panel_size.height,
        monitor.scale_factor(),
    );
    let handle_size = handle.outer_size().map_err(|error| error.to_string())?;
    positions.expanded_y += monitor_position.y;
    positions.collapsed_y += monitor_position.y;
    let handle_x =
        monitor_position.x + (monitor_size.width.saturating_sub(handle_size.width) / 2) as i32;
    Ok((
        positions,
        handle_x,
        handle_positions(monitor_position.y, handle_size.height),
    ))
}

fn restore_handle<R: Runtime>(
    controller: &PanelController,
    handle: &tauri::WebviewWindow<R>,
    generation: u64,
) {
    if !controller.may_restore_handle(generation) {
        return;
    }
    let position_result = (|| {
        let monitor = handle
            .primary_monitor()
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "primary monitor not found".to_owned())?;
        let monitor_position = monitor.position();
        let monitor_size = monitor.size();
        let handle_size = handle.outer_size().map_err(|error| error.to_string())?;
        let x =
            monitor_position.x + (monitor_size.width.saturating_sub(handle_size.width) / 2) as i32;
        handle
            .set_position(PhysicalPosition::new(x, monitor_position.y))
            .map_err(|error| error.to_string())
    })();
    if let Err(error) = position_result {
        eprintln!("failed to reposition quick panel handle while restoring: {error}");
    }
    if let Err(error) = handle.show() {
        eprintln!("failed to restore quick panel handle: {error}");
        return;
    }
    if !controller.may_restore_handle(generation) {
        let _ = handle.hide();
    }
}

fn fail_open<R: Runtime>(
    app: &AppHandle<R>,
    controller: &PanelController,
    generation: u64,
    error: impl std::fmt::Display,
) {
    eprintln!("failed to open quick panel: {error}");
    controller.reconcile(generation, false);
    if let Some(handle) = app.get_webview_window("quick-panel-handle") {
        restore_handle(controller, &handle, generation);
    }
}

pub fn initialize<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    reposition_handle(app)?;
    let handle = app
        .get_webview_window("quick-panel-handle")
        .ok_or_else(|| "quick-panel-handle window not found".to_owned())?;
    handle.show().map_err(|error| error.to_string())
}

pub fn reposition_handle<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    if !app.state::<PanelController>().is_enabled() {
        return Ok(());
    }
    let (_, handle_x, handle_positions) = window_positions(app)?;
    let handle_position = PhysicalPosition::new(handle_x, handle_positions.visible_y);
    let handle = app
        .get_webview_window("quick-panel-handle")
        .ok_or_else(|| "quick-panel-handle window not found".to_owned())?;
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
    let _animation = controller.animation.lock().unwrap();
    reposition_handle(app)?;
    if controller.is_open() {
        let (positions, _, _) = window_positions(app)?;
        let panel = app
            .get_webview_window("quick-panel")
            .ok_or_else(|| "quick-panel window not found".to_owned())?;
        let target = PhysicalPosition::new(positions.x, positions.expanded_y);
        if panel.outer_position().map_err(|error| error.to_string())? != target {
            panel
                .set_position(target)
                .map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

pub fn request_position_reconcile<R: Runtime>(app: AppHandle<R>) {
    std::thread::spawn(move || {
        if let Err(error) = reconcile_positions(&app) {
            eprintln!("failed to reposition quick panel windows: {error}");
        }
    });
}

pub fn start_monitor_watch<R: Runtime>(app: AppHandle<R>) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(2));
        if app.state::<PanelController>().is_enabled() {
            if let Err(error) = reconcile_positions(&app) {
                eprintln!("failed to keep quick panel windows positioned: {error}");
            }
        }
    });
}

pub fn set_enabled<R: Runtime>(app: &AppHandle<R>, enabled: bool) -> Result<(), String> {
    let controller = app.state::<PanelController>();
    let previous_enabled = controller.is_enabled();
    let previous_open = controller.is_open();
    if previous_enabled == enabled {
        return Ok(());
    }
    controller.set_enabled(enabled);
    let _animation = controller.animation.lock().unwrap();
    if enabled {
        if let Err(error) = initialize(app) {
            controller.set_enabled(false);
            return Err(error);
        }
        return Ok(());
    }
    let panel = app.get_webview_window("quick-panel");
    let handle = app.get_webview_window("quick-panel-handle");
    let result = (|| {
        if let Some(panel) = &panel {
            panel.hide().map_err(|error| error.to_string())?;
        }
        if let Some(handle) = &handle {
            handle.hide().map_err(|error| error.to_string())?;
        }
        Ok(())
    })();
    if let Err(error) = result {
        controller.restore(previous_enabled, previous_open);
        if previous_open {
            if let Some(panel) = &panel {
                let _ = panel.show();
                let _ = panel.set_focus();
            }
        } else if let Some(handle) = &handle {
            let _ = handle.show();
        }
        return Err(error);
    }
    Ok(())
}

fn animate<R: Runtime>(app: AppHandle<R>, transition: PanelTransition) {
    std::thread::spawn(move || {
        let controller = app.state::<PanelController>();
        let _animation = controller.animation.lock().unwrap();
        if !controller.is_current(transition.generation) {
            return;
        }
        let (positions, handle_x, handle_positions) = match window_positions(&app) {
            Ok(value) => value,
            Err(error) => {
                if transition.phase == PanelPhase::Opening {
                    fail_open(&app, &controller, transition.generation, error);
                } else {
                    eprintln!("failed to prepare quick panel close: {error}");
                    controller.reconcile(transition.generation, false);
                    if let Some(panel) = app.get_webview_window("quick-panel") {
                        let _ = panel.hide();
                    }
                    if let Some(handle) = app.get_webview_window("quick-panel-handle") {
                        restore_handle(&controller, &handle, transition.generation);
                    }
                }
                return;
            }
        };
        let Some(panel) = app.get_webview_window("quick-panel") else {
            if transition.phase == PanelPhase::Opening {
                fail_open(
                    &app,
                    &controller,
                    transition.generation,
                    "quick-panel window not found",
                );
            } else {
                controller.reconcile(transition.generation, false);
                if let Some(handle) = app.get_webview_window("quick-panel-handle") {
                    restore_handle(&controller, &handle, transition.generation);
                }
            }
            return;
        };
        let Some(handle) = app.get_webview_window("quick-panel-handle") else {
            controller.reconcile(transition.generation, false);
            return;
        };
        let (start_y, end_y, handle_start_y, handle_end_y, hide_after) = match transition.phase {
            PanelPhase::Opening => {
                let handle_start_y = handle
                    .outer_position()
                    .map_or(handle_positions.visible_y, |position| position.y);
                if let Err(error) = handle.show() {
                    fail_open(&app, &controller, transition.generation, error);
                    return;
                }
                let visible = panel.is_visible().unwrap_or(false);
                let start_y = if visible {
                    panel
                        .outer_position()
                        .map_or(positions.collapsed_y, |position| position.y)
                } else {
                    if let Err(error) = panel
                        .set_position(PhysicalPosition::new(positions.x, positions.collapsed_y))
                    {
                        eprintln!("failed to position quick panel before opening: {error}");
                        controller.reconcile(transition.generation, false);
                        restore_handle(&controller, &handle, transition.generation);
                        return;
                    }
                    positions.collapsed_y
                };
                if let Err(error) = panel.show() {
                    eprintln!("failed to show quick panel: {error}");
                    controller.reconcile(transition.generation, false);
                    restore_handle(&controller, &handle, transition.generation);
                    return;
                }
                if let Err(error) = panel.set_focus() {
                    eprintln!("failed to focus quick panel: {error}");
                }
                if let Err(error) = panel.emit("quick-panel-open", "ai-assistant") {
                    eprintln!("failed to notify quick panel frontend: {error}");
                }
                (
                    start_y,
                    positions.expanded_y,
                    handle_start_y,
                    handle_positions.hidden_y,
                    false,
                )
            }
            PanelPhase::Closing => {
                let start_y = panel
                    .outer_position()
                    .map_or(positions.expanded_y, |position| position.y);
                let handle_start_y = if handle.is_visible().unwrap_or(false) {
                    handle
                        .outer_position()
                        .map_or(handle_positions.hidden_y, |position| position.y)
                } else {
                    if let Err(error) = handle
                        .set_position(PhysicalPosition::new(handle_x, handle_positions.hidden_y))
                    {
                        eprintln!("failed to position quick panel handle before closing: {error}");
                        let _ = panel.hide();
                        controller.reconcile(transition.generation, false);
                        restore_handle(&controller, &handle, transition.generation);
                        return;
                    }
                    handle_positions.hidden_y
                };
                if let Err(error) = handle.show() {
                    eprintln!("failed to show quick panel handle before closing: {error}");
                    let _ = panel.hide();
                    controller.reconcile(transition.generation, false);
                    restore_handle(&controller, &handle, transition.generation);
                    return;
                }
                (
                    start_y,
                    positions.collapsed_y,
                    handle_start_y,
                    handle_positions.visible_y,
                    true,
                )
            }
        };
        let started = Instant::now();
        loop {
            let elapsed = started.elapsed();
            let (panel_progress, handle_progress) = match transition.phase {
                PanelPhase::Opening => {
                    let (handle, panel) = opening_progress(elapsed);
                    (panel, handle)
                }
                PanelPhase::Closing => closing_progress(elapsed),
            };
            let y = start_y as f64 + (end_y - start_y) as f64 * ease_out(panel_progress);
            let handle_y = handle_start_y as f64
                + (handle_end_y - handle_start_y) as f64 * ease_out(handle_progress);
            if !controller.is_current(transition.generation) {
                return;
            }
            if let Err(error) =
                panel.set_position(PhysicalPosition::new(positions.x, y.round() as i32))
            {
                eprintln!("failed to animate quick panel: {error}");
                let hidden = panel.hide().is_ok();
                controller.reconcile(transition.generation, !hidden);
                if hidden {
                    restore_handle(&controller, &handle, transition.generation);
                }
                return;
            }
            if let Err(error) =
                handle.set_position(PhysicalPosition::new(handle_x, handle_y.round() as i32))
            {
                eprintln!("failed to animate quick panel handle: {error}");
                if transition.phase == PanelPhase::Opening {
                    let _ = handle.hide();
                }
            }
            if panel_progress >= 1.0 && handle_progress >= 1.0 {
                break;
            }
            std::thread::sleep(FRAME_DURATION);
        }
        if !hide_after {
            if let Err(error) = handle.hide() {
                eprintln!("failed to hide quick panel handle after opening: {error}");
            }
        }
        if hide_after {
            if !controller.is_current(transition.generation) {
                return;
            }
            if let Err(error) = panel.hide() {
                eprintln!("failed to hide quick panel after animation: {error}");
                controller.reconcile(transition.generation, true);
            } else if handle_visible(transition.phase, true) {
                restore_handle(&controller, &handle, transition.generation);
            }
        }
    });
}

pub fn open<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let controller = app.state::<PanelController>();
    if controller.is_open() {
        return Ok(());
    }
    if let Some(transition) = controller.request_open() {
        animate(app.clone(), transition);
    }
    Ok(())
}

pub fn close<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let controller = app.state::<PanelController>();
    if !controller.is_open() {
        return Ok(());
    }
    let transition = controller.request_close();
    animate(app.clone(), transition);
    Ok(())
}

pub fn toggle<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    if app.state::<PanelController>().is_open() {
        close(app)
    } else {
        open(app)
    }
}

#[tauri::command]
pub fn open_quick_panel(app: AppHandle) -> Result<(), crate::error::CommandError> {
    open(&app).map_err(crate::error::CommandError::system)
}

#[tauri::command]
pub fn close_quick_panel(app: AppHandle) -> Result<(), crate::error::CommandError> {
    close(&app).map_err(crate::error::CommandError::system)
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::{
        closing_progress, ease_out, handle_positions, handle_visible, opening_progress,
        panel_positions, PanelController, PanelPhase,
    };

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
    fn panel_disables_native_shadow_that_adds_a_windows_border() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let panel = config["app"]["windows"]
            .as_array()
            .unwrap()
            .iter()
            .find(|window| window["label"] == "quick-panel")
            .unwrap();
        assert_eq!(panel["decorations"], false);
        assert_eq!(panel["shadow"], false);
    }

    #[test]
    fn panel_window_is_transparent_behind_the_rounded_surface() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let panel = config["app"]["windows"]
            .as_array()
            .unwrap()
            .iter()
            .find(|window| window["label"] == "quick-panel")
            .unwrap();
        assert_eq!(panel["transparent"], true);
        assert_eq!(panel["backgroundColor"], "#00000000");
    }

    #[test]
    fn panel_is_centered_and_collapses_above_the_monitor() {
        let positions = panel_positions(1920, 0, 520, 640, 1.0);

        assert_eq!(positions.x, 700);
        assert_eq!(positions.expanded_y, 16);
        assert_eq!(positions.collapsed_y, -640);
    }

    #[test]
    fn negative_monitor_origins_are_preserved() {
        let positions = panel_positions(1280, -1080, 520, 640, 1.0);

        assert_eq!(positions.x, -700);
        assert_eq!(positions.expanded_y, 16);
        assert_eq!(positions.collapsed_y, -640);
    }

    #[test]
    fn monitor_origin_is_added_without_a_handle_gap() {
        let mut positions = panel_positions(1920, 0, 520, 640, 1.0);
        positions.expanded_y += -900;
        positions.collapsed_y += -900;

        assert_eq!(positions.expanded_y, -884);
        assert_eq!(positions.collapsed_y, -1540);
    }

    #[test]
    fn indicator_slides_above_the_monitor_when_the_panel_opens() {
        let positions = handle_positions(0, 20);

        assert_eq!(positions.visible_y, 0);
        assert_eq!(positions.hidden_y, -20);
    }

    #[test]
    fn panel_margin_scales_without_rescaling_physical_window_dimensions() {
        for (scale, margin) in [(1.0, 16), (1.25, 20), (1.5, 24), (2.0, 32)] {
            let positions = panel_positions(2560, -2560, 780, 960, scale);
            assert_eq!(positions.expanded_y, margin);
            assert_eq!(positions.x, -1670);
            assert_eq!(positions.collapsed_y, -960);
        }
    }

    #[test]
    fn window_dimensions_match_the_approved_layout() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let windows = config["app"]["windows"].as_array().unwrap();
        let panel = windows.iter().find(|window| window["label"] == "quick-panel").unwrap();
        let handle = windows.iter().find(|window| window["label"] == "quick-panel-handle").unwrap();
        assert_eq!(panel["width"], 520);
        assert_eq!(panel["height"], 640);
        assert_eq!(handle["width"], 64);
        assert_eq!(handle["height"], 20);
    }

    #[test]
    fn handle_is_visible_only_after_the_panel_finishes_closing() {
        assert!(!handle_visible(PanelPhase::Opening, false));
        assert!(!handle_visible(PanelPhase::Opening, true));
        assert!(!handle_visible(PanelPhase::Closing, false));
        assert!(handle_visible(PanelPhase::Closing, true));
    }

    #[test]
    fn stale_close_cannot_restore_the_handle_after_reopening() {
        let controller = PanelController::default();
        controller.request_open().unwrap();
        let closing = controller.request_close();

        assert!(controller.may_restore_handle(closing.generation));

        controller.request_open().unwrap();
        assert!(!controller.may_restore_handle(closing.generation));
    }

    #[test]
    fn repeated_requests_reverse_the_active_transition() {
        let controller = PanelController::default();

        let opening = controller.request_open().unwrap();
        assert_eq!(opening.phase, PanelPhase::Opening);
        assert!(controller.is_open());

        let closing = controller.request_close();
        assert_eq!(closing.phase, PanelPhase::Closing);
        assert!(closing.generation > opening.generation);
        assert!(!controller.is_open());
    }

    #[test]
    fn disabled_controller_rejects_delayed_open_requests() {
        let controller = PanelController::default();

        controller.set_enabled(false);

        assert!(controller.request_open().is_none());
        assert!(!controller.is_open());
    }

    #[test]
    fn entrance_easing_has_stable_endpoints() {
        assert_eq!(ease_out(0.0), 0.0);
        assert_eq!(ease_out(1.0), 1.0);
        assert!(ease_out(0.5) > 0.9);
    }

    #[test]
    fn opening_indicator_leads_the_panel_with_a_short_overlap() {
        let (handle, panel) = opening_progress(Duration::from_millis(30));
        assert!(handle > 0.0);
        assert_eq!(panel, 0.0);

        let (handle, panel) = opening_progress(Duration::from_millis(100));
        assert!(handle > panel);
        assert!(panel > 0.0);
    }

    #[test]
    fn closing_panel_leads_indicator_return() {
        let (panel, handle) = closing_progress(Duration::from_millis(80));
        assert!(panel > 0.0);
        assert_eq!(handle, 0.0);

        let (panel, handle) = closing_progress(Duration::from_millis(240));
        assert_eq!(panel, 1.0);
        assert!(handle > 0.0);
    }
}
