//! `nowly`: the command external agents run to use Nowly's skills. It sends
//! one JSON request to the running app over the current user's named pipe and
//! prints the JSON reply. See the SKILL.md the app exports for the workflow.
#[path = "../agent_bridge/protocol.rs"]
mod protocol;

use protocol::exit;
use serde_json::{json, Map, Value};
use std::io::{Read, Write};

const USAGE: &str = r#"Usage: nowly [--client <name>] [--ascii] <command>

Commands:
  hello                     Check the connection, permissions and the user's clock
  query <json|@file|->      Read records; the input is one query object
  propose <json|@file|-> [--wait]
                            Propose {"revision":N,"actions":[...]}; it waits on the Nowly Bar
  status <planId> [--wait]  Read one of your plans
  undo <planId>             Undo one of your committed plans
  schema [skill]            List skills, or print one skill's JSON Schema
  skill-md                  Print the SKILL.md that describes all of this

Options:
  --client <name>  Your app's name, shown on the Bar (default: $NOWLY_CLIENT or "Agent")
  --ascii          Escape non-ASCII text as \uXXXX in the output
  --wait           Wait until the user or the countdown has decided the plan"#;

#[derive(Debug, PartialEq)]
enum Command {
    Help,
    Hello,
    Query(String),
    Propose { input: String, wait: bool },
    Status { plan_id: String, wait: bool },
    Undo(String),
    Schema(Option<String>),
    SkillMd,
}

#[derive(Debug, PartialEq)]
struct Invocation {
    client: Option<String>,
    ascii: bool,
    command: Command,
}

fn parse(args: &[String]) -> Result<Invocation, String> {
    let mut client = None;
    let mut ascii = false;
    let mut wait = false;
    let mut words = Vec::new();
    let mut rest = args.iter();
    while let Some(arg) = rest.next() {
        match arg.as_str() {
            "--client" => client = Some(rest.next().ok_or("--client needs a name")?.clone()),
            "--ascii" => ascii = true,
            "--wait" => wait = true,
            "-h" | "--help" => words.insert(0, "help".to_owned()),
            "-" => words.push(arg.clone()),
            flag if flag.starts_with("--") => return Err(format!("unknown option {flag}")),
            _ => words.push(arg.clone()),
        }
    }
    let mut words = words.into_iter();
    let name = words.next().unwrap_or_else(|| "help".into());
    let mut one = |what: &str| words.next().ok_or_else(|| format!("{name} needs {what}"));
    let command = match name.as_str() {
        "help" => Command::Help,
        "hello" => Command::Hello,
        "query" => Command::Query(one("a query")?),
        "propose" => Command::Propose { input: one("a plan")?, wait },
        "status" => Command::Status { plan_id: one("a plan id")?, wait },
        "undo" => Command::Undo(one("a plan id")?),
        "schema" => Command::Schema(words.next()),
        "skill-md" => Command::SkillMd,
        other => return Err(format!("unknown command {other}")),
    };
    if let Some(extra) = words.next() {
        return Err(format!("unexpected argument {extra}"));
    }
    if wait && !matches!(command, Command::Propose { .. } | Command::Status { .. }) {
        return Err("--wait only applies to propose and status".into());
    }
    Ok(Invocation { client, ascii, command })
}

/// Decodes request text from a file or stdin. Windows PowerShell writes
/// UTF-16 or UTF-8 with a byte order mark, so both are accepted.
fn decode(bytes: &[u8]) -> Result<String, String> {
    let utf16 = |body: &[u8], unit: fn([u8; 2]) -> u16| {
        let units: Vec<u16> = body.chunks_exact(2).map(|c| unit([c[0], c[1]])).collect();
        String::from_utf16(&units).map_err(|_| "the input is not valid UTF-16".to_owned())
    };
    match bytes {
        [0xEF, 0xBB, 0xBF, body @ ..] => std::str::from_utf8(body).map(str::to_owned).map_err(|_| "the input is not valid UTF-8".into()),
        [0xFF, 0xFE, body @ ..] => utf16(body, u16::from_le_bytes),
        [0xFE, 0xFF, body @ ..] => utf16(body, u16::from_be_bytes),
        body => std::str::from_utf8(body).map(str::to_owned).map_err(|_| "the input is not valid UTF-8".into()),
    }
}

fn read_input(raw: &str) -> Result<Value, String> {
    let text = if raw == "-" {
        let mut bytes = Vec::new();
        std::io::stdin().read_to_end(&mut bytes).map_err(|e| format!("cannot read stdin: {e}"))?;
        decode(&bytes)?
    } else if let Some(path) = raw.strip_prefix('@') {
        decode(&std::fs::read(path).map_err(|e| format!("cannot read {path}: {e}"))?)?
    } else {
        raw.to_owned()
    };
    serde_json::from_str(text.trim()).map_err(|e| format!("the input is not valid JSON: {e}"))
}

