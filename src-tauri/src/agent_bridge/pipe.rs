//! The named-pipe server `nowly-cli` connects to. The pipe's DACL admits only
//! the current user, remote clients are rejected, and the first instance must
//! be ours, so another account cannot squat on the name.
use super::{
    handler::{handle, Bridge, Host},
    protocol::{current_user_sid, pipe_name, MAX_LINE},
};
use std::{
    fs::File,
    io::{Read, Write},
    os::windows::io::FromRawHandle,
    sync::Arc,
};
use windows::core::HSTRING;
use windows::Win32::Foundation::{CloseHandle, ERROR_PIPE_CONNECTED};
use windows::Win32::Security::Authorization::{
    ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1,
};
use windows::Win32::Security::{PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES};
use windows::Win32::Storage::FileSystem::{
    FILE_FLAGS_AND_ATTRIBUTES, FILE_FLAG_FIRST_PIPE_INSTANCE, PIPE_ACCESS_DUPLEX,
};
use windows::Win32::System::Pipes::{
    ConnectNamedPipe, CreateNamedPipeW, PIPE_READMODE_BYTE, PIPE_REJECT_REMOTE_CLIENTS,
    PIPE_TYPE_BYTE, PIPE_UNLIMITED_INSTANCES, PIPE_WAIT,
};

const BUFFER: u32 = 64 * 1024;

pub fn serve(host: Arc<dyn Host>, bridge: Arc<Bridge>) {
    let spawned = std::thread::Builder::new()
        .name("agent-bridge".into())
        .spawn(move || {
            let result = current_user_sid()
                .and_then(|sid| listen(&pipe_name(&sid), &sid, host, bridge));
            if let Err(error) = result {
                eprintln!("agent bridge stopped: {error}");
            }
        });
    if let Err(error) = spawned {
        eprintln!("agent bridge did not start: {error}");
    }
}

fn listen(name: &str, sid: &str, host: Arc<dyn Host>, bridge: Arc<Bridge>) -> windows::core::Result<()> {
    let name = HSTRING::from(name);
    // Protected DACL with one entry: full access for this user, nobody else.
    let sddl = HSTRING::from(format!("D:P(A;;GA;;;{sid})"));
    let mut descriptor = PSECURITY_DESCRIPTOR::default();
    // SAFETY: the descriptor is allocated by Windows and kept for the life of
    // the process, since every pipe instance is created with it.
    unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(&sddl, SDDL_REVISION_1, &mut descriptor, None)?;
    }
    let attributes = SECURITY_ATTRIBUTES {
        nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: descriptor.0,
        bInheritHandle: false.into(),
    };
    let mut first = true;
    loop {
        let open = PIPE_ACCESS_DUPLEX
            | if first { FILE_FLAG_FIRST_PIPE_INSTANCE } else { FILE_FLAGS_AND_ATTRIBUTES(0) };
        // SAFETY: `name` and `attributes` outlive the call.
        let pipe = unsafe {
            CreateNamedPipeW(
                &name,
                open,
                PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
                PIPE_UNLIMITED_INSTANCES,
                BUFFER,
                BUFFER,
                0,
                Some(&attributes),
            )
        };
        if pipe.is_invalid() {
            return Err(windows::core::Error::from_win32());
        }
        first = false;
        // SAFETY: `pipe` is a valid server handle created above.
        if let Err(error) = unsafe { ConnectNamedPipe(pipe, None) } {
            if error.code() != ERROR_PIPE_CONNECTED.to_hresult() {
                // SAFETY: the handle is ours and not used again.
                let _ = unsafe { CloseHandle(pipe) };
                continue;
            }
        }
        // SAFETY: the File takes sole ownership of the handle and closes it.
        let connection = unsafe { File::from_raw_handle(pipe.0) };
        let (host, bridge) = (host.clone(), bridge.clone());
        let _ = std::thread::Builder::new()
            .name("agent-bridge-client".into())
            .spawn(move || answer(connection, host.as_ref(), &bridge));
    }
}

/// Reads one request line and writes one response line.
fn answer(mut connection: File, host: &dyn Host, bridge: &Bridge) {
    let reply = match read_line(&mut connection) {
        Some(line) => handle(bridge, host, &line),
        None => serde_json::json!({
            "ok": false,
            "error": { "code": "bad_request", "message": "请求过大或不是 UTF-8 文本。" }
        }),
    };
    let mut text = reply.to_string();
    text.push('\n');
    let _ = connection.write_all(text.as_bytes());
    // Waits until the client has read the reply before the handle closes.
    let _ = connection.sync_all();
}

fn read_line(connection: &mut File) -> Option<String> {
    let mut line = Vec::new();
    let mut chunk = [0u8; 8192];
    loop {
        let read = connection.read(&mut chunk).ok()?;
        if read == 0 {
            break;
        }
        line.extend_from_slice(&chunk[..read]);
        if let Some(end) = line.iter().position(|&b| b == b'\n') {
            line.truncate(end);
            break;
        }
        if line.len() > MAX_LINE {
            return None;
        }
    }
    String::from_utf8(line).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{assistant::types::Plan, db::AppDb};
    use std::{fs::OpenOptions, os::windows::io::AsRawHandle};
    use windows::Win32::{Foundation::HANDLE, System::Pipes::GetNamedPipeServerProcessId};

    struct Quiet(AppDb);

    impl Host for Quiet {
        fn db(&self) -> &AppDb {
            &self.0
        }
        fn present(&self, _: Plan) {}
        fn notify(&self, _: &Plan) {}
    }

    fn connect(name: &str) -> File {
        for _ in 0..100 {
            if let Ok(pipe) = OpenOptions::new().read(true).write(true).open(name) {
                return pipe;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        panic!("the pipe never opened");
    }

    #[test]
    fn a_client_gets_one_reply_per_connection_from_its_own_user() {
        let mut db = rusqlite::Connection::open_in_memory().unwrap();
        crate::db::migrate(&mut db).unwrap();
        let host: Arc<dyn Host> = Arc::new(Quiet(AppDb(std::sync::Mutex::new(db))));
        let sid = current_user_sid().unwrap();
        let name = format!(r"\\.\pipe\nowly-agent-test-{}", uuid::Uuid::new_v4());
        let (served, server_sid) = (name.clone(), sid.clone());
        std::thread::spawn(move || listen(&served, &server_sid, host, Arc::new(Bridge::default())));

        for _ in 0..2 {
            let mut pipe = connect(&name);
            let mut pid = 0u32;
            unsafe { GetNamedPipeServerProcessId(HANDLE(pipe.as_raw_handle()), &mut pid) }.unwrap();
            assert_eq!(crate::agent_bridge::protocol::process_user_sid(pid).unwrap(), sid);
            pipe.write_all(b"{\"version\":1,\"client\":\"Test\",\"op\":\"hello\"}\n").unwrap();
            let mut reply = String::new();
            pipe.read_to_string(&mut reply).unwrap();
            let reply: serde_json::Value = serde_json::from_str(reply.trim()).unwrap();
            assert_eq!(reply["result"]["app"], "nowly");
            assert_eq!(reply["result"]["enabled"], false);
        }
    }
}