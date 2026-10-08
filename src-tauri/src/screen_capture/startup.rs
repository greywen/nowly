use std::collections::HashSet;
use std::sync::{Condvar, Mutex};
use std::time::Instant;

use super::session::StartFailure;

#[derive(Debug, Default)]
struct Progress {
    expected: HashSet<String>,
    ready: HashSet<String>,
    created: bool,
    failure: Option<StartFailure>,
}

#[derive(Debug, Default)]
pub(crate) struct Startup {
    progress: Mutex<Progress>,
    changed: Condvar,
}

impl Startup {
    pub fn expect(&self, labels: impl IntoIterator<Item = String>) {
        let mut progress = self.progress.lock().unwrap();
        if progress.failure.is_none() {
            progress.expected = labels.into_iter().collect();
        }
    }

    pub fn ready(&self, label: &str) -> bool {
        let mut progress = self.progress.lock().unwrap();
        if progress.failure.is_some() || !progress.expected.contains(label) {
            return false;
        }
        progress.ready.insert(label.to_owned());
        self.changed.notify_all();
        true
    }

    pub fn created(&self) {
        self.progress.lock().unwrap().created = true;
        self.changed.notify_all();
    }

    pub fn fail(&self, failure: StartFailure) {
        self.progress.lock().unwrap().failure.get_or_insert(failure);
        self.changed.notify_all();
    }

    pub fn is_cancelled(&self) -> bool {
        self.progress.lock().unwrap().failure.is_some()
    }

    pub fn wait(&self, deadline: Instant) -> Result<(), StartFailure> {
        let mut progress = self.progress.lock().unwrap();
        loop {
            if let Some(failure) = &progress.failure {
                return Err(failure.clone());
            }
            let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
                progress.failure = Some(StartFailure::TimedOut);
                return Err(StartFailure::TimedOut);
            };
            if progress.created
                && !progress.expected.is_empty()
                && progress.expected == progress.ready
            {
                return Ok(());
            }
            let (next, _) = self.changed.wait_timeout(progress, remaining).unwrap();
            progress = next;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{mpsc, Arc};
    use std::time::Duration;

    #[test]
    fn one_missing_window_ack_hits_the_deadline() {
        let startup = Startup::default();
        startup.expect([
            "screenshot-session-1".into(),
            "screenshot-overlay-1-0".into(),
        ]);
        startup.created();
        startup.ready("screenshot-session-1");
        assert_eq!(
            startup.wait(Instant::now() + Duration::from_millis(20)),
            Err(StartFailure::TimedOut)
        );
        assert!(startup.is_cancelled());
    }

    #[test]
    fn ready_requires_the_exact_expected_label_and_is_idempotent() {
        let startup = Startup::default();
        startup.expect(["screenshot-overlay-2-0".into()]);
        assert!(!startup.ready("screenshot-overlay-1-0"));
        assert!(startup.ready("screenshot-overlay-2-0"));
        assert!(startup.ready("screenshot-overlay-2-0"));
        startup.created();
        assert_eq!(
            startup.wait(Instant::now() + Duration::from_secs(1)),
            Ok(())
        );
    }

    #[test]
    fn cancellation_wakes_a_waiter_without_waiting_for_capture() {
        let startup = Arc::new(Startup::default());
        let waiting = startup.clone();
        let (sender, receiver) = mpsc::channel();
        let waiter = std::thread::spawn(move || {
            let result = waiting.wait(Instant::now() + Duration::from_secs(5));
            sender.send(result).unwrap();
        });
        startup.fail(StartFailure::Window("cancelled".into()));
        let result = receiver.recv_timeout(Duration::from_secs(1));
        waiter.join().unwrap();
        assert_eq!(
            result.unwrap(),
            Err(StartFailure::Window("cancelled".into()))
        );
    }

    #[test]
    fn late_worker_cannot_revive_a_timed_out_startup() {
        let startup = Startup::default();
        startup.expect(["screenshot-overlay-1-0".into()]);
        assert_eq!(startup.wait(Instant::now()), Err(StartFailure::TimedOut));
        startup.created();
        assert!(!startup.ready("screenshot-overlay-1-0"));
        assert_eq!(
            startup.wait(Instant::now() + Duration::from_secs(1)),
            Err(StartFailure::TimedOut)
        );
    }
}
