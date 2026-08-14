mod color;
mod commands;
mod db;
mod error;
mod events;
mod extensions;
mod focus;
mod kanban;
mod layout;
mod models;
mod module_state;
mod monitors;
mod notes;
mod settings;
mod tasks;
mod wallpaper;
mod window_lifecycle;

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
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main_window(app)))
        .plugin(tauri_plugin_autostart::Builder::new()
            .args(["--background"])
            .build())
        .setup(|app| {
            let app_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            std::fs::create_dir_all(&app_dir).expect("failed to create app data dir");
            let connection = open_database(app_dir.join("nowly.sqlite"))
                .expect("failed to open database");
            app.manage(AppDb(Mutex::new(connection)));
            app.manage(Mutex::new(window_lifecycle::WindowLifecycle::default()));

            #[cfg(target_os = "windows")]
            {
                let handle = app.handle().clone();
                wallpaper::set_desktop_activation_handler(move || {
                    let handle = handle.clone();
                    let _ = handle
                        .clone()
                        .run_on_main_thread(move || show_main_window(&handle));
                });
            }

            let menu = MenuBuilder::new(app)
                .text("open", "打开 Nowly")
                .text("wallpaper", "设为壁纸 / 退出壁纸模式")
                .separator()
                .text("settings", "设置")
                .separator()
                .text("quit", "退出 Nowly")
                .build()?;

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
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "open" => show_main_window(app),
                    "settings" => {
                        show_main_window(app);
                        if let Err(error) = app.emit("open-settings", ()) {
                            eprintln!("failed to request settings: {error}");
                        }
                    }
                    "wallpaper" => {
                        if let Some(window) = app.get_webview_window("main") {
                            #[cfg(target_os = "windows")]
                            if let Err(error) = wallpaper::enter_foreground_webview(&window) {
                                eprintln!("failed to toggle wallpaper from tray: {error}");
                            }
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            if std::env::args().any(|arg| arg == "--background") {
                if let Some(window) = app.get_webview_window("main") {
                    let wallpaper_enabled = app.state::<AppDb>().0.lock().ok()
                        .and_then(|connection| settings::read_app_settings(&connection).ok())
                        .is_some_and(|settings| settings.wallpaper_enabled);
                    #[cfg(target_os = "windows")]
                    if wallpaper_enabled {
                        match wallpaper::enter_wallpaper_webview(&window) {
                            Ok(_) => {
                                if let Ok(mut lifecycle) = app.state::<Mutex<window_lifecycle::WindowLifecycle>>().lock() {
                                    lifecycle.enter_wallpaper();
                                }
                            }
                            Err(error) => {
                                eprintln!("background wallpaper startup failed: {error}");
                                let _ = window.hide();
                            }
                        }
                    } else {
                        let _ = window.hide();
                        if let Ok(mut lifecycle) = app.state::<Mutex<window_lifecycle::WindowLifecycle>>().lock() {
                            lifecycle.hide_to_tray();
                        }
                    }
                }
            }

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
                    let _ = window.emit("request-overlay-cleanup", ());
                    let app = window.app_handle();
                    let wallpaper_enabled = app.state::<AppDb>().0.lock().ok()
                        .and_then(|connection| settings::read_app_settings(&connection).ok())
                        .is_some_and(|settings| settings.wallpaper_enabled);
                    if wallpaper_enabled {
                        if let Some(webview) = app.get_webview_window("main") {
                            if wallpaper::enter_wallpaper_webview(&webview).is_ok() {
                                if let Ok(mut lifecycle) = app.state::<Mutex<window_lifecycle::WindowLifecycle>>().lock() {
                                    lifecycle.enter_wallpaper();
                                }
                                let _ = window.emit("window-mode-changed", window_lifecycle::WindowMode::Wallpaper);
                                return;
                            }
                        }
                        eprintln!("failed to restore wallpaper on close; hiding to tray");
                    }
                    if let Ok(mut lifecycle) = app.state::<Mutex<window_lifecycle::WindowLifecycle>>().lock() {
                        lifecycle.hide_to_tray();
                    }
                    if let Err(error) = window.hide() {
                        eprintln!("failed to hide window to tray: {error}");
                    }
                    let _ = window.emit("window-mode-changed", window_lifecycle::WindowMode::HiddenToTray);
                }
                tauri::WindowEvent::Destroyed => wallpaper::notify_window_destroyed(window),
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            tasks::list_tasks,
            tasks::create_task,
            tasks::update_task,
            tasks::delete_task,
            tasks::set_task_completed,
            notes::list_notes,
            monitors::list_monitors,
            notes::create_note,
            notes::update_note,
            notes::delete_note,
            commands::get_app_settings,
            commands::update_app_settings,
            layout::list_module_layout,
            layout::save_module_layout,
            module_state::get_module_state,
            module_state::set_module_state,
            extensions::list_extensions,
            extensions::install_extension,
            extensions::uninstall_extension,
            focus::create_focus_session,
            focus::list_focus_sessions,
            focus::get_focus_statistics,
            events::list_events_in_range,
            events::create_event,
            events::update_event,
            events::delete_event,
            kanban::get_kanban_snapshot,
            kanban::create_kanban_lane,
            kanban::update_kanban_lane,
            kanban::delete_kanban_lane,
            kanban::reorder_kanban_lanes,
            kanban::create_kanban_card,
            kanban::update_kanban_card,
            kanban::delete_kanban_card,
            kanban::move_kanban_card,
            kanban::create_kanban_priority,
            kanban::update_kanban_priority,
            kanban::delete_kanban_priority,
            kanban::reorder_kanban_priorities,
            kanban::create_kanban_tag,
            kanban::update_kanban_tag,
            kanban::delete_kanban_tag,
            kanban::create_kanban_collaborator,
            kanban::update_kanban_collaborator,
            kanban::delete_kanban_collaborator,
            wallpaper::enter_wallpaper_mode,
            wallpaper::enter_foreground_mode,
            window_lifecycle::get_window_mode
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
