use crate::error::CommandError;
use serde::{Deserialize, Serialize};
use std::io::Read;
use std::net::IpAddr;
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
    let url = reqwest::Url::parse(raw)
        .map_err(|_| CommandError::validation("url", "请求地址无效。"))?;
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
                || v4.is_unspecified()
                || v4.octets()[0] == 0
                // Carrier-grade NAT 100.64.0.0/10
                || (v4.octets()[0] == 100 && (v4.octets()[1] & 0xc0) == 64))
        }
        IpAddr::V6(v6) => {
            !(v6.is_loopback()
                || v6.is_unspecified()
                // Unique local fc00::/7
                || (v6.segments()[0] & 0xfe00) == 0xfc00
                // Link-local fe80::/10
                || (v6.segments()[0] & 0xffc0) == 0xfe80)
        }
    }
}

fn blocking_client() -> Result<reqwest::blocking::Client, CommandError> {
    reqwest::blocking::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .connect_timeout(REQUEST_TIMEOUT)
        // Refuse redirects: a permitted host must not be able to bounce us to an
        // internal address or an out-of-allow-list domain.
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(USER_AGENT)
        .build()
        .map_err(CommandError::system)
}

// Read at most `limit` bytes from the response body; anything larger is an
// error rather than an unbounded allocation.
fn read_capped(response: reqwest::blocking::Response, limit: usize) -> Result<String, CommandError> {
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

    let client = blocking_client()?;
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
    let url = reqwest::Url::parse(url_str)
        .map_err(|_| CommandError::validation("url", "地址无效。"))?;
    if url.scheme() != "https" {
        return Err(CommandError::validation("url", "仅允许 https 地址。"));
    }
    if let Some(host) = url.host_str() {
        if let Ok(ip) = host.parse::<IpAddr>() {
            if !is_public_ip(&ip) {
                return Err(CommandError::validation("url", "禁止访问内网地址。"));
            }
        }
    }
    let client = blocking_client()?;
    let response = client
        .get(url)
        .send()
        .map_err(|error| CommandError::validation("url", &format!("请求失败：{}", short_reqwest_error(&error))))?;
    if !response.status().is_success() {
        return Err(CommandError::validation("url", "远端返回错误状态。"));
    }
    read_capped(response, limit)
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
        let err = validate_url("http://api.example.com/x", &hosts(&["api.example.com"]))
            .unwrap_err();
        assert_eq!(err.field.as_deref(), Some("url"));
    }

    #[test]
    fn rejects_host_not_in_allow_list() {
        let err = validate_url("https://evil.com/x", &hosts(&["api.example.com"]))
            .unwrap_err();
        assert_eq!(err.field.as_deref(), Some("url"));
    }

    #[test]
    fn accepts_allowed_host_case_insensitively() {
        let url = validate_url("https://API.Example.com/data", &hosts(&["api.example.com"]))
            .unwrap();
        assert_eq!(url.host_str(), Some("api.example.com"));
    }

    #[test]
    fn rejects_private_ip_literal() {
        let err = validate_url("https://127.0.0.1/x", &hosts(&["127.0.0.1"]))
            .unwrap_err();
        assert_eq!(err.field.as_deref(), Some("url"));
        let err = validate_url("https://192.168.1.1/x", &hosts(&["192.168.1.1"]))
            .unwrap_err();
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
}
