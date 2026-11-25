//! Model requests can query and propose, never execute.
use super::{actions, store, types::*};
use crate::{error::CommandError, write_scope::WriteScope};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::BTreeSet,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Config {
    #[serde(default)]
    pub protocol: Protocol,
    #[serde(default = "default_api_version")]
    pub api_version: String,
    #[serde(default)]
    pub detected_endpoint: Option<String>,
    pub endpoint: String,
    pub model: String,
    pub permissions: Permissions,
    #[serde(default)]
    pub has_key: bool,
}
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum Protocol {
    #[default]
    OpenaiChat,
    OpenaiResponses,
    Azure,
    Anthropic,
    Gemini,
    Ollama,
}
fn default_api_version() -> String {
    "2024-10-21".into()
}
pub fn is_local(raw: &str) -> bool {
    reqwest::Url::parse(raw)
        .ok()
        .is_some_and(|u| match u.host_str() {
            Some("localhost" | "[::1]") => true,
            Some(name) => name
                .parse::<std::net::IpAddr>()
                .is_ok_and(|ip| ip.is_loopback()),
            None => false,
        })
}
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HistoryRole {
    User,
    Assistant,
}
impl HistoryRole {
    fn as_str(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Assistant => "assistant",
        }
    }
}
// Deserialising the role as an enum keeps the UI from smuggling a `system`
// turn into the prompt.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HistoryMessage {
    pub role: HistoryRole,
    pub content: String,
}
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub request_id: String,
    pub message: String,
    #[serde(default)]
    pub history: Vec<HistoryMessage>,
    pub previous_plan_id: Option<String>,
}
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
enum Step {
    Query { query: Query },
    Plan { actions: Vec<Action> },
    Clarify { message: String },
    Answer { message: String },
}
fn invalid(message: &str) -> CommandError {
    CommandError::validation("assistant", message)
}
/// The host owns execution status. A read-only answer has no reason to mention a
/// write at all, so any prose that does is dropped in favour of the host's own
/// sentence. Matching whole verbs rather than tensed phrases keeps a model from
/// slipping a claim through as "已全部删除".
fn mentions_write(text: &str) -> bool {
    const WRITE_WORDS: &[&str] = &[
        "删除", "删掉", "移除", "清空", "创建", "新建", "添加", "加上", "修改", "改成", "更新",
        "保存", "执行", "delete", "remove", "create", "add", "update", "save", "execute",
    ];
    let lowered = text.to_lowercase();
    WRITE_WORDS.iter().any(|word| lowered.contains(word))
}
pub fn get_config(db: &Connection) -> Result<Config, CommandError> {
    store::prune(db)?;
    let row: Option<(String, bool)> = db
        .query_row(
            "SELECT config,secret IS NOT NULL FROM assistant_config WHERE id=1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(CommandError::database)?;
    match row {
        None => Ok(Config::default()),
        Some((raw, has_key)) => {
            let mut config: Config =
                serde_json::from_str(&raw).map_err(|_| invalid("AI 设置无效，请重新保存。"))?;
            config.has_key = has_key;
            Ok(config)
        }
    }
}
pub fn endpoint(raw: &str) -> Result<reqwest::Url, CommandError> {
    let url = reqwest::Url::parse(raw).map_err(|_| invalid("请输入完整的 API 地址。"))?;
    if !(url.scheme() == "https" || (url.scheme() == "http" && is_local(raw)))
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err(invalid(
            "远程 API 地址必须使用 HTTPS（本机可用 HTTP），不能含账号、密码或片段。",
        ));
    }
    let query: Vec<_> = url.query_pairs().collect();
    if query.len() > 1
        || query.iter().any(|(k, v)| {
            k != "api-version"
                || v.is_empty()
                || v.len() > 64
                || !v.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
        })
    {
        return Err(invalid(
            "URL 仅允许 api-version 查询参数；请将 Key 填在独立字段。",
        ));
    }
    Ok(url)
}

