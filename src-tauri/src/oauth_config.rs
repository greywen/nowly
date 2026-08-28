//! OAuth 客户端凭证的编译期注入。真正的 client_id / client_secret 由 build.rs
//! 从 `oauth-credentials.json`（gitignore）读出，通过 `cargo:rustc-env` 暴露成编译期
//! 环境变量；这里用 `env!` 读进来。仓库里不留任何明文凭证；文件缺失时这些变量为空串，
//! OAuth 命令报“未配置”而非编译失败。
//!
//! 桌面端是 public client：Google 走 Authorization Code + PKCE，换 token 时按 Google
//! 对 “Desktop app” 的要求仍需带 client_secret（该 secret 会随包分发，不算真正机密）。
//! Microsoft 走 PKCE，不需要 secret。

use crate::error::CommandError;

// build.rs 通过 cargo:rustc-env 注入；文件缺失时为空串。
const GOOGLE_CLIENT_ID: &str = env!("NOWLY_GOOGLE_CLIENT_ID");
const GOOGLE_CLIENT_SECRET: &str = env!("NOWLY_GOOGLE_CLIENT_SECRET");
const MICROSOFT_CLIENT_ID: &str = env!("NOWLY_MICROSOFT_CLIENT_ID");

/// 某个 provider 的客户端凭证。
pub struct ClientCredentials {
    pub client_id: String,
    /// Google 桌面客户端换 token 需要；Microsoft 为 None。
    pub client_secret: Option<String>,
}

/// 取 provider 的客户端凭证。未配置（client_id 为空）返回可读校验错误，
/// 命令层据此提示用户“该来源尚未配置”。
pub fn credentials(provider: &str) -> Result<ClientCredentials, CommandError> {
    let (client_id, client_secret) = match provider {
        "google" => (
            GOOGLE_CLIENT_ID,
            if GOOGLE_CLIENT_SECRET.is_empty() {
                None
            } else {
                Some(GOOGLE_CLIENT_SECRET.to_owned())
            },
        ),
        "microsoft" => (MICROSOFT_CLIENT_ID, None),
        _ => return Err(CommandError::validation("provider", "不支持的日历来源。")),
    };
    if client_id.is_empty() {
        return Err(CommandError::validation(
            "provider",
            "该来源尚未配置凭证，暂不可用。",
        ));
    }
    Ok(ClientCredentials {
        client_id: client_id.to_owned(),
        client_secret,
    })
}
