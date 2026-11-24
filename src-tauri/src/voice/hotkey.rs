//! Hold-to-talk trigger. A low-level keyboard hook sees modifier-only combos
//! such as `Ctrl+Win`, which `RegisterHotKey` cannot. The decision logic is
//! the pure [`Machine`] so it can be tested without an OS hook.
use std::collections::BTreeSet;

/// Recording starts the moment the combo is complete so the first syllable is
/// not lost; the Bar only reacts once the hold is clearly intentional.
pub const PRIME_MS: u64 = 150;
pub const LISTEN_MS: u64 = 300;

const CTRL: u8 = 1;
const ALT: u8 = 2;
const SHIFT: u8 = 4;
const WIN: u8 = 8;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HoldSpec {
    mods: u8,
    key: Option<u16>,
}

impl Default for HoldSpec {
    fn default() -> Self {
        Self { mods: CTRL | WIN, key: None }
    }
}

pub const DEFAULT_SPEC: &str = "Ctrl+Super";

impl HoldSpec {
    /// Accepts two or more modifiers (`Ctrl+Super`), modifiers plus one key
    /// (`Ctrl+Alt+V`), or a lone function key (`F8`).
    pub fn parse(value: &str) -> Result<Self, String> {
        let invalid = || format!("无效的按键：{value}");
        let mut mods = 0;
        let mut key = None;
        for part in value.split('+').map(str::trim) {
            let bit = match part.to_ascii_lowercase().as_str() {
                "ctrl" | "control" => CTRL,
                "alt" => ALT,
                "shift" => SHIFT,
                "super" | "win" | "meta" => WIN,
                _ => 0,
            };
            if bit != 0 {
                if mods & bit != 0 {
                    return Err(invalid());
                }
                mods |= bit;
                continue;
            }
            if key.is_some() {
                return Err(invalid());
            }
            key = Some(key_code(part).ok_or_else(invalid)?);
        }
        let function_key = key.is_some_and(|vk| (0x70..=0x87).contains(&vk));
        let valid = match key {
            None => mods.count_ones() >= 2,
            Some(_) => mods != 0 || function_key,
        };
        valid.then_some(Self { mods, key }).ok_or_else(invalid)
    }

    /// Canonical text, in the same modifier order as the global shortcuts.
    pub fn canonical(&self) -> String {
        let mut parts: Vec<String> = [(CTRL, "Ctrl"), (ALT, "Alt"), (SHIFT, "Shift"), (WIN, "Super")]
            .into_iter()
            .filter(|(bit, _)| self.mods & bit != 0)
            .map(|(_, name)| name.to_owned())
            .collect();
        if let Some(vk) = self.key {
            parts.push(key_name(vk));
        }
        parts.join("+")
    }

    /// Whether this hold uses a non-modifier key, which the hook then hides
    /// from the foreground app.
    pub fn has_key(&self) -> bool {
        self.key.is_some()
    }

    fn contains(&self, vk: u16) -> bool {
        self.key == Some(vk) || modifier_bit(vk).is_some_and(|bit| self.mods & bit != 0)
    }
}

fn key_code(part: &str) -> Option<u16> {
    let upper = part.to_ascii_uppercase();
    if upper.len() == 1 {
        let c = upper.as_bytes()[0];
        return c.is_ascii_alphanumeric().then_some(c as u16);
    }
    if upper == "SPACE" {
        return Some(0x20);
    }
    let n = upper.strip_prefix('F')?.parse::<u16>().ok()?;
    (1..=24).contains(&n).then_some(0x6F + n)
}

fn key_name(vk: u16) -> String {
    match vk {
        0x20 => "Space".into(),
        0x70..=0x87 => format!("F{}", vk - 0x6F),
        _ => (vk as u8 as char).to_string(),
    }
}

