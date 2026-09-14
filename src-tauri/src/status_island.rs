use crate::db::AppDb;
use crate::error::CommandError;
use crate::focus_timer::{FocusStatusSnapshot, ManagedFocusTimer};
use crate::models::{Event, EventRange, EventTarget, ExternalEvent, Task};
use chrono::{DateTime, Duration, Local, NaiveDateTime};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::Duration as StdDuration;
use std::time::Instant;
use tauri::{AppHandle, Emitter, Manager, State};

const LOCAL_MINUTE_FORMAT: &str = "%Y-%m-%dT%H:%M";
const LOCAL_DATE_FORMAT: &str = "%Y-%m-%d";
const REMINDER_STORE_FILE: &str = "status-island-reminders.json";
static STATUS_APP: OnceLock<AppHandle> = OnceLock::new();

/// Lifecycle facts the native coordinator owns. `dismissed` is the user closing
/// the detail: it downgrades the island to today's summary for the rest of the
/// local day. It is neither acknowledgement nor business consumption, so a later
/// stage of the same event still appears.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderState {
    pub identity: String,
    pub acknowledged_at: Option<String>,
    /// Written by older builds, which collapsed a reminder 15s after it was
    /// acknowledged. Nothing sets it now: the island only changes content when the
    /// user asks it to. It is still read and preserved so a store file left by
    /// such a build keeps its already-collapsed reminders collapsed rather than
    /// replaying them all at once on upgrade.
    #[serde(default)]
    pub hidden: bool,
    #[serde(default)]
    pub dismissed: bool,
    #[serde(default)]
    pub consumed: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PresenceSurface {
    Island,
    Details,
    Keyboard,
    Action,
}

/// What the status island window receives. No hold deadline: collapse is no
/// longer a function of elapsed time, so there is nothing for either window to
/// count down to.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderSnapshotState {
    pub identity: String,
    pub acknowledged_at: Option<String>,
    pub hidden: bool,
    pub dismissed: bool,
    pub consumed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredReminders {
    local_date: String,
    reminders: Vec<ReminderState>,
}

/// Owns acknowledgement and the stored dismissal state. Everything here is
/// wall-clock local time, so a restart, tray restore, sleep/wake or timezone
/// change recomputes from the user's current local time instead of a monotonic
/// clock.
#[derive(Debug, Default)]
pub struct ReminderLifecycle {
    local_date: String,
    states: BTreeMap<String, ReminderState>,
    /// Identity of the reminder currently occupying the island. The island
    /// window reports it so acknowledgement can be recorded natively at the
    /// moment the details panel actually appears.
    primary: Option<String>,
    /// Whether the pointer is on the island right now. The only presence fact
    /// still worth storing: it is what the hover-open delay checks. The details
    /// panel and keyboard focus used to be tracked too, but only to keep a
    /// reminder from collapsing mid-interaction, and nothing collapses on a timer
    /// any more.
    island: bool,
}

impl ReminderLifecycle {
    pub fn new(local_date: String, reminders: Vec<ReminderState>) -> Self {
        Self {
            local_date,
            states: reminders
                .into_iter()
                .map(|state| (state.identity.clone(), state))
                .collect(),
            ..Self::default()
        }
    }

    pub fn local_date(&self) -> &str {
        &self.local_date
    }

    /// Dismissals only hold for the current local day. Crossing midnight clears
    /// them, so tomorrow every reminder starts in detail again.
    pub fn roll_local_date(&mut self, today: &str) -> bool {
        if self.local_date == today {
            return false;
        }
        self.local_date = today.to_owned();
        self.states.clear();
        true
    }

    fn entry(&mut self, identity: &str) -> &mut ReminderState {
        self.states
            .entry(identity.to_owned())
            .or_insert_with(|| ReminderState {
                identity: identity.to_owned(),
                ..ReminderState::default()
            })
    }

    /// The first acknowledgement wins; re-entering the surface must not extend
    /// the hold indefinitely.
    pub fn acknowledge(&mut self, identity: &str, now: DateTime<Local>) -> bool {
        let entry = self.entry(identity);
        if entry.acknowledged_at.is_some() {
            return false;
        }
        entry.acknowledged_at = Some(now.to_rfc3339());
        true
    }

    /// The user closed this reminder's detail. The island falls back to today's
    /// summary; the reminder does not come back in full until tomorrow.
    pub fn dismiss(&mut self, identity: &str) {
        self.entry(identity).dismissed = true;
    }

    pub fn set_primary(&mut self, identity: Option<String>) {
        self.primary = identity;
    }

