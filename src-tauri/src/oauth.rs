//! OAuth 2.0 桌面授权（Authorization Code + PKCE）。
//!
//! 桌面端是 public client：用 PKCE（S256）而非 client_secret 保护授权码交换
//! （Google Desktop 客户端仍要求同时带上随包分发的 client_secret，一并携带）。
//! 回调走本机 loopback（`http://127.0.0.1:<临时端口>`），用完即关，`state` 防 CSRF。
//!
//! 只申请只读日历权限：Google `calendar.readonly`，Microsoft `Calendars.Read`
//! （加 `offline_access` 换 refresh_token）。token 交给 `token_store` 用 DPAPI 加密落库。

use crate::db::AppDb;
use crate::error::CommandError;
use crate::models::OAuthAccount;
use crate::oauth_config;
use crate::token_store::{self, TokenSet};
use chrono::{Duration, Utc};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::time::{Duration as StdDuration, Instant};
use tauri::{Manager, State};

/// 授权流的整体超时：用户需要在浏览器里完成登录与授权。
const AUTH_TIMEOUT: StdDuration = StdDuration::from_secs(180);

// ---- provider 端点与 scope ------------------------------------------------

struct ProviderEndpoints {
    auth_uri: &'static str,
    token_uri: &'static str,
    scope: &'static str,
    /// 用户信息端点（拉邮箱作为账户标签）。Google 用 userinfo，Microsoft 用 Graph /me。
    userinfo_uri: &'static str,
}

fn endpoints_for(provider: &str) -> Result<ProviderEndpoints, CommandError> {
    match provider {
        "google" => Ok(ProviderEndpoints {
            auth_uri: "https://accounts.google.com/o/oauth2/auth",
            token_uri: "https://oauth2.googleapis.com/token",
            // openid+email 用于拿账户邮箱；calendar.readonly 只读日历。
            scope: "openid email https://www.googleapis.com/auth/calendar.readonly",
            userinfo_uri: "https://www.googleapis.com/oauth2/v3/userinfo",
        }),
        "microsoft" => Ok(ProviderEndpoints {
            // common：个人账户 + 组织账户都可登录。
            auth_uri: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
            token_uri: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
            scope: "openid email offline_access https://graph.microsoft.com/Calendars.Read",
            userinfo_uri: "https://graph.microsoft.com/v1.0/me",
        }),
        _ => Err(CommandError::validation("provider", "不支持的日历来源。")),
    }
}

// ---- PKCE -----------------------------------------------------------------

/// base64url（无填充）编码。PKCE / state 都用这种字符集，URL 安全。
fn base64url(bytes: &[u8]) -> String {
    const CHARSET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::with_capacity((bytes.len() + 2) / 3 * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(CHARSET[((n >> 18) & 63) as usize] as char);
        out.push(CHARSET[((n >> 12) & 63) as usize] as char);
        if chunk.len() > 1 {
            out.push(CHARSET[((n >> 6) & 63) as usize] as char);
        }
        if chunk.len() > 2 {
            out.push(CHARSET[(n & 63) as usize] as char);
        }
    }
    out
}

/// 用系统随机源生成 32 字节熵，base64url 后作为 verifier / state。
fn random_token() -> String {
    let mut buf = [0u8; 32];
    getrandom(&mut buf);
    base64url(&buf)
}

/// 取系统随机字节。用 uuid v4（内部走系统 RNG）拼够 32 字节，避免额外依赖。
fn getrandom(buf: &mut [u8]) {
    let mut i = 0;
    while i < buf.len() {
        let bytes = *uuid::Uuid::new_v4().as_bytes();
        let take = (buf.len() - i).min(bytes.len());
        buf[i..i + take].copy_from_slice(&bytes[..take]);
        i += take;
    }
}

fn code_challenge(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    base64url(&digest)
}

// ---- loopback 回调 --------------------------------------------------------

/// 在 127.0.0.1 上绑定一个临时端口的监听器。返回监听器与其实际端口。
fn bind_loopback() -> Result<(TcpListener, u16), CommandError> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|_| CommandError::system("无法启动本地回调服务。"))?;
    let port = listener
        .local_addr()
        .map_err(|_| CommandError::system("无法获取回调端口。"))?
        .port();
    Ok((listener, port))
}

