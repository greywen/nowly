// Prevents an extra console window on Windows in release builds. DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod assistant;
mod attachments;
mod calendar_api;
mod color;
mod commands;
mod db;
mod dev_modules;
mod error;
mod event_exceptions;
mod events;
mod extensions;
mod feedback;
mod focus;
mod focus_timer;
mod ics_parser;
mod layout;
mod models;
mod module_state;
mod monitors;
mod net;
mod notes;
mod oauth;
mod oauth_config;
mod quick_panel;
mod recurrence;
mod reminders;
mod remote_events;
mod rrule_bridge;
mod rrule_engine;
mod settings;
mod shell;
mod status_island;
mod subscription_sync;
mod subscriptions;
mod task_workspace;
mod timezone;
mod token_store;
mod update;
mod wallpaper;
mod window_lifecycle;
mod write_scope;

use db::{open_database, AppDb};
use std::sync::Mutex;
use tauri::menu::MenuBuilder;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Runtime};

// The AI quick panel, its `Ctrl+Space` global shortcut and the AI mutual
// exclusion logic are intentionally not registered in this version. Only the
// screen-level Home Indicator, status island and category details panel ship.
// `quick-panel-handle` is kept purely as a compatibility window label.

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

/// The AppUserModelID (AUMID) used for Windows toast notifications. It must
/// match the notification identifier the plugin uses, which is the app's
/// bundle identifier from tauri.conf.json (`com.nowly.app`).
#[cfg(target_os = "windows")]
const APP_USER_MODEL_ID: &str = "com.nowly.app";

/// Registers the app's AUMID with Windows so toast notifications are delivered
/// and attributed to Nowly.
///
/// On Windows the notification plugin sets the toast's AppUserModelID to the
/// bundle identifier in installed builds. Windows silently drops a toast whose
/// AUMID is not registered, which is why the installed app shows no
/// notification at all. Registering a DisplayName under
/// HKCU\Software\Classes\AppUserModelId\{AUMID} makes the AUMID valid and gives
/// the toast the correct "Nowly" attribution. Calling
/// SetCurrentProcessExplicitAppUserModelID keeps the running process aligned
/// with that identity regardless of how it was launched (installed shortcut,
/// autostart, etc.).
#[cfg(target_os = "windows")]
fn set_app_user_model_id() {
    use windows::core::{w, PCWSTR};
    use windows::Win32::Foundation::ERROR_SUCCESS;
    use windows::Win32::System::Registry::{
        RegCloseKey, RegCreateKeyExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_WRITE,
        REG_OPTION_NON_VOLATILE, REG_SZ,
    };
    use windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID;

    let subkey: Vec<u16> = format!("Software\\Classes\\AppUserModelId\\{APP_USER_MODEL_ID}")
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();

    let mut key = HKEY::default();
    let status = unsafe {
        RegCreateKeyExW(
            HKEY_CURRENT_USER,
            PCWSTR(subkey.as_ptr()),
            Some(0),
            PCWSTR::null(),
            REG_OPTION_NON_VOLATILE,
            KEY_WRITE,
            None,
            &mut key,
            None,
        )
    };
    if status == ERROR_SUCCESS {
        let display_name: Vec<u16> = "Nowly".encode_utf16().chain(std::iter::once(0)).collect();
        let display_bytes = unsafe {
            std::slice::from_raw_parts(
                display_name.as_ptr() as *const u8,
                display_name.len() * std::mem::size_of::<u16>(),
            )
        };
        let status =
            unsafe { RegSetValueExW(key, w!("DisplayName"), Some(0), REG_SZ, Some(display_bytes)) };
        if status != ERROR_SUCCESS {
            eprintln!("failed to set AppUserModelId DisplayName: {status:?}");
        }
        unsafe {
            let _ = RegCloseKey(key);
        }
    } else {
        eprintln!("failed to open AppUserModelId registry key: {status:?}");
    }

    if let Err(error) = unsafe { SetCurrentProcessExplicitAppUserModelID(w!("com.nowly.app")) } {
        eprintln!("failed to set AppUserModelID: {error}");
    }
}

