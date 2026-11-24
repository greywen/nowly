//! One voice session at a time: hold → record → transcribe → assistant →
//! result. A single worker thread owns the recording and every state change;
//! slow steps run on helper threads and report back tagged with the session
//! number, so a newer hold always wins over a late result.
use super::{
    asr::{Language, SenseVoice, Transcriber},
    capture::{CaptureError, Recording},
    hotkey::{Hook, Signal},
    model,
    settings::VoiceSettings,
};
use crate::{
    assistant::{
        provider::{self, HistoryMessage, HistoryRole, Request},
        skills, store,
        types::{Plan, Reply, Source},
    },
    db::AppDb,
    error::CommandError,
};
use serde::Serialize;
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager};

pub const EVENT: &str = "voice-session";
pub const LEVEL_EVENT: &str = "voice-level";
const BAR: &str = "quick-panel-handle";
const MIN_SPEECH_MS: u64 = 500;
const LEVEL_EVERY: Duration = Duration::from_millis(50);
const PARTIAL_EVERY: Duration = Duration::from_millis(800);
const ENGINE_IDLE: Duration = Duration::from_secs(10 * 60);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorKind {
    ModelMissing,
    Microphone,
    MicrophoneDenied,
    NotConfigured,
    Empty,
    Failed,
}

/// What the Bar shows; one variant per row of the result table in
/// design.md §12.9.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "phase", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum View {
    Idle,
    Listening { transcript: String },
    Interpreting { transcript: String },
    Created { transcript: String, plan: Plan },
    Confirm { transcript: String, plan: Plan },
    Clarify { transcript: String, message: String },
    Answer { transcript: String, message: String },
    Error { kind: ErrorKind, message: String, transcript: String },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    /// Increments with every hold that reaches Listen.
    pub seq: u64,
    pub hold_key: String,
    /// Held past 150 ms: the Logo slot shows the mic, nothing else changes.
    pub primed: bool,
    #[serde(flatten)]
    pub view: View,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
struct Level {
    seq: u64,
    level: f32,
}

enum Msg {
    Signal(Signal),
    Apply(VoiceSettings),
    Dismiss,
    Unload,
    Partial(u64, String),
    Transcript(u64, String),
    Finished(u64, View),
}

/// Managed state: the channel into the worker plus the last snapshot, for a
/// Bar that reloads mid-session.
pub struct Voice {
    tx: Mutex<mpsc::Sender<Msg>>,
    snapshot: Arc<Mutex<Snapshot>>,
}

impl Voice {
    fn send(&self, msg: Msg) {
        if let Ok(tx) = self.tx.lock() {
            let _ = tx.send(msg);
        }
    }

    pub fn apply(&self, settings: VoiceSettings) {
        self.send(Msg::Apply(settings));
    }

    pub fn dismiss(&self) {
        self.send(Msg::Dismiss);
    }

    /// Frees the model before its files are deleted.
    pub fn unload(&self) {
        self.send(Msg::Unload);
    }

    pub fn snapshot(&self) -> Snapshot {
        match self.snapshot.lock() {
            Ok(snapshot) => snapshot.clone(),
            Err(poisoned) => poisoned.into_inner().clone(),
        }
    }
}

/// Loads SenseVoice once and keeps it while voice input is in use.
#[derive(Default)]
struct Engine {
    slot: Mutex<Option<(Language, Arc<SenseVoice>)>>,
}

impl Engine {
    fn get(&self, dir: &Path, language: Language) -> Result<Arc<SenseVoice>, String> {
        let mut slot = self.slot.lock().map_err(|e| e.to_string())?;
        if let Some((loaded, engine)) = slot.as_ref() {
            if *loaded == language {
                return Ok(engine.clone());
            }
        }
        let engine = Arc::new(SenseVoice::load(dir, language)?);
        *slot = Some((language, engine.clone()));
        Ok(engine)
    }

    /// The engine if it is loaded and not busy loading.
    fn ready(&self) -> Option<Arc<SenseVoice>> {
        self.slot.try_lock().ok()?.as_ref().map(|(_, engine)| engine.clone())
    }

    fn unload(&self) {
        if let Ok(mut slot) = self.slot.try_lock() {
            slot.take();
        }
    }
}

enum Hold {
    None,
    Armed { recording: Result<Recording, CaptureError> },
    Listening { recording: Recording, last_partial: Instant, partial_busy: Arc<AtomicBool> },
}

