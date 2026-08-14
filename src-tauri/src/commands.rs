use crate::db::AppDb;
use crate::error::CommandError;
use crate::models::AppSettings;
use crate::settings::{read_app_settings, write_app_settings};
use rusqlite::Connection;
use tauri::State;
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
        rusqlite::Error::InvalidParameterName(field) => CommandError::validation(&field, "设置值无效。"),
        other => CommandError::database(other),
    })?;
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    // Only touch the OS autostart registration when the preference actually
    // changes. Toggling it on every save let an autostart-plugin failure (which
    // is common in dev and on some platforms) reject unrelated settings writes
    // — e.g. changing a calendar preference — and roll the value back in the UI.
    let previous_launch_at_login = read_app_settings(&connection)
        .map(|current| current.launch_at_login)
        .unwrap_or(!settings.launch_at_login);
    if settings.launch_at_login != previous_launch_at_login {
        if settings.launch_at_login {
            app.autolaunch().enable().map_err(CommandError::system)?;
        } else {
            app.autolaunch().disable().map_err(CommandError::system)?;
        }
    }
    write_app_settings(&mut connection, &settings).map_err(|error| match error {
        rusqlite::Error::InvalidParameterName(field) => {
            CommandError::validation(&field, "设置值无效。")
        }
        other => CommandError::database(other),
    })
}

