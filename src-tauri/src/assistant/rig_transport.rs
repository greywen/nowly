//! Protocol adapters only. No tools or execution authority are given to Rig.
use super::provider::{endpoint, is_local, Config, Protocol};
use crate::error::CommandError;
use bytes::Bytes;
use rig_core::{
    client::CompletionClient,
    completion::{AssistantContent, CompletionModel},
    http_client::{self as http, HttpClientExt, LazyBody, Request, Response},
    message::Message,
    providers::{anthropic, azure, gemini, ollama, openai},
};
use serde_json::Value;
use std::{future::Future, time::Duration};

const LIMIT: usize = 1024 * 1024;
fn invalid(text: &str) -> CommandError {
    CommandError::validation("assistant", text)
}

#[derive(Clone, Debug, Default)]
struct BoundedHttp(reqwest_rig::Client);
impl HttpClientExt for BoundedHttp {
    fn send<T, U>(
        &self,
        req: Request<T>,
    ) -> impl Future<Output = http::Result<Response<LazyBody<U>>>> + Send + 'static
    where
        T: Into<Bytes> + Send,
        U: From<Bytes> + Send + 'static,
    {
        let (parts, body) = req.into_parts();
        let client = self.0.clone();
        let body: Bytes = body.into();
        async move {
            let mut url = reqwest_rig::Url::parse(&parts.uri.to_string())
                .map_err(|_| http::Error::Instance("无效的请求地址".into()))?;
            let mut headers = parts.headers;
            // Gemini's SDK puts its key in the URI; move it into a header before
            // sending, so proxy access logs and reqwest diagnostics cannot expose it.
            let pairs: Vec<_> = url
                .query_pairs()
                .map(|(k, v)| (k.into_owned(), v.into_owned()))
                .collect();
            if let Some((_, key)) = pairs.iter().find(|(k, _)| k == "key") {
                headers.insert("x-goog-api-key", http::HeaderValue::from_str(key)?);
                url.set_query(None);
                for (k, v) in pairs.iter().filter(|(k, _)| k != "key") {
                    url.query_pairs_mut().append_pair(k, v);
                }
            }
            let mut response = client
                .request(parts.method, url)
                .headers(headers)
                .body(body)
                .send()
                .await
                .map_err(|e| {
                    http::Error::Instance(
                        if e.is_timeout() {
                            "连接或响应超时"
                        } else {
                            "无法连接服务，请检查网络、代理和证书"
                        }
                        .into(),
                    )
                })?;
            let status = response.status();
            let mut data = Vec::new();
            while let Some(chunk) = response
                .chunk()
                .await
                .map_err(|_| http::Error::Instance("响应读取失败".into()))?
            {
                if data.len().saturating_add(chunk.len()) > LIMIT {
                    return Err(http::Error::Instance("AI 服务响应超出大小限制".into()));
                }
                data.extend_from_slice(&chunk);
            }
            if !status.is_success() {
                return Err(http::Error::InvalidStatusCodeWithMessage(
                    status,
                    String::from_utf8_lossy(&data).into_owned(),
                ));
            }
            let lazy: LazyBody<U> = Box::pin(async move { Ok(U::from(Bytes::from(data))) });
            Ok(Response::builder().status(status).body(lazy)?)
        }
    }
    fn send_multipart<U>(
        &self,
        _: Request<http::multipart::MultipartForm>,
    ) -> impl Future<Output = http::Result<Response<LazyBody<U>>>> + Send + 'static
    where
        U: From<Bytes> + Send + 'static,
    {
        async { Err(http::Error::Instance("不支持附件请求".into())) }
    }
    fn send_streaming<T>(
        &self,
        _: Request<T>,
    ) -> impl Future<Output = http::Result<http::StreamingResponse>> + Send
    where
        T: Into<Bytes> + Send,
    {
        async { Err(http::Error::Instance("当前规划器不使用流式请求".into())) }
    }
}

