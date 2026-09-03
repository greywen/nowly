use crate::error::CommandError;
use serde::{Deserialize, Serialize};
use std::io::Read;
use std::net::{IpAddr, SocketAddr, ToSocketAddrs};
use std::time::Duration;

// The trusted network boundary for sandboxed modules and the module market.
//
// Sandboxed extension code never touches the network directly (its iframe has a
// null origin and a `default-src 'none'` CSP). Every request it makes arrives
// here as a `proxy_fetch` call that the frontend has already checked against the
// module's declared host allow-list. This layer re-checks the allow-list — the
// frontend check is a convenience, this is the real gate — and additionally
// blocks private / loopback / link-local address ranges to prevent SSRF, caps
// the response size, forbids redirects, and enforces a short timeout.

const REQUEST_TIMEOUT: Duration = Duration::from_secs(8);
const MAX_RESPONSE_BYTES: usize = 1024 * 1024; // 1 MiB
const MAX_REGISTRY_BYTES: usize = 512 * 1024; // 512 KiB index
const MAX_MODULE_BYTES: usize = 512 * 1024; // 512 KiB of module source
const MAX_ICS_BYTES: usize = 1024 * 1024; // 1 MiB 的订阅日历
const MAX_RELEASE_BYTES: usize = 256 * 1024; // 256 KiB GitHub release payload
const USER_AGENT: &str = "Nowly-Module-Proxy/1";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyFetchRequest {
    pub url: String,
    #[serde(default)]
    pub method: Option<String>,
    #[serde(default)]
    pub headers: Vec<(String, String)>,
    #[serde(default)]
    pub body: Option<String>,
    // The module's declared host allow-list, forwarded so this layer can enforce
    // it independently of the frontend.
    #[serde(default)]
    pub allowed_hosts: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyFetchResponse {
    pub ok: bool,
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub text: String,
}

// Reject any URL whose host is not in the allow-list, is not https, or resolves
// to a non-public address. Returns the validated `reqwest::Url`.
fn validate_url(raw: &str, allowed_hosts: &[String]) -> Result<reqwest::Url, CommandError> {
    let url =
        reqwest::Url::parse(raw).map_err(|_| CommandError::validation("url", "请求地址无效。"))?;
    // Only https egress. http is refused so credentials and data are never sent
    // in cleartext, and to shrink the SSRF surface.
    if url.scheme() != "https" {
        return Err(CommandError::validation("url", "仅允许 https 请求。"));
    }
    let host = url
        .host_str()
        .ok_or_else(|| CommandError::validation("url", "请求地址缺少域名。"))?
        .to_ascii_lowercase();
    let permitted = allowed_hosts
        .iter()
        .any(|allowed| allowed.eq_ignore_ascii_case(&host));
    if !permitted {
        return Err(CommandError::validation(
            "url",
            "请求域名不在该模块声明的白名单内。",
        ));
    }
    // Block literal IPs that fall in private / loopback / link-local ranges.
    // Hostnames that resolve to those ranges are additionally blocked at connect
    // time below, but rejecting obvious literals early gives a clearer error.
    if let Ok(ip) = host.parse::<IpAddr>() {
        if !is_public_ip(&ip) {
            return Err(CommandError::validation("url", "禁止访问内网地址。"));
        }
    }
    Ok(url)
}

fn is_public_ip(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            !(v4.is_private()
                || v4.is_loopback()
                || v4.is_link_local()
                || v4.is_broadcast()
                || v4.is_documentation()
                || v4.is_multicast()
                || v4.is_unspecified()
                || v4.octets()[0] == 0
                // Carrier-grade NAT 100.64.0.0/10
                || (v4.octets()[0] == 100 && (v4.octets()[1] & 0xc0) == 64)
                // Reserved 240.0.0.0/4
                || v4.octets()[0] >= 240)
        }
        IpAddr::V6(v6) => {
            // IPv4-mapped (::ffff:0:0/96) and IPv4-compatible addresses must be
            // re-checked against the embedded v4 range, otherwise an attacker
            // can smuggle 127.0.0.1 through as ::ffff:127.0.0.1.
            if let Some(v4) = v6.to_ipv4() {
                return is_public_ip(&IpAddr::V4(v4));
            }
            !(v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                // Unique local fc00::/7
                || (v6.segments()[0] & 0xfe00) == 0xfc00
                // Link-local fe80::/10
                || (v6.segments()[0] & 0xffc0) == 0xfe80)
        }
    }
}