fn request(invocation: &Invocation, input: impl Fn(&str) -> Result<Value, String>) -> Result<Value, String> {
    let mut body = match &invocation.command {
        Command::Help => unreachable!("help is answered locally"),
        Command::Hello => json!({ "op": "hello" }),
        Command::Query(raw) => json!({ "op": "query", "query": input(raw)? }),
        Command::Propose { input: raw, wait } => {
            let Value::Object(mut plan) = input(raw)? else {
                return Err(r#"propose takes {"revision":N,"actions":[...]}"#.into());
            };
            plan.insert("op".into(), json!("propose"));
            plan.insert("wait".into(), json!(wait));
            Value::Object(plan)
        }
        Command::Status { plan_id, wait } => json!({ "op": "status", "planId": plan_id, "wait": wait }),
        Command::Undo(plan_id) => json!({ "op": "undo", "planId": plan_id }),
        Command::Schema(skill) => json!({ "op": "schema", "skill": skill }),
        Command::SkillMd => json!({ "op": "skillMd" }),
    };
    let client = invocation
        .client
        .clone()
        .or_else(|| std::env::var("NOWLY_CLIENT").ok())
        .unwrap_or_else(|| "Agent".into());
    let fields: &mut Map<String, Value> = body.as_object_mut().expect("requests are objects");
    fields.insert("version".into(), json!(protocol::VERSION));
    fields.insert("client".into(), json!(client));
    Ok(body)
}

/// The exit code agents branch on, from the app's reply.
fn exit_code(reply: &Value) -> i32 {
    if reply["ok"] != json!(true) {
        return match reply["error"]["code"].as_str() {
            Some("disabled") => exit::DISABLED,
            _ => exit::FAILED,
        };
    }
    match reply["result"]["status"].as_str() {
        Some("cancelled" | "expired") => exit::CANCELLED,
        Some("failed") => exit::FAILED,
        _ => exit::OK,
    }
}

fn escape_non_ascii(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        if c.is_ascii() {
            out.push(c);
        } else {
            let mut units = [0u16; 2];
            for unit in c.encode_utf16(&mut units) {
                out.push_str(&format!("\\u{unit:04x}"));
            }
        }
    }
    out
}

fn fail(code: &str, message: &str, status: i32) -> ! {
    let reply = json!({ "ok": false, "error": { "code": code, "message": message } });
    println!("{}", serde_json::to_string_pretty(&reply).expect("JSON values serialize"));
    std::process::exit(status);
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let invocation = parse(&args).unwrap_or_else(|message| {
        eprintln!("{USAGE}");
        fail("usage", &message, exit::USAGE)
    });
    if invocation.command == Command::Help {
        println!("{USAGE}");
        return;
    }
    let body = request(&invocation, read_input).unwrap_or_else(|m| fail("usage", &m, exit::USAGE));
    let reply = match pipe::send(&body.to_string()) {
        Ok(reply) => reply,
        Err(pipe::Error::NotRunning(message)) => fail("not_running", &message, exit::NOT_RUNNING),
        Err(pipe::Error::Failed(message)) => fail("connection", &message, exit::FAILED),
    };
    let reply: Value = serde_json::from_str(&reply)
        .unwrap_or_else(|_| fail("connection", "Nowly sent a reply that is not JSON.", exit::FAILED));
    let text = match (&invocation.command, reply["result"].as_str()) {
        (Command::SkillMd, Some(markdown)) if reply["ok"] == json!(true) => markdown.to_owned(),
        _ => serde_json::to_string_pretty(&reply).expect("JSON values serialize"),
    };
    let text = if invocation.ascii { escape_non_ascii(&text) } else { text };
    let mut stdout = std::io::stdout().lock();
    let _ = writeln!(stdout, "{text}");
    let _ = stdout.flush();
    std::process::exit(exit_code(&reply));
}

#[cfg(windows)]
mod pipe {
    use super::protocol::{current_user_sid, pipe_name, process_user_sid, MAX_LINE};
    use std::{
        fs::{File, OpenOptions},
        io::{Read, Write},
        os::windows::io::AsRawHandle,
        path::PathBuf,
        time::{Duration, Instant},
    };
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::Pipes::GetNamedPipeServerProcessId;

    const ERROR_FILE_NOT_FOUND: i32 = 2;
    const ERROR_PIPE_BUSY: i32 = 231;
    const START_FOR: Duration = Duration::from_secs(20);
    const RETRY: Duration = Duration::from_millis(150);

    pub enum Error {
        NotRunning(String),
        Failed(String),
    }

    fn open(name: &str) -> std::io::Result<File> {
        OpenOptions::new().read(true).write(true).open(name)
    }

