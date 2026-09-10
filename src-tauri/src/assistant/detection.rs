//! Same-origin, bounded protocol discovery. Model names affect ordering only.
use super::provider::{endpoint, Config, Protocol};
use crate::error::CommandError;
use serde_json::{json, Value};

const ALL: [Protocol; 6] = [
    Protocol::OpenaiChat,
    Protocol::OpenaiResponses,
    Protocol::Anthropic,
    Protocol::Gemini,
    Protocol::Azure,
    Protocol::Ollama,
];

pub fn label(protocol: Protocol) -> &'static str {
    match protocol {
        Protocol::OpenaiChat => "OpenAI Chat Completions",
        Protocol::OpenaiResponses => "OpenAI Responses",
        Protocol::Azure => "Azure OpenAI",
        Protocol::Anthropic => "Anthropic Messages",
        Protocol::Gemini => "Gemini generateContent",
        Protocol::Ollama => "Ollama",
    }
}

fn candidates(input: &Config) -> Result<Vec<Config>, CommandError> {
    let mut url = endpoint(&input.endpoint)?;
    let version = url
        .query_pairs()
        .find(|(k, _)| k == "api-version")
        .map(|(_, v)| v.into_owned())
        .unwrap_or_else(|| "2024-10-21".into());
    url.set_query(None);
    let path = url.path().trim_end_matches('/').to_owned();
    let host = url.host_str().unwrap_or("").to_lowercase();
    let model = input.model.to_lowercase();
    let azure_prefix = path.find("/openai/deployments/");
    let explicit = if azure_prefix.is_some() {
        Some(Protocol::Azure)
    } else if path.ends_with("/messages") {
        Some(Protocol::Anthropic)
    } else if path.ends_with(":generateContent") || path.ends_with("/v1beta") {
        Some(Protocol::Gemini)
    } else if path.ends_with("/api/chat") {
        Some(Protocol::Ollama)
    } else if path.ends_with("/chat/completions") {
        Some(Protocol::OpenaiChat)
    } else if path.ends_with("/responses") {
        Some(Protocol::OpenaiResponses)
    } else {
        None
    };
    let hint = explicit.unwrap_or_else(|| {
        if host.ends_with(".openai.azure.com") || host.ends_with(".cognitiveservices.azure.com") {
            Protocol::Azure
        } else if host == "api.anthropic.com" {
            Protocol::Anthropic
        } else if host == "generativelanguage.googleapis.com" {
            Protocol::Gemini
        } else if url.port() == Some(11434) {
            Protocol::Ollama
        } else if model.contains("claude") {
            Protocol::Anthropic
        } else if model.contains("gemini") {
            Protocol::Gemini
        } else {
            Protocol::OpenaiChat
        }
    });
    let stem = if let Some(index) = azure_prefix {
        &path[..index]
    } else if path.ends_with(":generateContent") {
        path.rfind("/models/").map(|i| &path[..i]).unwrap_or(&path)
    } else {
        ["/chat/completions", "/responses", "/messages", "/api/chat"]
            .iter()
            .find_map(|suffix| path.strip_suffix(suffix))
            .unwrap_or(&path)
    };
    let native = stem
        .strip_suffix("/v1beta")
        .or_else(|| stem.strip_suffix("/v1"))
        .unwrap_or(stem);
    let chat = if stem.is_empty() || stem.ends_with("/v1beta") {
        format!("{native}/v1")
    } else {
        stem.to_owned()
    };
    let alternate = if chat.ends_with("/v1") {
        native.to_owned()
    } else {
        format!("{native}/v1")
    };
    let mut protocols = ALL.to_vec();
    protocols.sort_by_key(|p| if *p == hint { 0 } else { 1 });
    let mut result = Vec::new();
    for protocol in protocols {
        let paths = if matches!(protocol, Protocol::OpenaiChat | Protocol::OpenaiResponses) {
            vec![chat.as_str(), alternate.as_str()]
        } else {
            vec![native]
        };
        for path in paths {
            let mut target = url.clone();
            target.set_path(path);
            let mut candidate = input.clone();
            candidate.protocol = protocol;
            candidate.api_version = version.clone();
            candidate.endpoint = target.to_string().trim_end_matches('/').into();
            candidate.detected_endpoint = None;
            if !result
                .iter()
                .any(|c: &Config| c.protocol == protocol && c.endpoint == candidate.endpoint)
            {
                result.push(candidate);
            }
        }
    }
    Ok(result)
}

