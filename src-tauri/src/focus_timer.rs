use crate::error::CommandError;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::State;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeFocusSnapshot {
    pub id: String,
    pub planned_seconds: u64,
    pub started_at: String,
    pub notification_title: String,
    pub notification_body: String,
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
}

impl FocusTimerCoordinator {
    pub fn start(&mut self, snapshot: NativeFocusSnapshot, duration: Duration, now: Instant) {
        self.pending = None;
        self.active = Some(ActiveTimer {
            snapshot,
            remaining: duration,
            started_at: Some(now),
        });
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
    }

    pub fn resume(&mut self, now: Instant) {
        let Some(active) = self.active.as_mut() else {
            return;
        };
        if active.started_at.is_none() {
            active.started_at = Some(now);
        }
    }

    pub fn cancel(&mut self) {
        self.active = None;
        self.pending = None;
    }

    pub fn poll(&mut self, now: Instant) -> Option<NativeFocusSnapshot> {
        let active = self.active.as_ref()?;
        let started_at = active.started_at?;
        if now.saturating_duration_since(started_at) < active.remaining {
            return None;
        }
        let completed = self.active.take()?.snapshot;
        self.pending = Some(completed.clone());
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
    timer: State<'_, ManagedFocusTimer>,
    snapshot: NativeFocusSnapshot,
    remaining_seconds: u64,
) -> Result<(), CommandError> {
    locked(timer.inner())?.start(
        snapshot,
        Duration::from_secs(remaining_seconds),
        Instant::now(),
    );
    Ok(())
}

#[tauri::command]
pub fn pause_focus_timer(timer: State<'_, ManagedFocusTimer>) -> Result<(), CommandError> {
    locked(timer.inner())?.pause(Instant::now());
    Ok(())
}

#[tauri::command]
pub fn resume_focus_timer(timer: State<'_, ManagedFocusTimer>) -> Result<(), CommandError> {
    locked(timer.inner())?.resume(Instant::now());
    Ok(())
}

#[tauri::command]
pub fn cancel_focus_timer(timer: State<'_, ManagedFocusTimer>) -> Result<(), CommandError> {
    locked(timer.inner())?.cancel();
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
}