// Resolve `host:port` to socket addresses and keep only public ones. Rejects
// the request when the host does not resolve or every resolved address is
// private / loopback / link-local. Returning the concrete addresses lets the
// caller pin the connection to exactly what was validated, which closes the
// DNS-rebinding window between this check and the actual connect.
fn resolve_public_addrs(host: &str, port: u16) -> Result<Vec<SocketAddr>, CommandError> {
    // Literal IPs are validated directly; hostnames go through DNS.
    if let Ok(ip) = host.parse::<IpAddr>() {
        if !is_public_ip(&ip) {
            return Err(CommandError::validation("url", "禁止访问内网地址。"));
        }
        return Ok(vec![SocketAddr::new(ip, port)]);
    }
    let resolved: Vec<SocketAddr> = (host, port)
        .to_socket_addrs()
        .map_err(|_| CommandError::validation("url", "无法解析该域名。"))?
        .collect();
    if resolved.is_empty() {
        return Err(CommandError::validation("url", "无法解析该域名。"));
    }
    // Every resolved address must be public. If any resolves to a private range
    // we refuse outright rather than trying to connect to the public subset —
    // that keeps a rebinding attacker from mixing one public and one internal
    // answer.
    if resolved.iter().any(|addr| !is_public_ip(&addr.ip())) {
        return Err(CommandError::validation("url", "禁止访问内网地址。"));
    }
    Ok(resolved)
}

// Build a client whose DNS is pinned to the pre-validated addresses for `url`.
// reqwest will only connect to those addresses, so a hostname cannot be re-
// resolved to an internal IP after validation.
fn pinned_client(url: &reqwest::Url) -> Result<reqwest::blocking::Client, CommandError> {
    let host = url
        .host_str()
        .ok_or_else(|| CommandError::validation("url", "请求地址缺少域名。"))?;
    let port = url.port_or_known_default().unwrap_or(443);
    let addrs = resolve_public_addrs(host, port)?;
    let mut builder = reqwest::blocking::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .connect_timeout(REQUEST_TIMEOUT)
        // Refuse redirects: a permitted host must not be able to bounce us to an
        // internal address or an out-of-allow-list domain.
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(USER_AGENT);
    builder = builder.resolve_to_addrs(host, &addrs);
    builder.build().map_err(CommandError::system)
}

// Windows stores the current user's manual WinINet proxy in this shape:
// either one endpoint for every protocol (`127.0.0.1:7897`) or a semicolon-
// separated map (`http=host:port;https=host:port`). Browsers and WebView2 use
// this setting automatically, while reqwest does not, so OAuth could finish in
// the browser and then time out when Nowly exchanged the authorization code.
fn https_proxy_from_server(value: &str) -> Option<String> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }

    let endpoint = if value.contains('=') {
        value.split(';').find_map(|part| {
            let (scheme, endpoint) = part.split_once('=')?;
            scheme
                .trim()
                .eq_ignore_ascii_case("https")
                .then(|| endpoint.trim())
        })?
    } else {
        value
    };
    if endpoint.is_empty() || endpoint.chars().any(char::is_whitespace) {
        return None;
    }

    let candidate = if endpoint.contains("://") {
        endpoint.to_owned()
    } else {
        format!("http://{endpoint}")
    };
    let parsed = reqwest::Url::parse(&candidate).ok()?;
    if !matches!(parsed.scheme(), "http" | "https")
        || parsed.host_str().is_none()
        || parsed.port_or_known_default().is_none()
        || parsed.username() != ""
        || parsed.password().is_some()
        || parsed.path() != "/"
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return None;
    }
    Some(candidate)
}