    /// The package family when this command runs from the MSIX alias.
    fn package_family() -> Option<String> {
        use windows::core::PWSTR;
        use windows::Win32::Storage::Packaging::Appx::GetCurrentPackageFamilyName;
        let mut length = 0u32;
        // SAFETY: the first call only reports the length; the buffer is sized
        // from it for the second.
        unsafe {
            let _ = GetCurrentPackageFamilyName(&mut length, None);
            if length == 0 {
                return None;
            }
            let mut buffer = vec![0u16; length as usize];
            GetCurrentPackageFamilyName(&mut length, Some(PWSTR(buffer.as_mut_ptr())))
                .ok()
                .ok()?;
            Some(String::from_utf16_lossy(&buffer[..length.saturating_sub(1) as usize]))
        }
    }

    /// A packaged app is started through the shell, so it runs as the main
    /// application rather than as a child of this alias.
    fn activate(family: &str) -> Result<(), Error> {
        use windows::core::HSTRING;
        use windows::Win32::System::Com::{
            CoCreateInstance, CoInitializeEx, CLSCTX_LOCAL_SERVER, COINIT_APARTMENTTHREADED,
        };
        use windows::Win32::UI::Shell::{
            ApplicationActivationManager, IApplicationActivationManager, AO_NONE,
        };
        let failed = |e: windows::core::Error| {
            Error::NotRunning(format!("Nowly is not running and could not be started: {e}"))
        };
        // SAFETY: COM is initialized on this thread before the call.
        unsafe {
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            let manager: IApplicationActivationManager =
                CoCreateInstance(&ApplicationActivationManager, None, CLSCTX_LOCAL_SERVER)
                    .map_err(failed)?;
            manager
                .ActivateApplication(
                    &HSTRING::from(format!("{family}!Nowly")),
                    &HSTRING::from("--background"),
                    AO_NONE,
                )
                .map(drop)
                .map_err(failed)
        }
    }

    /// Starts Nowly in the background from the folder this command lives in.
    fn launch() -> Result<(), Error> {
        use std::os::windows::process::CommandExt;
        if let Some(family) = package_family() {
            return activate(&family);
        }
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        let app: PathBuf = std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(|dir| dir.join("nowly.exe")))
            .filter(|app| app.is_file())
            .ok_or_else(|| Error::NotRunning("Nowly is not running and its app was not found next to this command.".into()))?;
        std::process::Command::new(app)
            .arg("--background")
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP)
            .spawn()
            .map(drop)
            .map_err(|e| Error::NotRunning(format!("Nowly is not running and could not be started: {e}")))
    }

    fn connect(name: &str) -> Result<File, Error> {
        let mut launched = false;
        let mut deadline = Instant::now() + Duration::from_secs(5);
        loop {
            match open(name) {
                Ok(pipe) => return Ok(pipe),
                Err(e) if e.raw_os_error() == Some(ERROR_FILE_NOT_FOUND) && !launched => {
                    launch()?;
                    launched = true;
                    deadline = Instant::now() + START_FOR;
                }
                Err(e) if matches!(e.raw_os_error(), Some(ERROR_FILE_NOT_FOUND | ERROR_PIPE_BUSY)) => {
                    if Instant::now() >= deadline {
                        return Err(Error::NotRunning("Nowly did not answer. Open Nowly and try again.".into()));
                    }
                }
                Err(e) => return Err(Error::Failed(format!("cannot connect to Nowly: {e}"))),
            }
            std::thread::sleep(RETRY);
        }
    }

    /// Refuses a pipe served by anyone but the current user, so another
    /// account that created the name first never sees the request.
    fn check_owner(pipe: &File, user: &str) -> Result<(), Error> {
        let mut pid = 0u32;
        // SAFETY: the handle is a connected pipe client owned by `pipe`.
        unsafe { GetNamedPipeServerProcessId(HANDLE(pipe.as_raw_handle()), &mut pid) }
            .map_err(|e| Error::Failed(format!("cannot identify the Nowly process: {e}")))?;
        match process_user_sid(pid) {
            Ok(owner) if owner == user => Ok(()),
            _ => Err(Error::Failed("The Nowly pipe belongs to another user; the request was not sent.".into())),
        }
    }

    pub fn send(line: &str) -> Result<String, Error> {
        let user = current_user_sid().map_err(|e| Error::Failed(format!("cannot read the current user: {e}")))?;
        let mut pipe = connect(&pipe_name(&user))?;
        check_owner(&pipe, &user)?;
        let io = |e: std::io::Error| Error::Failed(format!("the connection to Nowly broke: {e}"));
        pipe.write_all(line.as_bytes()).map_err(io)?;
        pipe.write_all(b"\n").map_err(io)?;
        pipe.flush().map_err(io)?;
        let mut reply = Vec::new();
        let mut chunk = [0u8; 8192];
        loop {
            let read = pipe.read(&mut chunk).map_err(io)?;
            if read == 0 {
                break;
            }
            reply.extend_from_slice(&chunk[..read]);
            if reply.ends_with(b"\n") {
                break;
            }
            if reply.len() > MAX_LINE {
                return Err(Error::Failed("Nowly's reply is too large.".into()));
            }
        }
        String::from_utf8(reply).map_err(|_| Error::Failed("Nowly's reply is not UTF-8.".into()))
    }
}

