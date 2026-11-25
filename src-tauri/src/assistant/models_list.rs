//! Lists the models a service offers so settings can offer a choice instead of
//! a blank Model ID field. Same-origin, bounded, and never follows redirects.
use super::provider::{endpoint, is_local};
use crate::error::CommandError;
use serde_json::Value;
use std::{io::Read, time::Duration};

const LIMIT: u64 = 1024 * 1024;
const MAX_MODELS: usize = 500;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Kind {
    Openai,
    Azure,
    Anthropic,
    Gemini,
    Ollama,
}

#[derive(Debug, Clone)]
pub struct Route {
    pub kind: Kind,
    pub url: reqwest::Url,
}

pub enum FetchError {
    /// The host could not be reached at all; every other route shares it.
    Unreachable(String),
    Failed(String),
}

fn routes(raw: &str) -> Result<Vec<Route>, CommandError> {
    let mut url = endpoint(raw)?;
    let version = url
        .query_pairs()
        .find(|(k, _)| k == "api-version")
        .map(|(_, v)| v.into_owned())
        .unwrap_or_else(|| "2024-10-21".into());
    url.set_query(None);
    let path = url.path().trim_end_matches('/').to_owned();
    let host = url.host_str().unwrap_or("").to_lowercase();
    let azure = path.contains("/openai/deployments/")
        || host.ends_with(".openai.azure.com")
        || host.ends_with(".cognitiveservices.azure.com");
    let azure_prefix = path.find("/openai");
    let stem = if path.contains(":generateContent") {
        path.rfind("/models/").map(|i| &path[..i]).unwrap_or(&path)
    } else {
        [
            "/chat/completions",
            "/responses",
            "/messages",
            "/api/chat",
            "/api/tags",
            "/models",
        ]
        .iter()
        .find_map(|suffix| path.strip_suffix(suffix))
        .unwrap_or(&path)
    };
    let native = stem
        .strip_suffix("/v1beta")
        .or_else(|| stem.strip_suffix("/v1"))
        .unwrap_or(stem);
    let hint = if azure {
        Kind::Azure
    } else if host == "api.anthropic.com" || path.ends_with("/messages") {
        Kind::Anthropic
    } else if host == "generativelanguage.googleapis.com"
        || path.contains(":generateContent")
        || stem.ends_with("/v1beta")
    {
        Kind::Gemini
    } else if url.port() == Some(11434) || path.ends_with("/api/chat") {
        Kind::Ollama
    } else {
        Kind::Openai
    };
    let at = |path: String| {
        let mut target = url.clone();
        target.set_path(&path);
        target
    };
    let mut result = Vec::new();
    let mut push = |kind: Kind, target: reqwest::Url| {
        if !result.iter().any(|r: &Route| r.kind == kind && r.url == target) {
            result.push(Route { kind, url: target });
        }
    };
    let mut kinds = vec![Kind::Openai, Kind::Anthropic, Kind::Gemini, Kind::Ollama];
    if azure {
        kinds.insert(0, Kind::Azure);
    }
    kinds.sort_by_key(|k| if *k == hint { 0 } else { 1 });
    for kind in kinds {
        match kind {
            Kind::Azure => {
                let root = azure_prefix.map(|i| &path[..i]).unwrap_or("");
                push(kind, at(format!("{root}/openai/v1/models")));
                let mut legacy = at(format!("{root}/openai/models"));
                legacy.query_pairs_mut().append_pair("api-version", &version);
                push(kind, legacy);
            }
            Kind::Openai => {
                push(kind, at(format!("{stem}/models")));
                push(kind, at(format!("{native}/v1/models")));
            }
            Kind::Anthropic => push(kind, at(format!("{native}/v1/models"))),
            Kind::Gemini => push(kind, at(format!("{native}/v1beta/models"))),
            Kind::Ollama => push(kind, at(format!("{native}/api/tags"))),
        }
    }
    Ok(result)
}

fn headers(kind: Kind, key: &str) -> Vec<(&'static str, String)> {
    if key.is_empty() {
        return Vec::new();
    }
    match kind {
        Kind::Openai | Kind::Ollama => vec![("authorization", format!("Bearer {key}"))],
        Kind::Azure => vec![("api-key", key.into())],
        Kind::Anthropic => vec![
            ("x-api-key", key.into()),
            ("anthropic-version", "2023-06-01".into()),
        ],
        Kind::Gemini => vec![("x-goog-api-key", key.into())],
    }
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 200 && !id.chars().any(char::is_control)
}