/// Network detection runs without a database lock. Settings and encrypted key
/// form an optimistic snapshot so a late response cannot overwrite newer input.
pub fn save_detected_with<F>(
    db: &Mutex<Connection>,
    mut config: Config,
    key: Option<String>,
    clear_key: bool,
    probe: F,
) -> Result<Config, CommandError>
where
    F: FnMut(&Config, &str, &[Value]) -> Result<String, CommandError>,
{
    config.endpoint = config.endpoint.trim().trim_end_matches('/').into();
    config.model = config.model.trim().into();
    endpoint(&config.endpoint)?;
    if config.endpoint.len() > 2000 || config.model.is_empty() || config.model.len() > 200 {
        return Err(invalid("请填写有效的 API 地址和 Model ID。"));
    }
    if key
        .as_ref()
        .is_some_and(|k| k.is_empty() || k.len() > 8192 || k.chars().any(char::is_control))
    {
        return Err(invalid("API Key 格式无效。"));
    }
    // Client-supplied detected metadata is never authority.
    config.protocol = Protocol::OpenaiChat;
    config.api_version = default_api_version();
    config.detected_endpoint = None;
    if clear_key && !is_local(&config.endpoint) {
        return save_config(
            &*db.lock().map_err(CommandError::database)?,
            config,
            None,
            true,
        );
    }
    let snapshot = {
        let guard = db.lock().map_err(CommandError::database)?;
        config_snapshot(&guard)?
    };
    let effective_key = if clear_key {
        String::new()
    } else if let Some(key) = key {
        key
    } else if snapshot.0.endpoint == config.endpoint {
        snapshot
            .1
            .as_deref()
            .map(crate::token_store::unprotect_secret)
            .transpose()?
            .unwrap_or_default()
    } else {
        String::new()
    };
    if effective_key.is_empty() && !is_local(&config.endpoint) {
        return Err(invalid(
            "请填写 API Key；更换地址后不会沿用旧 Key。原设置未更改。",
        ));
    }
    let detected = super::detection::detect_with(&config, &effective_key, probe)?;
    let guard = db.lock().map_err(CommandError::database)?;
    if config_snapshot(&guard)? != snapshot {
        return Err(CommandError::conflict(
            "检测期间设置已发生变化，请重新检测；未覆盖新设置。",
        ));
    }
    let key = (!effective_key.is_empty()).then_some(effective_key);
    save_config(&guard, detected, key, clear_key)
}

/// The saved key is reused only for the exact address it was saved with, so a
/// changed URL can never receive the old credential.
pub fn saved_key_for(db: &Connection, raw_endpoint: &str) -> Result<String, CommandError> {
    let (config, secret) = config_snapshot(db)?;
    if config.endpoint != raw_endpoint.trim().trim_end_matches('/') {
        return Ok(String::new());
    }
    Ok(secret
        .as_deref()
        .map(crate::token_store::unprotect_secret)
        .transpose()?
        .unwrap_or_default())
}