/// Sends the focus completion toast.
///
/// On Windows we build the toast directly with `tauri-winrt-notification` and
/// pass our registered AUMID as the app_id. This bypasses the notification
/// plugin, which refuses to set an app_id when the executable runs from a
/// `target\debug` or `target\release` directory and therefore lets the toast
/// fall back to the PowerShell AUMID ("Windows PowerShell"). Because the AUMID
/// is registered in `set_app_user_model_id`, the toast is delivered and
/// attributed to Nowly across dev, release, and installed builds.
#[cfg(target_os = "windows")]
fn send_native_notification<R: Runtime>(
    _app: &AppHandle<R>,
    title: &str,
    body: &str,
    reminder: bool,
) -> Result<(), String> {
    send_windows_notification(title, body, reminder)
}

#[cfg(target_os = "windows")]
fn send_windows_notification(title: &str, body: &str, reminder: bool) -> Result<(), String> {
    use tauri_winrt_notification::{Duration, Scenario, Sound, Toast};
    use windows::core::HSTRING;
    use windows::UI::Notifications::{NotificationSetting, ToastNotificationManager};

    let notifier =
        ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(APP_USER_MODEL_ID))
            .map_err(|error| format!("cannot create Windows toast notifier: {error}"))?;
    let setting = notifier
        .Setting()
        .map_err(|error| format!("cannot read Windows notification setting: {error}"))?;
    if setting != NotificationSetting::Enabled {
        return Err(format!(
            "Windows notifications are disabled for Nowly (setting={})",
            setting.0
        ));
    }

    let mut toast = Toast::new(APP_USER_MODEL_ID).title(title).text1(body);
    if reminder {
        toast = toast
            .scenario(Scenario::Reminder)
            .duration(Duration::Long)
            .sound(Some(Sound::Reminder))
            .add_button("关闭", "dismiss");
    }
    toast
        .show()
        .map_err(|error| format!("Windows rejected the notification: {error}"))
}

#[cfg(not(target_os = "windows"))]
fn send_native_notification<R: Runtime>(
    app: &AppHandle<R>,
    title: &str,
    body: &str,
    _reminder: bool,
) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;

    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|error| format!("failed to send notification: {error}"))
}

