//! The wire contract between the Nowly app and `nowly-cli`, and the Windows
//! identity checks both ends make. The CLI includes this file with `#[path]`,
//! so it may use external crates but nothing from the app.
//!
//! One connection carries one request line and one response line, both JSON.

/// Bumped when a request or response changes shape incompatibly.
pub const VERSION: u32 = 1;

/// Longest request or response line, in bytes.
pub const MAX_LINE: usize = 4 << 20;

/// `nowly-cli` exit codes. Agents branch on these, so they never change.
#[allow(dead_code)]
pub mod exit {
    /// The request succeeded; a proposed plan was committed.
    pub const OK: i32 = 0;
    /// Nowly rejected the request; stdout carries the error.
    pub const FAILED: i32 = 1;
    /// The command line was wrong.
    pub const USAGE: i32 = 2;
    /// Nowly is not running and could not be started.
    pub const NOT_RUNNING: i32 = 3;
    /// The user has not turned on external agents in Nowly.
    pub const DISABLED: i32 = 4;
    /// The user cancelled the plan, or it expired before anyone confirmed it.
    pub const CANCELLED: i32 = 5;
}

/// The pipe is per user: the SID keeps two sessions on one machine apart.
pub fn pipe_name(user_sid: &str) -> String {
    format!(r"\\.\pipe\nowly-agent-{user_sid}")
}

#[cfg(windows)]
mod identity {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::{CloseHandle, LocalFree, HANDLE, HLOCAL};
    use windows::Win32::Security::Authorization::ConvertSidToStringSidW;
    use windows::Win32::Security::{GetTokenInformation, TokenUser, TOKEN_QUERY, TOKEN_USER};
    use windows::Win32::System::Threading::{
        GetCurrentProcess, OpenProcess, OpenProcessToken, PROCESS_QUERY_LIMITED_INFORMATION,
    };

    fn token_user(token: HANDLE) -> windows::core::Result<String> {
        // SAFETY: the buffer is sized by the first call and outlives the SID
        // pointer read from it; the string from ConvertSidToStringSidW is
        // copied before LocalFree releases it.
        unsafe {
            let mut length = 0u32;
            let _ = GetTokenInformation(token, TokenUser, None, 0, &mut length);
            let mut buffer = vec![0u8; length as usize];
            GetTokenInformation(
                token,
                TokenUser,
                Some(buffer.as_mut_ptr().cast()),
                length,
                &mut length,
            )?;
            let user = &*(buffer.as_ptr() as *const TOKEN_USER);
            let mut text = PWSTR::null();
            ConvertSidToStringSidW(user.User.Sid, &mut text)?;
            let sid = text.to_string();
            let _ = LocalFree(Some(HLOCAL(text.0.cast())));
            sid.map_err(|_| windows::core::Error::from_win32())
        }
    }

    fn process_user(process: HANDLE) -> windows::core::Result<String> {
        // SAFETY: the token handle is closed on every path after use.
        unsafe {
            let mut token = HANDLE::default();
            OpenProcessToken(process, TOKEN_QUERY, &mut token)?;
            let sid = token_user(token);
            let _ = CloseHandle(token);
            sid
        }
    }

    /// The string SID of the user running this process.
    pub fn current_user_sid() -> windows::core::Result<String> {
        // SAFETY: GetCurrentProcess returns a pseudo handle that needs no close.
        process_user(unsafe { GetCurrentProcess() })
    }

    /// The string SID of the user running process `pid`. Fails when the
    /// process belongs to someone else, because Windows denies the query.
    #[allow(dead_code)]
    pub fn process_user_sid(pid: u32) -> windows::core::Result<String> {
        // SAFETY: the process handle is closed after the token is read.
        unsafe {
            let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid)?;
            let sid = process_user(process);
            let _ = CloseHandle(process);
            sid
        }
    }
}

#[cfg(windows)]
#[allow(unused_imports)]
pub use identity::{current_user_sid, process_user_sid};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_pipe_is_named_for_its_user() {
        assert_eq!(pipe_name("S-1-5-21-1"), r"\\.\pipe\nowly-agent-S-1-5-21-1");
    }

    #[cfg(windows)]
    #[test]
    fn this_process_belongs_to_the_current_user() {
        let sid = current_user_sid().unwrap();
        assert!(sid.starts_with("S-1-"));
        assert_eq!(process_user_sid(std::process::id()).unwrap(), sid);
    }
}
