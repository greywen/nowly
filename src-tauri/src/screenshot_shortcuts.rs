//! Global shortcuts: the two screenshot bindings and the three optional
//! quick-create bindings share one registry so they can never collide.
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
pub(crate) const SLOT_COUNT: usize = 5;
pub(crate) type Keys = [String; SLOT_COUNT];
const FIELDS: [&str; SLOT_COUNT] = [
    "screenshotShortcut",
    "screenshotHistoryShortcut",
    "quickCreateEventShortcut",
    "quickCreateTaskShortcut",
    "quickCreateNoteShortcut",
];
/// Screenshot bindings always exist; quick-create bindings are unset by default.
const REQUIRED: [bool; SLOT_COUNT] = [true, true, false, false, false];

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BindingStatus {
    shortcut: String,
    registered: bool,
    error: Option<String>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutStatus {
    screenshot: BindingStatus,
    history: BindingStatus,
    create_event: BindingStatus,
    create_task: BindingStatus,
    create_note: BindingStatus,
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
pub(crate) fn configured_keys(settings: &AppSettings) -> Keys {
    [
        settings.screenshot_shortcut.clone(),
        settings.screenshot_history_shortcut.clone(),
        settings.quick_create_event_shortcut.clone(),
        settings.quick_create_task_shortcut.clone(),
        settings.quick_create_note_shortcut.clone(),
    ]
}
pub(crate) fn store_keys(settings: &mut AppSettings, keys: Keys) {
    let [screenshot, history, event, task, note] = keys;
    settings.screenshot_shortcut = screenshot;
    settings.screenshot_history_shortcut = history;
    settings.quick_create_event_shortcut = event;
    settings.quick_create_task_shortcut = task;
    settings.quick_create_note_shortcut = note;
}
fn is_unset(index: usize, key: &str) -> bool {
    !REQUIRED[index] && key.trim().is_empty()
}
/// Normalizes every binding; unset optional bindings stay empty. The error
/// names the field of the first invalid or repeated binding.
pub(crate) fn validate_keys(keys: &Keys) -> Result<Keys, CommandError> {
    let mut normalized = Keys::default();
    for (index, key) in keys.iter().enumerate() {
        if is_unset(index, key) {
            continue;
        }
        let value = normalize(key).map_err(|mut error| {
            error.field = Some(FIELDS[index].into());
            error
        })?;
        if normalized[..index].contains(&value) {
            return Err(CommandError::validation(FIELDS[index], "Duplicate shortcut"));
        }
        normalized[index] = value;
    }
    Ok(normalized)
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
    configured: Keys,
    active: HashSet<String>,
    pressed: HashSet<String>,
    errors: [Option<String>; SLOT_COUNT],
}
impl Registry {
    fn new(configured: Keys) -> Self {
        let errors = std::array::from_fn(|index| {
            (!is_unset(index, &configured[index])).then(|| "pending".to_owned())
        });
        Self {
            configured,
            active: HashSet::new(),
            pressed: HashSet::new(),
            errors,
        }
    }
    /// Registers each saved binding on its own so one invalid or occupied key
    /// never disables the others.
    fn register_startup(&mut self, native: &mut impl Registration) {
        for index in 0..SLOT_COUNT {
            let raw = self.configured[index].clone();
            if is_unset(index, &raw) {
                self.configured[index].clear();
                self.errors[index] = None;
                continue;
            }
            let result = normalize(&raw).and_then(|key| {
                if self.configured[..index].contains(&key) {
                    return Err(CommandError::validation(FIELDS[index], "Duplicate shortcut"));
                }
                native
                    .register(&key)
                    .map_err(|_| CommandError::conflict("unavailable"))?;
                self.active.insert(key.clone());
                self.configured[index] = key;
                Ok(())
            });
            self.errors[index] = result.err().map(|error| error.code);
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
        keys: Keys,
        persist: impl FnOnce() -> Result<(), CommandError>,
    ) -> Result<(), CommandError> {
        let keys = validate_keys(&keys)?;
        let mut added = Vec::new();
        for (index, key) in keys.iter().enumerate() {
            if key.is_empty() || self.active.contains(key) {
                continue;
            }
            if let Err(error) = native.register(key) {
                eprintln!("shortcut registration failed: {error}");
                self.cleanup(native, added);
                return Err(CommandError::validation(
                    FIELDS[index],
                    "Global shortcut unavailable",
                ));
            }
            self.active.insert(key.clone());
            added.push(key.clone());
        }
        if let Err(error) = persist() {
            self.cleanup(native, added);
            return Err(error);
        }
        self.configured = keys;
        self.errors = Default::default();
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
        let binding = |index: usize| {
            let shortcut = self.configured[index].clone();
            let error = self.errors[index].clone();
            BindingStatus {
                registered: error.is_none() && !shortcut.is_empty() && self.active.contains(&shortcut),
                error,
                shortcut,
            }
        };
        ShortcutStatus {
            screenshot: binding(0),
            history: binding(1),
            create_event: binding(2),
            create_task: binding(3),
            create_note: binding(4),
        }
    }
}
struct Controller {
    registry: Mutex<Registry>,
    actions: [Action; SLOT_COUNT],
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

/// `actions` follow the slot order: screenshot, history, then quick-create
/// event, task and note.
pub fn setup(app: &AppHandle, actions: [Action; SLOT_COUNT]) {
    let keys = app
        .state::<AppDb>()
        .0
        .lock()
        .ok()
        .and_then(|db| crate::settings::read_app_settings(&db).ok())
        .map(|settings| configured_keys(&settings))
        .unwrap_or_else(|| {
            [
                crate::models::default_screenshot_shortcut(),
                crate::models::default_screenshot_history_shortcut(),
                String::new(),
                String::new(),
                String::new(),
            ]
        });
    app.manage(Controller {
        registry: Mutex::new(Registry::new(keys)),
        actions,
        recording: AtomicBool::new(false),
    });
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let controller = app.state::<Controller>();
        let Ok(mut registry) = controller.registry.lock() else {
            return;
        };
        registry.register_startup(&mut Native(&app));
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
    registry.replace(&mut Native(app), configured_keys(settings), || {
        saved = Some(persist()?);
        Ok(())
    })?;
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
    fn keys(values: [&str; SLOT_COUNT]) -> Keys {
        values.map(str::to_owned)
    }
    fn pair(a: &str, b: &str) -> Keys {
        keys([a, b, "", "", ""])
    }
    fn registered(keys: &Keys) -> HashSet<String> {
        keys.iter().filter(|key| !key.is_empty()).cloned().collect()
    }
    fn active_registry(old: &Keys, native: &mut Fake) -> Registry {
        native.keys.extend(registered(old));
        let mut registry = Registry::new(old.clone());
        registry.active.extend(registered(old));
        registry
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
        assert!(validate_keys(&pair("Ctrl+A", "control+a")).is_err());
    }
    #[test]
    fn quick_create_slots_are_optional_and_errors_name_their_field() {
        assert_eq!(
            validate_keys(&keys(["ctrl+alt+a", "Ctrl+Alt+H", " ", "alt+ctrl+t", ""])).unwrap(),
            keys(["Ctrl+Alt+A", "Ctrl+Alt+H", "", "Ctrl+Alt+T", ""])
        );
        for (values, field) in [
            (["", "Ctrl+Alt+H", "", "", ""], "screenshotShortcut"),
            (["Ctrl+Alt+A", "", "", "", ""], "screenshotHistoryShortcut"),
            (["Ctrl+Alt+A", "Ctrl+Alt+H", "Ctrl", "", ""], "quickCreateEventShortcut"),
            (["Ctrl+Alt+A", "Ctrl+Alt+H", "Ctrl+Alt+A", "", ""], "quickCreateEventShortcut"),
            (["Ctrl+Alt+A", "Ctrl+Alt+H", "", "Ctrl+Alt+H", ""], "quickCreateTaskShortcut"),
            (["Ctrl+Alt+A", "Ctrl+Alt+H", "", "Ctrl+Alt+N", "control+alt+n"], "quickCreateNoteShortcut"),
        ] {
            let error = validate_keys(&keys(values)).unwrap_err();
            assert_eq!(error.field.as_deref(), Some(field), "{values:?}");
        }
    }
    #[test]
    fn configured_keys_round_trip_through_settings() {
        let mut settings = crate::models::AppSettings {
            quick_create_task_shortcut: "Ctrl+Alt+T".into(),
            ..serde_json::from_value::<crate::models::AppSettings>(serde_json::json!({
                "wallpaperEnabled": true, "launchAtLogin": true, "targetMonitorId": null,
                "density": "compact", "weekStart": "monday", "dateFormat": "localized",
                "showWeekends": true, "barMenu": []
            }))
            .unwrap()
        };
        assert_eq!(
            configured_keys(&settings),
            keys(["Ctrl+Alt+A", "Ctrl+Alt+H", "", "Ctrl+Alt+T", ""])
        );
        store_keys(&mut settings, keys(["Ctrl+A", "Ctrl+H", "Ctrl+E", "", "Ctrl+N"]));
        assert_eq!(settings.screenshot_shortcut, "Ctrl+A");
        assert_eq!(settings.quick_create_event_shortcut, "Ctrl+E");
        assert_eq!(settings.quick_create_task_shortcut, "");
        assert_eq!(settings.quick_create_note_shortcut, "Ctrl+N");
    }
    #[test]
    fn swapping_existing_keys_never_unregisters_them() {
        let old = pair("Ctrl+Alt+A", "Ctrl+Alt+H");
        let mut native = Fake::default();
        let mut registry = active_registry(&old, &mut native);
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
        let mut registry = active_registry(&old, &mut native);
        native.fail = Some("Ctrl+J".into());
        let mut persisted = false;
        assert!(registry
            .replace(&mut native, pair("Ctrl+K", "Ctrl+J"), || {
                persisted = true;
                Ok(())
            })
            .is_err());
        assert!(!persisted);
        assert_eq!(registry.configured, old);
        assert_eq!(native.keys, registered(&old));
    }
    #[test]
    fn database_failure_rolls_back_native_registration() {
        let old = pair("Ctrl+A", "Ctrl+H");
        let mut native = Fake::default();
        let mut registry = active_registry(&old, &mut native);
        assert!(registry
            .replace(&mut native, pair("Ctrl+K", "Ctrl+J"), || Err(
                CommandError::database("failed")
            ))
            .is_err());
        assert_eq!(registry.configured, old);
        assert_eq!(native.keys, registered(&old));
    }
    #[test]
    fn unset_quick_create_slots_are_never_registered() {
        let old = pair("Ctrl+A", "Ctrl+H");
        let mut native = Fake::default();
        let mut registry = active_registry(&old, &mut native);
        let next = keys(["Ctrl+A", "Ctrl+H", "Ctrl+E", "", ""]);
        registry.replace(&mut native, next.clone(), || Ok(())).unwrap();
        assert_eq!(native.keys, registered(&next));
        let status = registry.status();
        assert!(status.create_event.registered);
        assert_eq!(status.create_task.shortcut, "");
        assert!(!status.create_task.registered);
        assert!(status.create_task.error.is_none());

        registry.replace(&mut native, old.clone(), || Ok(())).unwrap();
        assert_eq!(native.keys, registered(&old));
        assert!(!registry.status().create_event.registered);
    }
    #[test]
    fn quick_create_registration_failure_names_its_field_and_rolls_back() {
        let old = pair("Ctrl+A", "Ctrl+H");
        let mut native = Fake::default();
        let mut registry = active_registry(&old, &mut native);
        native.fail = Some("Ctrl+T".into());
        let error = registry
            .replace(&mut native, keys(["Ctrl+A", "Ctrl+H", "Ctrl+E", "Ctrl+T", ""]), || Ok(()))
            .unwrap_err();
        assert_eq!(error.field.as_deref(), Some("quickCreateTaskShortcut"));
        assert_eq!(registry.configured, old);
        assert_eq!(native.keys, registered(&old));
    }
    #[test]
    fn startup_registers_each_slot_independently() {
        let mut native = Fake::default();
        native.fail = Some("Ctrl+Alt+E".into());
        let mut registry = Registry::new(keys([
            "ctrl+alt+a", "Ctrl+Alt+H", "Ctrl+Alt+E", "Ctrl+Alt+H", "Ctrl+Alt+N",
        ]));
        registry.register_startup(&mut native);
        assert_eq!(native.keys, registered(&keys(["Ctrl+Alt+A", "Ctrl+Alt+H", "", "", "Ctrl+Alt+N"])));
        let status = registry.status();
        assert!(status.screenshot.registered && status.screenshot.error.is_none());
        assert!(status.history.registered);
        assert!(!status.create_event.registered && status.create_event.error.is_some());
        assert!(!status.create_task.registered && status.create_task.error.is_some());
        assert!(status.create_note.registered && status.create_note.error.is_none());
    }
    #[test]
    fn startup_status_does_not_claim_unregistered_bindings_work() {
        let registry = Registry::new(pair("Ctrl+A", "Ctrl+H"));
        assert!(!registry.status().screenshot.registered);
        assert!(registry.status().screenshot.error.is_some());
        assert!(!registry.status().history.registered);
        assert!(!registry.status().create_note.registered);
        assert!(registry.status().create_note.error.is_none());
    }
    #[test]
    fn pressed_only_fires_once_until_release() {
        let mut registry = Registry::new(keys(["Ctrl+A", "Ctrl+H", "", "", "Ctrl+N"]));
        registry.active.insert("Ctrl+A".into());
        registry.active.insert("Ctrl+N".into());
        assert_eq!(registry.action("Ctrl+A", true), Some(0));
        assert_eq!(registry.action("Ctrl+A", true), None);
        assert_eq!(registry.action("Ctrl+A", false), None);
        assert_eq!(registry.action("Ctrl+A", true), Some(0));
        assert_eq!(registry.action("Ctrl+N", true), Some(4));
    }
}