    pub fn primary(&self) -> Option<String> {
        self.primary.clone()
    }

    pub fn consume(&mut self, identity: &str) {
        self.entry(identity).consumed = true;
    }

    pub fn states(&self) -> Vec<ReminderState> {
        self.states.values().cloned().collect()
    }

    /// Snapshot view of the stored lifecycle.
    pub fn snapshot_states(&self) -> Vec<ReminderSnapshotState> {
        self.states
            .values()
            .map(|state| ReminderSnapshotState {
                identity: state.identity.clone(),
                acknowledged_at: state.acknowledged_at.clone(),
                hidden: state.hidden,
                dismissed: state.dismissed,
                consumed: state.consumed,
            })
            .collect()
    }

    /// True while the pointer is still on the indicator itself. The native
    /// hover-open checks this after its 300ms delay so a quick pass neither
    /// opens the panel nor acknowledges the reminder.
    pub fn island_present(&self) -> bool {
        self.island
    }

    /// Records pointer presence on the island.
    ///
    /// The other surfaces are still accepted, and deliberately ignored: they only
    /// ever fed the collapse hold, so acting on them now would be storing state
    /// nothing reads. Keeping the variants means neither window errors while
    /// reporting them.
    pub fn set_presence(&mut self, surface: PresenceSurface, present: bool) {
        if surface == PresenceSurface::Island {
            self.island = present;
        }
    }
}

pub type ManagedReminders = Mutex<ReminderLifecycle>;

pub fn reminder_store_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(REMINDER_STORE_FILE)
}

/// Corrupt or unreadable storage degrades to empty state; it must never stop
/// the top surface from starting.
pub fn load_reminders(path: &Path, today: &str) -> ReminderLifecycle {
    let stored = std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<StoredReminders>(&raw).ok());
    match stored {
        Some(stored) if stored.local_date == today => {
            ReminderLifecycle::new(today.to_owned(), stored.reminders)
        }
        _ => ReminderLifecycle::new(today.to_owned(), Vec::new()),
    }
}

pub fn save_reminders(path: &Path, lifecycle: &ReminderLifecycle) -> Result<(), std::io::Error> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let payload = StoredReminders {
        local_date: lifecycle.local_date.clone(),
        reminders: lifecycle.states(),
    };
    std::fs::write(
        path,
        serde_json::to_string(&payload).map_err(std::io::Error::other)?,
    )
}

fn persist<R: tauri::Runtime>(app: &AppHandle<R>, lifecycle: &ReminderLifecycle) {
    let Ok(dir) = app.path().app_data_dir() else {
        return;
    };
    if let Err(error) = save_reminders(&reminder_store_path(&dir), lifecycle) {
        // The live process keeps working; only cross-restart memory is lost.
        eprintln!("failed to persist status island reminders: {error}");
    }
}

/// Acknowledgement is recorded here, never in a WebView: the native coordinator
/// is the single time source of truth. Called the moment the details panel is
/// actually shown, whichever path opened it (sustained hover, click, or keyboard).
pub fn acknowledge_primary<R: tauri::Runtime>(app: &AppHandle<R>) {
    let Some(state) = app.try_state::<ManagedReminders>() else {
        return;
    };
    let Ok(mut lifecycle) = state.lock() else {
        return;
    };
    lifecycle.roll_local_date(&today_local());
    let Some(identity) = lifecycle.primary() else {
        return;
    };
    if !lifecycle.acknowledge(&identity, Local::now()) {
        return;
    }
    persist(app, &lifecycle);
    drop(lifecycle);
    // Acknowledgement is now only a "has been seen" fact, used to label the
    // surface. It no longer schedules a collapse, so there is nothing to
    // re-derive later.
    let _ = app.emit("status-island-invalidated", ());
}

fn today_local() -> String {
    Local::now().format(LOCAL_DATE_FORMAT).to_string()
}

/// The reminder the island currently shows. The details window is opened *for*
/// this identity and stays pinned to it, so it never silently re-targets to
/// whatever later becomes the queue head.
pub fn primary_identity<R: tauri::Runtime>(app: &AppHandle<R>) -> Option<String> {
    app.try_state::<ManagedReminders>()
        .and_then(|state| state.lock().ok().and_then(|lifecycle| lifecycle.primary()))
}

