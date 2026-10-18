use crate::db::AppDb;
use crate::sound_settings::{SoundScene, SoundSettings};
use crate::time::types::{AlarmNotice, AlarmNoticeKind};
use rodio::{Decoder, OutputStream, OutputStreamBuilder, Sink, Source};
use std::collections::HashSet;
use std::io::Cursor;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::time::Duration;
use tauri::{AppHandle, Manager};

struct SoundPlan {
    alarm: Option<(String, String)>,
    singles: Vec<SoundScene>,
}

struct SoundCoordinator {
    summaries: HashSet<String>,
    dispatched: HashSet<(SoundScene, String)>,
}

impl SoundCoordinator {
    fn new(notices: &[AlarmNotice]) -> Self {
        Self {
            summaries: notices
                .iter()
                .filter(|notice| notice.kind == AlarmNoticeKind::MissedSummary)
                .map(|notice| notice.id.clone())
                .collect(),
            dispatched: HashSet::new(),
        }
    }

    fn sample(&mut self, settings: &SoundSettings, notices: &[AlarmNotice]) -> SoundPlan {
        let alarm = settings.selected(SoundScene::Alarm).and_then(|sound| {
            notices
                .iter()
                .find(|notice| notice.kind == AlarmNoticeKind::Alarm)
                .map(|notice| (notice.id.clone(), sound.to_owned()))
        });
        let mut singles = Vec::new();
        for notice in notices
            .iter()
            .filter(|notice| notice.kind == AlarmNoticeKind::MissedSummary)
        {
            if self.summaries.insert(notice.id.clone())
                && settings.selected(SoundScene::MissedSummary).is_some()
            {
                singles.push(SoundScene::MissedSummary);
            }
        }
        SoundPlan { alarm, singles }
    }

    fn single(
        &mut self,
        settings: &SoundSettings,
        scene: SoundScene,
        identity: &str,
    ) -> Option<(String, u8)> {
        if !self.dispatched.insert((scene, identity.to_owned())) {
            return None;
        }
        settings
            .selected(scene)
            .map(|sound| (sound.to_owned(), 100))
    }
}

fn sound_bytes(id: &str) -> Result<&'static [u8], String> {
    match id {
        "chime-glass" => Ok(include_bytes!("../../public/sounds/chime-glass.wav")),
        "chime-wood" => Ok(include_bytes!("../../public/sounds/chime-wood.wav")),
        "bell-rise" => Ok(include_bytes!("../../public/sounds/bell-rise.wav")),
        "beep-soft" => Ok(include_bytes!("../../public/sounds/beep-soft.wav")),
        "tap" => Ok(include_bytes!("../../public/sounds/tap.wav")),
        "low-knock" => Ok(include_bytes!("../../public/sounds/low-knock.wav")),
        "resolve" => Ok(include_bytes!("../../public/sounds/resolve.wav")),
        "done-blip" => Ok(include_bytes!("../../public/sounds/done-blip.wav")),
        _ => Err(format!("Unknown reminder sound: {id}")),
    }
}

struct AudioEngine {
    stream: OutputStream,
    alarm: Sink,
    singles: Sink,
}

impl AudioEngine {
    fn new() -> Result<Self, String> {
        let stream = OutputStreamBuilder::open_default_stream()
            .map_err(|error| format!("Cannot open reminder audio output: {error}"))?;
        let alarm = Sink::connect_new(stream.mixer());
        let singles = Sink::connect_new(stream.mixer());
        Ok(Self {
            stream,
            alarm,
            singles,
        })
    }

    fn volume(&self, volume: u8) {
        self.alarm.set_volume(f32::from(volume) / 100.0);
        self.singles.set_volume(f32::from(volume) / 100.0);
    }

    fn stop_alarm(&mut self) {
        self.alarm.stop();
        self.alarm = Sink::connect_new(self.stream.mixer());
    }

    fn stop_singles(&mut self) {
        self.singles.stop();
        self.singles = Sink::connect_new(self.stream.mixer());
    }

    fn play(&mut self, sound: &str, volume: u8, looping: bool) -> Result<(), String> {
        let source = Decoder::try_from(Cursor::new(sound_bytes(sound)?))
            .map_err(|error| format!("Cannot decode reminder sound {sound}: {error}"))?;
        self.volume(volume);
        if looping {
            self.alarm.append(source.repeat_infinite());
        } else {
            self.singles.append(source);
        }
        Ok(())
    }
}

struct NotificationSound {
    scene: SoundScene,
    identity: String,
}

pub struct SoundDispatcher(Sender<NotificationSound>);

pub fn dispatch(app: &AppHandle, scene: SoundScene, identity: String) {
    if let Some(dispatcher) = app.try_state::<SoundDispatcher>() {
        if let Err(error) = dispatcher.0.send(NotificationSound { scene, identity }) {
            eprintln!("Reminder audio worker unavailable: {error}");
        }
    }
}

