mod commands;
mod db;
mod error;
mod events;
mod models;
mod settings;
mod wallpaper;

use db::{open_database, AppDb};
use std::sync::Mutex;
use tauri::menu::MenuBuilder;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Runtime};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TrayClickKind {
    Single(MouseButtonState),
    Double,
}

fn should_activate_tray(kind: TrayClickKind, button: MouseButton) -> bool {
    button == MouseButton::Left
        && matches!(
            kind,
            TrayClickKind::Single(MouseButtonState::Up) | TrayClickKind::Double
        )
}

fn sync_window_visibility<F>(show: F) -> tauri::Result<()>
where
    F: FnOnce() -> tauri::Result<()>,
{
    show()
}

fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = app.get_webview_window("main") else {
        eprintln!("failed to show main window: window not found");
        return;
    };

    if let Err(error) = wallpaper::enter_foreground_webview(&window) {
        eprintln!("failed to enter foreground mode from tray: {error}");
        return;
    }
    if let Err(error) = sync_window_visibility(|| window.show()) {
        eprintln!("failed to synchronize foreground window visibility: {error}");
        return;
    }
    if let Err(error) = window.set_focus() {
        eprintln!("failed to focus foreground window: {error}");
    }
    if let Err(error) = window.emit("window-mode-changed", "foreground") {
        eprintln!("failed to notify frontend of foreground mode: {error}");
    }
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let app_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            std::fs::create_dir_all(&app_dir).expect("failed to create app data dir");
            let connection = open_database(app_dir.join("nowly.sqlite"))
                .expect("failed to open database");
            app.manage(AppDb(Mutex::new(connection)));

            let menu = MenuBuilder::new(app).text("quit", "退出").build()?;

            let mut tray_builder = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("Nowly")
                .show_menu_on_left_click(false);
            if let Some(icon) = app.default_window_icon().cloned() {
                tray_builder = tray_builder.icon(icon);
            }
            tray_builder
                .on_tray_icon_event(|tray, event| {
                    let (kind, button) = match event {
                        TrayIconEvent::Click {
                            button,
                            button_state,
                            ..
                        } => (TrayClickKind::Single(button_state), button),
                        TrayIconEvent::DoubleClick { button, .. } => {
                            (TrayClickKind::Double, button)
                        }
                        _ => return,
                    };

                    if should_activate_tray(kind, button) {
                        show_main_window(tray.app_handle());
                    }
                })
                .on_menu_event(|app, event| {
                    if event.id().as_ref() == "quit" {
                        app.exit(0);
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            #[cfg(target_os = "windows")]
            match event {
                tauri::WindowEvent::Moved(_)
                | tauri::WindowEvent::ScaleFactorChanged { .. }
                | tauri::WindowEvent::Resized(_) => wallpaper::notify_window_changed(window),
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    if let Err(error) = window.hide() {
                        eprintln!("failed to hide window to tray: {error}");
                    }
                }
                tauri::WindowEvent::Destroyed => wallpaper::notify_window_destroyed(window),
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_events,
            commands::list_tasks,
            commands::list_notes,
            commands::get_app_settings,
            events::list_events_in_range,
            events::create_event,
            events::update_event,
            events::delete_event,
            wallpaper::enter_wallpaper_mode,
            wallpaper::enter_foreground_mode
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Nowly");
}

#[cfg(test)]
mod tests {
    use super::{should_activate_tray, sync_window_visibility, TrayClickKind};
    use tauri::tray::{MouseButton, MouseButtonState};

    #[test]
    fn foreground_restore_resynchronizes_tauri_visibility() {
        let mut show_calls = 0;

        sync_window_visibility(|| {
            show_calls += 1;
            Ok(())
        })
        .expect("visibility synchronization should succeed");

        assert_eq!(show_calls, 1);
    }

    #[test]
    fn left_click_release_activates_main_window() {
        assert!(should_activate_tray(
            TrayClickKind::Single(MouseButtonState::Up),
            MouseButton::Left,
        ));
    }

    #[test]
    fn left_double_click_activates_main_window() {
        assert!(should_activate_tray(
            TrayClickKind::Double,
            MouseButton::Left,
        ));
    }

    #[test]
    fn right_click_does_not_activate_main_window() {
        assert!(!should_activate_tray(
            TrayClickKind::Single(MouseButtonState::Up),
            MouseButton::Right,
        ));
        assert!(!should_activate_tray(
            TrayClickKind::Double,
            MouseButton::Right,
        ));
    }

    #[test]
    fn left_mouse_down_does_not_activate_main_window() {
        assert!(!should_activate_tray(
            TrayClickKind::Single(MouseButtonState::Down),
            MouseButton::Left,
        ));
    }
}
