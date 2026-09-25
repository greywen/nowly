use crate::db::AppDb;
use crate::error::CommandError;
use crate::models::AppSettings;
use crate::settings::{read_app_settings, write_app_settings};
use rusqlite::Connection;
use tauri::{Manager, State};
use tauri_plugin_autostart::ManagerExt;

#[derive(Debug, PartialEq, Eq)]
enum StatusIslandVisibilityChange {
    Show,
}

fn normalize_status_island_settings(mut settings: AppSettings) -> AppSettings {
    settings.quick_panel_enabled = true;
    settings
}

fn status_island_visibility_change(
    previous_mode: &str,
    next_mode: &str,
    quick_panel_enabled: bool,
) -> Option<StatusIslandVisibilityChange> {
    if !quick_panel_enabled || previous_mode == next_mode {
        return None;
    }
    match next_mode {
        "persistent" => Some(StatusIslandVisibilityChange::Show),
        // The WebView owns the unseen queue. It will keep an existing unseen
        // reminder visible or hide an empty surface after the invalidated
        // snapshot arrives; native must not guess and swallow a reminder.
        "notification" => None,
        _ => None,
    }
}

fn with_connection<T>(
    db: State<'_, AppDb>,
    operation: impl FnOnce(&Connection) -> rusqlite::Result<T>,
) -> Result<T, CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    operation(&connection).map_err(CommandError::database)
}

#[tauri::command]
pub fn get_app_settings(db: State<'_, AppDb>) -> Result<AppSettings, CommandError> {
    with_connection(db, read_app_settings).map(normalize_status_island_settings)
}

#[tauri::command]
pub fn update_app_settings(
    app: tauri::AppHandle,
    db: State<'_, AppDb>,
    settings: AppSettings,
) -> Result<AppSettings, CommandError> {
    let settings = normalize_status_island_settings(settings);
    crate::settings::validate(&settings).map_err(|error| match error {
        rusqlite::Error::InvalidParameterName(field) => {
            CommandError::validation(&field, "设置值无效。")
        }
        other => CommandError::database(other),
    })?;
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    let previous_settings = normalize_status_island_settings(
        read_app_settings(&connection).map_err(CommandError::database)?,
    );
    let previous_launch_at_login = previous_settings.launch_at_login;
    // The AI quick panel and its global shortcut are removed for now, so
    // `quickPanelShortcut` is still persisted but never registered.
    // `quickPanelEnabled` keeps gating the screen-level top surfaces.
    let quick_panel_enabled_changed =
        settings.quick_panel_enabled != previous_settings.quick_panel_enabled;
    if quick_panel_enabled_changed {
        if settings.quick_panel_enabled {
            app.state::<crate::quick_panel::PanelController>()
                .set_target_monitor_id(settings.target_monitor_id.clone());
        }
        crate::quick_panel::set_enabled(
            &app,
            settings.quick_panel_enabled,
            &settings.notification_mode,
        )
        .map_err(CommandError::system)?;
    }
    if settings.launch_at_login != previous_launch_at_login {
        let autostart_result = if settings.launch_at_login {
            app.autolaunch().enable()
        } else {
            app.autolaunch().disable()
        };
        if let Err(error) = autostart_result {
            let _ = crate::quick_panel::set_enabled(
                &app,
                previous_settings.quick_panel_enabled,
                &previous_settings.notification_mode,
            );
            return Err(CommandError::system(error));
        }
    }
    let saved = match write_app_settings(&mut connection, &settings) {
        Ok(saved) => saved,
        Err(error) => {
            let _ = crate::quick_panel::set_enabled(
                &app,
                previous_settings.quick_panel_enabled,
                &previous_settings.notification_mode,
            );
            if settings.launch_at_login != previous_launch_at_login {
                let rollback = if previous_launch_at_login {
                    app.autolaunch().enable()
                } else {
                    app.autolaunch().disable()
                };
                if let Err(rollback_error) = rollback {
                    eprintln!("failed to restore autostart setting: {rollback_error}");
                }
            }
            return Err(match error {
                rusqlite::Error::InvalidParameterName(field) => {
                    CommandError::validation(&field, "设置值无效。")
                }
                other => CommandError::database(other),
            });
        }
    };
    if saved.quick_panel_enabled && saved.target_monitor_id != previous_settings.target_monitor_id {
        app.state::<crate::quick_panel::PanelController>()
            .set_target_monitor_id(saved.target_monitor_id.clone());
        crate::quick_panel::request_position_reconcile(app.clone());
    }
    if let Some(visibility) = status_island_visibility_change(
        &previous_settings.notification_mode,
        &saved.notification_mode,
        saved.quick_panel_enabled,
    ) {
        if let Some(window) = app.get_webview_window("quick-panel-handle") {
            match visibility {
                StatusIslandVisibilityChange::Show => {
                    app.state::<crate::quick_panel::PanelController>()
                        .show_serialized(|| window.show())
                        .map_err(CommandError::system)?;
                    crate::quick_panel::request_position_reconcile(app.clone());
                }
            }
        }
    }
    if saved.notification_mode != previous_settings.notification_mode {
        crate::status_island::invalidate(&app)?;
    }
    // The bar's app buttons change its width, so the host window has to be
    // resized and re-clipped before the WebView can render the new lane.
    if app
        .state::<crate::quick_panel::PanelController>()
        .set_bar_button_count(saved.bar_buttons.len())
    {
        crate::quick_panel::request_position_reconcile(app.clone());
    }
    if saved.bar_buttons != previous_settings.bar_buttons {
        crate::status_island::invalidate(&app)?;
    }
    Ok(saved)
}

#[cfg(test)]
mod tests {
    use super::{
        normalize_status_island_settings, status_island_visibility_change,
        StatusIslandVisibilityChange,
    };
    use crate::models::AppSettings;

    fn settings() -> AppSettings {
        AppSettings {
            wallpaper_enabled: false,
            launch_at_login: false,
            target_monitor_id: None,
            density: "balanced".into(),
            week_start: "monday".into(),
            date_format: "localized".into(),
            show_weekends: true,
            icon_style: "duotone".into(),
            hide_topbar_in_wallpaper: true,
            notification_mode: "persistent".into(),
            quick_panel_enabled: false,
            quick_panel_shortcut: "Ctrl+Space".into(),
            bar_buttons: Vec::new(),
            recent_colors: Vec::new(),
        }
    }

    #[test]
    fn saving_settings_always_enables_the_status_island() {
        let normalized = normalize_status_island_settings(settings());

        assert!(normalized.quick_panel_enabled);
    }

    #[test]
    fn notification_mode_changes_update_the_island_immediately() {
        assert_eq!(
            status_island_visibility_change("notification", "persistent", true),
            Some(StatusIslandVisibilityChange::Show)
        );
        assert_eq!(
            status_island_visibility_change("persistent", "notification", true),
            None
        );
    }

    #[test]
    fn unchanged_or_disabled_settings_do_not_update_island_visibility() {
        assert_eq!(
            status_island_visibility_change("persistent", "persistent", true),
            None
        );
        assert_eq!(
            status_island_visibility_change("notification", "persistent", false),
            None
        );
    }
}