fn snapshot(app: &AppHandle) -> Result<(SoundSettings, Vec<AlarmNotice>), String> {
    let database = app.state::<AppDb>();
    let mut connection = database.0.lock().map_err(|error| error.to_string())?;
    let settings =
        crate::settings::read_sound_settings(&connection).map_err(|error| error.to_string())?;
    let now = chrono::Utc::now();
    let (active, _expired) = crate::time::scheduler::read_alarm_notice_lists(&mut connection, now)
        .map_err(|error| error.message)?;
    let mut notices = active;
    notices.retain(|notice| notice.kind == AlarmNoticeKind::MissedSummary);
    notices.extend(crate::time::scheduler::list_ringing_alarm_notices(&connection, now)
        .map_err(|error| error.message)?);
    Ok((settings, notices))
}

fn play(
    engine: &mut Option<AudioEngine>,
    sound: &str,
    volume: u8,
    looping: bool,
) -> Result<(), String> {
    if engine.is_none() {
        *engine = Some(AudioEngine::new()?);
    }
    engine.as_mut().unwrap().play(sound, volume, looping)
}

fn reconcile_alarm(
    active: &mut Option<(String, String)>,
    desired: Option<(String, String)>,
    start: impl FnOnce(&str) -> Result<(), String>,
) -> Result<(), String> {
    if *active == desired {
        return Ok(());
    }
    *active = None;
    if let Some((_, sound)) = desired.as_ref() {
        start(sound)?;
    }
    *active = desired;
    Ok(())
}

