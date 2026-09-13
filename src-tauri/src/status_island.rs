use crate::db::AppDb;
use crate::error::CommandError;
use crate::focus_timer::{FocusStatusSnapshot, ManagedFocusTimer};
use crate::models::{Event, EventRange, EventTarget, ExternalEvent, Task};
use chrono::{Duration, Local, NaiveDateTime};
use serde::Serialize;
use std::sync::OnceLock;
use std::time::Duration as StdDuration;
use std::time::Instant;
use tauri::{AppHandle, Emitter, Manager, State};

const LOCAL_MINUTE_FORMAT: &str = "%Y-%m-%dT%H:%M";
static STATUS_APP: OnceLock<AppHandle> = OnceLock::new();

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusIslandSnapshot {
    pub sampled_at: String,
    pub events: Vec<Event>,
    pub external_events: Vec<ExternalEvent>,
    pub tasks: Vec<Task>,
    pub focus: FocusStatusSnapshot,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusIslandEventNavigation {
    pub target: EventTarget,
    pub start_at: String,
}

fn show_main_window(app: &AppHandle) -> Result<tauri::WebviewWindow, CommandError> {
    crate::quick_panel::close_details_for_navigation(app).map_err(CommandError::system)?;
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| CommandError::system("main window not found"))?;
    crate::wallpaper::enter_foreground_webview(&window).map_err(CommandError::system)?;
    window.show().map_err(CommandError::system)?;
    window.set_focus().map_err(CommandError::system)?;
    window
        .emit("window-mode-changed", "foreground")
        .map_err(CommandError::system)?;
    Ok(window)
}

pub(crate) fn invalidate(app: &AppHandle) -> Result<(), CommandError> {
    app.emit("status-island-invalidated", ())
        .map_err(CommandError::system)
}

pub(crate) fn initialize(app: AppHandle) {
    let _ = STATUS_APP.set(app);
}

pub(crate) fn invalidate_registered() -> Result<(), CommandError> {
    match STATUS_APP.get() {
        Some(app) => invalidate(app),
        None => Ok(()),
    }
}

pub fn snapshot_range(now: NaiveDateTime) -> EventRange {
    let today = now.date().and_hms_opt(0, 0, 0).expect("midnight is valid");
    EventRange {
        start_at: (today - Duration::days(1))
            .format(LOCAL_MINUTE_FORMAT)
            .to_string(),
        end_at_exclusive: (today + Duration::days(1) + Duration::minutes(15))
            .format(LOCAL_MINUTE_FORMAT)
            .to_string(),
    }
}

#[tauri::command]
pub fn get_status_island_snapshot(
    db: State<'_, AppDb>,
    timer: State<'_, ManagedFocusTimer>,
) -> Result<StatusIslandSnapshot, CommandError> {
    let now = Local::now().naive_local();
    let range = snapshot_range(now);
    let connection = db.0.lock().map_err(CommandError::database)?;
    let events = crate::events::list_overlapping(&connection, &range)?;
    let external_events = crate::subscriptions::list_external_in_range(&connection, &range)?;
    let tasks = crate::task_workspace::snapshot(&connection)?.tasks;
    drop(connection);
    let focus = timer
        .lock()
        .map_err(CommandError::system)?
        .status_snapshot(Instant::now());
    Ok(StatusIslandSnapshot {
        sampled_at: Local::now().to_rfc3339(),
        events,
        external_events,
        tasks,
        focus,
    })
}

#[tauri::command]
pub fn open_status_island_event(
    app: AppHandle,
    target: EventTarget,
    start_at: String,
) -> Result<(), CommandError> {
    show_main_window(&app)?
        .emit(
            "status-island-open-event",
            StatusIslandEventNavigation { target, start_at },
        )
        .map_err(CommandError::system)
}

#[tauri::command]
pub fn open_status_island_task(app: AppHandle, id: String) -> Result<(), CommandError> {
    show_main_window(&app)?
        .emit("status-island-open-task", id)
        .map_err(CommandError::system)
}

#[tauri::command]
pub fn start_status_island_focus(
    app: AppHandle,
    timer: State<'_, ManagedFocusTimer>,
    minutes: u64,
) -> Result<(), CommandError> {
    if !(1..=720).contains(&minutes) {
        return Err(CommandError::validation(
            "minutes",
            "专注时长必须在 1 到 720 分钟之间。",
        ));
    }
    let now = Local::now();
    let snapshot = crate::focus_timer::NativeFocusSnapshot {
        id: uuid::Uuid::new_v4().to_string(),
        planned_seconds: minutes * 60,
        started_at: now.to_rfc3339(),
        notification_title: "专注完成".into(),
        notification_body: format!("你已完成 {minutes} 分钟专注。"),
    };
    timer.lock().map_err(CommandError::system)?.start(
        snapshot.clone(),
        StdDuration::from_secs(minutes * 60),
        Instant::now(),
    );
    app.emit("focus-timer-started", snapshot)
        .map_err(CommandError::system)?;
    invalidate(&app)
}

#[tauri::command]
pub fn pause_status_island_focus(
    app: AppHandle,
    timer: State<'_, ManagedFocusTimer>,
) -> Result<(), CommandError> {
    timer
        .lock()
        .map_err(CommandError::system)?
        .pause(Instant::now());
    app.emit("focus-timer-paused", ())
        .map_err(CommandError::system)?;
    invalidate(&app)
}

#[tauri::command]
pub fn resume_status_island_focus(
    app: AppHandle,
    timer: State<'_, ManagedFocusTimer>,
) -> Result<(), CommandError> {
    timer
        .lock()
        .map_err(CommandError::system)?
        .resume(Instant::now());
    app.emit("focus-timer-resumed", ())
        .map_err(CommandError::system)?;
    invalidate(&app)
}

#[cfg(test)]
mod tests {
    use super::{snapshot_range, StatusIslandEventNavigation};
    use crate::models::EventTarget;
    use chrono::NaiveDate;

    #[test]
    fn range_includes_cross_midnight_and_next_day_imminent_events() {
        let now = NaiveDate::from_ymd_opt(2026, 9, 12)
            .unwrap()
            .and_hms_opt(23, 55, 0)
            .unwrap();

        let range = snapshot_range(now);

        assert_eq!(range.start_at, "2026-09-11T00:00");
        assert_eq!(range.end_at_exclusive, "2026-09-13T00:15");
    }

    #[test]
    fn event_navigation_preserves_the_occurrence_identity() {
        let payload = StatusIslandEventNavigation {
            target: EventTarget {
                id: "series-1".into(),
                occurrence_start_at: Some("2026-09-12T14:30".into()),
            },
            start_at: "2026-09-12T14:30".into(),
        };

        let value = serde_json::to_value(payload).unwrap();
        assert_eq!(value["target"]["id"], "series-1");
        assert_eq!(value["target"]["occurrenceStartAt"], "2026-09-12T14:30");
        assert_eq!(value["startAt"], "2026-09-12T14:30");
    }
}