fn modifier_bit(vk: u16) -> Option<u8> {
    match vk {
        0x10 | 0xA0 | 0xA1 => Some(SHIFT),
        0x11 | 0xA2 | 0xA3 => Some(CTRL),
        0x12 | 0xA4 | 0xA5 => Some(ALT),
        0x5B | 0x5C => Some(WIN),
        _ => None,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Signal {
    /// Combo complete: start buffering audio.
    Start,
    /// Held long enough to show the mic hint.
    Prime,
    /// Held long enough to count as a deliberate hold.
    Listen,
    /// Released after `Listen`.
    Release,
    /// Released early or interrupted by another key: discard the audio.
    Cancel,
}

/// What the hook must do with the current key event.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Verdict {
    /// Hide the event from the foreground app.
    pub swallow: bool,
    /// Swallow this key-up and re-send it after the mask key, so Win does not
    /// open Start and Alt does not focus a menu bar.
    pub mask: bool,
    /// Re-send a swallowed key as a tap: the user only tapped it.
    pub replay: Option<u16>,
    pub signal: Option<Signal>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    Idle,
    Held { since: u64, primed: bool, listening: bool },
    /// Interrupted; waits for every combo key to be released.
    Blocked,
}

pub struct Machine {
    spec: HoldSpec,
    down: BTreeSet<u16>,
    phase: Phase,
    main_swallowed: bool,
    mask_armed: bool,
}

impl Machine {
    pub fn new(spec: HoldSpec) -> Self {
        Self { spec, down: BTreeSet::new(), phase: Phase::Idle, main_swallowed: false, mask_armed: false }
    }

    pub fn is_held(&self) -> bool {
        matches!(self.phase, Phase::Held { .. })
    }

    fn mods_down(&self) -> u8 {
        self.down.iter().filter_map(|vk| modifier_bit(*vk)).fold(0, |a, b| a | b)
    }

    fn plain_keys_down(&self) -> usize {
        self.down.iter().filter(|vk| modifier_bit(**vk).is_none()).count()
    }

    fn arm(&mut self, now: u64) -> Verdict {
        self.phase = Phase::Held { since: now, primed: false, listening: false };
        self.mask_armed = self.spec.mods & (WIN | ALT) != 0;
        Verdict { signal: Some(Signal::Start), ..Default::default() }
    }

    pub fn key_down(&mut self, vk: u16, now: u64) -> Verdict {
        let repeat = !self.down.insert(vk);
        let is_main = self.spec.key == Some(vk);
        match self.phase {
            Phase::Held { .. } => {
                if is_main {
                    return Verdict { swallow: true, ..Default::default() };
                }
                if repeat && self.spec.contains(vk) {
                    return Verdict::default();
                }
                self.phase = Phase::Blocked;
                Verdict { signal: Some(Signal::Cancel), ..Default::default() }
            }
            Phase::Blocked => Verdict { swallow: is_main && self.main_swallowed, ..Default::default() },
            Phase::Idle => {
                if repeat || self.mods_down() != self.spec.mods {
                    return Verdict::default();
                }
                match self.spec.key {
                    None if modifier_bit(vk).is_some() && self.plain_keys_down() == 0 => self.arm(now),
                    Some(_) if is_main && self.plain_keys_down() == 1 => {
                        self.main_swallowed = true;
                        Verdict { swallow: true, ..self.arm(now) }
                    }
                    _ => Verdict::default(),
                }
            }
        }
    }

    pub fn key_up(&mut self, vk: u16) -> Verdict {
        self.down.remove(&vk);
        let mut verdict = Verdict::default();
        if self.main_swallowed && self.spec.key == Some(vk) {
            self.main_swallowed = false;
            verdict.swallow = true;
        }
        if self.mask_armed && matches!(modifier_bit(vk), Some(WIN | ALT)) {
            verdict.mask = true;
            if self.mods_down() & (WIN | ALT) == 0 {
                self.mask_armed = false;
            }
        }
        match self.phase {
            Phase::Held { listening, .. } if self.spec.contains(vk) => {
                self.phase = Phase::Idle;
                if listening {
                    verdict.signal = Some(Signal::Release);
                } else {
                    verdict.signal = Some(Signal::Cancel);
                    if verdict.swallow {
                        verdict.replay = Some(vk);
                    }
                }
            }
            Phase::Blocked if !self.down.iter().any(|vk| self.spec.contains(*vk)) => {
                self.phase = Phase::Idle;
            }
            _ => {}
        }
        verdict
    }

    /// Advances the hold timers; may return both signals if ticks were late.
    pub fn tick(&mut self, now: u64) -> Vec<Signal> {
        let mut signals = Vec::new();
        if let Phase::Held { since, primed, listening } = &mut self.phase {
            let held = now.saturating_sub(*since);
            if !*primed && held >= PRIME_MS {
                *primed = true;
                signals.push(Signal::Prime);
            }
            if !*listening && held >= LISTEN_MS {
                *listening = true;
                signals.push(Signal::Listen);
            }
        }
        signals
    }
}

#[cfg(windows)]
pub use native::Hook;

#[cfg(not(windows))]
pub struct Hook;

#[cfg(not(windows))]
impl Hook {
    pub fn install(_: HoldSpec, _: impl Fn(Signal) + Send + 'static) -> Result<Self, String> {
        Err("当前系统不支持按住说话。".into())
    }
}

#[cfg(windows)]
mod native {
    use super::{HoldSpec, Machine, Signal, Verdict};
    use std::{cell::RefCell, sync::mpsc, thread::JoinHandle, time::Instant};
    use windows::Win32::{
        Foundation::{LPARAM, LRESULT, WPARAM},
        System::Threading::GetCurrentThreadId,
        UI::Input::KeyboardAndMouse::{
            SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS,
            KEYEVENTF_KEYUP, VIRTUAL_KEY,
        },
        UI::WindowsAndMessaging::{
            CallNextHookEx, GetMessageW, KillTimer, PostThreadMessageW, SetTimer,
            SetWindowsHookExW, UnhookWindowsHookEx, HC_ACTION, KBDLLHOOKSTRUCT, MSG,
            WH_KEYBOARD_LL, WM_KEYDOWN, WM_QUIT, WM_SYSKEYDOWN, WM_TIMER,
        },
    };

    /// Marks events this hook injects so it can ignore them.
    const MARK: usize = 0x4E57_4C59; // "NWLY"
    /// An unassigned virtual key; Windows treats it as "another key was
    /// pressed", which cancels Start and menu-bar activation.
    const MASK_KEY: u16 = 0xE8;
    const TICK_MS: u32 = 20;

    struct State {
        machine: Machine,
        started: Instant,
        timer: usize,
        sink: Box<dyn Fn(Signal)>,
    }

    thread_local! {
        static STATE: RefCell<Option<State>> = const { RefCell::new(None) };
    }

    pub struct Hook {
        thread_id: u32,
        thread: Option<JoinHandle<()>>,
    }

    impl Hook {
        /// Installs the hook on its own message-loop thread. `sink` runs on
        /// that thread and must not block.
        pub fn install(spec: HoldSpec, sink: impl Fn(Signal) + Send + 'static) -> Result<Self, String> {
            let (ready_tx, ready_rx) = mpsc::channel();
            let thread = std::thread::Builder::new()
                .name("voice-hotkey".into())
                .spawn(move || unsafe {
                    let hook = match SetWindowsHookExW(WH_KEYBOARD_LL, Some(hook_proc), None, 0) {
                        Ok(hook) => hook,
                        Err(error) => {
                            let _ = ready_tx.send(Err(error.to_string()));
                            return;
                        }
                    };
                    STATE.with(|state| {
                        *state.borrow_mut() = Some(State {
                            machine: Machine::new(spec),
                            started: Instant::now(),
                            timer: 0,
                            sink: Box::new(sink),
                        })
                    });
                    let _ = ready_tx.send(Ok(GetCurrentThreadId()));
                    let mut msg = MSG::default();
                    while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                        if msg.message == WM_TIMER {
                            on_tick();
                        }
                    }
                    let _ = UnhookWindowsHookEx(hook);
                    STATE.with(|state| state.borrow_mut().take());
                })
                .map_err(|e| e.to_string())?;
            match ready_rx.recv() {
                Ok(Ok(thread_id)) => Ok(Self { thread_id, thread: Some(thread) }),
                Ok(Err(error)) => {
                    let _ = thread.join();
                    Err(error)
                }
                Err(_) => Err("按键监听线程意外退出。".into()),
            }
        }
    }

    impl Drop for Hook {
        fn drop(&mut self) {
            unsafe {
                let _ = PostThreadMessageW(self.thread_id, WM_QUIT, WPARAM(0), LPARAM(0));
            }
            if let Some(thread) = self.thread.take() {
                let _ = thread.join();
            }
        }
    }

    fn now(state: &State) -> u64 {
        state.started.elapsed().as_millis() as u64
    }

    fn sync_timer(state: &mut State) {
        unsafe {
            if state.machine.is_held() && state.timer == 0 {
                state.timer = SetTimer(None, 0, TICK_MS, None);
            } else if !state.machine.is_held() && state.timer != 0 {
                let _ = KillTimer(None, state.timer);
                state.timer = 0;
            }
        }
    }

    fn on_tick() {
        STATE.with(|cell| {
            let mut guard = cell.borrow_mut();
            let Some(state) = guard.as_mut() else { return };
            let now = now(state);
            for signal in state.machine.tick(now) {
                (state.sink)(signal);
            }
            sync_timer(state);
        });
    }

    fn key(vk: u16, up: bool) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(vk),
                    wScan: 0,
                    dwFlags: if up { KEYEVENTF_KEYUP } else { KEYBD_EVENT_FLAGS(0) },
                    time: 0,
                    dwExtraInfo: MARK,
                },
            },
        }
    }

    fn send(inputs: &[INPUT]) {
        unsafe {
            SendInput(inputs, std::mem::size_of::<INPUT>() as i32);
        }
    }

    unsafe extern "system" fn hook_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code == HC_ACTION as i32 {
            let info = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
            if info.dwExtraInfo != MARK {
                let vk = info.vkCode as u16;
                let down = matches!(wparam.0 as u32, WM_KEYDOWN | WM_SYSKEYDOWN);
                let verdict = STATE.with(|cell| {
                    let mut guard = cell.try_borrow_mut().ok()?;
                    let state = guard.as_mut()?;
                    let now = now(state);
                    let verdict = if down { state.machine.key_down(vk, now) } else { state.machine.key_up(vk) };
                    if let Some(signal) = verdict.signal {
                        (state.sink)(signal);
                    }
                    sync_timer(state);
                    Some(verdict)
                });
                if let Some(Verdict { swallow, mask, replay, .. }) = verdict {
                    if let Some(vk) = replay {
                        send(&[key(vk, false), key(vk, true)]);
                    }
                    if mask && !swallow {
                        send(&[key(MASK_KEY, false), key(MASK_KEY, true), key(vk, true)]);
                        return LRESULT(1);
                    }
                    if swallow {
                        return LRESULT(1);
                    }
                }
            }
        }
        CallNextHookEx(None, code, wparam, lparam)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LCTRL: u16 = 0xA2;
    const LWIN: u16 = 0x5B;
    const LALT: u16 = 0xA4;
    const RIGHT: u16 = 0x27;
    const V: u16 = 0x56;
    const F8: u16 = 0x77;

    fn spec(value: &str) -> HoldSpec {
        HoldSpec::parse(value).unwrap()
    }

    #[test]
    fn parses_modifier_combos_keys_and_lone_function_keys() {
        assert_eq!(spec("Ctrl+Win"), HoldSpec::default());
        assert_eq!(spec(DEFAULT_SPEC).canonical(), "Ctrl+Super");
        assert_eq!(spec("alt + ctrl + v").canonical(), "Ctrl+Alt+V");
        assert_eq!(spec("F8").canonical(), "F8");
        for bad in ["Ctrl", "V", "Ctrl+Ctrl+Win", "Ctrl+V+B", "Ctrl+F25", "Ctrl+Esc", ""] {
            assert!(HoldSpec::parse(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn hold_starts_buffering_then_primes_then_listens() {
        let mut m = Machine::new(HoldSpec::default());
        assert_eq!(m.key_down(LCTRL, 0).signal, None);
        let start = m.key_down(LWIN, 10);
        assert_eq!(start, Verdict { signal: Some(Signal::Start), ..Default::default() });
        assert!(m.tick(100).is_empty());
        assert_eq!(m.tick(160), vec![Signal::Prime]);
        // Win autorepeat while held changes nothing.
        assert_eq!(m.key_down(LWIN, 200), Verdict::default());
        assert_eq!(m.tick(310), vec![Signal::Listen]);
        let up = m.key_up(LWIN);
        assert_eq!(up.signal, Some(Signal::Release));
        assert!(up.mask, "Win release after a hold must not open Start");
        assert!(!up.swallow);
        assert_eq!(m.key_up(LCTRL), Verdict::default());
    }

    #[test]
    fn short_press_cancels_and_late_ticks_emit_both_signals() {
        let mut m = Machine::new(HoldSpec::default());
        m.key_down(LWIN, 0);
        m.key_down(LCTRL, 0);
        assert_eq!(m.tick(140), vec![]);
        assert_eq!(m.key_up(LCTRL).signal, Some(Signal::Cancel));
        let mut m = Machine::new(HoldSpec::default());
        m.key_down(LCTRL, 0);
        m.key_down(LWIN, 0);
        assert_eq!(m.tick(500), vec![Signal::Prime, Signal::Listen]);
    }

    #[test]
    fn another_key_cancels_without_being_swallowed_and_blocks_until_release() {
        let mut m = Machine::new(HoldSpec::default());
        m.key_down(LCTRL, 0);
        m.key_down(LWIN, 0);
        let arrow = m.key_down(RIGHT, 50);
        assert_eq!(arrow, Verdict { signal: Some(Signal::Cancel), ..Default::default() });
        assert!(m.tick(400).is_empty());
        m.key_up(RIGHT);
        // Re-pressing Ctrl while Win is still down must not re-arm.
        m.key_up(LCTRL);
        assert_eq!(m.key_down(LCTRL, 500).signal, None);
        m.key_up(LCTRL);
        m.key_up(LWIN);
        m.key_down(LCTRL, 900);
        assert_eq!(m.key_down(LWIN, 900).signal, Some(Signal::Start));
    }

    #[test]
    fn extra_modifiers_do_not_trigger() {
        let mut m = Machine::new(HoldSpec::default());
        m.key_down(LALT, 0);
        m.key_down(LCTRL, 0);
        assert_eq!(m.key_down(LWIN, 0).signal, None);
    }

    #[test]
    fn key_combo_hides_the_key_and_replays_a_tap() {
        let mut m = Machine::new(spec("Ctrl+Alt+V"));
        m.key_down(LCTRL, 0);
        m.key_down(LALT, 0);
        let down = m.key_down(V, 0);
        assert!(down.swallow);
        assert_eq!(down.signal, Some(Signal::Start));
        assert!(m.key_down(V, 30).swallow, "autorepeat stays hidden");
        let up = m.key_up(V);
        assert_eq!(up, Verdict { swallow: true, replay: Some(V), signal: Some(Signal::Cancel), mask: false });
        assert!(m.key_up(LALT).mask);
    }

    #[test]
    fn key_pressed_before_modifiers_does_not_trigger() {
        let mut m = Machine::new(spec("Ctrl+V"));
        m.key_down(V, 0);
        assert_eq!(m.key_down(LCTRL, 0), Verdict::default());
    }

    #[test]
    fn lone_function_key_hold() {
        let mut m = Machine::new(spec("F8"));
        assert!(m.key_down(F8, 0).swallow);
        m.tick(400);
        let up = m.key_up(F8);
        assert_eq!(up, Verdict { swallow: true, signal: Some(Signal::Release), ..Default::default() });
        // Holding Ctrl first is a different shortcut.
        m.key_down(LCTRL, 1000);
        assert_eq!(m.key_down(F8, 1000), Verdict::default());
    }

    #[test]
    fn cancelled_key_hold_still_hides_the_key_up() {
        let mut m = Machine::new(spec("Ctrl+V"));
        m.key_down(LCTRL, 0);
        m.key_down(V, 0);
        assert_eq!(m.key_down(LALT, 10).signal, Some(Signal::Cancel));
        let up = m.key_up(V);
        assert!(up.swallow);
        assert_eq!(up.replay, None);
    }
}