struct Worker {
    app: AppHandle,
    app_dir: PathBuf,
    rx: mpsc::Receiver<Msg>,
    tx: mpsc::Sender<Msg>,
    settings: VoiceSettings,
    hook: Option<Hook>,
    hold: Hold,
    /// Cancels the transcription/assistant request in flight.
    work: Option<Arc<AtomicBool>>,
    /// The question a Clarify result asked, answered by the next hold.
    clarify: Option<(String, String)>,
    snapshot: Arc<Mutex<Snapshot>>,
    engine: Arc<Engine>,
    last_used: Instant,
    last_level: Instant,
}

pub fn start(app: &AppHandle, app_dir: PathBuf, settings: VoiceSettings) -> Voice {
    let (tx, rx) = mpsc::channel();
    let snapshot = Arc::new(Mutex::new(Snapshot {
        seq: 0,
        hold_key: settings.hold_key.clone(),
        primed: false,
        view: View::Idle,
    }));
    let worker = Worker {
        app: app.clone(),
        app_dir,
        rx,
        tx: tx.clone(),
        // Disabled here so the first Apply installs the hook if enabled.
        settings: VoiceSettings { enabled: false, ..settings.clone() },
        hook: None,
        hold: Hold::None,
        work: None,
        clarify: None,
        snapshot: snapshot.clone(),
        engine: Arc::default(),
        last_used: Instant::now(),
        last_level: Instant::now(),
    };
    if let Err(error) = std::thread::Builder::new().name("voice-session".into()).spawn(move || worker.run()) {
        eprintln!("failed to start voice input: {error}");
    }
    let voice = Voice { tx: Mutex::new(tx), snapshot };
    voice.apply(settings);
    voice
}

impl Worker {
    fn run(mut self) {
        loop {
            let wait = if matches!(self.hold, Hold::Listening { .. }) { LEVEL_EVERY } else { Duration::from_secs(30) };
            match self.rx.recv_timeout(wait) {
                Ok(msg) => self.handle(msg),
                Err(mpsc::RecvTimeoutError::Timeout) => self.idle_tick(),
                Err(mpsc::RecvTimeoutError::Disconnected) => return,
            }
            self.listening_tick();
        }
    }

    fn seq(&self) -> u64 {
        self.snapshot.lock().map(|s| s.seq).unwrap_or(0)
    }

    fn update(&self, change: impl FnOnce(&mut Snapshot)) {
        let snapshot = {
            let Ok(mut snapshot) = self.snapshot.lock() else { return };
            change(&mut snapshot);
            snapshot.clone()
        };
        if let Err(error) = self.app.emit_to(BAR, EVENT, snapshot) {
            eprintln!("failed to emit voice state: {error}");
        }
    }

    fn show(&self, view: View) {
        self.update(|snapshot| {
            snapshot.primed = false;
            snapshot.view = view;
        });
    }

    fn handle(&mut self, msg: Msg) {
        match msg {
            Msg::Signal(signal) => self.signal(signal),
            Msg::Apply(settings) => self.apply(settings),
            Msg::Dismiss => {
                if matches!(self.hold, Hold::None) {
                    self.cancel_work();
                    self.clarify = None;
                    self.show(View::Idle);
                }
            }
            Msg::Unload => self.engine.unload(),
            Msg::Partial(seq, text) => {
                if seq == self.seq() && matches!(self.hold, Hold::Listening { .. }) && !text.is_empty() {
                    self.show(View::Listening { transcript: text });
                }
            }
            Msg::Transcript(seq, transcript) => {
                if seq == self.seq() && self.work.is_some() {
                    self.show(View::Interpreting { transcript });
                }
            }
            Msg::Finished(seq, view) => {
                if seq != self.seq() || self.work.take().is_none() {
                    return;
                }
                self.clarify = match &view {
                    View::Clarify { transcript, message } => Some((transcript.clone(), message.clone())),
                    _ => None,
                };
                if matches!(view, View::Created { .. }) {
                    let _ = crate::status_island::invalidate_registered();
                }
                self.show(view);
            }
        }
    }

    fn apply(&mut self, settings: VoiceSettings) {
        let rebind = settings.enabled != self.settings.enabled || settings.hold_key != self.settings.hold_key;
        if settings.language != self.settings.language {
            self.engine.unload();
        }
        self.settings = settings;
        let hold_key = self.settings.hold_key.clone();
        if let Ok(mut snapshot) = self.snapshot.lock() {
            snapshot.hold_key = hold_key;
        }
        if !rebind {
            return;
        }
        self.hook = None;
        self.hold = Hold::None;
        if self.settings.enabled {
            let tx = self.tx.clone();
            match Hook::install(self.settings.spec(), move |signal| {
                let _ = tx.send(Msg::Signal(signal));
            }) {
                Ok(hook) => self.hook = Some(hook),
                Err(error) => eprintln!("failed to install voice hotkey: {error}"),
            }
        }
    }