/// 解析回调请求行里的查询参数（`GET /?code=...&state=... HTTP/1.1`）。
fn parse_callback_query(request_line: &str) -> Vec<(String, String)> {
    // 形如 "GET /?a=b&c=d HTTP/1.1"
    let Some(path) = request_line.split_whitespace().nth(1) else {
        return Vec::new();
    };
    let Some(query) = path.split_once('?').map(|(_, q)| q) else {
        return Vec::new();
    };
    query
        .split('&')
        .filter_map(|pair| {
            let (k, v) = pair.split_once('=')?;
            Some((url_decode(k), url_decode(v)))
        })
        .collect()
}

/// 极简 application/x-www-form-urlencoded 解码（%XX 与 '+'）。
fn url_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b'%' if i + 2 < bytes.len() => {
                let hi = hex_val(bytes[i + 1]);
                let lo = hex_val(bytes[i + 2]);
                if let (Some(hi), Some(lo)) = (hi, lo) {
                    out.push((hi << 4) | lo);
                    i += 3;
                } else {
                    out.push(bytes[i]);
                    i += 1;
                }
            }
            other => {
                out.push(other);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

/// application/x-www-form-urlencoded 编码单个组件（用于拼授权 URL 的 query）。
fn url_encode(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for &b in input.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}

/// 阻塞等待浏览器回调，直到拿到一次带 `code`/`error` 的请求或超时。
/// 返回该次回调的查询参数。回调后给浏览器回一段“可关闭此页”的 HTML。
fn wait_for_callback(listener: &TcpListener) -> Result<Vec<(String, String)>, CommandError> {
    listener
        .set_nonblocking(true)
        .map_err(|_| CommandError::system("回调服务配置失败。"))?;
    let started = Instant::now();
    loop {
        if started.elapsed() > AUTH_TIMEOUT {
            return Err(CommandError::validation("oauth", "授权超时，请重试。"));
        }
        match listener.accept() {
            Ok((mut stream, _)) => {
                if let Some(query) = read_request_query(&mut stream) {
                    respond_done(&mut stream);
                    // 只关心带 code 或 error 的那次回调；浏览器可能先发 favicon 请求。
                    let has_code = query.iter().any(|(k, _)| k == "code" || k == "error");
                    if has_code {
                        return Ok(query);
                    }
                }
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(StdDuration::from_millis(120));
            }
            Err(_) => return Err(CommandError::system("回调服务读取失败。")),
        }
    }
}

/// 读取 HTTP 请求首行并解析查询参数。只读到首行即可。
fn read_request_query(stream: &mut TcpStream) -> Option<Vec<(String, String)>> {
    stream
        .set_read_timeout(Some(StdDuration::from_secs(2)))
        .ok()?;
    let mut buf = [0u8; 2048];
    let n = stream.read(&mut buf).ok()?;
    if n == 0 {
        return None;
    }
    let text = String::from_utf8_lossy(&buf[..n]);
    let first_line = text.lines().next()?;
    Some(parse_callback_query(first_line))
}

/// 给浏览器回一个简单的成功页，提示用户可以关闭并回到 Nowly。
fn respond_done(stream: &mut TcpStream) {
    let body = "<!DOCTYPE html><html lang=\"zh\"><head><meta charset=\"utf-8\">\
        <title>Nowly</title></head><body style=\"font-family:sans-serif;\
        text-align:center;margin-top:15vh;color:#333\">\
        <h2>授权完成</h2><p>已连接日历，请回到 Nowly。可以关闭此页面。</p>\
        </body></html>";
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\
         Content-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.as_bytes().len(),
        body
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

// ---- 打开系统浏览器 -------------------------------------------------------

/// 用系统默认浏览器打开授权 URL。Windows 走 ShellExecuteW（不引入额外插件）。
#[cfg(target_os = "windows")]
fn open_in_browser(url: &str) -> Result<(), CommandError> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let wide: Vec<u16> = std::ffi::OsStr::new(url)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let verb: Vec<u16> = std::ffi::OsStr::new("open")
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    // SAFETY: 传入以 NUL 结尾的宽字符串；ShellExecuteW 不持有指针。
    let result = unsafe {
        ShellExecuteW(
            None,
            PCWSTR(verb.as_ptr()),
            PCWSTR(wide.as_ptr()),
            PCWSTR::null(),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };
    // ShellExecuteW 返回值 > 32 视为成功。
    if result.0 as isize > 32 {
        Ok(())
    } else {
        Err(CommandError::system("无法打开系统浏览器。"))
    }
}

#[cfg(not(target_os = "windows"))]
fn open_in_browser(_url: &str) -> Result<(), CommandError> {
    Err(CommandError::system("当前平台不支持打开浏览器。"))
}

// ---- token 交换与刷新 -----------------------------------------------------

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: Option<String>,
    refresh_token: Option<String>,
    expires_in: Option<i64>,
    #[allow(dead_code)]
    token_type: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

fn expires_at_from(expires_in: Option<i64>) -> String {
    // 留 60 秒余量，避免临界过期。
    let secs = expires_in.unwrap_or(3600).max(60) - 60;
    (Utc::now() + Duration::seconds(secs)).to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

/// 用授权码换 token。
fn exchange_code(
    provider: &str,
    endpoints: &ProviderEndpoints,
    code: &str,
    verifier: &str,
    redirect_uri: &str,
) -> Result<TokenSet, CommandError> {
    let creds = oauth_config::credentials(provider)?;
    let mut form: Vec<(&str, &str)> = vec![
        ("client_id", creds.client_id.as_str()),
        ("code", code),
        ("code_verifier", verifier),
        ("grant_type", "authorization_code"),
        ("redirect_uri", redirect_uri),
    ];
    // Google Desktop 客户端要求带 client_secret（随包分发，非机密）。
    if let Some(secret) = creds.client_secret.as_deref() {
        if !secret.is_empty() {
            form.push(("client_secret", secret));
        }
    }
    let body = crate::net::post_oauth_form(endpoints.token_uri, &form)?;
    parse_token_response(&body)
}

fn parse_token_response(body: &str) -> Result<TokenSet, CommandError> {
    let parsed: TokenResponse = serde_json::from_str(body)
        .map_err(|_| CommandError::validation("oauth", "无法解析授权响应。"))?;
    if let Some(error) = parsed.error {
        let detail = parsed.error_description.unwrap_or(error);
        return Err(CommandError::validation(
            "oauth",
            format!("授权失败：{detail}"),
        ));
    }
    let access_token = parsed
        .access_token
        .ok_or_else(|| CommandError::validation("oauth", "授权响应缺少令牌。"))?;
    Ok(TokenSet {
        access_token,
        refresh_token: parsed.refresh_token,
        expires_at: expires_at_from(parsed.expires_in),
        scopes: String::new(),
    })
}

/// 用 refresh_token 刷新 access_token。返回新的 access_token 与过期时间。
/// refresh_token 通常不变，返回的 TokenSet.refresh_token 可能为 None。
pub fn refresh_access_token(provider: &str, refresh_token: &str) -> Result<TokenSet, CommandError> {
    let endpoints = endpoints_for(provider)?;
    let creds = oauth_config::credentials(provider)?;
    let mut form: Vec<(&str, &str)> = vec![
        ("client_id", creds.client_id.as_str()),
        ("refresh_token", refresh_token),
        ("grant_type", "refresh_token"),
    ];
    if let Some(secret) = creds.client_secret.as_deref() {
        if !secret.is_empty() {
            form.push(("client_secret", secret));
        }
    }
    let body = crate::net::post_oauth_form(endpoints.token_uri, &form)?;
    parse_token_response(&body)
}

// ---- 拉取账户邮箱作为标签 -------------------------------------------------

#[derive(Debug, Deserialize)]
struct GoogleUserInfo {
    email: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GraphUser {
    #[serde(rename = "userPrincipalName")]
    user_principal_name: Option<String>,
    mail: Option<String>,
}

/// 用 access_token 拉账户的邮箱/主体名作为展示标签。失败时回退到 provider 名。
fn fetch_account_label(
    provider: &str,
    endpoints: &ProviderEndpoints,
    access_token: &str,
) -> String {
    let fallback = || match provider {
        "google" => "Google 日历".to_owned(),
        "microsoft" => "Outlook 日历".to_owned(),
        _ => "日历账户".to_owned(),
    };
    let Ok((status, body)) = crate::net::get_with_bearer(endpoints.userinfo_uri, access_token)
    else {
        return fallback();
    };
    if !(200..300).contains(&status) {
        return fallback();
    }
    match provider {
        "google" => serde_json::from_str::<GoogleUserInfo>(&body)
            .ok()
            .and_then(|u| u.email)
            .unwrap_or_else(fallback),
        "microsoft" => serde_json::from_str::<GraphUser>(&body)
            .ok()
            .and_then(|u| u.mail.or(u.user_principal_name))
            .unwrap_or_else(fallback),
        _ => fallback(),
    }
}

// ---- 授权命令 -------------------------------------------------------------

/// 发起一次 OAuth 授权：起 loopback → 开浏览器 → 等回调 → 换 token → 存账户。
/// 阻塞直到完成或超时（网络与等待都在锁外，仅存库时短锁）。返回新账户信息。
pub fn start_login(db: &AppDb, provider: &str) -> Result<OAuthAccount, CommandError> {
    let endpoints = endpoints_for(provider)?;
    let creds = oauth_config::credentials(provider)?;
    if creds.client_id.is_empty() {
        return Err(CommandError::validation(
            "provider",
            "该来源尚未配置凭证，暂不可用。",
        ));
    }

    let (listener, port) = bind_loopback()?;
    let redirect_uri = format!("http://127.0.0.1:{port}");
    let verifier = random_token();
    let challenge = code_challenge(&verifier);
    let state = random_token();

    let auth_url = format!(
        "{}?response_type=code&client_id={}&redirect_uri={}&scope={}\
         &code_challenge={}&code_challenge_method=S256&state={}\
         &access_type=offline&prompt=consent",
        endpoints.auth_uri,
        url_encode(&creds.client_id),
        url_encode(&redirect_uri),
        url_encode(endpoints.scope),
        url_encode(&challenge),
        url_encode(&state),
    );

    open_in_browser(&auth_url)?;

    let query = wait_for_callback(&listener)?;
    // state 校验：防 CSRF / 混淆。
    let returned_state = query.iter().find(|(k, _)| k == "state").map(|(_, v)| v);
    if returned_state.map(String::as_str) != Some(state.as_str()) {
        return Err(CommandError::validation(
            "oauth",
            "授权状态校验失败，请重试。",
        ));
    }
    if let Some((_, err)) = query.iter().find(|(k, _)| k == "error") {
        return Err(CommandError::validation(
            "oauth",
            format!("授权被拒绝：{err}"),
        ));
    }
    let code = query
        .iter()
        .find(|(k, _)| k == "code")
        .map(|(_, v)| v.clone())
        .ok_or_else(|| CommandError::validation("oauth", "未收到授权码。"))?;

    let mut tokens = exchange_code(provider, &endpoints, &code, &verifier, &redirect_uri)?;
    tokens.scopes = endpoints.scope.to_owned();
    let label = fetch_account_label(provider, &endpoints, &tokens.access_token);

    let account_id = {
        let mut connection = db.0.lock().map_err(CommandError::database)?;
        token_store::upsert_account(&mut connection, provider, &label, &tokens)?
    };
    Ok(OAuthAccount {
        id: account_id,
        provider: provider.to_owned(),
        account_label: label,
        created_at: String::new(),
        updated_at: String::new(),
    })
}

/// 确保账户的 access_token 有效：过期则用 refresh_token 刷新并落库。
/// 返回可用的 access_token。无 refresh_token 且已过期则报错（需重新授权）。
pub fn ensure_valid_access_token(db: &AppDb, account_id: &str) -> Result<String, CommandError> {
    // ① 短锁读账户 token。
    let account = {
        let connection = db.0.lock().map_err(CommandError::database)?;
        token_store::account_tokens(&connection, account_id)?
    };
    let expired = account
        .expires_at
        .as_deref()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|exp| exp.with_timezone(&Utc) <= Utc::now())
        .unwrap_or(true);
    if !expired {
        return Ok(account.access_token);
    }
    let Some(refresh) = account.refresh_token.as_deref() else {
        return Err(CommandError::validation(
            "oauth",
            "登录已过期，请重新连接该账户。",
        ));
    };
    // ② 锁外刷新。
    let refreshed = refresh_access_token(&account.provider, refresh)?;
    // ③ 短锁写回。
    {
        let connection = db.0.lock().map_err(CommandError::database)?;
        token_store::update_access_token(
            &connection,
            account_id,
            &refreshed.access_token,
            &refreshed.expires_at,
        )?;
    }
    Ok(refreshed.access_token)
}

// ---- Tauri 命令 -----------------------------------------------------------

/// 授权流程会阻塞等待浏览器回调（最多 `AUTH_TIMEOUT`）。若在主线程同步执行，
/// 窗口会“未响应”。因此改为 async 命令 + `spawn_blocking`：把阻塞等待丢进
/// 阻塞线程池，主线程立刻返回、UI 保持可交互。
#[tauri::command]
pub async fn start_oauth_login<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    provider: String,
) -> Result<OAuthAccount, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        let db = app.state::<AppDb>();
        start_login(db.inner(), &provider)
    })
    .await
    .map_err(|_| CommandError::system("授权任务执行失败。"))?
}