#[cfg(target_os = "windows")]
fn windows_manual_https_proxy() -> Option<String> {
    use std::ffi::c_void;
    use windows::core::w;
    use windows::Win32::Foundation::ERROR_SUCCESS;
    use windows::Win32::System::Registry::{
        RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD, RRF_RT_REG_SZ,
    };

    let subkey = w!("Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings");
    let mut enabled = 0u32;
    let mut enabled_size = std::mem::size_of::<u32>() as u32;
    let enabled_status = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            subkey,
            w!("ProxyEnable"),
            RRF_RT_REG_DWORD,
            None,
            Some((&mut enabled as *mut u32).cast::<c_void>()),
            Some(&mut enabled_size),
        )
    };
    if enabled_status != ERROR_SUCCESS || enabled == 0 {
        return None;
    }

    let mut byte_len = 0u32;
    let size_status = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            subkey,
            w!("ProxyServer"),
            RRF_RT_REG_SZ,
            None,
            None,
            Some(&mut byte_len),
        )
    };
    if size_status != ERROR_SUCCESS || byte_len < 2 || byte_len > 16 * 1024 {
        return None;
    }

    let mut buffer = vec![0u16; (byte_len as usize + 1) / 2];
    let read_status = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            subkey,
            w!("ProxyServer"),
            RRF_RT_REG_SZ,
            None,
            Some(buffer.as_mut_ptr().cast::<c_void>()),
            Some(&mut byte_len),
        )
    };
    if read_status != ERROR_SUCCESS {
        return None;
    }
    let end = buffer
        .iter()
        .position(|unit| *unit == 0)
        .unwrap_or(buffer.len());
    https_proxy_from_server(&String::from_utf16_lossy(&buffer[..end]))
}

#[cfg(not(target_os = "windows"))]
fn windows_manual_https_proxy() -> Option<String> {
    None
}

// OAuth and calendar calls use the browser's manual Windows proxy when one is
// enabled. The destination URL is still restricted by `assert_oauth_host`, TLS
// still authenticates the Google/Microsoft endpoint, and redirects remain
// disabled. We resolve the destination up front as an additional guard; direct
// connections are pinned to that result, while proxied requests use HTTPS
// CONNECT through the explicitly configured proxy.
fn oauth_client(url: &reqwest::Url) -> Result<reqwest::blocking::Client, CommandError> {
    let host = url
        .host_str()
        .ok_or_else(|| CommandError::validation("url", "请求地址缺少域名。"))?;
    let port = url.port_or_known_default().unwrap_or(443);
    let addrs = resolve_public_addrs(host, port)?;
    let mut builder = reqwest::blocking::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .connect_timeout(REQUEST_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(USER_AGENT)
        .resolve_to_addrs(host, &addrs);
    if let Some(proxy_url) = windows_manual_https_proxy() {
        let proxy = reqwest::Proxy::https(&proxy_url)
            .map_err(|_| CommandError::validation("proxy", "系统代理配置无效。"))?;
        builder = builder.proxy(proxy);
    }
    builder.build().map_err(CommandError::system)
}

// Read at most `limit` bytes from the response body; anything larger is an
// error rather than an unbounded allocation.
fn read_capped(
    response: reqwest::blocking::Response,
    limit: usize,
) -> Result<String, CommandError> {
    let mut reader = response.take(limit as u64 + 1);
    let mut buffer: Vec<u8> = Vec::new();
    reader
        .read_to_end(&mut buffer)
        .map_err(CommandError::system)?;
    if buffer.len() > limit {
        return Err(CommandError::validation("url", "响应内容过大。"));
    }
    Ok(String::from_utf8_lossy(&buffer).into_owned())
}

fn run_proxy_fetch(request: ProxyFetchRequest) -> Result<ProxyFetchResponse, CommandError> {
    let url = validate_url(&request.url, &request.allowed_hosts)?;
    let method = request
        .method
        .as_deref()
        .unwrap_or("GET")
        .to_ascii_uppercase();
    // Only simple, non-destructive methods are proxied.
    let method = match method.as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        _ => {
            return Err(CommandError::validation("method", "仅支持 GET 和 POST。"));
        }
    };

    let client = pinned_client(&url)?;
    let mut builder = client.request(method, url);
    // Forward a conservative subset of headers. Hop-by-hop and identity headers
    // are dropped so a module cannot spoof cookies, auth, or the host.
    for (name, value) in &request.headers {
        let lname = name.to_ascii_lowercase();
        let blocked = matches!(
            lname.as_str(),
            "host"
                | "cookie"
                | "authorization"
                | "content-length"
                | "connection"
                | "origin"
                | "referer"
                | "user-agent"
        );
        if blocked {
            continue;
        }
        builder = builder.header(name, value);
    }
    if let Some(body) = request.body {
        builder = builder.body(body);
    }

    let response = builder.send().map_err(|error| {
        // Do not leak internal details; a failed request is a validation-level
        // problem from the module's perspective.
        CommandError::validation("url", &format!("请求失败：{}", short_reqwest_error(&error)))
    })?;

    let status = response.status().as_u16();
    let ok = response.status().is_success();
    let mut headers: Vec<(String, String)> = Vec::new();
    for (name, value) in response.headers().iter() {
        if let Ok(value) = value.to_str() {
            headers.push((name.as_str().to_owned(), value.to_owned()));
        }
    }
    let text = read_capped(response, MAX_RESPONSE_BYTES)?;
    Ok(ProxyFetchResponse {
        ok,
        status,
        headers,
        text,
    })
}

