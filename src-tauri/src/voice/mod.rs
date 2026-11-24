//! Hold-to-talk voice input: capture, local recognition, model management.

/// Debug-build trace of the hold → record pipeline. Never logs keys or
/// transcripts.
macro_rules! trace {
    ($($arg:tt)*) => {
        if cfg!(debug_assertions) {
            eprintln!("[voice] {}", format_args!($($arg)*));
        }
    };
}

pub mod asr;
pub mod capture;
pub mod commands;
pub mod hotkey;
pub mod model;
pub mod session;
pub mod settings;