/// Records any collapse whose hold has run out. Called before every snapshot read
/// and whenever a hold could have just ended.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusIslandSnapshot {
    pub sampled_at: String,
    pub local_date: String,
    pub events: Vec<Event>,
    pub external_events: Vec<ExternalEvent>,
    pub tasks: Vec<Task>,
    pub focus: FocusStatusSnapshot,
    pub reminders: Vec<ReminderSnapshotState>,
    /// The user's notification setting, forwarded so the island window does not
    /// have to open the database itself. Decides whether a new reminder starts as
    /// a full detail or goes straight into today's summary.
    pub notification_display: String,
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
    app: AppHandle,
    db: State<'_, AppDb>,
    timer: State<'_, ManagedFocusTimer>,
    reminders: State<'_, ManagedReminders>,
) -> Result<StatusIslandSnapshot, CommandError> {
    let now = Local::now().naive_local();
    let range = snapshot_range(now);
    let connection = db.0.lock().map_err(CommandError::database)?;
    let events = crate::events::list_overlapping(&connection, &range)?;
    let external_events = crate::subscriptions::list_external_in_range(&connection, &range)?;
    let tasks = crate::task_workspace::snapshot(&connection)?.tasks;
    // Read on the same connection that is already open: the island window has no
    // database of its own, and a second command round-trip would let the surface
    // render one frame with the wrong mode.
    let notification_display = crate::settings::read_app_settings(&connection)
        .map_err(CommandError::database)?
        .notification_display;
    drop(connection);
    let focus = timer
        .lock()
        .map_err(CommandError::system)?
        .status_snapshot(Instant::now());
    let today = today_local();
    let (local_date, states, rolled) = {
        let mut lifecycle = reminders.lock().map_err(CommandError::system)?;
        let rolled = lifecycle.roll_local_date(&today);
        (
            lifecycle.local_date().to_owned(),
            lifecycle.snapshot_states(),
            rolled,
        )
    };
    if rolled {
        let lifecycle = reminders.lock().map_err(CommandError::system)?;
        persist(&app, &lifecycle);
    }
    Ok(StatusIslandSnapshot {
        sampled_at: Local::now().to_rfc3339(),
        local_date,
        events,
        external_events,
        tasks,
        focus,
        reminders: states,
        notification_display,
    })
}

#[tauri::command]
pub fn acknowledge_status_island_reminder(
    app: AppHandle,
    reminders: State<'_, ManagedReminders>,
    identity: String,
) -> Result<(), CommandError> {
    {
        let mut lifecycle = reminders.lock().map_err(CommandError::system)?;
        lifecycle.roll_local_date(&today_local());
        if !lifecycle.acknowledge(&identity, Local::now()) {
            return Ok(());
        }
        persist(&app, &lifecycle);
    }
    // Only records that the reminder has been seen. Nothing collapses on a timer
    // any more, so there is no second re-derive to schedule.
    invalidate(&app)
}

#[tauri::command]
pub fn dismiss_status_island_reminder(
    app: AppHandle,
    reminders: State<'_, ManagedReminders>,
    identity: String,
) -> Result<(), CommandError> {
    {
        let mut lifecycle = reminders.lock().map_err(CommandError::system)?;
        lifecycle.roll_local_date(&today_local());
        lifecycle.dismiss(&identity);
        persist(&app, &lifecycle);
    }
    // The panel is pinned to the identity it was opened for, and the island stays
    // an island (it just switches to the summary), so no shape change will tear
    // the panel down. Close it here, otherwise a panel acting on the reminder the
    // user just closed would stay on screen.
    crate::quick_panel::close_details_for_navigation(&app).map_err(CommandError::system)?;
    invalidate(&app)
}

#[tauri::command]
pub fn consume_status_island_reminder(
    app: AppHandle,
    reminders: State<'_, ManagedReminders>,
    identity: String,
) -> Result<(), CommandError> {
    {
        let mut lifecycle = reminders.lock().map_err(CommandError::system)?;
        lifecycle.roll_local_date(&today_local());
        lifecycle.consume(&identity);
        persist(&app, &lifecycle);
    }
    invalidate(&app)
}

#[tauri::command]
pub fn set_status_island_primary(
    reminders: State<'_, ManagedReminders>,
    identity: Option<String>,
) -> Result<(), CommandError> {
    reminders
        .lock()
        .map_err(CommandError::system)?
        .set_primary(identity);
    Ok(())
}