    fn cancel_work(&mut self) {
        if let Some(cancel) = self.work.take() {
            cancel.store(true, Ordering::SeqCst);
        }
    }

    fn signal(&mut self, signal: Signal) {
        match signal {
            Signal::Start if crate::screen_capture::is_active(&self.app) => {}
            Signal::Start => {
                // Opening the device now keeps the first syllable; nothing
                // visible changes until Prime, and a quick tap leaves any
                // result or request in flight alone.
                let recording = Recording::start(self.settings.device.as_deref());
                self.hold = Hold::Armed { recording };
                self.preload();
            }
            Signal::Prime => {
                if matches!(self.hold, Hold::Armed { .. }) {
                    self.update(|snapshot| snapshot.primed = true);
                }
            }
            Signal::Listen => self.listen(),
            Signal::Release => self.release(),
            Signal::Cancel => match std::mem::replace(&mut self.hold, Hold::None) {
                Hold::Armed { .. } => {
                    if self.snapshot.lock().map(|s| s.primed).unwrap_or(false) {
                        self.update(|snapshot| snapshot.primed = false);
                    }
                }
                Hold::Listening { .. } => self.show(View::Idle),
                Hold::None => {}
            },
        }
    }

    fn preload(&self) {
        if !model::status(&self.app_dir).installed || self.engine.ready().is_some() {
            return;
        }
        let engine = self.engine.clone();
        let dir = model::dir(&self.app_dir);
        let language = self.settings.language;
        std::thread::spawn(move || {
            if let Err(error) = engine.get(&dir, language) {
                eprintln!("failed to load the voice model: {error}");
            }
        });
    }

    fn listen(&mut self) {
        let Hold::Armed { recording } = std::mem::replace(&mut self.hold, Hold::None) else { return };
        // A new hold replaces whatever the Bar was showing.
        self.cancel_work();
        self.last_used = Instant::now();
        self.update(|snapshot| snapshot.seq += 1);
        let failure = match recording {
            Err(error) => Some(capture_error(&error)),
            Ok(_) if !model::status(&self.app_dir).installed => Some((
                ErrorKind::ModelMissing,
                "需要先下载语音识别模型。".to_owned(),
            )),
            Ok(_) if !assistant_ready(&self.app) => Some((
                ErrorKind::NotConfigured,
                "请先在模型设置中连接 AI 服务。".to_owned(),
            )),
            Ok(recording) => {
                self.hold = Hold::Listening {
                    recording,
                    last_partial: Instant::now(),
                    partial_busy: Arc::default(),
                };
                None
            }
        };
        match failure {
            Some((kind, message)) => {
                self.clarify = None;
                self.show(View::Error { kind, message, transcript: String::new() });
            }
            None => self.show(View::Listening { transcript: String::new() }),
        }
    }

    fn release(&mut self) {
        let Hold::Listening { recording, .. } = std::mem::replace(&mut self.hold, Hold::None) else {
            // Released after an error at Listen: the error stays.
            return;
        };
        let transcript = match &self.snapshot.lock().map(|s| s.view.clone()) {
            Ok(View::Listening { transcript }) => transcript.clone(),
            _ => String::new(),
        };
        let failure = recording.failure();
        let duration = recording.duration_ms();
        let samples = recording.finish();
        if let Some(error) = failure {
            self.show(View::Error { kind: ErrorKind::Microphone, message: format!("麦克风中断：{error}"), transcript });
            return;
        }
        if duration < MIN_SPEECH_MS {
            self.show(View::Error { kind: ErrorKind::Empty, message: "没有听清，请再试一次。".into(), transcript });
            return;
        }
        let cancel = Arc::new(AtomicBool::new(false));
        self.work = Some(cancel.clone());
        self.show(View::Interpreting { transcript });
        let job = Job {
            app: self.app.clone(),
            dir: model::dir(&self.app_dir),
            engine: self.engine.clone(),
            language: self.settings.language,
            seq: self.seq(),
            cancel,
            history: self.clarify.take().map(history).unwrap_or_default(),
            tx: self.tx.clone(),
        };
        std::thread::spawn(move || job.run(samples));
    }

