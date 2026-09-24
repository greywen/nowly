use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WindowMode {
    Foreground,
    Wallpaper,
    HiddenToTray,
}

#[derive(Debug)]
pub struct WindowLifecycle {
    mode: WindowMode,
}

impl Default for WindowLifecycle {
    fn default() -> Self {
        Self {
            mode: WindowMode::Foreground,
        }
    }
}

impl WindowLifecycle {
    pub fn mode(&self) -> WindowMode {
        self.mode
    }
    pub fn enter_foreground(&mut self) {
        self.mode = WindowMode::Foreground;
    }
    pub fn enter_wallpaper(&mut self) {
        self.mode = WindowMode::Wallpaper;
    }
    pub fn hide_to_tray(&mut self) {
        self.mode = WindowMode::HiddenToTray;
    }
}

#[tauri::command]
pub fn get_window_mode(
    lifecycle: tauri::State<'_, std::sync::Mutex<WindowLifecycle>>,
) -> Result<WindowMode, crate::error::CommandError> {
    Ok(lifecycle
        .lock()
        .map_err(crate::error::CommandError::system)?
        .mode())
}

#[cfg(test)]
mod tests {
    use super::{WindowLifecycle, WindowMode};

    #[test]
    fn starts_foreground_and_records_successful_transitions() {
        let mut lifecycle = WindowLifecycle::default();
        assert_eq!(lifecycle.mode(), WindowMode::Foreground);
        lifecycle.enter_wallpaper();
        assert_eq!(lifecycle.mode(), WindowMode::Wallpaper);
        lifecycle.enter_foreground();
        assert_eq!(lifecycle.mode(), WindowMode::Foreground);
    }

    #[test]
    fn mode_serializes_as_stable_camel_case_value() {
        assert_eq!(
            serde_json::to_string(&WindowMode::HiddenToTray).unwrap(),
            "\"hiddenToTray\""
        );
    }
}