fn short_reqwest_error(error: &reqwest::Error) -> String {
    if error.is_timeout() {
        "超时".to_owned()
    } else if error.is_connect() {
        "无法连接".to_owned()
    } else {
        "网络错误".to_owned()
    }
}

// Fetch an arbitrary https resource with a byte cap, used for the registry index
// and module source download. Unlike `proxy_fetch` there is no per-module host
// allow-list — instead the caller passes the max size, and the same https-only /
// no-private-IP / no-redirect rules apply.
fn fetch_text(url_str: &str, limit: usize) -> Result<String, CommandError> {
    let url =
        reqwest::Url::parse(url_str).map_err(|_| CommandError::validation("url", "地址无效。"))?;
    if url.scheme() != "https" {
        return Err(CommandError::validation("url", "仅允许 https 地址。"));
    }
    let client = pinned_client(&url)?;
    let response = client.get(url).send().map_err(|error| {
        CommandError::validation("url", &format!("请求失败：{}", short_reqwest_error(&error)))
    })?;
    if !response.status().is_success() {
        return Err(CommandError::validation("url", "远端返回错误状态。"));
    }
    read_capped(response, limit)
}

/// 拉取一个 https 的 .ics 订阅内容。复用 https-only / 拦内网 IP 字面量 /
/// 禁重定向 / 限大小 / 超时基线。URL 需已是 https（webcal→https 由调用方完成）。
pub fn fetch_ics(url: &str) -> Result<String, CommandError> {
    fetch_text(url, MAX_ICS_BYTES)
}

/// 拉取一个 https 的公开资源（用于软件更新检查，例如 GitHub Releases API）。
/// 复用同一套 https-only / 拦内网 IP / 禁重定向 / 限大小 / 超时基线。
pub fn fetch_public_text(url: &str) -> Result<String, CommandError> {
    fetch_text(url, MAX_RELEASE_BYTES)
}

// The fixed set of hosts the OAuth calendar integration may talk to. Unlike the
// module proxy (which enforces a per-module user allow-list), these API calls
// carry an `Authorization: Bearer` token, so the destination must be pinned to
// exactly the identity/token/calendar endpoints of Google and Microsoft — never
// an arbitrary host a caller might pass. Any host outside this list is refused.
const OAUTH_API_HOSTS: &[&str] = &[
    "accounts.google.com",
    "oauth2.googleapis.com",
    "www.googleapis.com",
    "login.microsoftonline.com",
    "graph.microsoft.com",
];

const MAX_API_BYTES: usize = 2 * 1024 * 1024; // 2 MiB of calendar JSON

fn assert_oauth_host(url: &reqwest::Url) -> Result<(), CommandError> {
    let host = url
        .host_str()
        .ok_or_else(|| CommandError::validation("url", "请求地址缺少域名。"))?
        .to_ascii_lowercase();
    if OAUTH_API_HOSTS.iter().any(|allowed| *allowed == host) {
        Ok(())
    } else {
        Err(CommandError::validation(
            "url",
            "请求域名不在授权白名单内。",
        ))
    }
}

/// 向固定白名单内的 OAuth token 端点发一个 `application/x-www-form-urlencoded`
/// 的 POST（换 code 或刷新 token）。复用 https-only / 拦内网 IP / 禁重定向 /
/// 限大小 / 超时基线，host 被钉死在 `OAUTH_API_HOSTS`。返回响应体文本（可能是
/// 成功或错误 JSON，由调用方按 HTTP 状态区分）。
pub fn post_oauth_form(url: &str, form: &[(&str, &str)]) -> Result<String, CommandError> {
    let parsed =
        reqwest::Url::parse(url).map_err(|_| CommandError::validation("url", "地址无效。"))?;
    if parsed.scheme() != "https" {
        return Err(CommandError::validation("url", "仅允许 https 地址。"));
    }
    assert_oauth_host(&parsed)?;
    let client = oauth_client(&parsed)?;
    let response = client.post(parsed).form(form).send().map_err(|error| {
        CommandError::validation("url", &format!("请求失败：{}", short_reqwest_error(&error)))
    })?;
    // token 端点用非 2xx 表达业务错误（如 invalid_grant），把响应体带回给调用方
    // 解析，而不是在这里吞掉。
    read_capped(response, MAX_RELEASE_BYTES)
}

