// Prevents an extra console window on Windows in release builds. DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod assistant;
mod attachments;
mod autostart;
mod package;
mod package_policy;
mod calendar_api;
mod categories;
mod color;
mod commands;
mod db;
mod error;
mod event_exceptions;
mod events;
mod feedback;
mod focus;
mod focus_timer;
mod ics_parser;
mod layout;
mod models;
mod monitors;
mod native_language;
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
mod screen_capture;
mod screenshot_shortcuts;
mod screenshot_windows;
mod screenshot_pins;
mod settings;
mod shell;
mod sound_settings;
mod sounds;
mod status_island;
mod stickers;
mod subscription_sync;
mod subscriptions;
mod task_workspace;
mod time;
mod timezone;
mod token_store;
mod update;
mod wallpaper;
mod window_lifecycle;
mod write_scope;

use db::{open_database, AppDb};
use std::sync::Mutex;
use tauri::menu::{MenuBuilder, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Runtime};

struct NativeTrayMenu(MenuItem<tauri::Wry>);

#[tauri::command]
fn set_native_language(
    window: tauri::WebviewWindow,
    menu: tauri::State<'_, NativeTrayMenu>,
    language: String,
) -> Result<(), error::CommandError> {
    if window.label() != "main" {
        return Err(error::CommandError::system(
            "Only the main window can change the native menu language",
        ));
    }
    // Tauri dispatches set_text onto the native UI thread. Keep the same item
    // and id so localization never rebuilds the tray or changes its behavior.
    menu.0
        .set_text(native_language::quit_label(&language))
        .map_err(error::CommandError::system)
}

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

