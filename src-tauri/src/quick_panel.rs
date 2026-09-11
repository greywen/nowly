use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, Runtime};

const ANIMATION_DURATION: Duration = Duration::from_millis(200);
const FRAME_DURATION: Duration = Duration::from_millis(16);

#[cfg(target_os = "windows")]
fn animations_enabled() -> bool {
    use windows::core::BOOL;
    use windows::Win32::UI::WindowsAndMessaging::{
        SystemParametersInfoW, SPI_GETCLIENTAREAANIMATION, SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS,
    };

    let mut enabled = BOOL::default();
    unsafe {
        SystemParametersInfoW(
            SPI_GETCLIENTAREAANIMATION,
            0,
            Some((&mut enabled as *mut BOOL).cast()),
            SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
        )
        .is_ok()
            && enabled.as_bool()
    }
}

#[cfg(not(target_os = "windows"))]
fn animations_enabled() -> bool {
    true
}

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

pub fn panel_positions(
    monitor_width: u32,
    monitor_x: i32,
    panel_width: u32,
    panel_height: u32,
) -> PanelPositions {
    PanelPositions {
        x: monitor_x + (monitor_width.saturating_sub(panel_width) / 2) as i32,
        expanded_y: 0,
        collapsed_y: -(panel_height as i32),
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
) -> Result<(PanelPositions, PhysicalPosition<i32>), String> {
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
    );
    let handle_size = handle.outer_size().map_err(|error| error.to_string())?;
    positions.expanded_y += monitor_position.y;
    positions.collapsed_y += monitor_position.y;
    let handle_x =
        monitor_position.x + (monitor_size.width.saturating_sub(handle_size.width) / 2) as i32;
    Ok((
        positions,
        PhysicalPosition::new(handle_x, monitor_position.y),
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
    let (_, handle_position) = window_positions(app)?;
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
        let (positions, _) = window_positions(app)?;
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
        let (positions, handle_position) = match window_positions(&app) {
            Ok(value) => value,
            Err(error) => {
                if transition.phase == PanelPhase::Opening {
                    fail_open(&app, &controller, transition.generation, error);
                } else {
                    controller.reconcile(transition.generation, false);
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
            }
            return;
        };
        let Some(handle) = app.get_webview_window("quick-panel-handle") else {
            controller.reconcile(transition.generation, false);
            return;
        };
        let (start_y, end_y, hide_after) = match transition.phase {
            PanelPhase::Opening => {
                if let Err(error) = handle.set_position(handle_position) {
                    fail_open(&app, &controller, transition.generation, error);
                    return;
                }
                if !handle_visible(transition.phase, false) {
                    if let Err(error) = handle.hide() {
                        fail_open(&app, &controller, transition.generation, error);
                        return;
                    }
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
                (start_y, positions.expanded_y, false)
            }
            PanelPhase::Closing => {
                let start_y = panel
                    .outer_position()
                    .map_or(positions.expanded_y, |position| position.y);
                (start_y, positions.collapsed_y, true)
            }
        };
        if !animations_enabled() {
            if !controller.is_current(transition.generation) {
                return;
            }
            let positioned = panel
                .set_position(PhysicalPosition::new(positions.x, end_y))
                .is_ok();
            let hidden = if hide_after || !positioned {
                panel.hide().is_ok()
            } else {
                false
            };
            controller.reconcile(
                transition.generation,
                if hide_after || !positioned {
                    !hidden
                } else {
                    true
                },
            );
            if hidden && handle_visible(transition.phase, true) {
                restore_handle(&controller, &handle, transition.generation);
            } else if !positioned {
                restore_handle(&controller, &handle, transition.generation);
            }
            return;
        }
        let started = Instant::now();
        loop {
            let progress = (started.elapsed().as_secs_f64() / ANIMATION_DURATION.as_secs_f64())
                .clamp(0.0, 1.0);
            let y = start_y as f64 + (end_y - start_y) as f64 * ease_out(progress);
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
            if progress >= 1.0 {
                break;
            }
            std::thread::sleep(FRAME_DURATION);
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
    use super::{ease_out, handle_visible, panel_positions, PanelController, PanelPhase};

    #[test]
    fn panel_is_centered_and_collapses_above_the_monitor() {
        let positions = panel_positions(1920, 0, 520, 640);

        assert_eq!(positions.x, 700);
        assert_eq!(positions.expanded_y, 0);
        assert_eq!(positions.collapsed_y, -640);
    }

    #[test]
    fn negative_monitor_origins_are_preserved() {
        let positions = panel_positions(1280, -1080, 520, 640);

        assert_eq!(positions.x, -700);
        assert_eq!(positions.expanded_y, 0);
        assert_eq!(positions.collapsed_y, -640);
    }

    #[test]
    fn monitor_origin_is_added_without_a_handle_gap() {
        let mut positions = panel_positions(1920, 0, 520, 640);
        positions.expanded_y += -900;
        positions.collapsed_y += -900;

        assert_eq!(positions.expanded_y, -900);
        assert_eq!(positions.collapsed_y, -1540);
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
}
