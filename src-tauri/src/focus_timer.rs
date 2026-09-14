use crate::error::CommandError;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeFocusSnapshot {
    pub id: String,
    pub planned_seconds: u64,
    pub started_at: String,
    pub notification_title: String,
    pub notification_body: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusStatusSnapshot {
    pub status: String,
    pub remaining_seconds: u64,
    pub planned_seconds: u64,
    pub session_id: Option<String>,
    /// Distinguishes repeated stages of one session. A status-only snapshot
    /// cannot tell a resumed "running" apart from the original start, so the
    /// status island would either replay or swallow the reminder.
    pub stage_sequence: u64,
    /// Wall-clock local time of the last stage change. The status island derives
    /// the 15s hold from it, so it must not be a monotonic instant.
    pub stage_changed_at: Option<String>,
}

#[derive(Debug)]
struct ActiveTimer {
    snapshot: NativeFocusSnapshot,
    remaining: Duration,
    started_at: Option<Instant>,
}

#[derive(Debug, Default)]
pub struct FocusTimerCoordinator {
    active: Option<ActiveTimer>,
    pending: Option<NativeFocusSnapshot>,
    stage_sequence: u64,
    stage_changed_at: Option<String>,
}

impl FocusTimerCoordinator {
    fn mark_stage(&mut self) {
        self.stage_sequence += 1;
        self.stage_changed_at = Some(chrono::Local::now().to_rfc3339());
    }

    pub fn status_snapshot(&self, now: Instant) -> FocusStatusSnapshot {
        let Some(active) = self.active.as_ref() else {
            if let Some(pending) = self.pending.as_ref() {
                return FocusStatusSnapshot {
                    status: "completed".into(),
                    remaining_seconds: 0,
                    planned_seconds: pending.planned_seconds,
                    session_id: Some(pending.id.clone()),
                    stage_sequence: self.stage_sequence,
                    stage_changed_at: self.stage_changed_at.clone(),
                };
            }
            return FocusStatusSnapshot {
                status: "idle".into(),
                remaining_seconds: 0,
                planned_seconds: 0,
                session_id: None,
                stage_sequence: self.stage_sequence,
                stage_changed_at: self.stage_changed_at.clone(),
            };
        };
        let remaining = active.started_at.map_or(active.remaining, |started_at| {
            active
                .remaining
                .saturating_sub(now.saturating_duration_since(started_at))
        });
        FocusStatusSnapshot {
            status: if active.started_at.is_some() {
                "running".into()
            } else {
                "paused".into()
            },
            remaining_seconds: remaining.as_secs(),
            planned_seconds: active.snapshot.planned_seconds,
            session_id: Some(active.snapshot.id.clone()),
            stage_sequence: self.stage_sequence,
            stage_changed_at: self.stage_changed_at.clone(),
        }
    }

    pub fn start(&mut self, snapshot: NativeFocusSnapshot, duration: Duration, now: Instant) {
        self.pending = None;
        self.active = Some(ActiveTimer {
            snapshot,
            remaining: duration,
            started_at: Some(now),
        });
        self.mark_stage();
    }

    pub fn pause(&mut self, now: Instant) {
        let Some(active) = self.active.as_mut() else {
            return;
        };
        let Some(started_at) = active.started_at.take() else {
            return;
        };
        active.remaining = active
            .remaining
            .saturating_sub(now.saturating_duration_since(started_at));
        self.mark_stage();
    }

    pub fn resume(&mut self, now: Instant) {
        let Some(active) = self.active.as_mut() else {
            return;
        };
        if active.started_at.is_none() {
            active.started_at = Some(now);
            self.mark_stage();
        }
    }

    pub fn cancel(&mut self) {
        self.active = None;
        self.pending = None;
        self.stage_sequence = 0;
        self.stage_changed_at = None;
    }

    pub fn poll(&mut self, now: Instant) -> Option<NativeFocusSnapshot> {
        let active = self.active.as_ref()?;
        let started_at = active.started_at?;
        if now.saturating_duration_since(started_at) < active.remaining {
            return None;
        }
        let completed = self.active.take()?.snapshot;
        self.pending = Some(completed.clone());
        self.mark_stage();
        Some(completed)
    }

    pub fn pending(&self) -> Option<NativeFocusSnapshot> {
        self.pending.clone()
    }

    pub fn acknowledge(&mut self, id: &str) {
        if self
            .pending
            .as_ref()
            .is_some_and(|snapshot| snapshot.id == id)
        {
            self.pending = None;
        }
    }
}

pub type ManagedFocusTimer = Mutex<FocusTimerCoordinator>;

fn locked(
    timer: &ManagedFocusTimer,
) -> Result<std::sync::MutexGuard<'_, FocusTimerCoordinator>, CommandError> {
    timer.lock().map_err(CommandError::system)
}

#[tauri::command]
pub fn start_focus_timer(
    app: AppHandle,
    timer: State<'_, ManagedFocusTimer>,
    snapshot: NativeFocusSnapshot,
    remaining_seconds: u64,
) -> Result<(), CommandError> {
    locked(timer.inner())?.start(
        snapshot,
        Duration::from_secs(remaining_seconds),
        Instant::now(),
    );
    app.emit("status-island-invalidated", ())
        .map_err(CommandError::system)?;
    Ok(())
}

#[tauri::command]
pub fn pause_focus_timer(
    app: AppHandle,
    timer: State<'_, ManagedFocusTimer>,
) -> Result<(), CommandError> {
    locked(timer.inner())?.pause(Instant::now());
    app.emit("status-island-invalidated", ())
        .map_err(CommandError::system)?;
    Ok(())
}

