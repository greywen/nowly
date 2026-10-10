use crate::{db::AppDb, error::CommandError, models::AppSettings};
use serde::Serialize;
use std::{
    collections::HashSet,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

type Action = fn(&AppHandle) -> Result<(), CommandError>;
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BindingStatus {
    shortcut: String,
    registered: bool,
    error: Option<String>,
}
#[derive(Clone, Serialize)]
pub struct ShortcutStatus {
    screenshot: BindingStatus,
    history: BindingStatus,
}

pub(crate) fn normalize(value: &str) -> Result<String, CommandError> {
    let mut modifiers = HashSet::new();
    let mut key = None;
    for part in value.split('+').map(str::trim) {
        let lower = part.to_ascii_lowercase();
        let modifier = match lower.as_str() {
            "ctrl" | "control" => Some("Ctrl"),
            "alt" => Some("Alt"),
            "shift" => Some("Shift"),
            "super" | "meta" => Some("Super"),
            _ => None,
        };
        if let Some(modifier) = modifier {
            if !modifiers.insert(modifier) {
                return Err(CommandError::validation(
                    "screenshotShortcut",
                    "Invalid shortcut",
                ));
            }
        } else {
            let upper = part.to_ascii_uppercase();
            let valid = upper.len() == 1 && upper.bytes().all(|c| c.is_ascii_alphanumeric())
                || upper
                    .strip_prefix('F')
                    .and_then(|n| n.parse::<u8>().ok())
                    .is_some_and(|n| (1..=24).contains(&n));
            if !valid || key.is_some() {
                return Err(CommandError::validation(
                    "screenshotShortcut",
                    "Invalid shortcut",
                ));
            }
            key = Some(upper);
        }
    }
    if modifiers.is_empty() || key.is_none() {
        return Err(CommandError::validation(
            "screenshotShortcut",
            "Invalid shortcut",
        ));
    }
    let mut parts: Vec<String> = ["Ctrl", "Alt", "Shift", "Super"]
        .into_iter()
        .filter(|m| modifiers.contains(m))
        .map(str::to_owned)
        .collect();
    parts.push(key.unwrap());
    let result = parts.join("+");
    result
        .parse::<Shortcut>()
        .map_err(|_| CommandError::validation("screenshotShortcut", "Invalid shortcut"))?;
    Ok(result)
}
fn validate_pair(keys: &[String; 2]) -> Result<[String; 2], CommandError> {
    let a = normalize(&keys[0])?;
    let b = normalize(&keys[1]).map_err(|mut e| {
        e.field = Some("screenshotHistoryShortcut".into());
        e
    })?;
    if a == b {
        return Err(CommandError::validation(
            "screenshotHistoryShortcut",
            "Duplicate shortcut",
        ));
    }
    Ok([a, b])
}
trait Registration {
    fn register(&mut self, key: &str) -> Result<(), String>;
    fn unregister(&mut self, key: &str) -> Result<(), String>;
}
struct Native<'a>(&'a AppHandle);
impl Registration for Native<'_> {
    fn register(&mut self, key: &str) -> Result<(), String> {
        self.0
            .global_shortcut()
            .register(key)
            .map_err(|e| e.to_string())
    }
    fn unregister(&mut self, key: &str) -> Result<(), String> {
        self.0
            .global_shortcut()
            .unregister(key)
            .map_err(|e| e.to_string())
    }
}
struct Registry {
    configured: [String; 2],
    active: HashSet<String>,
    pressed: HashSet<String>,
    errors: [Option<String>; 2],
}
impl Registry {
    fn new(configured: [String; 2]) -> Self {
        Self {
            configured,
            active: HashSet::new(),
            pressed: HashSet::new(),
            errors: [Some("pending".into()), Some("pending".into())],
        }
    }
    fn cleanup(&mut self, native: &mut impl Registration, keys: Vec<String>) {
        for key in keys {
            match native.unregister(&key) {
                Ok(()) => {
                    self.active.remove(&key);
                    self.pressed.remove(&key);
                }
                Err(error) => {
                    eprintln!("shortcut cleanup failed: {error}");
                }
            }
        }
    }
    fn replace(
        &mut self,
        native: &mut impl Registration,
        keys: [String; 2],
        persist: impl FnOnce() -> Result<(), CommandError>,
    ) -> Result<(), CommandError> {
        let keys = validate_pair(&keys)?;
        let mut added = Vec::new();
        for (index, key) in keys.iter().enumerate() {
            if !self.active.contains(key) {
                if let Err(error) = native.register(key) {
                    eprintln!("shortcut registration failed: {error}");
                    self.cleanup(native, added);
                    return Err(CommandError::validation(
                        if index == 0 {
                            "screenshotShortcut"
                        } else {
                            "screenshotHistoryShortcut"
                        },
                        "Global shortcut unavailable",
                    ));
                }
                self.active.insert(key.clone());
                added.push(key.clone());
            }
        }
        if let Err(error) = persist() {
            self.cleanup(native, added);
            return Err(error);
        }
        self.configured = keys;
        self.errors = [None, None];
        self.pressed.clear();
        let retired = self
            .active
            .iter()
            .filter(|key| !self.configured.contains(key))
            .cloned()
            .collect();
        self.cleanup(native, retired);
        Ok(())
    }
    fn action(&mut self, key: &str, pressed: bool) -> Option<usize> {
        if !pressed {
            self.pressed.remove(key);
            return None;
        }
        if !self.active.contains(key) || !self.pressed.insert(key.into()) {
            return None;
        }
        self.configured.iter().position(|s| s == key)
    }
    fn status(&self) -> ShortcutStatus {
        let binding = |index: usize| BindingStatus {
            shortcut: self.configured[index].clone(),
            registered: self.active.contains(&self.configured[index]),
            error: self.errors[index].clone(),
        };
        ShortcutStatus {
            screenshot: binding(0),
            history: binding(1),
        }
    }
}
struct Controller {
    registry: Mutex<Registry>,
    actions: [Action; 2],
    recording: AtomicBool,
}

pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, shortcut, event| {
            let Some(controller) = app.try_state::<Controller>() else {
                return;
            };
            let action = controller
                .registry
                .try_lock()
                .ok()
                .and_then(|mut registry| {
                    let key = registry
                        .active
                        .iter()
                        .find(|key| {
                            key.parse::<Shortcut>()
                                .is_ok_and(|s| s.id() == shortcut.id())
                        })
                        .cloned()?;
                    registry.action(&key, event.state() == ShortcutState::Pressed)
                });
            if controller.recording.load(Ordering::Acquire) {
                return;
            }
            if let Some(index) = action {
                let callback = controller.actions[index];
                let app = app.clone();
                tauri::async_runtime::spawn_blocking(move || {
                    if let Err(error) = callback(&app) {
                        eprintln!("shortcut action failed: {}", error.code);
                    }
                });
            }
        })
        .build()
}

pub fn setup(app: &AppHandle, capture: Action, history: Action) {
    let keys = app
        .state::<AppDb>()
        .0
        .lock()
        .ok()
        .and_then(|db| crate::settings::read_app_settings(&db).ok())
        .map(|s| [s.screenshot_shortcut, s.screenshot_history_shortcut])
        .unwrap_or_else(|| {
            [
                crate::models::default_screenshot_shortcut(),
                crate::models::default_screenshot_history_shortcut(),
            ]
        });
    app.manage(Controller {
        registry: Mutex::new(Registry::new(keys)),
        actions: [capture, history],
        recording: AtomicBool::new(false),
    });
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let controller = app.state::<Controller>();
        let Ok(mut registry) = controller.registry.lock() else {
            return;
        };
        let normalized = match validate_pair(&registry.configured) {
            Ok(keys) => keys,
            Err(error) => {
                registry.errors = [Some(error.code.clone()), Some(error.code)];
                return;
            }
        };
        registry.configured = normalized;
        for index in 0..2 {
            let key = registry.configured[index].clone();
            match normalize(&key).and_then(|key| {
                Native(&app)
                    .register(&key)
                    .map_err(|_| CommandError::conflict("unavailable"))?;
                registry.configured[index] = key.clone();
                registry.active.insert(key);
                Ok(())
            }) {
                Ok(()) => registry.errors[index] = None,
                Err(error) => registry.errors[index] = Some(error.code),
            }
        }
    });
}

pub(crate) fn save_with_registration<T>(
    app: &AppHandle,
    settings: &AppSettings,
    persist: impl FnOnce() -> Result<T, CommandError>,
) -> Result<T, CommandError> {
    let controller = app
        .try_state::<Controller>()
        .ok_or_else(|| CommandError::conflict("Global shortcuts are not initialized"))?;
    let mut registry = controller.registry.lock().map_err(CommandError::system)?;
    let mut saved = None;
    registry.replace(
        &mut Native(app),
        [
            settings.screenshot_shortcut.clone(),
            settings.screenshot_history_shortcut.clone(),
        ],
        || {
            saved = Some(persist()?);
            Ok(())
        },
    )?;
    Ok(saved.unwrap())
}