#[tauri::command]
pub fn list_oauth_accounts(db: State<'_, AppDb>) -> Result<Vec<OAuthAccount>, CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    token_store::list_accounts(&connection)
}

#[tauri::command]
pub fn disconnect_oauth_account(db: State<'_, AppDb>, id: String) -> Result<(), CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    token_store::delete_account(&mut connection, &id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64url_matches_known_vectors() {
        // RFC 4648 base64url，无填充。
        assert_eq!(base64url(b""), "");
        assert_eq!(base64url(b"f"), "Zg");
        assert_eq!(base64url(b"fo"), "Zm8");
        assert_eq!(base64url(b"foo"), "Zm9v");
        assert_eq!(base64url(b"foob"), "Zm9vYg");
        assert_eq!(base64url(b"fooba"), "Zm9vYmE");
        assert_eq!(base64url(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn code_challenge_is_s256_of_verifier() {
        // RFC 7636 附录 B 的官方向量。
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        let challenge = code_challenge(verifier);
        assert_eq!(challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }

    #[test]
    fn random_tokens_are_urlsafe_and_unique() {
        let a = random_token();
        let b = random_token();
        assert_ne!(a, b);
        assert!(a
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
    }

    #[test]
    fn parses_callback_query_from_request_line() {
        let q = parse_callback_query("GET /?code=abc123&state=xyz%20z HTTP/1.1");
        assert_eq!(q.len(), 2);
        assert_eq!(q[0], ("code".to_owned(), "abc123".to_owned()));
        assert_eq!(q[1], ("state".to_owned(), "xyz z".to_owned()));
    }

    #[test]
    fn callback_without_query_is_empty() {
        assert!(parse_callback_query("GET / HTTP/1.1").is_empty());
    }

    #[test]
    fn url_encode_escapes_reserved_but_keeps_unreserved() {
        assert_eq!(url_encode("a b/c"), "a%20b%2Fc");
        assert_eq!(url_encode("A-Z_a.z~0"), "A-Z_a.z~0");
    }

    #[test]
    fn url_decode_roundtrips_encoded_reserved() {
        assert_eq!(url_decode("a%20b%2Fc"), "a b/c");
        assert_eq!(url_decode("x+y"), "x y");
    }

    #[test]
    fn token_response_error_is_surfaced() {
        let body = r#"{"error":"invalid_grant","error_description":"bad code"}"#;
        let err = parse_token_response(body).unwrap_err();
        assert_eq!(err.field.as_deref(), Some("oauth"));
        assert!(err.message.contains("bad code"));
    }

    #[test]
    fn token_response_success_parses_tokens() {
        let body =
            r#"{"access_token":"at","refresh_token":"rt","expires_in":3600,"token_type":"Bearer"}"#;
        let set = parse_token_response(body).unwrap();
        assert_eq!(set.access_token, "at");
        assert_eq!(set.refresh_token.as_deref(), Some("rt"));
        // expires_at 应是未来时刻。
        let exp = chrono::DateTime::parse_from_rfc3339(&set.expires_at).unwrap();
        assert!(exp.with_timezone(&Utc) > Utc::now());
    }

    #[test]
    fn unknown_provider_is_rejected() {
        assert!(endpoints_for("dropbox").is_err());
    }
}