    fn listening_tick(&mut self) {
        if matches!(&self.hold, Hold::Listening { recording, .. } if recording.is_full()) {
            // The 60 s cap ends the hold as if the key were released.
            self.release();
            return;
        }
        let seq = self.seq();
        let Hold::Listening { recording, last_partial, partial_busy } = &mut self.hold else { return };
        if self.last_level.elapsed() >= LEVEL_EVERY {
            self.last_level = Instant::now();
            let _ = self.app.emit_to(BAR, LEVEL_EVENT, Level { seq, level: recording.level() });
        }
        if last_partial.elapsed() < PARTIAL_EVERY || partial_busy.load(Ordering::SeqCst) {
            return;
        }
        let Some(engine) = self.engine.ready() else { return };
        *last_partial = Instant::now();
        partial_busy.store(true, Ordering::SeqCst);
        let samples = recording.snapshot();
        let busy = partial_busy.clone();
        let tx = self.tx.clone();
        std::thread::spawn(move || {
            if let Ok(text) = engine.transcribe(&samples) {
                let _ = tx.send(Msg::Partial(seq, text));
            }
            busy.store(false, Ordering::SeqCst);
        });
    }

    fn idle_tick(&mut self) {
        if matches!(self.hold, Hold::None) && self.work.is_none() && self.last_used.elapsed() > ENGINE_IDLE {
            self.engine.unload();
        }
    }
}

fn capture_error(error: &CaptureError) -> (ErrorKind, String) {
    let kind = match error {
        CaptureError::Denied => ErrorKind::MicrophoneDenied,
        _ => ErrorKind::Microphone,
    };
    (kind, error.to_string())
}

fn assistant_ready(app: &AppHandle) -> bool {
    let state = app.state::<AppDb>();
    let Ok(db) = state.0.lock() else { return false };
    provider::get_config(&db).is_ok_and(|config| {
        (config.has_key || provider::is_local(&config.endpoint)) && !config.model.is_empty()
    })
}

/// Answering a clarifying question: the model sees what was asked and what
/// it asked back.
fn history((said, asked): (String, String)) -> Vec<HistoryMessage> {
    vec![
        HistoryMessage { role: HistoryRole::User, content: said },
        HistoryMessage { role: HistoryRole::Assistant, content: asked },
    ]
}

struct Job {
    app: AppHandle,
    dir: PathBuf,
    engine: Arc<Engine>,
    language: Language,
    seq: u64,
    cancel: Arc<AtomicBool>,
    history: Vec<HistoryMessage>,
    tx: mpsc::Sender<Msg>,
}

impl Job {
    fn run(self, samples: Vec<f32>) {
        let view = self.interpret(samples);
        let _ = self.tx.send(Msg::Finished(self.seq, view));
    }

    fn interpret(&self, samples: Vec<f32>) -> View {
        let error = |kind, message: String, transcript: &str| View::Error {
            kind,
            message,
            transcript: transcript.to_owned(),
        };
        let text = match self.engine.get(&self.dir, self.language).and_then(|e| e.transcribe(&samples)) {
            Ok(text) => text,
            Err(message) => return error(ErrorKind::ModelMissing, message, ""),
        };
        drop(samples);
        if text.trim().is_empty() {
            return error(ErrorKind::Empty, "没有听清，请再试一次。".into(), "");
        }
        let _ = self.tx.send(Msg::Transcript(self.seq, text.clone()));
        let request = Request {
            request_id: uuid::Uuid::new_v4().to_string(),
            message: text.clone(),
            history: self.history.clone(),
            previous_plan_id: None,
        };
        let db = &self.app.state::<AppDb>().0;
        let reply = provider::run_with_source(db, &request, Source::Voice, &self.cancel, provider::send_http);
        match reply {
            Ok(reply) => outcome(reply, text, &self.cancel, |plan| execute(db, plan), |plan| {
                if let Ok(db) = db.lock() {
                    let _ = store::cancel(&db, &plan.id);
                }
            }),
            Err(failure) => error(ErrorKind::Failed, failure.message, &text),
        }
    }
}

fn execute(db: &Mutex<rusqlite::Connection>, plan: &Plan) -> Result<Plan, CommandError> {
    let db = db.lock().map_err(CommandError::database)?;
    let permissions = provider::get_config(&db)?.permissions;
    store::execute(&db, &plan.id, &permissions)
}