pub fn detect_with<F>(input: &Config, key: &str, mut probe: F) -> Result<Config, CommandError>
where
    F: FnMut(&Config, &str, &[Value]) -> Result<String, CommandError>,
{
    let messages = [
        json!({"role":"user","content":"Connection test only. Reply with exactly this JSON object: {\"ok\":true}"}),
    ];
    let mut failures = Vec::new();
    for candidate in candidates(input)? {
        let result = probe(&candidate, key, &messages);
        let failure = match result {
            Ok(text) => {
                let text = super::provider::normalize_json(&text);
                if serde_json::from_str::<Value>(&text)
                    .ok()
                    .is_some_and(|v| v == json!({"ok":true}))
                {
                    let mut detected = input.clone();
                    detected.protocol = candidate.protocol;
                    detected.api_version = candidate.api_version;
                    detected.detected_endpoint = Some(candidate.endpoint);
                    return Ok(detected);
                }
                "接口没有返回有效的连接测试 JSON。".into()
            }
            Err(error) => error.message,
        };
        let safe = if key.is_empty() {
            failure
        } else {
            failure.replace(key, "***")
        };
        let safe: String = safe
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .chars()
            .take(350)
            .collect();
        // Paths identify tested routes, but hosts/URLs could themselves contain
        // the supplied key; redact the whole diagnostic before returning it.
        let line = format!(
            "{}（{}）：{}",
            label(candidate.protocol),
            candidate.endpoint,
            safe
        );
        failures.push(if key.is_empty() {
            line
        } else {
            line.replace(key, "***")
        });
    }
    Err(CommandError::validation(
        "assistant",
        format!(
            "自动检测失败，已尝试全部 {} 个候选接口；原设置未更改。\n{}",
            failures.len(),
            failures.join("\n")
        ),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn config(url: &str, model: &str) -> Config {
        Config {
            endpoint: url.into(),
            model: model.into(),
            ..Default::default()
        }
    }

    #[test]
    fn model_hint_prioritizes_but_never_excludes_other_protocols() {
        for (model, first) in [
            ("claude-fixture", Protocol::Anthropic),
            ("gemini-fixture", Protocol::Gemini),
            ("gpt-fixture", Protocol::OpenaiChat),
        ] {
            let routes = candidates(&config("https://gateway.example/v1", model)).unwrap();
            assert_eq!(routes[0].protocol, first);
            for protocol in ALL {
                assert!(routes.iter().any(|c| c.protocol == protocol));
            }
            assert!(routes.len() <= 8);
            assert!(routes
                .iter()
                .all(|c| c.endpoint.starts_with("https://gateway.example")));
        }
    }

    #[test]
    fn host_and_port_hints_precede_conflicting_model_names() {
        for (url, model, first) in [
            (
                "https://generativelanguage.googleapis.com",
                "claude-alias",
                Protocol::Gemini,
            ),
            ("http://127.0.0.1:11434", "gemini-local", Protocol::Ollama),
            (
                "https://api.anthropic.com",
                "gemini-alias",
                Protocol::Anthropic,
            ),
        ] {
            assert_eq!(candidates(&config(url, model)).unwrap()[0].protocol, first);
        }
    }

    #[test]
    fn explicit_url_hint_wins_and_gateway_prefix_is_preserved() {
        let routes = candidates(&config(
            "https://gateway.example/team/v1/messages",
            "gpt-fixture",
        ))
        .unwrap();
        assert_eq!(routes[0].protocol, Protocol::Anthropic);
        assert_eq!(routes[0].endpoint, "https://gateway.example/team");
        assert!(routes.iter().any(|c| c.protocol == Protocol::OpenaiChat
            && c.endpoint == "https://gateway.example/team/v1"));
        let local = candidates(&config("http://127.0.0.1:11434", "qwen:7b")).unwrap();
        assert_eq!(local[0].protocol, Protocol::Ollama);
    }

    #[test]
    fn azure_full_url_and_version_are_derived_without_extra_form_fields() {
        let routes = candidates(&config("https://resource.openai.azure.com/openai/deployments/production/chat/completions?api-version=2025-01-01-preview", "production")).unwrap();
        assert_eq!(routes[0].protocol, Protocol::Azure);
        assert_eq!(routes[0].endpoint, "https://resource.openai.azure.com");
        assert_eq!(routes[0].api_version, "2025-01-01-preview");
        assert!(candidates(&config("https://example.com/v1?key=secret", "model")).is_err());
    }

    #[test]
    fn failed_hints_fall_back_and_probe_never_contains_user_data() {
        let c = config("https://gateway.example/v1", "claude-fixture");
        let mut attempted = vec![];
        let result = detect_with(&c, "fixture-key", |candidate, key, messages| {
            assert_eq!(key, "fixture-key");
            assert_eq!(messages.len(), 1);
            assert_eq!(messages[0]["role"], "user");
            assert!(!serde_json::to_string(messages)
                .unwrap()
                .contains("HOST_CONTEXT"));
            attempted.push(candidate.protocol);
            if candidate.protocol == Protocol::OpenaiResponses {
                Ok(r#"{"ok":true}"#.into())
            } else {
                Err(CommandError::validation("assistant", "HTTP 404"))
            }
        })
        .unwrap();
        assert_eq!(attempted[0], Protocol::Anthropic);
        assert_eq!(result.protocol, Protocol::OpenaiResponses);
        assert_eq!(result.endpoint, c.endpoint);
        assert!(result.detected_endpoint.is_some());
        assert_eq!(attempted.last(), Some(&Protocol::OpenaiResponses));
    }

    #[test]
    fn all_failures_are_reported_and_secret_is_redacted_before_truncation() {
        let c = config("https://gateway.example/v1", "unknown");
        let mut attempts = 0;
        let error = detect_with(&c, "fixture-key", |_, _, _| {
            attempts += 1;
            Err(CommandError::validation(
                "assistant",
                format!("HTTP 401 {}fixture-key", "x".repeat(285)),
            ))
        })
        .unwrap_err();
        assert_eq!(attempts, candidates(&c).unwrap().len());
        for protocol in ALL {
            assert!(error.message.contains(label(protocol)));
        }
        assert!(!error.message.contains("fixture-key"));
        assert!(error.message.contains("原设置未更改"));
        assert!(error.message.contains('\n'));
    }

    #[test]
    fn successful_http_without_expected_json_does_not_select_a_route() {
        let c = config("https://example.com/v1", "model");
        for body in ["", "hello", "<html>ok</html>", r#"{"ok":false}"#] {
            assert!(detect_with(&c, "fixture-key", |_, _, _| Ok(body.into())).is_err());
        }
        assert!(detect_with(&c, "fixture-key", |_, _, _| Ok(
            json!({"ok":true}).to_string()
        ))
        .is_ok());
    }
}