fn should_prevent_close(window_label: &str) -> bool {
    window_label == "quick-panel-handle"
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

/// Keeps unpackaged taskbar grouping consistent with the app's bundle identity.
#[cfg(target_os = "windows")]
fn set_app_user_model_id() {
    match package::aumid() {
        Ok(Some(_)) => return,
        Ok(None) => {},
        Err(error) => { eprintln!("{error}"); return; }
    }
    use windows::core::w;
    use windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID;

    if let Err(error) = unsafe { SetCurrentProcessExplicitAppUserModelID(w!("com.nowly.app")) } {
        eprintln!("failed to set AppUserModelID: {error}");
    }
}

fn main() {
    #[cfg(target_os = "windows")]
    set_app_user_model_id();

    tauri::Builder::default()
        .plugin(native_language::plugin())
        .manage(assistant::commands::Requests::default())
        .manage(screen_capture::ActiveCapture::default())
        .manage(screen_capture::FrameStore::default())
        .manage(screen_capture::scroll::ScrollCapture::default())
        .manage(screen_capture::FreezeLayer::default())
        .manage(screen_capture::OverlayStaging::default())
        .manage(screen_capture::PreviewStore::default())
        .manage(screenshot_windows::ScreenshotWindows::default())
        .manage(screenshot_pins::ScreenshotPins::default())
        .register_asynchronous_uri_scheme_protocol(
            screen_capture::FRAME_URI_SCHEME,
            |context, request, responder| {
                let app = context.app_handle().clone();
                let caller_label = context.webview_label().to_owned();
                std::thread::spawn(move || {
                    responder.respond(screen_capture::serve_frame(&app, &caller_label, request));
                });
            },
        )
        .register_asynchronous_uri_scheme_protocol(
            "screenshot-history",
            |context, request, responder| {
                screen_capture::history::protocol::respond(
                    context.app_handle().clone(),
                    context.webview_label().to_owned(),
                    request,
                    responder,
                );
            },
        )
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if !package_policy::background_launch(args.iter().map(String::as_str)) { show_main_window(app) }
        }))
        .plugin(screenshot_shortcuts::plugin())
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
            if let Err(error) = status_island::remove_legacy_reminder_store(&app_dir) {
                eprintln!("failed to delete the legacy status island reminder store: {error}");
            }
            // Ensure the dev-modules draft directory exists so the workbench
            // has a stable, discoverable place to read drafts from.
            std::fs::create_dir_all(app_dir.join("dev-modules"))
                .expect("failed to create dev-modules dir");
            let mut connection =
                open_database(app_dir.join("nowly.sqlite")).expect("failed to open database");
            if let Err(error) = stickers::collect_startup_garbage(
                &mut connection,
                &stickers::stickers_dir(&app_dir),
            ) {
                eprintln!("sticker startup garbage collection failed: {}", error.message);
            }
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
            if let Err(error) = screen_capture::history::setup(app.handle()) {
                eprintln!("screenshot history recovery failed: {}", error.message);
            }
            status_island::initialize(app.handle().clone());
            let quick_settings = settings::read_app_settings(&app.state::<AppDb>().0.lock().unwrap()).unwrap_or_else(|_| crate::models::AppSettings {
                wallpaper_enabled: false, launch_at_login: false, target_monitor_id: None, density: "balanced".into(),
                week_start: "monday".into(), date_format: "localized".into(), show_weekends: true, icon_style: "duotone".into(),
                hide_topbar_in_wallpaper: true,
            hide_module_background_in_wallpaper: false, notification_mode: crate::models::default_notification_mode(), sound_settings: Default::default(), quick_panel_enabled: true, quick_panel_shortcut: "Ctrl+Space".into(), screenshot_shortcut: crate::models::default_screenshot_shortcut(), screenshot_history_shortcut: crate::models::default_screenshot_history_shortcut(), bar_menu: crate::models::default_bar_menu(), recent_colors: vec![]
            });
            let quick_panel_controller = quick_panel::PanelController::default();
            quick_panel_controller.set_enabled(true);
            quick_panel_controller.set_target_monitor_id(quick_settings.target_monitor_id.clone());
            // The configured app buttons decide the host width and hit region, so
            // they must be known before the window is first placed.
            // Where the user last dragged the top surface along the top edge.
            // Restored before the window is first placed, so it never appears
            // centred and then jumps.
            quick_panel_controller.set_offset_x(quick_panel::load_offset_x(
                &app.state::<AppDb>().0.lock().unwrap(),
            ));
            app.manage(quick_panel_controller);
            quick_panel::start_outside_click_watch(app.handle().clone());
            quick_panel::start_monitor_watch(app.handle().clone());
            // A top-surface creation or positioning failure must not stop the
            // main app from starting; it is logged and the app continues.
            if let Err(error) =
                quick_panel::initialize(&app.handle(), &quick_settings.notification_mode)
            {
                eprintln!("failed to initialize the status island top surface: {error}");
            }
            // Reminder acknowledgement is wall-clock local time, so a restart,
            // tray restore or sleep/wake recomputes from the current local day.
            // Missing or unreadable database rows degrade to an empty store
            // instead of blocking the top surface.
            let today = chrono::Local::now().format("%Y-%m-%d").to_string();
            let reminder_lifecycle = app
                .state::<AppDb>()
                .0
                .lock()
                .map(|connection| status_island::load_reminders(&connection, &today))
                .unwrap_or_else(|_| status_island::ReminderLifecycle::new(today, Vec::new()));
            app.manage(Mutex::new(reminder_lifecycle));
            app.manage(Mutex::new(window_lifecycle::WindowLifecycle::default()));
            app.manage(Mutex::new(focus_timer::FocusTimerCoordinator::default()));
            if let Err(error) = sounds::start(app.handle()) {
                eprintln!("Failed to start reminder audio: {error}");
            }
            let timer_handle = app.handle().clone();
            std::thread::spawn(move || {
                let mut previous = None;
                loop {
                    std::thread::sleep(std::time::Duration::from_millis(250));
                    let (completed, current) = timer_handle
                        .state::<focus_timer::ManagedFocusTimer>()
                        .lock()
                        .ok()
                        .map(|mut timer| {
                            let now = std::time::Instant::now();
                            let completed = timer.poll(now);
                            (completed, Some(timer.status_snapshot(now)))
                        }).unwrap_or((None, None));
                    if current != previous {
                        if let Some(snapshot) = current.as_ref() {
                            let _ = timer_handle.emit("focus-timer-updated", snapshot);
                        }
                        previous = current;
                    }
                    if let Some(snapshot) = completed {
                        sounds::dispatch(&timer_handle, sound_settings::SoundScene::Focus, snapshot.id.clone());
                        if let Err(error) = timer_handle.emit("focus-session-completed", snapshot) {
                            eprintln!("failed to emit focus completion: {error}");
                        }
                    }
                }
            });

            // Bar 从日程快照展示提醒；每 20 秒只为首次到期的提醒派发音效。
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
                if !notifications.is_empty() {
                    if let Err(error) = status_island::invalidate(&reminder_handle) {
                        eprintln!("failed to refresh Nowly Bar reminders: {error:?}");
                    }
                }
                for notification in notifications {
                    sounds::dispatch(&reminder_handle, sound_settings::SoundScene::Calendar,
                        format!("{}:{}:{}", notification.event_id, notification.occurrence_start_at, notification.offset_minutes));
                }
            });

            // Time alarms surface through Nowly Bar; the native audio worker
            // reads their persisted acknowledgement and snooze state.
            let alarm_handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(1));
                let changed = match alarm_handle.state::<AppDb>().0.lock() {
                    Ok(mut connection) => match time::scheduler::poll(&mut connection, chrono::Utc::now()) {
                        Ok(outcome) => outcome.changed,
                        Err(error) => {
                            eprintln!("failed to poll time alarms: {error:?}");
                            false
                        }
                    },
                    Err(error) => {
                        eprintln!("failed to lock database for time alarms: {error}");
                        false
                    }
                };
                if changed {
                    let _ = status_island::invalidate_registered();
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

            let quit_item = MenuItem::with_id(
                app, "quit", native_language::quit_label("en"), true, None::<&str>,
            )?;
            let menu = MenuBuilder::new(app).item(&quit_item).build()?;
            app.manage(NativeTrayMenu(quit_item));

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
                        if let Ok(mut timer) = app.state::<focus_timer::ManagedFocusTimer>().lock()
                        {
                            timer.cancel();
                        }
                        app.exit(0);
                    }
                })
                .build(app)?;

            if package_policy::background_launch(std::env::args().collect::<Vec<_>>().iter().map(String::as_str)) {
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

            screen_capture::prewarm_after_launch(app.handle());
            screenshot_shortcuts::setup(
                app.handle(),
                |handle| {
                    if screen_capture::is_active(handle) { return Ok(()); }
                    screen_capture::start_screen_capture(handle.clone())
                },
                |handle| {
                    if screen_capture::is_active(handle) { return Ok(()); }
                    screenshot_windows::open_history(handle)
                },
            );
            Ok(())
        })
        .on_window_event(|window, event| {
            // A capture window can also go away by Alt+F4, the taskbar or a
            // front-end crash. Without this the session would stay active and the
            // bar would stay hidden, so Rust ends the session itself.
            if screen_capture::is_capture_window(window.label()) {
                if matches!(event, tauri::WindowEvent::Destroyed) {
                    screen_capture::abandon_session(window.app_handle(), window.label());
                }
                return;
            }
            if window.label().starts_with("screenshot-pin-") {
                return;
            }
            if window.label() == screenshot_windows::HISTORY_LABEL {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
                return;
            }
            if window.label() == "quick-panel-handle" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    if should_prevent_close(window.label()) {
                        api.prevent_close();
                    }
                } else if matches!(
                    event,
                    tauri::WindowEvent::ScaleFactorChanged { .. }
                        | tauri::WindowEvent::Resized(_)
                ) {
                    quick_panel::request_position_reconcile(window.app_handle().clone());
                } else if matches!(event, tauri::WindowEvent::Focused(false)) {
                    // The rail only holds focus while its sheet is open, so a
                    // focus loss means the user went elsewhere and the sheet
                    // has to collapse. Collapsed, there is nothing to close.
                    let app = window.app_handle().clone();
                    std::thread::spawn(move || {
                        if app
                            .state::<quick_panel::PanelController>()
                            .are_details_open()
                        {
                            if let Err(error) = quick_panel::close_details_after_outside_click(&app) {
                                eprintln!("failed to close status island details after focus loss: {error}");
                            }
                        }
                    });
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
        .invoke_handler({
            let handler: Box<dyn Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync> = Box::new(tauri::generate_handler![
            set_native_language,
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
            stickers::get_sticker_board,
            stickers::save_sticker_board,
            stickers::upload_sticker_image,
            stickers::read_sticker_image,
            stickers::discard_sticker_images,
            commands::get_app_settings,
            commands::update_app_settings,
            feedback::open_external,
            update::check_for_update,
            layout::list_module_layout,
            layout::save_module_layout,
            focus::create_focus_session,
            focus::list_focus_sessions,
            focus::get_focus_statistics,
            focus_timer::get_focus_timer_snapshot,
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
            categories::list_categories,
            categories::create_category,
            categories::update_category,
            categories::delete_category,
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
            screenshot_shortcuts::screenshot_shortcut_status,
            screenshot_shortcuts::screenshot_shortcut_recording,
            screen_capture::history::commands::list_screenshot_history,
            screen_capture::history::commands::copy_screenshot_history,
            screen_capture::history::commands::delete_screenshot_history,
            screen_capture::history::commands::open_screenshot_folder,
            quick_panel::toggle_bar_menu,
            screenshot_windows::open_screenshot_history,
            screen_capture::start_screen_capture,
            screen_capture::cancel_screen_capture,
            screen_capture::describe_capture_frame,
            screen_capture::capture_window_ready,
            screen_capture::capture_window_failed,
            screen_capture::stage_capture_overlay,
            screen_capture::pin_capture,
            screenshot_pins::capture_pin_image,
            screenshot_pins::zoom_capture_pin,
            screen_capture::copy_capture_to_clipboard,
            screen_capture::save_capture_to_file,
            screen_capture::scroll::scroll_capture,
            screen_capture::scroll::scroll_capture_image,
            screen_capture::render_mosaic_preview,
            screen_capture::copy_capture_color,
            status_island::get_status_island_snapshot,
            status_island::acknowledge_status_island_reminder,
            status_island::set_status_island_visibility,
            status_island::dismiss_status_island_reminder,
            status_island::consume_status_island_reminder,
            status_island::acknowledge_alarm_notice,
            status_island::snooze_alarm_notice,
            status_island::set_status_island_presence,
            quick_panel::get_status_island_presentation,
            quick_panel::finish_status_island_presentation,
            quick_panel::finish_status_island_details,
            status_island::set_status_island_primary,
            status_island::open_status_island_event,
            status_island::open_status_island_task,
            status_island::start_status_island_focus,
            status_island::pause_status_island_focus,
            status_island::resume_status_island_focus,
            window_lifecycle::get_window_mode,
            time::commands::get_time_settings,
            time::commands::save_time_settings,
            time::commands::list_alarms,
            time::commands::create_alarm,
            time::commands::update_alarm,
            time::commands::delete_alarm
            ]);
            move |invoke| {
                if !screenshot_pins::allows_command(invoke.message.webview().label(), invoke.message.command()) {
                    invoke.resolver.reject("This screenshot surface cannot invoke that command.");
                    return true;
                }
                handler(invoke)
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to run Nowly");
}

#[cfg(test)]
mod tests {
    use super::{
        should_activate_tray, should_prevent_close, sync_window_visibility, TrayClickKind,
    };
    use tauri::tray::{MouseButton, MouseButtonState};

    #[test]
    fn reminders_use_nowly_bar_without_system_notification_access() {
        let source = include_str!("main.rs").split("#[cfg(test)]").next().unwrap();
        assert!(!source.contains("send_native_notification"));
        assert!(!source.contains("ToastNotificationManager"));
        assert!(!source.contains("tauri_plugin_notification"));

        let manifest = include_str!("../Cargo.toml");
        assert!(!manifest.contains("tauri-plugin-notification"));
        assert!(!manifest.contains("tauri-winrt-notification"));
        assert!(!manifest.contains("UI_Notifications"));

        let capability: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/default.json")).unwrap();
        assert!(capability["permissions"].as_array().unwrap().iter().all(|permission| {
            !permission.as_str().is_some_and(|name| name.starts_with("notification:"))
        }));
    }

    #[test]
    fn nowly_bar_close_requests_are_prevented() {
        assert!(should_prevent_close("quick-panel-handle"));
        assert!(!should_prevent_close("main"));
    }

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