/// Decides what the Bar shows for an assistant reply. Only a voice plan made
/// entirely of creates is committed without a click; the model's output
/// cannot change that.
fn outcome(
    reply: Reply,
    transcript: String,
    cancelled: &AtomicBool,
    execute: impl FnOnce(&Plan) -> Result<Plan, CommandError>,
    discard: impl FnOnce(&Plan),
) -> View {
    match (reply.kind.as_str(), reply.plan) {
        ("plan", Some(plan)) => {
            if !skills::auto_commit(Source::Voice, &plan.actions) {
                return View::Confirm { transcript, plan };
            }
            if cancelled.load(Ordering::SeqCst) {
                discard(&plan);
                return View::Idle;
            }
            match execute(&plan) {
                Ok(plan) => View::Created { transcript, plan },
                Err(failure) => View::Error { kind: ErrorKind::Failed, message: failure.message, transcript },
            }
        }
        ("clarify", _) => View::Clarify { transcript, message: reply.message },
        _ => View::Answer { transcript, message: reply.message },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::assistant::types::Action;
    use serde_json::json;
    use std::cell::Cell;

    fn plan(actions: Vec<Action>) -> Plan {
        Plan {
            id: "p".into(),
            status: "pending".into(),
            created_at: 0,
            expires_at: 0,
            revision: 0,
            actions,
            changes: vec![],
            warnings: vec![],
            options: json!({}),
        }
    }

    fn reply(kind: &str, plan: Option<Plan>) -> Reply {
        Reply { kind: kind.into(), message: "m".into(), records: vec![], plan }
    }

    fn create() -> Action {
        Action::CreateNote { draft: json!({"content": "x"}) }
    }

    #[test]
    fn creates_commit_immediately() {
        let executed = Cell::new(false);
        let view = outcome(reply("plan", Some(plan(vec![create(), create()]))), "t".into(), &AtomicBool::new(false),
            |p| { executed.set(true); Ok(Plan { status: "executed".into(), ..p.clone() }) }, |_| panic!());
        assert!(executed.get());
        assert!(matches!(view, View::Created { plan, .. } if plan.status == "executed"));
    }

    #[test]
    fn any_modify_or_delete_waits_for_confirmation() {
        let actions = vec![create(), Action::DeleteNote { id: "n".into() }];
        let view = outcome(reply("plan", Some(plan(actions))), "t".into(), &AtomicBool::new(false),
            |_| panic!("must not execute"), |_| panic!());
        assert!(matches!(view, View::Confirm { .. }));
    }

    #[test]
    fn cancelled_creates_are_discarded_not_executed() {
        let discarded = Cell::new(false);
        let view = outcome(reply("plan", Some(plan(vec![create()]))), "t".into(), &AtomicBool::new(true),
            |_| panic!("must not execute"), |_| discarded.set(true));
        assert!(discarded.get());
        assert!(matches!(view, View::Idle));
    }

    #[test]
    fn execute_failure_and_other_replies_map_to_views() {
        let view = outcome(reply("plan", Some(plan(vec![create()]))), "t".into(), &AtomicBool::new(false),
            |_| Err(CommandError::conflict("changed")), |_| {});
        assert!(matches!(view, View::Error { kind: ErrorKind::Failed, ref message, .. } if message == "changed"));
        let never = |_: &Plan| -> Result<Plan, CommandError> { panic!() };
        assert!(matches!(outcome(reply("clarify", None), "t".into(), &AtomicBool::new(false), never, |_| {}), View::Clarify { .. }));
        assert!(matches!(outcome(reply("answer", None), "t".into(), &AtomicBool::new(false), never, |_| {}), View::Answer { .. }));
    }

    #[test]
    fn snapshot_serializes_flat_for_the_bar() {
        let snapshot = Snapshot {
            seq: 3,
            hold_key: "Ctrl+Super".into(),
            primed: false,
            view: View::Error { kind: ErrorKind::ModelMissing, message: "m".into(), transcript: String::new() },
        };
        assert_eq!(
            serde_json::to_value(snapshot).unwrap(),
            json!({"seq":3,"holdKey":"Ctrl+Super","primed":false,"phase":"error","kind":"modelMissing","message":"m","transcript":""})
        );
    }

    #[test]
    fn clarify_history_carries_question_and_answer_roles() {
        let messages = history(("开会".into(), "几点？".into()));
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].role, HistoryRole::User);
        assert_eq!(messages[1].content, "几点？");
    }
}
