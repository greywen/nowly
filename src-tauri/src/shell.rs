//! Handing a target to the user's default application.
//!
//! `ShellExecuteW` is called directly rather than through a Tauri plugin, which
//! is the convention the rest of this crate already follows for shell work. The
//! unsafe FFI lives here so callers deal only with a boolean outcome and phrase
//! their own error, which lets each one say something useful about what it was
//! trying to open.

use std::ffi::OsStr;

/// Ask the OS to open `target` with whatever application is associated with it.
///
/// `target` may be a URL or a filesystem path. It is handed to the shell as a
/// single argument rather than assembled into a command line, so it needs no
/// quoting and cannot be split into extra arguments — a path holding spaces,
/// quotes or an `&` is passed through literally.
///
/// Returns false when the shell declines, which covers both "nothing is
/// associated with this type" and an outright failure. Callers cannot tell those
/// apart, and for the one place this is used the distinction does not change what
/// the user should do about it.
///
/// This performs no validation of its own. Deciding whether a target is safe to
/// open belongs to the caller, which is the only place that knows where the
/// target came from.
#[cfg(windows)]
pub fn open_with_default_handler(target: impl AsRef<OsStr>) -> bool {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    fn to_wide(value: &OsStr) -> Vec<u16> {
        value.encode_wide().chain(std::iter::once(0)).collect()
    }

    let verb = to_wide(OsStr::new("open"));
    let file = to_wide(target.as_ref());
    // SAFETY: both pointers reference NUL-terminated UTF-16 buffers that outlive
    // the call. ShellExecuteW does not retain them past return.
    let result = unsafe {
        ShellExecuteW(
            None,
            PCWSTR(verb.as_ptr()),
            PCWSTR(file.as_ptr()),
            PCWSTR::null(),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };
    // ShellExecuteW returns a value greater than 32 on success.
    result.0 as isize > 32
}

#[cfg(not(windows))]
pub fn open_with_default_handler(_target: impl AsRef<OsStr>) -> bool {
    false
}
