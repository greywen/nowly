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
    if settings.launch_at_login {
        app.autolaunch().enable().map_err(CommandError::system)?;
    } else {
        app.autolaunch().disable().map_err(CommandError::system)?;
    }
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    write_app_settings(&mut connection, &settings).map_err(|error| match error {
        rusqlite::Error::InvalidParameterName(field) => {
            CommandError::validation(&field, "设置值无效。")
        }
        other => CommandError::database(other),
    })
}