fn run(app: AppHandle, receiver: Receiver<NotificationSound>, initial: Vec<AlarmNotice>) {
    let mut coordinator = SoundCoordinator::new(&initial);
    let mut engine: Option<AudioEngine> = None;
    let mut alarm_key = None;
    let mut last_settings = None;
    loop {
        let mut queued = Vec::new();
        match receiver.recv_timeout(Duration::from_millis(250)) {
            Ok(sound) => {
                queued.push(sound);
                queued.extend(receiver.try_iter());
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return,
        }
        let (settings, notices) = match snapshot(&app) {
            Ok(snapshot) => snapshot,
            Err(error) => {
                if let Some(engine) = engine.as_mut() {
                    engine.stop_alarm();
                    engine.stop_singles();
                }
                alarm_key = None;
                eprintln!("Cannot read reminder audio state: {error}");
                continue;
            }
        };
        if let Some(engine) = engine.as_mut() {
            if last_settings.as_ref() != Some(&settings) {
                engine.stop_singles();
            }
            engine.volume(100);
        }
        last_settings = Some(settings.clone());
        let plan = coordinator.sample(&settings, &notices);
        if alarm_key != plan.alarm {
            if let Some(engine) = engine.as_mut() {
                engine.stop_alarm();
            }
            if let Err(error) = reconcile_alarm(&mut alarm_key, plan.alarm, |sound| {
                play(&mut engine, sound, 100, true)
            }) {
                eprintln!("Cannot start alarm audio: {error}");
            }
        }
        for scene in plan.singles {
            if let Some(sound) = settings.selected(scene) {
                if let Err(error) = play(&mut engine, sound, 100, false) {
                    eprintln!("Cannot play summary audio: {error}");
                }
            }
        }
        for request in queued {
            if let Some((sound, volume)) =
                coordinator.single(&settings, request.scene, &request.identity)
            {
                if let Err(error) = play(&mut engine, &sound, volume, false) {
                    eprintln!("Cannot play reminder audio: {error}");
                }
            }
        }
    }
}

pub fn start(app: &AppHandle) -> Result<(), String> {
    let (_, initial) = snapshot(app)?;
    let (sender, receiver) = mpsc::channel();
    app.manage(SoundDispatcher(sender));
    let handle = app.clone();
    std::thread::spawn(move || run(handle, receiver, initial));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sound_settings::{SoundScene, SoundSettings};
    use crate::time::types::{AlarmNotice, AlarmNoticeKind};

    #[test]
    fn failed_alarm_start_does_not_commit_identity_and_can_recover() {
        let mut active = None;
        let desired = Some(("alarm:one".into(), "bell-rise".into()));
        assert!(reconcile_alarm(&mut active, desired.clone(), |_| Err(
            "audio device unavailable".into()
        ))
        .is_err());
        assert_eq!(active, None);
        let mut starts = 0;
        reconcile_alarm(&mut active, desired.clone(), |_| {
            starts += 1;
            Ok(())
        })
        .unwrap();
        assert_eq!(active, desired);
        assert_eq!(starts, 1);
        reconcile_alarm(&mut active, desired.clone(), |_| {
            starts += 1;
            Ok(())
        })
        .unwrap();
        assert_eq!(starts, 1);
        reconcile_alarm(&mut active, None, |_| unreachable!()).unwrap();
        assert_eq!(active, None);
    }

    #[test]
    #[ignore = "requires a native audio output device"]
    fn native_output_plays_loops_and_stops() {
        let mut engine = AudioEngine::new().unwrap();
        engine.play("bell-rise", 0, true).unwrap();
        assert!(!engine.alarm.empty());
        assert_eq!(engine.alarm.volume(), 0.0);
        engine.stop_alarm();
        assert!(engine.alarm.empty());
        engine.play("chime-glass", 0, false).unwrap();
        engine.singles.sleep_until_end();
        assert!(engine.singles.empty());
    }

    #[test]
    fn all_bundled_sounds_decode_as_mono_pcm() {
        for id in [
            "chime-glass",
            "chime-wood",
            "bell-rise",
            "beep-soft",
            "tap",
            "low-knock",
            "resolve",
            "done-blip",
        ] {
            let source = Decoder::try_from(Cursor::new(sound_bytes(id).unwrap())).unwrap();
            assert_eq!(source.channels(), 1);
            assert_eq!(source.sample_rate(), 44100);
            assert!(source.count() >= 17640);
        }
        assert!(sound_bytes("unknown").is_err());
    }

    fn notice(id: &str, kind: AlarmNoticeKind) -> AlarmNotice {
        AlarmNotice {
            id: id.into(),
            kind,
            title: "Test".into(),
            due_at: "2026-10-14T10:00:00Z".into(),
            alarm_id: Some("alarm-1".into()),
            count: 1,
            range_start: "2026-10-14T10:00:00Z".into(),
            range_end: "2026-10-14T10:00:00Z".into(),
        }
    }

    #[test]
    fn alarms_stop_when_removed_and_ignore_legacy_mute_settings() {
        let mut coordinator = SoundCoordinator::new(&[]);
        let mut settings = SoundSettings::default();
        let alarm = notice("alarm:one", AlarmNoticeKind::Alarm);
        let plan = coordinator.sample(&settings, &[alarm.clone()]);
        assert_eq!(plan.alarm, Some((alarm.id.clone(), "bell-rise".into())));
        assert_eq!(coordinator.sample(&settings, &[]).alarm, None);
        assert_eq!(
            coordinator.sample(&settings, &[alarm.clone()]).alarm,
            plan.alarm
        );
        settings.enabled = false;
        assert_eq!(coordinator.sample(&settings, &[alarm.clone()]).alarm, plan.alarm);
        settings.enabled = true;
        settings.volume = 0;
        assert_eq!(coordinator.sample(&settings, &[alarm.clone()]).alarm, plan.alarm);
        settings.volume = 20;
        settings.alarm = "none".into();
        assert_eq!(coordinator.sample(&settings, &[alarm]).alarm, plan.alarm);
    }

    #[test]
    fn summaries_are_once_only_and_existing_summaries_do_not_replay_on_startup() {
        let old = notice("summary:old", AlarmNoticeKind::MissedSummary);
        let fresh = notice("summary:new", AlarmNoticeKind::MissedSummary);
        let settings = SoundSettings::default();
        let mut coordinator = SoundCoordinator::new(&[old.clone()]);
        assert!(coordinator
            .sample(&settings, &[old.clone()])
            .singles
            .is_empty());
        assert_eq!(
            coordinator
                .sample(&settings, &[old.clone(), fresh.clone()])
                .singles,
            vec![SoundScene::MissedSummary]
        );
        assert!(coordinator
            .sample(&settings, &[old, fresh])
            .singles
            .is_empty());
        let muted = notice("summary:muted", AlarmNoticeKind::MissedSummary);
        let mut off = settings.clone();
        off.enabled = false;
        assert_eq!(
            coordinator.sample(&off, &[muted.clone()]).singles,
            vec![SoundScene::MissedSummary]
        );
        assert!(coordinator.sample(&settings, &[muted]).singles.is_empty());
    }

    #[test]
    fn single_notifications_use_system_volume_and_ignore_legacy_mute() {
        let mut coordinator = SoundCoordinator::new(&[]);
        let mut settings = SoundSettings::default();
        assert_eq!(
            coordinator.single(&settings, SoundScene::Calendar, "event:1"),
            Some(("chime-glass".into(), 100))
        );
        assert_eq!(
            coordinator.single(&settings, SoundScene::Calendar, "event:1"),
            None
        );
        settings.enabled = false;
        assert_eq!(
            coordinator.single(&settings, SoundScene::Focus, "session:1"),
            Some(("resolve".into(), 100))
        );
        settings.enabled = true;
        assert_eq!(
            coordinator.single(&settings, SoundScene::Focus, "session:1"),
            None
        );
        assert_eq!(
            coordinator.single(&settings, SoundScene::Focus, "session:2"),
            Some(("resolve".into(), 100))
        );
    }

    fn ringing_candidates(connection: &rusqlite::Connection, now: chrono::DateTime<chrono::Utc>) -> Vec<AlarmNotice> {
        crate::time::scheduler::list_ringing_alarm_notices(connection, now).unwrap()
    }

    #[test]
    fn ringing_expires_but_notice_remains_pending() {
        let mut connection = rusqlite::Connection::open_in_memory().unwrap();
        crate::db::migrate(&mut connection).unwrap();
        connection.execute("INSERT INTO alarm_notices (id,kind,instance_key,title,due_at_utc,range_start_utc,range_end_utc,count,created_at_utc) VALUES ('alarm:one','alarm','key-1','Test','2026-10-14T10:00:00Z','2026-10-14T10:00:00Z','2026-10-14T10:00:00Z',1,'2026-10-14T10:00:00Z')", []).unwrap();
        let now = chrono::DateTime::parse_from_rfc3339("2026-10-14T10:00:00Z").unwrap().with_timezone(&chrono::Utc);
        for seconds in [0, 59, 60, 120] {
            let at = now + chrono::Duration::seconds(seconds);
            let ringing = ringing_candidates(&connection, at);
            assert_eq!(ringing.len(), usize::from(seconds < 60));
            assert_eq!(crate::time::scheduler::list_alarm_notices(&connection, at).unwrap().len(), 1);
        }
        crate::time::scheduler::snooze_notice(&mut connection, "alarm:one", now).unwrap();
        for seconds in [0, 299, 300, 359, 360] {
            let ringing = ringing_candidates(&connection, now + chrono::Duration::seconds(seconds));
            assert_eq!(ringing.len(), usize::from((300..360).contains(&seconds)));
        }
        crate::time::scheduler::acknowledge_notice(&mut connection, "alarm:one", now).unwrap();
        assert!(ringing_candidates(&connection, now + chrono::Duration::seconds(300)).is_empty());
        connection.execute("UPDATE alarm_notices SET acknowledged_at_utc=NULL, snoozed_until_utc=NULL", []).unwrap();
        connection.execute("INSERT INTO alarm_notices (id,kind,instance_key,title,due_at_utc,range_start_utc,range_end_utc,count,created_at_utc) VALUES ('alarm:new','alarm','key-new','New','2026-10-14T10:02:00Z','2026-10-14T10:02:00Z','2026-10-14T10:02:00Z',1,'2026-10-14T10:02:00Z')", []).unwrap();
        let later = now + chrono::Duration::seconds(120);
        let ringing = ringing_candidates(&connection, later);
        assert_eq!(ringing.len(), 1);
        assert_eq!(ringing[0].id, "alarm:new");
        assert_eq!(crate::time::scheduler::list_alarm_notices(&connection, later).unwrap().len(), 2);
    }

    #[test]
    fn snooze_and_acknowledgement_control_the_native_alarm_plan() {
        let mut connection = rusqlite::Connection::open_in_memory().unwrap();
        crate::db::migrate(&mut connection).unwrap();
        connection.execute("INSERT INTO alarm_notices (id,kind,alarm_id,instance_key,title,due_at_utc,range_start_utc,range_end_utc,count,created_at_utc) VALUES ('notice-1','alarm',NULL,'key-1','Test','2026-10-14T10:00:00Z','2026-10-14T10:00:00Z','2026-10-14T10:00:00Z',1,'2026-10-14T10:00:00Z')", []).unwrap();
        let now = chrono::DateTime::parse_from_rfc3339("2026-10-14T10:00:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc);
        let mut coordinator = SoundCoordinator::new(&[]);
        let settings = SoundSettings::default();
        let visible = crate::time::scheduler::list_alarm_notices(&connection, now).unwrap();
        assert!(coordinator.sample(&settings, &visible).alarm.is_some());
        crate::time::scheduler::snooze_notice(&mut connection, "notice-1", now).unwrap();
        let snoozed = crate::time::scheduler::list_alarm_notices(&connection, now).unwrap();
        assert!(coordinator.sample(&settings, &snoozed).alarm.is_none());
        let later = now + chrono::Duration::minutes(5);
        let resumed = crate::time::scheduler::list_alarm_notices(&connection, later).unwrap();
        assert!(coordinator.sample(&settings, &resumed).alarm.is_some());
        crate::time::scheduler::acknowledge_notice(&mut connection, "notice-1", later).unwrap();
        let acknowledged = crate::time::scheduler::list_alarm_notices(&connection, later).unwrap();
        assert!(coordinator.sample(&settings, &acknowledged).alarm.is_none());
    }
}