#[tauri::command]
pub fn resume_focus_timer(
    app: AppHandle,
    timer: State<'_, ManagedFocusTimer>,
) -> Result<(), CommandError> {
    locked(timer.inner())?.resume(Instant::now());
    app.emit("status-island-invalidated", ())
        .map_err(CommandError::system)?;
    Ok(())
}

#[tauri::command]
pub fn cancel_focus_timer(
    app: AppHandle,
    timer: State<'_, ManagedFocusTimer>,
) -> Result<(), CommandError> {
    locked(timer.inner())?.cancel();
    app.emit("status-island-invalidated", ())
        .map_err(CommandError::system)?;
    Ok(())
}

#[tauri::command]
pub fn get_pending_focus_completion(
    timer: State<'_, ManagedFocusTimer>,
) -> Result<Option<NativeFocusSnapshot>, CommandError> {
    Ok(locked(timer.inner())?.pending())
}

#[tauri::command]
pub fn acknowledge_focus_completion(
    timer: State<'_, ManagedFocusTimer>,
    id: String,
) -> Result<(), CommandError> {
    locked(timer.inner())?.acknowledge(&id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{FocusTimerCoordinator, NativeFocusSnapshot};
    use std::time::{Duration, Instant};

    fn snapshot() -> NativeFocusSnapshot {
        NativeFocusSnapshot {
            id: "session-1".into(),
            planned_seconds: 2,
            started_at: "2026-08-14T09:00:00Z".into(),
            notification_title: "专注完成".into(),
            notification_body: "你已完成 2 秒专注。".into(),
        }
    }

    #[test]
    fn reports_running_and_paused_snapshots_without_mutating_the_timer() {
        let origin = Instant::now();
        let mut timer = FocusTimerCoordinator::default();
        timer.start(snapshot(), Duration::from_secs(1500), origin);

        let running = timer.status_snapshot(origin + Duration::from_secs(42));
        assert_eq!(running.status, "running");
        assert_eq!(running.remaining_seconds, 1458);
        assert_eq!(running.session_id.as_deref(), Some("session-1"));

        timer.pause(origin + Duration::from_secs(42));
        let paused = timer.status_snapshot(origin + Duration::from_secs(90));
        assert_eq!(paused.status, "paused");
        assert_eq!(paused.remaining_seconds, 1458);
    }

    #[test]
    fn reports_idle_when_no_native_timer_is_active() {
        let timer = FocusTimerCoordinator::default();
        let status = timer.status_snapshot(Instant::now());

        assert_eq!(status.status, "idle");
        assert_eq!(status.remaining_seconds, 0);
        assert_eq!(status.session_id, None);
    }

    #[test]
    fn running_timer_completes_exactly_once() {
        let now = Instant::now();
        let mut timer = FocusTimerCoordinator::default();
        timer.start(snapshot(), Duration::from_secs(2), now);
        assert!(timer.poll(now + Duration::from_secs(1)).is_none());
        assert_eq!(
            timer.poll(now + Duration::from_secs(2)).unwrap().id,
            "session-1"
        );
        assert!(timer.poll(now + Duration::from_secs(3)).is_none());
        assert_eq!(timer.pending().unwrap().id, "session-1");
        let completed = timer.status_snapshot(now + Duration::from_secs(3));
        assert_eq!(completed.status, "completed");
        assert_eq!(completed.remaining_seconds, 0);
        timer.acknowledge("session-1");
        assert!(timer.pending().is_none());
    }

    #[test]
    fn pause_freezes_remaining_time_and_resume_continues() {
        let now = Instant::now();
        let mut timer = FocusTimerCoordinator::default();
        timer.start(snapshot(), Duration::from_secs(2), now);
        timer.pause(now + Duration::from_secs(1));
        assert!(timer.poll(now + Duration::from_secs(10)).is_none());
        timer.resume(now + Duration::from_secs(10));
        assert!(timer.poll(now + Duration::from_millis(10_999)).is_none());
        assert!(timer.poll(now + Duration::from_secs(11)).is_some());
    }

    #[test]
    fn cancel_discards_active_and_pending_sessions() {
        let now = Instant::now();
        let mut timer = FocusTimerCoordinator::default();
        timer.start(snapshot(), Duration::from_secs(1), now);
        timer.cancel();
        assert!(timer.poll(now + Duration::from_secs(2)).is_none());
        assert!(timer.pending().is_none());
    }

    #[test]
    fn every_stage_change_gets_its_own_sequence_and_wall_clock_stamp() {
        let now = Instant::now();
        let mut timer = FocusTimerCoordinator::default();

        timer.start(snapshot(), Duration::from_secs(2), now);
        let started = timer.status_snapshot(now);
        assert_eq!(started.stage_sequence, 1);
        assert_eq!(started.planned_seconds, 2);
        let stamp = started.stage_changed_at.clone().unwrap();
        assert!(chrono::DateTime::parse_from_rfc3339(&stamp).is_ok());

        timer.pause(now);
        assert_eq!(timer.status_snapshot(now).stage_sequence, 2);
        timer.resume(now);
        let resumed = timer.status_snapshot(now);
        assert_eq!(resumed.status, "running");
        assert_eq!(resumed.stage_sequence, 3);

        // A resumed session must not reuse the original start identity, or the
        // island would treat the resume as already seen.
        assert_ne!(started.stage_sequence, resumed.stage_sequence);

        timer.poll(now + Duration::from_secs(5));
        let completed = timer.status_snapshot(now + Duration::from_secs(5));
        assert_eq!(completed.status, "completed");
        assert_eq!(completed.stage_sequence, 4);
        assert_eq!(completed.planned_seconds, 2);

        timer.cancel();
        let idle = timer.status_snapshot(now + Duration::from_secs(6));
        assert_eq!(idle.status, "idle");
        assert_eq!(idle.stage_sequence, 0);
        assert_eq!(idle.stage_changed_at, None);
    }
}