/// OpenAI, Azure and Anthropic answer `data[].id`; Gemini and Ollama answer
/// `models[].name`. Gemini also lists embedding-only models, which cannot chat.
fn parse(body: &str) -> Option<Vec<String>> {
    let value: Value = serde_json::from_str(body).ok()?;
    let mut ids: Vec<String> = if let Some(data) = value["data"].as_array() {
        data.iter()
            .filter_map(|m| m["id"].as_str())
            .map(str::to_owned)
            .collect()
    } else {
        value["models"]
            .as_array()?
            .iter()
            .filter(|m| {
                m["supportedGenerationMethods"]
                    .as_array()
                    .map_or(true, |methods| {
                        methods.iter().any(|v| v == "generateContent")
                    })
            })
            .filter_map(|m| m["name"].as_str().or_else(|| m["model"].as_str()))
            .map(|name| name.strip_prefix("models/").unwrap_or(name).to_owned())
            .collect()
    };
    ids.retain(|id| valid_id(id));
    ids.sort();
    ids.dedup();
    ids.truncate(MAX_MODELS);
    (!ids.is_empty()).then_some(ids)
}

fn redact(text: &str, key: &str) -> String {
    let text: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let text = if key.is_empty() {
        text
    } else {
        text.replace(key, "***")
    };
    text.chars().take(200).collect()
}