/// 向固定白名单内的 API 端点发一个带 `Authorization: Bearer` 的 GET（拉日历/事件）。
/// 复用同一套安全基线，host 钉死在 `OAUTH_API_HOSTS`。返回 (status, body)。
pub fn get_with_bearer(url: &str, access_token: &str) -> Result<(u16, String), CommandError> {
    let parsed =
        reqwest::Url::parse(url).map_err(|_| CommandError::validation("url", "地址无效。"))?;
    if parsed.scheme() != "https" {
        return Err(CommandError::validation("url", "仅允许 https 地址。"));
    }
    assert_oauth_host(&parsed)?;
    let client = oauth_client(&parsed)?;
    let response = client
        .get(parsed)
        .bearer_auth(access_token)
        .send()
        .map_err(|error| {
            CommandError::validation("url", &format!("请求失败：{}", short_reqwest_error(&error)))
        })?;
    let status = response.status().as_u16();
    let body = read_capped(response, MAX_API_BYTES)?;
    Ok((status, body))
}

/// 向固定 OAuth API 白名单发送带 Bearer 的 JSON 写请求。
/// 与读取接口共用 DNS pinning、禁重定向、超时和响应大小限制。
pub fn json_with_bearer(
    method: &str,
    url: &str,
    access_token: &str,
    body: Option<&serde_json::Value>,
) -> Result<(u16, String), CommandError> {
    let parsed =
        reqwest::Url::parse(url).map_err(|_| CommandError::validation("url", "地址无效。"))?;
    if parsed.scheme() != "https" {
        return Err(CommandError::validation("url", "仅允许 https 地址。"));
    }
    assert_oauth_host(&parsed)?;
    let method = match method {
        "POST" => reqwest::Method::POST,
        "PATCH" => reqwest::Method::PATCH,
        "DELETE" => reqwest::Method::DELETE,
        _ => return Err(CommandError::validation("method", "不支持的日历写入方法。")),
    };
    let client = oauth_client(&parsed)?;
    let mut request = client.request(method, parsed).bearer_auth(access_token);
    if let Some(value) = body {
        request = request
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(value.to_string());
    }
    let response = request.send().map_err(|error| {
        CommandError::validation("url", &format!("请求失败：{}", short_reqwest_error(&error)))
    })?;
    let status = response.status().as_u16();
    let body = read_capped(response, MAX_API_BYTES)?;
    Ok((status, body))
}

#[tauri::command]
pub fn proxy_fetch(request: ProxyFetchRequest) -> Result<ProxyFetchResponse, CommandError> {
    run_proxy_fetch(request)
}

#[tauri::command]
pub fn fetch_registry(url: String) -> Result<String, CommandError> {
    fetch_text(&url, MAX_REGISTRY_BYTES)
}