#[cfg(not(windows))]
mod pipe {
    pub enum Error {
        #[allow(dead_code)]
        NotRunning(String),
        Failed(String),
    }

    pub fn send(_: &str) -> Result<String, Error> {
        Err(Error::Failed("nowly only runs on Windows.".into()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(line: &str) -> Vec<String> {
        line.split_whitespace().map(str::to_owned).collect()
    }

    #[test]
    fn options_may_come_anywhere() {
        let parsed = parse(&args("propose @plan.json --client Codex --wait --ascii")).unwrap();
        assert_eq!(
            parsed,
            Invocation {
                client: Some("Codex".into()),
                ascii: true,
                command: Command::Propose { input: "@plan.json".into(), wait: true },
            }
        );
        assert_eq!(parse(&args("query -")).unwrap().command, Command::Query("-".into()));
        assert_eq!(parse(&[]).unwrap().command, Command::Help);
        assert_eq!(parse(&args("schema createTask")).unwrap().command, Command::Schema(Some("createTask".into())));
    }

    #[test]
    fn mistakes_are_usage_errors() {
        assert!(parse(&args("query")).is_err());
        assert!(parse(&args("hello extra")).is_err());
        assert!(parse(&args("undo p1 --wait")).is_err());
        assert!(parse(&args("hello --force")).is_err());
        assert!(parse(&args("hello --client")).is_err());
        assert!(parse(&args("delete p1")).is_err());
    }

    #[test]
    fn powershell_encodings_decode() {
        assert_eq!(decode("{\"t\":\"会\"}".as_bytes()).unwrap(), "{\"t\":\"会\"}");
        assert_eq!(decode(b"\xEF\xBB\xBF{}").unwrap(), "{}");
        let le: Vec<u8> = [0xFF, 0xFE].into_iter().chain("{\"t\":\"会\"}".encode_utf16().flat_map(u16::to_le_bytes)).collect();
        assert_eq!(decode(&le).unwrap(), "{\"t\":\"会\"}");
        let be: Vec<u8> = [0xFE, 0xFF].into_iter().chain("{}".encode_utf16().flat_map(u16::to_be_bytes)).collect();
        assert_eq!(decode(&be).unwrap(), "{}");
        assert!(decode(b"\xFF\x00\xC3").is_err());
    }

    #[test]
    fn requests_carry_version_client_and_the_input() {
        let parsed = parse(&args("propose x --wait --client Codex")).unwrap();
        let body = request(&parsed, |_| Ok(json!({"revision":3,"actions":[]}))).unwrap();
        assert_eq!(
            body,
            json!({"op":"propose","revision":3,"actions":[],"wait":true,"version":protocol::VERSION,"client":"Codex"})
        );
        let parsed = parse(&args("propose x")).unwrap();
        assert!(request(&parsed, |_| Ok(json!([]))).is_err());
        let parsed = parse(&args("status p1 --client A")).unwrap();
        assert_eq!(request(&parsed, |_| unreachable!()).unwrap()["planId"], json!("p1"));
    }

    #[test]
    fn exit_codes_follow_the_reply() {
        assert_eq!(exit_code(&json!({"ok":true,"result":{"status":"committed"}})), exit::OK);
        assert_eq!(exit_code(&json!({"ok":true,"result":{"records":[]}})), exit::OK);
        assert_eq!(exit_code(&json!({"ok":true,"result":{"status":"cancelled"}})), exit::CANCELLED);
        assert_eq!(exit_code(&json!({"ok":true,"result":{"status":"expired"}})), exit::CANCELLED);
        assert_eq!(exit_code(&json!({"ok":true,"result":{"status":"failed"}})), exit::FAILED);
        assert_eq!(exit_code(&json!({"ok":false,"error":{"code":"disabled"}})), exit::DISABLED);
        assert_eq!(exit_code(&json!({"ok":false,"error":{"code":"not_queried"}})), exit::FAILED);
    }

    #[test]
    fn ascii_output_escapes_text_and_emoji() {
        assert_eq!(escape_non_ascii("{\"t\":\"会😀\"}"), "{\"t\":\"\\u4f1a\\ud83d\\ude00\"}");
        let round: Value = serde_json::from_str(&escape_non_ascii("{\"t\":\"会😀\"}")).unwrap();
        assert_eq!(round["t"], json!("会😀"));
    }
}
