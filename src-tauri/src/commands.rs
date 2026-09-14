use crate::db::AppDb;
use crate::error::CommandError;
use crate::models::AppSettings;
use crate::settings::{read_app_settings, write_app_settings};
use rusqlite::Connection;
use tauri::{Manager, State};
use tauri_plugin_autostart::ManagerExt;

fn with_connection<T>(
    db: State<'_, AppDb>,
    operation: impl FnOnce(&Connection) -> rusqlite::Result<T>,
) -> Result<T, CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    operation(&connection).map_err(CommandError::database)
}

#[tauri::command]
pub fn get_app_settings(db: State<'_, AppDb>) -> Result<AppSettings, CommandError> {
    with_connection(db, read_app_settings)
}

#[tauri::command]
pub fn update_app_settings(
    app: tauri::AppHandle,
    db: State<'_, AppDb>,
    settings: AppSettings,
) -> Result<AppSettings, CommandError> {
    crate::settings::validate(&settings).map_err(|error| match error {
        rusqlite::Error::InvalidParameterName(field) => {
            CommandError::validation(&field, "设置值无效。")
        }
        other => CommandError::database(other),
    })?;
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    let previous_settings = read_app_settings(&connection).map_err(CommandError::database)?;
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
        crate::quick_panel::set_enabled(&app, settings.quick_panel_enabled)
            .map_err(CommandError::system)?;
    }
    if settings.launch_at_login != previous_launch_at_login {
        let autostart_result = if settings.launch_at_login {
            app.autolaunch().enable()
        } else {
            app.autolaunch().disable()
        };
        if let Err(error) = autostart_result {
            let _ = crate::quick_panel::set_enabled(&app, previous_settings.quick_panel_enabled);
            return Err(CommandError::system(error));
        }
    }
    let saved = match write_app_settings(&mut connection, &settings) {
        Ok(saved) => saved,
        Err(error) => {
            let _ = crate::quick_panel::set_enabled(&app, previous_settings.quick_panel_enabled);
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
    Ok(saved)
}