#[tauri::command]
pub fn set_status_island_presence(
    reminders: State<'_, ManagedReminders>,
    surface: PresenceSurface,
    present: bool,
) -> Result<(), CommandError> {
    // Presence is now only read by the hover-open delay, which checks it 300ms
    // after the pointer arrived. Nothing expires on a timer, so leaving a surface
    // no longer has to schedule anything.
    reminders
        .lock()
        .map_err(CommandError::system)?
        .set_presence(surface, present);
    Ok(())
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
    use super::{
        load_reminders, reminder_store_path, save_reminders, snapshot_range, PresenceSurface,
        ReminderLifecycle, ReminderState, StatusIslandEventNavigation,
    };
    use crate::models::EventTarget;
    use chrono::{Local, NaiveDate, TimeZone};

    fn lifecycle() -> ReminderLifecycle {
        ReminderLifecycle::new("2026-09-13".into(), Vec::new())
    }

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

    #[test]
    fn acknowledgement_is_recorded_once() {
        let mut lifecycle = lifecycle();
        let first = Local.with_ymd_and_hms(2026, 9, 13, 9, 0, 0).unwrap();

        assert!(lifecycle.acknowledge("event:a:start", first));
        let recorded = lifecycle.states()[0].acknowledged_at.clone();
        assert!(recorded.is_some());

        // Re-entering the surface must not rewrite when it was first seen.
        assert!(!lifecycle.acknowledge("event:a:start", first + chrono::Duration::seconds(10)));
        assert_eq!(lifecycle.states()[0].acknowledged_at, recorded);
    }

    #[test]
    fn dismissal_and_consumption_stay_per_identity() {
        let mut lifecycle = lifecycle();

        lifecycle.dismiss("event:a:reminder:15");
        lifecycle.consume("focus:session-1:completed:2");

        let states = lifecycle.states();
        assert_eq!(states.len(), 2);
        let dismissed = states
            .iter()
            .find(|state| state.identity == "event:a:reminder:15")
            .unwrap();
        assert!(dismissed.dismissed);
        assert!(!dismissed.consumed);
        assert!(dismissed.acknowledged_at.is_none());
        assert!(lifecycle
            .states()
            .iter()
            .find(|state| state.identity == "focus:session-1:completed:2")
            .unwrap()
            .consumed);
        // Nothing was batch-acknowledged.
        assert!(states.iter().all(|state| state.acknowledged_at.is_none()));
    }

    #[test]
    fn crossing_midnight_clears_the_previous_day_dismissals() {
        let mut lifecycle = lifecycle();
        lifecycle.dismiss("event:a:reminder:15");

        assert!(lifecycle.roll_local_date("2026-09-14"));

        assert_eq!(lifecycle.local_date(), "2026-09-14");
        assert!(lifecycle.states().is_empty());
        assert!(!lifecycle.roll_local_date("2026-09-14"));
    }

    #[test]
    fn presence_tracks_the_pointer_on_the_island_only() {
        let mut lifecycle = lifecycle();
        assert!(!lifecycle.island_present());

        lifecycle.set_presence(PresenceSurface::Island, true);
        assert!(lifecycle.island_present());

        // The other surfaces are accepted and ignored: they only ever fed the
        // collapse hold, and nothing collapses on a timer any more.
        lifecycle.set_presence(PresenceSurface::Details, true);
        lifecycle.set_presence(PresenceSurface::Keyboard, true);
        lifecycle.set_presence(PresenceSurface::Action, true);
        assert!(lifecycle.island_present());

        lifecycle.set_presence(PresenceSurface::Island, false);
        assert!(!lifecycle.island_present());
    }

    #[test]
    fn reminders_round_trip_and_expire_with_the_local_date() {
        let dir = std::env::temp_dir().join(format!("nowly-reminders-{}", uuid::Uuid::new_v4()));
        let path = reminder_store_path(&dir);
        let mut lifecycle = ReminderLifecycle::new("2026-09-13".into(), Vec::new());
        lifecycle.dismiss("event:a:reminder:15");
        save_reminders(&path, &lifecycle).unwrap();

        let same_day = load_reminders(&path, "2026-09-13");
        assert_eq!(same_day.states().len(), 1);
        assert!(same_day.states()[0].dismissed);

        let next_day = load_reminders(&path, "2026-09-14");
        assert!(next_day.states().is_empty());
        assert_eq!(next_day.local_date(), "2026-09-14");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn corrupt_or_missing_storage_degrades_to_an_empty_store() {
        let dir = std::env::temp_dir().join(format!("nowly-reminders-{}", uuid::Uuid::new_v4()));
        let path = reminder_store_path(&dir);

        let missing = load_reminders(&path, "2026-09-13");
        assert!(missing.states().is_empty());

        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(&path, "{not json").unwrap();
        let corrupt = load_reminders(&path, "2026-09-13");
        assert!(corrupt.states().is_empty());
        assert_eq!(corrupt.local_date(), "2026-09-13");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn the_primary_identity_is_what_acknowledgement_applies_to() {
        let mut lifecycle = lifecycle();
        assert!(lifecycle.primary().is_none());

        lifecycle.set_primary(Some("event:a:reminder:15".into()));
        assert_eq!(lifecycle.primary().as_deref(), Some("event:a:reminder:15"));

        // Only the current primary is acknowledged; the queue is never batched.
        let now = Local.with_ymd_and_hms(2026, 9, 13, 9, 0, 0).unwrap();
        lifecycle.acknowledge(&lifecycle.primary().unwrap(), now);
        lifecycle.set_primary(Some("event:b:start".into()));

        let states = lifecycle.states();
        assert!(states
            .iter()
            .find(|state| state.identity == "event:a:reminder:15")
            .unwrap()
            .acknowledged_at
            .is_some());
        assert!(states.iter().all(|state| state.identity != "event:b:start"));

        lifecycle.set_primary(None);
        assert!(lifecycle.primary().is_none());
    }

    #[test]
    fn stored_reminders_keep_their_camel_case_contract() {
        let value = serde_json::to_value(ReminderState {
            identity: "event:a:start".into(),
            acknowledged_at: Some("2026-09-13T09:00:00+08:00".into()),
            hidden: false,
            dismissed: false,
            consumed: true,
        })
        .unwrap();

        assert_eq!(value["identity"], "event:a:start");
        assert_eq!(value["acknowledgedAt"], "2026-09-13T09:00:00+08:00");
        assert_eq!(value["hidden"], false);
        assert_eq!(value["dismissed"], false);
        assert_eq!(value["consumed"], true);
    }

    #[test]
    fn a_dismissal_is_the_downgrade_and_only_touches_its_own_identity() {
        let mut lifecycle = lifecycle();
        let now = Local.with_ymd_and_hms(2026, 9, 13, 9, 0, 0).unwrap();
        lifecycle.acknowledge("task:peer", now);
        lifecycle.dismiss("task:closed");

        let states = lifecycle.states();
        let closed = states.iter().find(|s| s.identity == "task:closed").unwrap();
        let peer = states.iter().find(|s| s.identity == "task:peer").unwrap();
        assert!(closed.dismissed);
        // Closing one notification must not downgrade the rest: the next one still
        // gets its own turn in full detail.
        assert!(!peer.dismissed);
        // Time alone never downgrades anything, so an acknowledged reminder that
        // was never closed carries no collapse flag.
        assert!(!peer.hidden);
    }

    #[test]
    fn a_collapsed_reminder_from_an_older_build_stays_collapsed() {
        let dir = std::env::temp_dir().join(format!("nowly-hidden-{}", uuid::Uuid::new_v4()));
        let path = reminder_store_path(&dir);
        // Written by a build that collapsed reminders 15s after acknowledgement.
        // Nothing sets `hidden` now, but upgrading must not replay every reminder
        // that had already collapsed before the upgrade.
        let lifecycle = ReminderLifecycle::new(
            "2026-09-13".into(),
            vec![ReminderState {
                identity: "task:seen".into(),
                acknowledged_at: Some("2026-09-13T09:00:00+08:00".into()),
                hidden: true,
                dismissed: false,
                consumed: false,
            }],
        );
        save_reminders(&path, &lifecycle).unwrap();

        let restored = load_reminders(&path, "2026-09-13");

        assert!(restored.states()[0].hidden);
        // The next local day clears it, as dismissals do.
        assert!(load_reminders(&path, "2026-09-14").states().is_empty());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn the_snapshot_carries_lifecycle_facts_and_no_deadline() {
        let mut lifecycle = lifecycle();
        let acknowledged = Local.with_ymd_and_hms(2026, 9, 13, 9, 0, 0).unwrap();
        lifecycle.acknowledge("event:a:start", acknowledged);
        lifecycle.dismiss("event:b:reminder:15");

        let states = lifecycle.snapshot_states();
        let acknowledged_state = states
            .iter()
            .find(|state| state.identity == "event:a:start")
            .unwrap();
        assert!(acknowledged_state.acknowledged_at.is_some());
        assert!(!acknowledged_state.hidden);

        let dismissed_state = states
            .iter()
            .find(|state| state.identity == "event:b:reminder:15")
            .unwrap();
        assert!(dismissed_state.dismissed);
        assert!(dismissed_state.acknowledged_at.is_none());

        let value = serde_json::to_value(acknowledged_state).unwrap();
        assert_eq!(value["identity"], "event:a:start");
        // No hold deadline is published any more: there is nothing to count down
        // to, so neither window can drift on it.
        assert!(value.get("hideEligibleAt").is_none());
    }
}