pub fn list_with<F>(raw: &str, key: &str, mut fetch: F) -> Result<Vec<String>, CommandError>
where
    F: FnMut(&reqwest::Url, &[(&'static str, String)]) -> Result<String, FetchError>,
{
    let raw = raw.trim().trim_end_matches('/');
    if key.is_empty() && !is_local(raw) {
        return Err(CommandError::validation(
            "apiKey",
            "远程地址需要 API Key。",
        ));
    }
    let mut failures = Vec::new();
    for route in routes(raw)? {
        let line = |reason: &str| {
            let mut shown = route.url.clone();
            shown.set_query(None);
            format!("{shown}：{}", redact(reason, key))
        };
        match fetch(&route.url, &headers(route.kind, key)) {
            Ok(body) => match parse(&body) {
                Some(ids) => return Ok(ids),
                None => failures.push(line("没有返回模型列表。")),
            },
            Err(FetchError::Unreachable(reason)) => {
                failures.push(line(&reason));
                break;
            }
            Err(FetchError::Failed(reason)) => failures.push(line(&reason)),
        }
    }
    Err(CommandError::validation(
        "models",
        format!("无法获取模型列表。\n{}", failures.join("\n")),
    ))
}

pub fn fetch_http(
    url: &reqwest::Url,
    headers: &[(&'static str, String)],
) -> Result<String, FetchError> {
    let mut builder = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(10))
        .connect_timeout(Duration::from_secs(5))
        .redirect(reqwest::redirect::Policy::none());
    if is_local(url.as_str()) {
        builder = builder.no_proxy();
    }
    let client = builder
        .build()
        .map_err(|_| FetchError::Unreachable("无法初始化连接。".into()))?;
    let mut request = client.get(url.clone());
    for (name, value) in headers {
        request = request.header(*name, value);
    }
    let response = request.send().map_err(|e| {
        if e.is_timeout() {
            FetchError::Unreachable("连接或响应超时。".into())
        } else if e.is_connect() {
            FetchError::Unreachable("无法连接服务，请检查地址、网络和代理。".into())
        } else {
            FetchError::Failed("请求失败。".into())
        }
    })?;
    let status = response.status();
    let mut body = String::new();
    response
        .take(LIMIT + 1)
        .read_to_string(&mut body)
        .map_err(|_| FetchError::Failed("响应读取失败。".into()))?;
    if body.len() as u64 > LIMIT {
        return Err(FetchError::Failed("响应超出大小限制。".into()));
    }
    if status.is_redirection() {
        return Err(FetchError::Failed(format!("HTTP {}：服务要求重定向。", status.as_u16())));
    }
    if !status.is_success() {
        return Err(FetchError::Failed(format!("HTTP {}：{body}", status.as_u16())));
    }
    Ok(body)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::Write,
        net::TcpListener,
        sync::mpsc,
        thread,
    };

    fn urls(raw: &str) -> Vec<String> {
        routes(raw).unwrap().into_iter().map(|r| r.url.to_string()).collect()
    }

    #[test]
    fn routes_follow_the_service_hint_and_stay_on_the_same_origin() {
        let openai = urls("https://gateway.example/v1/chat/completions");
        assert_eq!(openai[0], "https://gateway.example/v1/models");
        assert!(openai.iter().all(|u| u.starts_with("https://gateway.example/")));
        assert!(openai.contains(&"https://gateway.example/api/tags".to_string()));

        let azure = urls("https://res.openai.azure.com/openai/deployments/prod/chat/completions?api-version=2025-01-01");
        assert_eq!(azure[0], "https://res.openai.azure.com/openai/v1/models");
        assert_eq!(azure[1], "https://res.openai.azure.com/openai/models?api-version=2025-01-01");

        assert_eq!(urls("https://api.anthropic.com")[0], "https://api.anthropic.com/v1/models");
        assert_eq!(
            urls("https://generativelanguage.googleapis.com/v1beta")[0],
            "https://generativelanguage.googleapis.com/v1beta/models"
        );
        assert_eq!(urls("http://127.0.0.1:11434")[0], "http://127.0.0.1:11434/api/tags");
    }

    #[test]
    fn every_listing_shape_is_parsed_sorted_and_filtered() {
        assert_eq!(
            parse(r#"{"data":[{"id":"gpt-b"},{"id":"gpt-a"},{"id":"gpt-a"},{"id":""}]}"#).unwrap(),
            vec!["gpt-a", "gpt-b"]
        );
        assert_eq!(
            parse(r#"{"models":[{"name":"models/gemini-pro","supportedGenerationMethods":["generateContent"]},{"name":"models/embedding","supportedGenerationMethods":["embedContent"]}]}"#).unwrap(),
            vec!["gemini-pro"]
        );
        assert_eq!(parse(r#"{"models":[{"name":"llama3:latest"}]}"#).unwrap(), vec!["llama3:latest"]);
        assert!(parse(r#"{"data":[]}"#).is_none());
        assert!(parse("<html></html>").is_none());
    }

    #[test]
    fn failures_fall_through_and_never_echo_the_key() {
        let mut seen = Vec::new();
        let ids = list_with("https://gateway.example/v1", "sk-secret", |url, headers| {
            seen.push((url.to_string(), headers.to_vec()));
            if seen.len() == 1 {
                Err(FetchError::Failed("HTTP 404: sk-secret not here".into()))
            } else {
                Ok(r#"{"data":[{"id":"m"}]}"#.into())
            }
        })
        .unwrap();
        assert_eq!(ids, vec!["m"]);
        assert_eq!(seen[0].1, vec![("authorization", "Bearer sk-secret".to_string())]);

        let error = list_with("https://gateway.example/v1", "sk-secret", |_, _| {
            Err(FetchError::Failed("HTTP 401: bad key sk-secret".into()))
        })
        .unwrap_err();
        assert!(!error.message.contains("sk-secret"));
        assert!(error.message.contains("HTTP 401"));
    }

    #[test]
    fn unreachable_hosts_stop_after_one_attempt_and_remote_needs_a_key() {
        let mut calls = 0;
        let error = list_with("https://gateway.example", "k", |_, _| {
            calls += 1;
            Err(FetchError::Unreachable("down".into()))
        })
        .unwrap_err();
        assert_eq!(calls, 1);
        assert!(error.message.contains("down"));
        assert!(list_with("https://gateway.example", "", |_, _| unreachable!()).is_err());
        assert!(list_with("http://127.0.0.1:11434", "", |_, h| {
            assert!(h.is_empty());
            Ok(r#"{"models":[{"name":"qwen"}]}"#.into())
        })
        .is_ok());
    }

    #[test]
    fn real_http_sends_auth_and_reports_redirects_without_following() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let (tx, rx) = mpsc::channel();
        let server = thread::spawn(move || {
            for reply in [
                "HTTP/1.1 302 Found\r\nLocation: https://elsewhere.example/\r\nContent-Length: 0\r\n\r\n",
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 22\r\n\r\n{\"data\":[{\"id\":\"m1\"}]}",
            ] {
                let (mut socket, _) = listener.accept().unwrap();
                let mut buffer = [0u8; 4096];
                let read = std::io::Read::read(&mut socket, &mut buffer).unwrap();
                tx.send(String::from_utf8_lossy(&buffer[..read]).to_lowercase()).unwrap();
                socket.write_all(reply.as_bytes()).unwrap();
            }
        });
        let ids = list_with(&format!("http://127.0.0.1:{port}/v1"), "local-key", fetch_http).unwrap();
        server.join().unwrap();
        assert_eq!(ids, vec!["m1"]);
        let first = rx.recv().unwrap();
        assert!(first.starts_with("get /v1/models"));
        assert!(first.contains("authorization: bearer local-key"));
        let second = rx.recv().unwrap();
        assert!(second.starts_with("get /v1/models"));
        assert!(second.contains("x-api-key: local-key"));
    }
}