fn base(config: &Config) -> Result<String, CommandError> {
    let input = endpoint(&config.endpoint)?;
    let raw = config
        .detected_endpoint
        .as_deref()
        .unwrap_or(&config.endpoint);
    let detected = endpoint(raw)?;
    if input.origin() != detected.origin() {
        return Err(invalid("检测接口与用户填写的地址不在同一主机。"));
    }
    let raw = raw.trim_end_matches('/');
    let suffix = match config.protocol {
        Protocol::OpenaiChat => "/chat/completions",
        Protocol::OpenaiResponses => "/responses",
        Protocol::Anthropic => "/v1/messages",
        Protocol::Ollama => "/api/chat",
        _ => "",
    };
    let raw = if suffix.is_empty() {
        raw
    } else {
        raw.strip_suffix(suffix).unwrap_or(raw)
    };
    let raw = match config.protocol {
        Protocol::Anthropic => raw.strip_suffix("/v1").unwrap_or(raw),
        Protocol::Gemini => raw.strip_suffix("/v1beta").unwrap_or(raw),
        _ => raw,
    };
    Ok(raw.into())
}

pub fn send(config: &Config, key: &str, messages: &[Value]) -> Result<String, CommandError> {
    send_limited(config, key, messages, Duration::from_secs(90), 4096)
}

pub fn probe(config: &Config, key: &str, messages: &[Value]) -> Result<String, CommandError> {
    send_limited(config, key, messages, Duration::from_secs(15), 1024)
}

fn send_limited(
    config: &Config,
    key: &str,
    messages: &[Value],
    timeout: Duration,
    max_tokens: u64,
) -> Result<String, CommandError> {
    let base = base(config)?;
    if key.is_empty() && !is_local(&base) {
        return Err(invalid("远程 AI 服务需要 API Key。"));
    }
    // Deployment/model names are interpolated into paths by some adapters.
    if config.model.is_empty()
        || (matches!(config.protocol, Protocol::Azure | Protocol::Gemini)
            && config.model.contains(['/', '?', '#', '%', '\\']))
    {
        return Err(invalid("模型或部署名称无效。"));
    }
    let mut builder = reqwest_rig::Client::builder()
        .timeout(timeout)
        .connect_timeout(Duration::from_secs(10))
        .redirect(reqwest_rig::redirect::Policy::none());
    if is_local(&base) {
        builder = builder.no_proxy();
    }
    let client = BoundedHttp(
        builder
            .build()
            .map_err(|_| invalid("无法初始化 AI 连接。"))?,
    );
    let history: Vec<Message> = messages
        .iter()
        .map(|m| {
            let text = m["content"].as_str().unwrap_or("");
            match m["role"].as_str() {
                Some("system") => Message::system(text),
                Some("assistant") => Message::assistant(text),
                _ => Message::user(text),
            }
        })
        .collect();
    macro_rules! call {
        ($builder:expr) => {{
            let provider = $builder
                .http_client(client)
                .build()
                .map_err(|_| invalid("无法初始化协议，请检查地址和 Key 格式。"))?;
            complete(
                provider.completion_model(&config.model),
                history,
                key,
                config.protocol,
                timeout,
                max_tokens,
            )
        }};
    }
    match config.protocol {
        Protocol::OpenaiChat => {
            let provider = openai::Client::builder()
                .api_key(key)
                .base_url(&base)
                .http_client(client)
                .build()
                .map_err(|_| invalid("无法初始化 OpenAI 连接。"))?
                .completions_api();
            complete(
                provider.completion_model(&config.model),
                history,
                key,
                config.protocol,
                timeout,
                max_tokens,
            )
        }
        Protocol::OpenaiResponses => call!(openai::Client::builder().api_key(key).base_url(&base)),
        Protocol::Anthropic => call!(anthropic::Client::builder().api_key(key).base_url(&base)),
        Protocol::Gemini => call!(gemini::Client::builder().api_key(key).base_url(&base)),
        Protocol::Ollama => call!(ollama::Client::builder().api_key(key).base_url(&base)),
        Protocol::Azure => call!(azure::Client::builder()
            .api_key(azure::AzureOpenAIAuth::ApiKey(key.into()))
            .azure_endpoint(base)
            .api_version(&config.api_version)),
    }
}

