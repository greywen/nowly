use crate::db::AppDb;
use crate::error::CommandError;
use crate::models::AppSettings;
use crate::settings::{read_app_settings, write_app_settings};
use rusqlite::Connection;
use std::str::FromStr;
use tauri::State;
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_global_shortcut::GlobalShortcutExt;
use tauri_plugin_global_shortcut::Shortcut;

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
    let requested_shortcut = if settings.quick_panel_enabled {
        Some(
            Shortcut::from_str(&settings.quick_panel_shortcut)
                .map_err(|_| CommandError::validation("quickPanelShortcut", "快捷键格式无效。"))?,
        )
    } else {
        None
    };
    let shortcut_changed = settings.quick_panel_enabled
        && (!previous_settings.quick_panel_enabled
            || settings.quick_panel_shortcut != previous_settings.quick_panel_shortcut);
    let previous_launch_at_login = previous_settings.launch_at_login;
    if shortcut_changed {
        crate::register_quick_shortcut(&app, &settings.quick_panel_shortcut)
            .map_err(CommandError::system)?;
    }
    let quick_panel_enabled_changed =
        settings.quick_panel_enabled != previous_settings.quick_panel_enabled;
    if quick_panel_enabled_changed {
        if let Err(error) = crate::quick_panel::set_enabled(&app, settings.quick_panel_enabled) {
            if shortcut_changed {
                if let Some(shortcut) = requested_shortcut {
                    let _ = app.global_shortcut().unregister(shortcut);
                }
            }
            return Err(CommandError::system(error));
        }
    }
    if settings.launch_at_login != previous_launch_at_login {
        let autostart_result = if settings.launch_at_login {
            app.autolaunch().enable()
        } else {
            app.autolaunch().disable()
        };
        if let Err(error) = autostart_result {
            let _ = crate::quick_panel::set_enabled(&app, previous_settings.quick_panel_enabled);
            if shortcut_changed {
                if let Some(shortcut) = requested_shortcut {
                    let _ = app.global_shortcut().unregister(shortcut);
                }
            }
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
            if shortcut_changed {
                if let Some(shortcut) = requested_shortcut {
                    let _ = app.global_shortcut().unregister(shortcut);
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
    if previous_settings.quick_panel_enabled
        && (!settings.quick_panel_enabled
            || settings.quick_panel_shortcut != previous_settings.quick_panel_shortcut)
    {
        if let Ok(previous) = Shortcut::from_str(&previous_settings.quick_panel_shortcut) {
            if let Err(error) = app.global_shortcut().unregister(previous) {
                let _ = write_app_settings(&mut connection, &previous_settings);
                let _ =
                    crate::quick_panel::set_enabled(&app, previous_settings.quick_panel_enabled);
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
                if shortcut_changed {
                    if let Some(shortcut) = requested_shortcut {
                        let _ = app.global_shortcut().unregister(shortcut);
                    }
                }
                return Err(CommandError::system(error));
            }
        }
    }
    Ok(saved)
}