#[tauri::command]
pub fn screenshot_shortcut_recording(
    app: AppHandle,
    window: tauri::WebviewWindow,
    recording: bool,
) -> Result<(), CommandError> {
    if !matches!(window.label(), "main" | "quick-panel") {
        return Err(CommandError::validation(
            "window",
            "Shortcut recording is restricted to settings windows",
        ));
    }
    let controller = app
        .try_state::<Controller>()
        .ok_or_else(|| CommandError::conflict("Global shortcuts are not initialized"))?;
    controller.recording.store(recording, Ordering::Release);
    Ok(())
}

#[tauri::command]
pub async fn screenshot_shortcut_status(app: AppHandle) -> Result<ShortcutStatus, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        let controller = app
            .try_state::<Controller>()
            .ok_or_else(|| CommandError::conflict("Global shortcuts are not initialized"))?;
        let registry = controller.registry.lock().map_err(CommandError::system)?;
        Ok(registry.status())
    })
    .await
    .map_err(CommandError::system)?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;
    #[derive(Default)]
    struct Fake {
        keys: HashSet<String>,
        fail: Option<String>,
    }
    impl Registration for Fake {
        fn register(&mut self, key: &str) -> Result<(), String> {
            if self.fail.as_deref() == Some(key) {
                return Err("occupied".into());
            }
            self.keys.insert(key.into());
            Ok(())
        }
        fn unregister(&mut self, key: &str) -> Result<(), String> {
            self.keys.remove(key);
            Ok(())
        }
    }
    fn pair(a: &str, b: &str) -> [String; 2] {
        [a.into(), b.into()]
    }
    #[test]
    fn validates_and_normalizes_combinations() {
        assert_eq!(normalize("alt+control+a").unwrap(), "Ctrl+Alt+A");
        for key in [
            "A",
            "Ctrl",
            "Ctrl+Alt",
            "Ctrl+Ctrl+A",
            "Ctrl+Space",
            "Ctrl+A+B",
        ] {
            assert!(normalize(key).is_err(), "{key}");
        }
        assert!(validate_pair(&pair("Ctrl+A", "control+a")).is_err());
    }
    #[test]
    fn swapping_existing_keys_never_unregisters_them() {
        let old = pair("Ctrl+Alt+A", "Ctrl+Alt+H");
        let mut native = Fake::default();
        native.keys.extend(old.clone());
        let mut registry = Registry::new(old.clone());
        registry.active.extend(old.clone());
        registry
            .replace(&mut native, pair(&old[1], &old[0]), || Ok(()))
            .unwrap();
        assert_eq!(registry.configured, pair(&old[1], &old[0]));
        assert_eq!(native.keys.len(), 2);
    }
    #[test]
    fn conflict_preserves_original_keys_and_never_persists() {
        let old = pair("Ctrl+A", "Ctrl+H");
        let mut native = Fake::default();
        native.keys.extend(old.clone());
        native.fail = Some("Ctrl+J".into());
        let mut registry = Registry::new(old.clone());
        registry.active.extend(old.clone());
        let mut persisted = false;
        assert!(registry
            .replace(&mut native, pair("Ctrl+K", "Ctrl+J"), || {
                persisted = true;
                Ok(())
            })
            .is_err());
        assert!(!persisted);
        assert_eq!(registry.configured, old);
        assert_eq!(native.keys, old.into_iter().collect());
    }
    #[test]
    fn database_failure_rolls_back_native_registration() {
        let old = pair("Ctrl+A", "Ctrl+H");
        let mut native = Fake::default();
        native.keys.extend(old.clone());
        let mut registry = Registry::new(old.clone());
        registry.active.extend(old.clone());
        assert!(registry
            .replace(&mut native, pair("Ctrl+K", "Ctrl+J"), || Err(
                CommandError::database("failed")
            ))
            .is_err());
        assert_eq!(registry.configured, old);
        assert_eq!(native.keys, old.into_iter().collect());
    }
    #[test]
    fn startup_status_does_not_claim_unregistered_bindings_work() {
        let registry = Registry::new(pair("Ctrl+A", "Ctrl+H"));
        assert!(!registry.status().screenshot.registered);
        assert!(registry.status().screenshot.error.is_some());
        assert!(!registry.status().history.registered);
    }
    #[test]
    fn pressed_only_fires_once_until_release() {
        let mut registry = Registry::new(pair("Ctrl+A", "Ctrl+H"));
        registry.active.insert("Ctrl+A".into());
        assert_eq!(registry.action("Ctrl+A", true), Some(0));
        assert_eq!(registry.action("Ctrl+A", true), None);
        assert_eq!(registry.action("Ctrl+A", false), None);
        assert_eq!(registry.action("Ctrl+A", true), Some(0));
    }
}