fn config_snapshot(db: &Connection) -> Result<(Config, Option<Vec<u8>>), CommandError> {
    let config = get_config(db)?;
    let secret = db
        .query_row("SELECT secret FROM assistant_config WHERE id=1", [], |r| {
            r.get(0)
        })
        .optional()
        .map_err(CommandError::database)?
        .flatten();
    Ok((config, secret))
}
pub fn save_config(
    db: &Connection,
    mut config: Config,
    key: Option<String>,
    clear_key: bool,
) -> Result<Config, CommandError> {
    config.endpoint = config.endpoint.trim().trim_end_matches('/').into();
    config.model = config.model.trim().into();
    endpoint(&config.endpoint)?;
    if config.protocol == Protocol::Azure
        && (config.api_version.is_empty()
            || config.api_version.len() > 64
            || !config
                .api_version
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-'))
    {
        return Err(invalid("请填写有效的 Azure API 版本。"));
    }
    if config.endpoint.len() > 2000 || config.model.is_empty() || config.model.len() > 200 {
        return Err(invalid("请填写有效的模型名称和 API 地址。"));
    }
    if key
        .as_ref()
        .is_some_and(|k| k.is_empty() || k.len() > 8192 || k.contains(['\r', '\n']))
    {
        return Err(invalid("API Key 格式无效。"));
    }
    let outer = WriteScope::new(db).map_err(CommandError::database)?;
    let old = get_config(&outer)?;
    let old_key: Option<Vec<u8>> = outer
        .query_row("SELECT secret FROM assistant_config WHERE id=1", [], |r| {
            r.get(0)
        })
        .optional()
        .map_err(CommandError::database)?
        .flatten();
    let encrypted = if clear_key {
        None
    } else if let Some(k) = key {
        Some(crate::token_store::protect_secret(&k)?)
    } else if old.endpoint == config.endpoint && old.protocol == config.protocol {
        old_key
    } else {
        None
    };
    config.has_key = encrypted.is_some();
    outer.execute("INSERT INTO assistant_config VALUES(1,?1,?2) ON CONFLICT(id) DO UPDATE SET config=excluded.config,secret=excluded.secret",
        params![serde_json::to_string(&config).map_err(CommandError::system)?,encrypted]).map_err(CommandError::database)?;
    outer
        .execute(
            "UPDATE assistant_clock SET revision=revision+1 WHERE id=1",
            [],
        )
        .map_err(CommandError::database)?;
    outer.commit().map_err(CommandError::database)?;
    Ok(config)
}

pub fn run_with<F>(
    db: &Mutex<Connection>,
    request: &Request,
    cancelled: &AtomicBool,
    transport: F,
) -> Result<Reply, CommandError>
where
    F: FnMut(&Config, &str, &[Value]) -> Result<String, CommandError>,
{
    run_with_source(db, request, Source::Chat, cancelled, transport)
}

/// `source` comes from the host, never from IPC input.
pub fn run_with_source<F>(
    db: &Mutex<Connection>,
    request: &Request,
    source: Source,
    cancelled: &AtomicBool,
    mut transport: F,
) -> Result<Reply, CommandError>
where
    F: FnMut(&Config, &str, &[Value]) -> Result<String, CommandError>,
{
    if uuid::Uuid::parse_str(&request.request_id).is_err()
        || request.message.trim().is_empty()
        || request.message.len() > 12000
        || request.history.len() > 12
        || request.history.iter().any(|m| m.content.len() > 12000)
    {
        return Err(invalid("请求过长或标识无效。"));
    }
    let check_cancel = || {
        if cancelled.load(Ordering::SeqCst) {
            Err(invalid("已停止处理；未提交任何变更。"))
        } else {
            Ok(())
        }
    };
    check_cancel()?;
    let (config, key, mut expected, previous, week_start) = {
        let db = db.lock().map_err(CommandError::database)?;
        let config = get_config(&db)?;
        if (!config.has_key && !is_local(&config.endpoint)) || config.model.is_empty() {
            return Err(invalid("请先连接 AI 服务并保存 API Key。"));
        }
        if !config.permissions.calendar
            && !config.permissions.tasks
            && !config.permissions.external
            && !config.permissions.notes
            && !config.permissions.alarms
        {
            return Err(invalid("请先选择允许 AI 读取的数据范围。"));
        }
        let secret: Option<Vec<u8>> = db
            .query_row("SELECT secret FROM assistant_config WHERE id=1", [], |r| {
                r.get(0)
            })
            .map_err(CommandError::database)?;
        let previous = if let Some(id) = &request.previous_plan_id {
            let previous = store::get(&db, id)?;
            store::cancel(&db, id)?;
            store::require_permissions(&previous.actions, &config.permissions)?;
            if previous.status != "pending" && previous.status != "cancelled" {
                return Err(invalid("上份计划已执行或过期，请重新描述请求。"));
            }
            Some(previous.actions)
        } else {
            None
        };
        let week = crate::settings::read_app_settings(&db)
            .map(|s| s.week_start)
            .unwrap_or_else(|_| "monday".into());
        (
            config,
            secret
                .as_deref()
                .map(crate::token_store::unprotect_secret)
                .transpose()?
                .unwrap_or_default(),
            store::revision(&db)?,
            previous,
            week,
        )
    };
    let context = json!({"now":chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string(),"timezone":crate::timezone::device_tz().name(),"weekStart":week_start,"permissions":config.permissions});
    let mut messages =
        vec![json!({"role":"system","content":format!("{}\nHOST_CONTEXT: {context}", super::skills::instructions(&config.permissions, source))})];
    for message in &request.history {
        messages.push(json!({"role":message.role.as_str(),"content":message.content}));
    }
    if let Some(previous) = previous {
        messages.push(json!({"role":"user","content":format!("PREVIOUS_DRAFT (not executed): {}",serde_json::to_string(&previous).map_err(CommandError::system)?)}));
    }
    messages.push(json!({"role":"user","content":request.message}));
    let mut seen = BTreeSet::new();
    let mut records = vec![];
    let mut truncated = false;
    for _ in 0..4 {
        check_cancel()?;
        {
            let db = db.lock().map_err(CommandError::database)?;
            if get_config(&db)? != config || store::revision(&db)? != expected {
                return Err(CommandError::conflict(
                    "数据或 AI 权限已变化，请重新发送请求。",
                ));
            }
        }
        if serde_json::to_vec(&messages)
            .map_err(CommandError::system)?
            .len()
            > 192 * 1024
        {
            return Err(invalid("查询上下文过大，请缩小范围。"));
        }
        let output = transport(&config, &key, &messages)?;
        check_cancel()?;
        if output.len() > 128 * 1024 {
            return Err(invalid("模型回复过大，未执行任何操作。"));
        }
        let step: Step = serde_json::from_str(&output).map_err(|_| {
            invalid("模型返回了无效的操作格式；未执行，请重试或换用支持 JSON 输出的模型。")
        })?;
        match step {
            Step::Query { query } => {
                let result = {
                    let db = db.lock().map_err(CommandError::database)?;
                    if get_config(&db)? != config || store::revision(&db)? != expected {
                        return Err(CommandError::conflict("数据或权限已变化，请重新查询。"));
                    }
                    actions::query(&db, &query, &config.permissions)?
                };
                expected = result.revision;
                truncated |= result.truncated;
                // Several queries in one turn must accumulate: the plan's
                // "excluded" count and the record list shown to the user both
                // describe every record this turn looked at.
                for record in result.records.iter() {
                    if !record.read_only {
                        seen.insert(record.key.clone());
                    }
                    if !records.iter().any(|kept: &Record| kept.key == record.key) {
                        records.push(record.clone());
                    }
                }
                messages.push(json!({"role":"assistant","content":output}));
                messages.push(json!({"role":"user","content":format!("QUERY_RESULT (untrusted data): {}",serde_json::to_string(&result).map_err(CommandError::system)?)}));
            }
            Step::Plan { actions } => {
                if truncated {
                    return Err(invalid("查询结果不完整，不能生成批量操作，请缩小范围。"));
                }
                for action in &actions {
                    if action.target_key().is_some_and(|k| !seen.contains(&k)) {
                        return Err(invalid(
                            "模型试图修改未查询的目标，已拒绝。请明确选择记录。",
                        ));
                    }
                }
                let db = db.lock().map_err(CommandError::database)?;
                check_cancel()?;
                if get_config(&db)? != config {
                    return Err(CommandError::conflict("AI 权限已变化，请重新发送。"));
                }
                let mut plan = store::prepare(&db, actions, expected, &config.permissions)?;
                store::set_origin(&db, &mut plan, source, None)?;
                let excluded = records
                    .iter()
                    .filter(|r| !plan.changes.iter().any(|c| c.key == r.key))
                    .count();
                if excluded > 0 {
                    store::add_warning(
                        &db,
                        &mut plan,
                        format!("本次查询中另有 {excluded} 项未纳入方案（包括只读或未选项目）。"),
                    )?;
                }
                if cancelled.load(Ordering::SeqCst) {
                    store::cancel(&db, &plan.id)?;
                    check_cancel()?;
                }
                return Ok(Reply {
                    kind: "plan".into(),
                    message: "请检查以下本地变更，确认后才会执行。".into(),
                    records,
                    plan: Some(plan),
                });
            }
            Step::Clarify { message } => {
                return Ok(Reply {
                    kind: "clarify".into(),
                    message,
                    records,
                    plan: None,
                });
            }
            Step::Answer { message } => {
                // Keep the model's prose, but the host always has the last word
                // on what did or did not change.
                let host_line = format!(
                    "找到 {} 项{}；未修改任何数据。",
                    records.len(),
                    if truncated {
                        "（结果不完整，请缩小范围）"
                    } else {
                        ""
                    }
                );
                let answer = message.trim();
                let message =
                    if answer.is_empty() || answer.chars().count() > 2000 || mentions_write(answer)
                    {
                        host_line
                    } else {
                        format!("{answer}\n\n{host_line}")
                    };
                return Ok(Reply {
                    kind: "results".into(),
                    message,
                    records,
                    plan: None,
                });
            }
        }
    }
    Err(invalid(
        "已达到本次查询次数上限，未提交变更。请缩小范围或明确目标。",
    ))
}

pub fn send_http(config: &Config, key: &str, messages: &[Value]) -> Result<String, CommandError> {
    super::rig_transport::send(config, key, messages).map(|text| normalize_json(&text))
}
/// Models that ignore `response_format` still tend to answer with the object
/// wrapped in Markdown fences or prose. The parser upstream stays strict.
pub(super) fn normalize_json(raw: &str) -> String {
    let mut text = raw.trim();
    if let Some(rest) = text.strip_prefix("```") {
        let rest = rest.strip_prefix("json").unwrap_or(rest);
        let rest = rest.trim_start();
        text = rest.split("```").next().unwrap_or(rest).trim();
    }
    if serde_json::from_str::<Value>(text).is_ok() {
        return text.into();
    }
    match (text.find('{'), text.rfind('}')) {
        (Some(start), Some(end)) if end > start => text[start..=end].into(),
        _ => text.into(),
    }
}

#[cfg(test)]
mod http_tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::{TcpListener, TcpStream},
        sync::mpsc,
        thread::JoinHandle,
        time::Duration,
    };
    const MAX_RESPONSE: usize = 1024 * 1024;

    fn read_request(socket: &mut TcpStream) -> String {
        let mut request = vec![];
        let mut buf = [0u8; 4096];
        loop {
            let n = socket.read(&mut buf).unwrap();
            if n == 0 {
                break;
            }
            request.extend_from_slice(&buf[..n]);
            if let Some(i) = request.windows(4).position(|w| w == b"\r\n\r\n") {
                let headers = String::from_utf8_lossy(&request[..i]).to_lowercase();
                let len: usize = headers
                    .lines()
                    .find_map(|l| {
                        l.strip_prefix("content-length: ")
                            .and_then(|v| v.parse().ok())
                    })
                    .unwrap();
                if request.len() >= i + 4 + len {
                    break;
                }
            }
        }
        String::from_utf8(request).unwrap()
    }
    /// Answers a scripted sequence of `(status, body)` and records every request.
    fn scripted(script: Vec<(u16, String)>) -> (String, mpsc::Receiver<String>, JoinHandle<()>) {
        let server = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = server.local_addr().unwrap();
        let (tx, rx) = mpsc::channel();
        let thread = std::thread::spawn(move || {
            for (status, body) in script {
                let (mut socket, _) = server.accept().unwrap();
                socket
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                tx.send(read_request(&mut socket)).unwrap();
                write!(socket,"HTTP/1.1 {status} STATUS\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).unwrap();
            }
        });
        (format!("http://{addr}/v1/chat/completions"), rx, thread)
    }
    fn completion(content: &str) -> String {
        json!({"id":"fixture","model":"fixture","choices":[{"index":0,"finish_reason":"stop","message":{"role":"assistant","content":content}}]}).to_string()
    }
    fn call(url: &str, key: &str) -> Result<String, CommandError> {
        let config = Config {
            endpoint: url.into(),
            model: "fixture-model".into(),
            ..Config::default()
        };
        send_http(&config, key, &[json!({"role":"user","content":"8点"})])
    }

    #[test]
    fn rig_native_protocols_use_real_http_and_native_auth() {
        let text = r#"{"kind":"answer","message":"fixture"}"#;
        let chat = json!({"id":"fixture","model":"fixture","choices":[{"index":0,"finish_reason":"stop","message":{"role":"assistant","content":text}}]});
        let cases = [
            (
                Protocol::OpenaiChat,
                "/v1",
                "/v1/chat/completions",
                "authorization: Bearer fixture-key",
                chat.clone(),
            ),
            (
                Protocol::OpenaiResponses,
                "/v1",
                "/v1/responses",
                "authorization: Bearer fixture-key",
                json!({"id":"r1","object":"response","created_at":1,"status":"completed","model":"fixture","output":[{"type":"message","id":"m1","status":"completed","role":"assistant","content":[{"type":"output_text","text":text,"annotations":[]}]}],"tools":[]}),
            ),
            (
                Protocol::Azure,
                "",
                "/openai/deployments/fixture/chat/completions?api-version=2024-10-21",
                "api-key: fixture-key",
                chat,
            ),
            (
                Protocol::Anthropic,
                "",
                "/v1/messages",
                "x-api-key: fixture-key",
                json!({"id":"m1","type":"message","role":"assistant","model":"fixture","content":[{"type":"text","text":text}],"stop_reason":"end_turn","usage":{"input_tokens":1,"output_tokens":1}}),
            ),
            (
                Protocol::Gemini,
                "",
                "/v1beta/models/fixture:generateContent",
                "x-goog-api-key: fixture-key",
                json!({"candidates":[{"content":{"role":"model","parts":[{"text":text}]},"finishReason":"STOP","index":0}]}),
            ),
            (
                Protocol::Ollama,
                "",
                "/api/chat",
                "authorization: Bearer fixture-key",
                json!({"model":"fixture","created_at":"2026-09-08T00:00:00Z","message":{"role":"assistant","content":text},"done":true,"done_reason":"stop"}),
            ),
        ];
        for (protocol, prefix, path, auth, response) in cases {
            let (url, requests, server) = scripted(vec![(200, response.to_string())]);
            let root = url.strip_suffix("/v1/chat/completions").unwrap();
            let config = Config {
                protocol,
                api_version: default_api_version(),
                endpoint: format!("{root}{prefix}"),
                model: "fixture".into(),
                ..Default::default()
            };
            let result = send_http(
                &config,
                "fixture-key",
                &[
                    json!({"role":"system","content":"Return JSON only."}),
                    json!({"role":"user","content":"hello"}),
                ],
            );
            server.join().unwrap();
            assert_eq!(
                result.unwrap_or_else(|e| panic!("{protocol:?}: {e:?}")),
                text
            );
            let request = requests.try_iter().next().unwrap();
            assert!(
                request.starts_with(&format!("POST {path} HTTP")),
                "{protocol:?}: {request}"
            );
            assert!(
                request.to_lowercase().contains(&auth.to_lowercase()),
                "{protocol:?}: missing auth"
            );
            assert!(!request.lines().next().unwrap().contains("fixture-key"));
            let body: Value =
                serde_json::from_str(request.split("\r\n\r\n").nth(1).unwrap()).unwrap();
            let encoded = body.to_string();
            assert!(
                encoded.contains("Return JSON only.") && encoded.contains("hello"),
                "{protocol:?}: {body}"
            );
            assert!(body
                .get("tools")
                .is_none_or(|v| v.as_array().is_some_and(|a| a.is_empty())));
            if protocol == Protocol::Azure {
                assert_eq!(
                    body["max_completion_tokens"], 4096,
                    "Azure deployments must support reasoning models"
                );
                assert!(body.get("max_tokens").is_none());
            }
            let mut probe_response = response;
            let target = match protocol {
                Protocol::OpenaiChat | Protocol::Azure => {
                    &mut probe_response["choices"][0]["message"]["content"]
                }
                Protocol::OpenaiResponses => &mut probe_response["output"][0]["content"][0]["text"],
                Protocol::Anthropic => &mut probe_response["content"][0]["text"],
                Protocol::Gemini => {
                    &mut probe_response["candidates"][0]["content"]["parts"][0]["text"]
                }
                Protocol::Ollama => &mut probe_response["message"]["content"],
            };
            *target = json!(r#"{"ok":true}"#);
            let (url, requests, server) = scripted(vec![(200, probe_response.to_string())]);
            let root = url.strip_suffix("/v1/chat/completions").unwrap();
            let input = Config {
                endpoint: format!("{root}{path}"),
                model: "fixture".into(),
                ..Default::default()
            };
            let detected = super::super::detection::detect_with(
                &input,
                "fixture-key",
                super::super::rig_transport::probe,
            )
            .unwrap();
            server.join().unwrap();
            assert_eq!(detected.protocol, protocol);
            assert_eq!(detected.endpoint, input.endpoint);
            let sent: Vec<_> = requests.try_iter().collect();
            assert_eq!(sent.len(), 1);
            assert!(
                sent[0].starts_with(&format!("POST {path} HTTP")),
                "{protocol:?}: {}",
                sent[0]
            );
        }
    }
    #[test]
    fn rig_errors_redact_before_truncating_and_bound_responses() {
        for (status, body, expected) in [
            (
                401,
                json!({"error":{"message":format!("{}{}", "x".repeat(190), "fixture-key")}})
                    .to_string(),
                "401",
            ),
            (200, "x".repeat(MAX_RESPONSE + 1), "大小限制"),
            (302, "{}".into(), "302"),
            (200, "not json".into(), "AI 请求失败"),
        ] {
            let (url, _requests, server) = scripted(vec![(status, body)]);
            let config = Config {
                endpoint: url,
                model: "fixture".into(),
                ..Default::default()
            };
            let err = format!(
                "{:?}",
                send_http(
                    &config,
                    "fixture-key",
                    &[json!({"role":"user","content":"hello"})]
                )
                .unwrap_err()
            );
            server.join().unwrap();
            assert!(err.contains(expected), "{err}");
            assert!(!err.contains("fixture-key"), "{err}");
        }
    }
    #[test]
    fn detection_falls_back_over_real_http_without_sending_business_context() {
        let refusal = json!({"error":{"message":"fixture-key authentication failed"}}).to_string();
        let (url, requests, server) =
            scripted(vec![(401, refusal), (200, completion(r#"{"ok":true}"#))]);
        let root = url.strip_suffix("/chat/completions").unwrap();
        let input = Config {
            endpoint: root.into(),
            model: "claude-fixture".into(),
            ..Default::default()
        };
        let result = super::super::detection::detect_with(
            &input,
            "fixture-key",
            super::super::rig_transport::probe,
        )
        .unwrap();
        server.join().unwrap();
        assert_eq!(result.protocol, Protocol::OpenaiChat);
        let sent: Vec<_> = requests.try_iter().collect();
        assert_eq!(sent.len(), 2);
        assert!(sent[0].starts_with("POST /v1/messages "));
        assert!(sent[0].contains("x-api-key: fixture-key"));
        assert!(sent[1].starts_with("POST /v1/chat/completions "));
        for request in sent {
            assert!(!request.contains("HOST_CONTEXT"));
            assert!(!request.contains("QUERY_RESULT"));
            assert!(!request.contains("PREVIOUS_DRAFT"));
            assert!(request.contains("Connection test only"));
        }
        let (url, _requests, server) = scripted(vec![(
            200,
            completion(r#"{"kind":"answer","message":"cached route"}"#),
        )]);
        let cached = Config {
            endpoint: url.strip_suffix("/v1/chat/completions").unwrap().into(),
            detected_endpoint: Some(url),
            model: "fixture".into(),
            ..Default::default()
        };
        assert!(send_http(
            &cached,
            "fixture-key",
            &[json!({"role":"user","content":"hello"})]
        )
        .unwrap()
        .contains("cached route"));
        server.join().unwrap();
    }
    #[test]
    fn detection_all_real_http_failures_are_visible_without_exposing_key() {
        let (url, requests, server) = scripted(
            (0..8)
                .map(|_| {
                    (
                        401,
                        json!({"error":{"message":"Invalid fixture-key"}}).to_string(),
                    )
                })
                .collect(),
        );
        let input = Config {
            endpoint: url.strip_suffix("/chat/completions").unwrap().into(),
            model: "fixture".into(),
            ..Default::default()
        };
        let error = super::super::detection::detect_with(
            &input,
            "fixture-key",
            super::super::rig_transport::probe,
        )
        .unwrap_err();
        server.join().unwrap();
        assert_eq!(requests.try_iter().count(), 8);
        assert_eq!(error.message.matches("HTTP 401").count(), 8);
        assert!(!error.message.contains("fixture-key"));
        assert!(error.message.contains("Ollama"));
        assert!(error.message.contains("Anthropic Messages"));
    }
    #[test]
    fn rig_rejects_truncated_and_filtered_valid_json() {
        for reason in ["length", "content_filter"] {
            let response = json!({"id":"r1","model":"fixture","choices":[{"index":0,"finish_reason":reason,"message":{"role":"assistant","content":r#"{"kind":"plan","actions":[]}"#}}]});
            let (url, _requests, server) = scripted(vec![(200, response.to_string())]);
            let config = Config {
                endpoint: url,
                model: "fixture".into(),
                ..Default::default()
            };
            let result = send_http(
                &config,
                "fixture-key",
                &[json!({"role":"user","content":"hello"})],
            );
            server.join().unwrap();
            assert!(result.is_err(), "{reason} response must not be accepted");
        }
    }
    #[test]
    fn real_http_transport_posts_json_and_parses_completion() {
        let (url, requests, thread) = scripted(vec![(
            200,
            completion("{\"kind\":\"clarify\",\"message\":\"上午还是晚上？\"}"),
        )]);
        let result = call(&url, "fixture-key").unwrap();
        thread.join().unwrap();
        let request = requests.try_iter().next().unwrap();
        assert!(request.starts_with("POST /v1/chat/completions"));
        assert!(request.contains("Bearer fixture-key"));
        assert!(request.contains("\"type\":\"json_object\""));
        assert!(request.contains("max_completion_tokens"));
        assert!(result.contains("上午还是晚上"));
    }
    #[test]
    fn unsupported_request_fields_fall_back_to_the_compatible_dialect() {
        let refusal =
            json!({"error":{"message":"Unrecognized request argument: max_completion_tokens"}})
                .to_string();
        let (url, requests, thread) = scripted(vec![
            (400, refusal),
            // Models without JSON mode often fence the object.
            (
                200,
                completion("```json\n{\"kind\":\"answer\",\"message\":\"ok\"}\n```"),
            ),
        ]);
        let result = call(&url, "fixture-key").unwrap();
        thread.join().unwrap();
        let sent: Vec<String> = requests.try_iter().collect();
        assert_eq!(sent.len(), 2);
        assert!(sent[1].contains("\"max_tokens\""));
        assert!(!sent[1].contains("max_completion_tokens"));
        assert!(!sent[1].contains("response_format"));
        // The retried answer still reaches the strict parser as clean JSON.
        assert_eq!(
            serde_json::from_str::<Value>(&result).unwrap()["kind"],
            json!("answer")
        );
    }
    #[test]
    fn json_mode_refusal_preserves_modern_cap_for_reasoning_deployments() {
        let (url, requests, server) = scripted(vec![
            (
                400,
                json!({"error":{"message":"response_format is not supported"}}).to_string(),
            ),
            (200, completion(r#"{"kind":"answer","message":"ok"}"#)),
        ]);
        call(&url, "fixture-key").unwrap();
        server.join().unwrap();
        let sent: Vec<_> = requests.try_iter().collect();
        assert!(sent[1].contains("max_completion_tokens"));
        assert!(!sent[1].contains("response_format"));
    }
    #[test]
    fn model_not_found_does_not_retry_and_writes_nothing() {
        let refusal = json!({"error":{"message":"model not found"}}).to_string();
        let (url, requests, thread) = scripted(vec![(400, refusal)]);
        let error = call(&url, "fixture-key").unwrap_err();
        thread.join().unwrap();
        assert_eq!(requests.try_iter().count(), 1);
        assert!(error.message.contains("model not found"));
        assert!(error.message.contains("未提交任何变更"));
    }
    #[test]
    fn rejected_credentials_surface_the_reason_without_echoing_the_key() {
        let body = json!({"error":{"message":"Invalid API key provided: fixture-key"}}).to_string();
        let (url, requests, thread) = scripted(vec![(401, body)]);
        let error = call(&url, "fixture-key").unwrap_err();
        thread.join().unwrap();
        // A hard credential failure is not a request-shape problem: no retry.
        assert_eq!(requests.try_iter().count(), 1);
        assert!(error.message.contains("HTTP 401"));
        assert!(error.message.contains("Invalid API key"));
        assert!(error.message.contains("***"));
        assert!(!error.message.contains("fixture-key"));
    }
    #[test]
    fn redirects_are_reported_instead_of_forwarding_the_token() {
        let (url, requests, thread) = scripted(vec![(302, String::new())]);
        let error = call(&url, "fixture-key").unwrap_err();
        thread.join().unwrap();
        assert_eq!(requests.try_iter().count(), 1);
        assert!(error.message.contains("重定向"));
    }
    #[test]
    fn unreachable_service_names_the_cause() {
        // Nothing is listening on this port, so the connection is refused.
        let server = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = server.local_addr().unwrap();
        drop(server);
        let error = call(&format!("http://{addr}/v1/chat/completions"), "fixture-key").unwrap_err();
        assert!(error.message.contains("AI 请求失败"));
        assert!(error.message.contains("未提交任何变更"));
    }
    #[test]
    fn model_output_is_normalized_before_parsing() {
        assert_eq!(normalize_json("  {\"a\":1}  "), "{\"a\":1}");
        assert_eq!(normalize_json("```json\n{\"a\":1}\n```"), "{\"a\":1}");
        assert_eq!(normalize_json("```\n{\"a\":1}\n```"), "{\"a\":1}");
        assert_eq!(normalize_json("好的：{\"a\":1} 完成"), "{\"a\":1}");
        // Non-JSON stays untouched so the caller still rejects it.
        assert_eq!(normalize_json("sorry"), "sorry");
    }
    #[test]
    fn content_parts_are_parsed_by_rig() {
        let mut response: Value = serde_json::from_str(&completion("")).unwrap();
        response["choices"][0]["message"]["content"] = json!([
            {"type":"text","text":"{\"kind\":\"answer\","},
            {"type":"text","text":"\"message\":\"ok\"}"}
        ]);
        let (url, _requests, server) = scripted(vec![(200, response.to_string())]);
        assert_eq!(
            call(&url, "fixture-key").unwrap(),
            r#"{"kind":"answer","message":"ok"}"#
        );
        server.join().unwrap();
    }
}