#[tauri::command]
pub fn download_module(url: String) -> Result<String, CommandError> {
    fetch_text(&url, MAX_MODULE_BYTES)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hosts(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn rejects_non_https() {
        let err =
            validate_url("http://api.example.com/x", &hosts(&["api.example.com"])).unwrap_err();
        assert_eq!(err.field.as_deref(), Some("url"));
    }

    #[test]
    fn rejects_host_not_in_allow_list() {
        let err = validate_url("https://evil.com/x", &hosts(&["api.example.com"])).unwrap_err();
        assert_eq!(err.field.as_deref(), Some("url"));
    }

    #[test]
    fn accepts_allowed_host_case_insensitively() {
        let url =
            validate_url("https://API.Example.com/data", &hosts(&["api.example.com"])).unwrap();
        assert_eq!(url.host_str(), Some("api.example.com"));
    }

    #[test]
    fn rejects_private_ip_literal() {
        let err = validate_url("https://127.0.0.1/x", &hosts(&["127.0.0.1"])).unwrap_err();
        assert_eq!(err.field.as_deref(), Some("url"));
        let err = validate_url("https://192.168.1.1/x", &hosts(&["192.168.1.1"])).unwrap_err();
        assert_eq!(err.field.as_deref(), Some("url"));
    }

    #[test]
    fn public_ip_classification() {
        assert!(is_public_ip(&"8.8.8.8".parse().unwrap()));
        assert!(!is_public_ip(&"10.0.0.1".parse().unwrap()));
        assert!(!is_public_ip(&"172.16.0.1".parse().unwrap()));
        assert!(!is_public_ip(&"169.254.0.1".parse().unwrap()));
        assert!(!is_public_ip(&"100.64.0.1".parse().unwrap()));
        assert!(!is_public_ip(&"::1".parse().unwrap()));
        assert!(!is_public_ip(&"fc00::1".parse().unwrap()));
        assert!(!is_public_ip(&"fe80::1".parse().unwrap()));
    }

    #[test]
    fn rejects_multicast_and_reserved_ranges() {
        assert!(!is_public_ip(&"224.0.0.1".parse().unwrap()));
        assert!(!is_public_ip(&"240.0.0.1".parse().unwrap()));
        assert!(!is_public_ip(&"ff02::1".parse().unwrap()));
    }

    #[test]
    fn ipv4_mapped_ipv6_is_reclassified_as_the_embedded_v4() {
        // ::ffff:127.0.0.1 must be rejected as loopback, not treated as a
        // generic public v6 address.
        assert!(!is_public_ip(&"::ffff:127.0.0.1".parse().unwrap()));
        assert!(!is_public_ip(&"::ffff:10.0.0.1".parse().unwrap()));
        assert!(is_public_ip(&"::ffff:8.8.8.8".parse().unwrap()));
    }

    #[test]
    fn resolve_rejects_hostnames_that_map_to_loopback() {
        // localhost resolves to 127.0.0.1 / ::1 — both private, so resolution
        // must refuse rather than hand back a connectable address.
        let err = resolve_public_addrs("localhost", 443).unwrap_err();
        assert_eq!(err.field.as_deref(), Some("url"));
    }

    #[test]
    fn resolve_accepts_public_ip_literal() {
        let addrs = resolve_public_addrs("8.8.8.8", 443).unwrap();
        assert_eq!(addrs.len(), 1);
        assert_eq!(addrs[0].port(), 443);
    }

    #[test]
    fn resolve_rejects_private_ip_literal() {
        let err = resolve_public_addrs("127.0.0.1", 443).unwrap_err();
        assert_eq!(err.field.as_deref(), Some("url"));
    }

    #[test]
    fn fetch_ics_rejects_non_https_after_webcal_untouched() {
        // fetch_ics 只接受 https；http 直接拒绝（webcal 的转换在 subscriptions 层完成）。
        let err = fetch_ics("http://example.com/a.ics").unwrap_err();
        assert_eq!(err.field.as_deref(), Some("url"));
    }

    #[test]
    fn fetch_ics_rejects_private_ip() {
        let err = fetch_ics("https://192.168.0.10/a.ics").unwrap_err();
        assert_eq!(err.field.as_deref(), Some("url"));
    }

    #[test]
    fn parses_windows_https_proxy_formats() {
        assert_eq!(
            https_proxy_from_server("127.0.0.1:7897"),
            Some("http://127.0.0.1:7897".to_owned())
        );
        assert_eq!(
            https_proxy_from_server("http=proxy.test:8080;https=secure.test:8443"),
            Some("http://secure.test:8443".to_owned())
        );
        assert_eq!(
            https_proxy_from_server("HTTPS=https://secure.test:8443; socks=127.0.0.1:9"),
            Some("https://secure.test:8443".to_owned())
        );
    }

    #[test]
    fn rejects_unusable_windows_proxy_values() {
        assert_eq!(https_proxy_from_server(""), None);
        assert_eq!(https_proxy_from_server("http=proxy.test:8080"), None);
        assert_eq!(https_proxy_from_server("socks=127.0.0.1:7897"), None);
        assert_eq!(
            https_proxy_from_server("http://user:pass@proxy.test:8080"),
            None
        );
        assert_eq!(https_proxy_from_server("http://proxy.test:8080/path"), None);
    }

    #[test]
    #[ignore = "requires live Google connectivity"]
    fn oauth_client_reaches_google_through_the_windows_proxy() {
        let (status, _) = get_with_bearer(
            "https://www.googleapis.com/oauth2/v3/userinfo",
            "invalid-test-token",
        )
        .expect("Google should answer instead of timing out");
        assert_eq!(status, 401);
    }
}