fn complete<M: CompletionModel + Clone>(
    model: M,
    mut history: Vec<Message>,
    key: &str,
    protocol: Protocol,
    timeout: Duration,
    max_tokens: u64,
) -> Result<String, CommandError> {
    let prompt = history.pop().ok_or_else(|| invalid("AI 请求不能为空。"))?;
    let chat = matches!(protocol, Protocol::OpenaiChat | Protocol::Azure);
    let build = |compat: bool, json_mode: bool| {
        let builder = model
            .completion_request(prompt.clone())
            .messages(history.clone());
        if chat {
            // Deployment names cannot reliably identify Azure reasoning models.
            // Explicit caps avoid Rig's model-name heuristics and never send both.
            let mut params = if compat {
                serde_json::json!({"max_tokens":max_tokens})
            } else {
                serde_json::json!({"max_completion_tokens":max_tokens})
            };
            if json_mode {
                params["response_format"] = serde_json::json!({"type":"json_object"});
            }
            builder.additional_params(params).build()
        } else {
            builder.max_tokens(max_tokens).build()
        }
    };
    let result = tauri::async_runtime::block_on(async {
        tokio::time::timeout(timeout, async {
            let first = model.completion(build(false, true)).await;
            match first {
                Err(ref error)
                    if chat
                        && error
                            .provider_response_status()
                            .is_some_and(|s| matches!(s.as_u16(), 400 | 422 | 501))
                        && error.provider_response_body().is_some_and(|body| {
                            let body = body.to_lowercase();
                            ["max_completion_tokens", "max_tokens", "response_format"]
                                .iter()
                                .any(|field| body.contains(field))
                                && [
                                    "unsupported",
                                    "not supported",
                                    "unrecognized",
                                    "unknown",
                                    "not allowed",
                                    "invalid",
                                ]
                                .iter()
                                .any(|word| body.contains(word))
                        }) =>
                {
                    let body = error.provider_response_body().unwrap_or("").to_lowercase();
                    let only_json = body.contains("response_format")
                        && !body.contains("max_completion_tokens")
                        && !body.contains("max_tokens");
                    model.completion(build(!only_json, false)).await
                }
                result => result,
            }
        })
        .await
    })
    .map_err(|_| invalid("连接检测或模型请求超时；未提交任何变更。"))?;
    let response = result.map_err(|error| {
        // Redact BEFORE truncation, even when a provider echoes an entire key.
        let raw = error.to_string();
        let safe = if key.is_empty() {
            raw
        } else {
            raw.replace(key, "***")
        };
        let safe: String = safe
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .chars()
            .take(300)
            .collect();
        let status = error
            .provider_response_status()
            .map(|s| format!("HTTP {} ", s.as_u16()))
            .unwrap_or_default();
        let hint = match error.provider_response_status().map(|s| s.as_u16()) {
            Some(300..=399) => "请填写最终地址，不跟随重定向。",
            Some(401 | 403) => "请检查 API Key 和模型权限。",
            Some(404) => "请检查协议、地址前缀和模型/部署名称。",
            Some(429) => "请求过于频繁或额度不足。",
            _ => "",
        };
        invalid(&format!(
            "AI 请求失败：{status}{safe}；{hint}未提交任何变更。"
        ))
    })?;
    if response.finish_reason() == Some(rig_core::completion::FinishReason::Length) {
        return Err(invalid("模型回复被截断，请缩小请求范围。"));
    }
    if !matches!(
        response.finish_reason(),
        None | Some(rig_core::completion::FinishReason::Stop)
    ) {
        return Err(invalid("模型回复未正常完成或被过滤；未提交任何变更。"));
    }
    let text: String = response
        .choice
        .into_iter()
        .filter_map(|part| match part {
            AssistantContent::Text(text) => Some(text.text),
            _ => None,
        })
        .collect();
    if text.trim().is_empty() {
        return Err(invalid("AI 服务未返回文本；未提交任何变更。"));
    }
    Ok(text)
}