fn main() {
    #[cfg(target_os = "windows")]
    set_app_user_model_id();

    tauri::Builder::default()
        .manage(assistant::commands::Requests::default())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app)
        }))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .args(["--background"])
                .build(),
        )
        .setup(|app| {
            let app_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            std::fs::create_dir_all(&app_dir).expect("failed to create app data dir");
            // Ensure the dev-modules draft directory exists so the workbench
            // has a stable, discoverable place to read drafts from.
            std::fs::create_dir_all(app_dir.join("dev-modules"))
                .expect("failed to create dev-modules dir");
            let connection =
                open_database(app_dir.join("nowly.sqlite")).expect("failed to open database");
            // Reclaim attachment files that no rich text content references any
            // more. Startup is the one safe moment: no editor can be open, so an
            // uploaded-but-unsaved attachment cannot be collected out from under
            // the user. A failure here must never block launch.
            if let Err(error) = attachments::collect_garbage(
                &connection,
                &attachments::attachments_dir(&app_dir),
            ) {
                eprintln!("attachment garbage collection failed: {}", error.message);
            }
            app.manage(AppDb(Mutex::new(connection)));
            status_island::initialize(app.handle().clone());
            let quick_settings = settings::read_app_settings(&app.state::<AppDb>().0.lock().unwrap()).unwrap_or_else(|_| crate::models::AppSettings {
                wallpaper_enabled: false, launch_at_login: false, target_monitor_id: None, density: "balanced".into(),
                week_start: "monday".into(), date_format: "localized".into(), show_weekends: true, icon_style: "duotone".into(),
                hide_topbar_in_wallpaper: true, notification_display: crate::models::default_notification_display(), quick_panel_enabled: true, quick_panel_shortcut: "Ctrl+Space".into(), recent_colors: vec![]
            });
            let quick_panel_controller = quick_panel::PanelController::default();
            quick_panel_controller.set_enabled(quick_settings.quick_panel_enabled);
            quick_panel_controller.set_target_monitor_id(quick_settings.target_monitor_id.clone());
            // Where the user last dragged the top surface along the top edge.
            // Restored before the window is first placed, so it never appears
            // centred and then jumps.
            quick_panel_controller.set_offset_x(quick_panel::load_offset_x(
                &app.state::<AppDb>().0.lock().unwrap(),
            ));
            app.manage(quick_panel_controller);
            quick_panel::start_monitor_watch(app.handle().clone());
            if quick_settings.quick_panel_enabled {
                // A top-surface creation or positioning failure must not stop the
                // main app from starting; it is logged and the app continues.
                if let Err(error) = quick_panel::initialize(&app.handle()) {
                    eprintln!("failed to initialize the status island top surface: {error}");
                }
            }
            // Reminder acknowledgement is wall-clock local time, so a restart,
            // tray restore or sleep/wake recomputes from the current local day.
            // Corrupt storage degrades to an empty store instead of blocking the
            // top surface.
            let today = chrono::Local::now().format("%Y-%m-%d").to_string();
            app.manage(Mutex::new(status_island::load_reminders(
                &status_island::reminder_store_path(&app_dir),
                &today,
            )));
            app.manage(Mutex::new(window_lifecycle::WindowLifecycle::default()));
            app.manage(Mutex::new(focus_timer::FocusTimerCoordinator::default()));
            let timer_handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_millis(250));
                let completed = timer_handle
                    .state::<focus_timer::ManagedFocusTimer>()
                    .lock()
                    .ok()
                    .and_then(|mut timer| timer.poll(std::time::Instant::now()));
                if let Some(snapshot) = completed {
                    if let Err(error) = send_native_notification(
                        &timer_handle,
                        &snapshot.notification_title,
                        &snapshot.notification_body,
                        false,
                    ) {
                        eprintln!("failed to send focus notification: {error}");
                    }
                    if let Err(error) = timer_handle.emit("focus-session-completed", snapshot) {
                        eprintln!("failed to emit focus completion: {error}");
                    }
                }
            });

            // 日程提醒轮询：每 20 秒展开近期日程，把到点且未派发过的提醒发成系统通知。
            let reminder_handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(20));
                let now = chrono::Local::now().naive_local();
                let notifications = match reminder_handle.state::<AppDb>().0.lock() {
                    Ok(connection) => match reminders::poll_due(&connection, now) {
                        Ok(notifications) => notifications,
                        Err(error) => {
                            eprintln!("failed to poll calendar reminders: {error:?}");
                            Vec::new()
                        }
                    },
                    Err(error) => {
                        eprintln!("failed to lock calendar database for reminders: {error}");
                        Vec::new()
                    }
                };
                for notification in notifications {
                    if let Err(error) = send_native_notification(
                        &reminder_handle,
                        &notification.title,
                        &notification.body,
                        true,
                    ) {
                        eprintln!("failed to send calendar reminder: {error}");
                        match reminder_handle.state::<AppDb>().0.lock() {
                            Ok(connection) => {
                                if let Err(release_error) =
                                    reminders::release_dispatch(&connection, &notification)
                                {
                                    eprintln!(
                                        "failed to release calendar reminder for retry: {release_error:?}"
                                    );
                                }
                            }
                            Err(lock_error) => eprintln!(
                                "failed to lock calendar database to release reminder: {lock_error}"
                            ),
                        }
                    }
                }
            });

            // 订阅刷新：启动即全刷一次，之后每 60 秒检查各源是否到期（按各自间隔）。
            // 网络拉取在数据库锁外执行（见 subscription_sync 阶段锁），不会拖垮其它操作。
            let subscription_handle = app.handle().clone();
            std::thread::spawn(move || {
                // 启动即刷一次全部源。
                let _ =
                    subscription_sync::sync_all_db(subscription_handle.state::<AppDb>().inner());
                // 无论是否有源，都发一次使前端加载现有订阅与实例。
                let _ = subscription_handle.emit("calendar-subscriptions-updated", ());
                let _ = status_island::invalidate_registered();
                loop {
                    std::thread::sleep(std::time::Duration::from_secs(60));
                    // 只有实际尝试了至少一个到期源才通知前端，
                    // 没有到期源时不发事件，避免每分钟无谓重拉。
                    let changed = subscription_sync::sync_due_db(
                        subscription_handle.state::<AppDb>().inner(),
                    )
                    .unwrap_or(false);
                    if changed {
                        let _ = subscription_handle.emit("calendar-subscriptions-updated", ());
                        let _ = status_island::invalidate_registered();
                    }
                }
            });

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
                    "quit" => {
                        if let Ok(mut timer) = app.state::<focus_timer::ManagedFocusTimer>().lock()
                        {
                            timer.cancel();
                        }
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            if std::env::args().any(|arg| arg == "--background") {
                if let Some(window) = app.get_webview_window("main") {
                    let wallpaper_enabled = app
                        .state::<AppDb>()
                        .0
                        .lock()
                        .ok()
                        .and_then(|connection| settings::read_app_settings(&connection).ok())
                        .is_some_and(|settings| settings.wallpaper_enabled);
                    #[cfg(target_os = "windows")]
                    if wallpaper_enabled {
                        match wallpaper::enter_wallpaper_webview(&window) {
                            Ok(_) => {
                                if let Ok(mut lifecycle) = app
                                    .state::<Mutex<window_lifecycle::WindowLifecycle>>()
                                    .lock()
                                {
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
                        if let Ok(mut lifecycle) = app
                            .state::<Mutex<window_lifecycle::WindowLifecycle>>()
                            .lock()
                        {
                            lifecycle.hide_to_tray();
                        }
                    }
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "quick-panel-handle" {
                if matches!(
                    event,
                    tauri::WindowEvent::ScaleFactorChanged { .. }
                        | tauri::WindowEvent::Resized(_)
                ) {
                    quick_panel::request_position_reconcile(window.app_handle().clone());
                } else if matches!(event, tauri::WindowEvent::Focused(false)) {
                    // The rail only holds focus while its sheet is open, so a
                    // focus loss means the user went elsewhere and the sheet
                    // has to collapse. Collapsed, there is nothing to close.
                    let app = window.app_handle();
                    if app
                        .state::<quick_panel::PanelController>()
                        .are_details_open()
                    {
                        if let Err(error) = quick_panel::close_details_for_navigation(app) {
                            eprintln!("failed to close status island details after focus loss: {error}");
                        }
                    }
                }
                return;
            }
            #[cfg(target_os = "windows")]
            match event {
                tauri::WindowEvent::Moved(_)
                | tauri::WindowEvent::ScaleFactorChanged { .. }
                | tauri::WindowEvent::Resized(_) => wallpaper::notify_window_changed(window),
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let _ = window.emit("request-overlay-cleanup", ());
                    let app = window.app_handle();
                    let wallpaper_enabled = app
                        .state::<AppDb>()
                        .0
                        .lock()
                        .ok()
                        .and_then(|connection| settings::read_app_settings(&connection).ok())
                        .is_some_and(|settings| settings.wallpaper_enabled);
                    if wallpaper_enabled {
                        if let Some(webview) = app.get_webview_window("main") {
                            if wallpaper::enter_wallpaper_webview(&webview).is_ok() {
                                if let Ok(mut lifecycle) = app
                                    .state::<Mutex<window_lifecycle::WindowLifecycle>>()
                                    .lock()
                                {
                                    lifecycle.enter_wallpaper();
                                }
                                let _ = window.emit(
                                    "window-mode-changed",
                                    window_lifecycle::WindowMode::Wallpaper,
                                );
                                return;
                            }
                        }
                        eprintln!("failed to restore wallpaper on close; hiding to tray");
                    }
                    if let Ok(mut lifecycle) = app
                        .state::<Mutex<window_lifecycle::WindowLifecycle>>()
                        .lock()
                    {
                        lifecycle.hide_to_tray();
                    }
                    if let Err(error) = window.hide() {
                        eprintln!("failed to hide window to tray: {error}");
                    }
                    let _ = window.emit(
                        "window-mode-changed",
                        window_lifecycle::WindowMode::HiddenToTray,
                    );
                }
                tauri::WindowEvent::Destroyed => wallpaper::notify_window_destroyed(window),
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            assistant::commands::assistant_get_config,
            assistant::commands::assistant_save_config,
            assistant::commands::assistant_interpret,
            assistant::commands::assistant_cancel_request,
            assistant::commands::assistant_revise,
            assistant::commands::assistant_cancel_plan,
            assistant::commands::assistant_execute,
            assistant::commands::assistant_undo,
            assistant::commands::assistant_history,
            assistant::commands::assistant_status,
            task_workspace::get_task_workspace_snapshot,
            task_workspace::create_task,
            task_workspace::update_task,
            task_workspace::delete_task,
            task_workspace::set_task_completed,
            task_workspace::move_task_to_lane,
            task_workspace::move_task_to_priority,
            task_workspace::move_task_to_date,
            task_workspace::set_task_view_memberships,
            task_workspace::set_task_view_linking,
            task_workspace::create_task_lane,
            task_workspace::update_task_lane,
            task_workspace::delete_task_lane,
            task_workspace::reorder_task_lanes,
            task_workspace::set_default_task_lane,
            task_workspace::set_completion_task_lane,
            task_workspace::create_task_tag,
            task_workspace::update_task_tag,
            task_workspace::archive_task_tag,
            task_workspace::delete_task_tag,
            task_workspace::create_task_collaborator,
            task_workspace::update_task_collaborator,
            task_workspace::archive_task_collaborator,
            task_workspace::delete_task_collaborator,
            task_workspace::set_task_view_preferences,
            notes::list_notes,
            monitors::list_monitors,
            notes::create_note,
            notes::update_note,
            notes::delete_note,
            attachments::save_attachment,
            attachments::read_attachment,
            attachments::list_attachments,
            attachments::open_attachment,
            attachments::collect_attachment_garbage,
            commands::get_app_settings,
            commands::update_app_settings,
            feedback::open_external,
            update::check_for_update,
            layout::list_module_layout,
            layout::save_module_layout,
            module_state::get_module_state,
            module_state::set_module_state,
            dev_modules::list_dev_modules,
            dev_modules::dev_modules_dir_path,
            extensions::list_extensions,
            extensions::install_extension,
            extensions::uninstall_extension,
            net::proxy_fetch,
            net::fetch_registry,
            net::download_module,
            net::proxy_fetch,
            net::fetch_registry,
            net::download_module,
            focus::create_focus_session,
            focus::list_focus_sessions,
            focus::get_focus_statistics,
            focus_timer::start_focus_timer,
            focus_timer::pause_focus_timer,
            focus_timer::resume_focus_timer,
            focus_timer::cancel_focus_timer,
            focus_timer::get_pending_focus_completion,
            focus_timer::acknowledge_focus_completion,
            events::list_events_in_range,
            events::create_event,
            events::update_event,
            events::delete_event,
            subscriptions::list_calendar_subscriptions,
            subscriptions::create_calendar_subscription,
            subscriptions::update_calendar_subscription,
            subscriptions::delete_calendar_subscription,
            subscriptions::subscribe_remote_calendar,
            subscriptions::update_subscription_display,
            subscriptions::list_remote_calendars,
            oauth::start_oauth_login,
            oauth::list_oauth_accounts,
            oauth::disconnect_oauth_account,
            subscription_sync::refresh_calendar_subscription,
            subscriptions::list_external_events_in_range,
            remote_events::create_remote_event,
            remote_events::update_remote_event,
            remote_events::delete_remote_event,
            wallpaper::enter_wallpaper_mode,
            wallpaper::enter_foreground_mode,
            quick_panel::toggle_status_island_details,
            quick_panel::toggle_nowly_panel,
            quick_panel::hover_status_island_details,
            quick_panel::close_status_island_details,
            quick_panel::begin_status_island_drag,
            quick_panel::drag_status_island,
            quick_panel::end_status_island_drag,
            status_island::get_status_island_snapshot,
            status_island::acknowledge_status_island_reminder,
            status_island::dismiss_status_island_reminder,
            status_island::consume_status_island_reminder,
            status_island::set_status_island_presence,
            status_island::set_status_island_primary,
            status_island::open_status_island_event,
            status_island::open_status_island_task,
            status_island::start_status_island_focus,
            status_island::pause_status_island_focus,
            status_island::resume_status_island_focus,
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
