//! OAuth 账户与 token 的存储层。
//!
//! access_token / refresh_token 属敏感凭证，绝不明文落盘：先用 Windows DPAPI
//! （`CryptProtectData`，绑定当前用户）加密成密文 BLOB 再写入 SQLite。读取时
//! 用 `CryptUnprotectData` 解密。DPAPI 的密钥由操作系统按用户账户托管，别的用户
//! 或别的机器无法解密，即使数据库文件被拷走也读不出明文 token。
//!
//! 账户记录本身（provider / 邮箱标签 / 过期时间）不敏感，明文存储用于列表展示。

use crate::error::CommandError;
use crate::models::OAuthAccount;
use rusqlite::{params, Connection, Row};
use uuid::Uuid;

// ---- DPAPI 加解密 ---------------------------------------------------------

#[cfg(target_os = "windows")]
fn dpapi_protect(plain: &[u8]) -> Result<Vec<u8>, CommandError> {
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{CryptProtectData, CRYPT_INTEGER_BLOB};

    // 空明文也要能往返：DPAPI 接受 0 长度输入。
    let mut in_blob = CRYPT_INTEGER_BLOB {
        cbData: plain.len() as u32,
        pbData: plain.as_ptr() as *mut u8,
    };
    let mut out_blob = CRYPT_INTEGER_BLOB::default();
    // SAFETY: 传入合法的输入 BLOB 指针与输出 BLOB 接收指针；成功后 out_blob.pbData
    // 指向 LocalAlloc 分配的内存，拷贝出来后立即 LocalFree，不留悬垂。
    unsafe {
        CryptProtectData(&mut in_blob, None, None, None, None, 0, &mut out_blob)
            .map_err(CommandError::system)?;
        let slice = std::slice::from_raw_parts(out_blob.pbData, out_blob.cbData as usize);
        let owned = slice.to_vec();
        let _ = LocalFree(Some(HLOCAL(out_blob.pbData as *mut _)));
        Ok(owned)
    }
}

#[cfg(target_os = "windows")]
fn dpapi_unprotect(cipher: &[u8]) -> Result<Vec<u8>, CommandError> {
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{CryptUnprotectData, CRYPT_INTEGER_BLOB};

    let mut in_blob = CRYPT_INTEGER_BLOB {
        cbData: cipher.len() as u32,
        pbData: cipher.as_ptr() as *mut u8,
    };
    let mut out_blob = CRYPT_INTEGER_BLOB::default();
    // SAFETY: 同 protect；解密失败（密文被篡改/换用户/换机器）返回 Err。
    unsafe {
        CryptUnprotectData(&mut in_blob, None, None, None, None, 0, &mut out_blob)
            .map_err(CommandError::system)?;
        let slice = std::slice::from_raw_parts(out_blob.pbData, out_blob.cbData as usize);
        let owned = slice.to_vec();
        let _ = LocalFree(Some(HLOCAL(out_blob.pbData as *mut _)));
        Ok(owned)
    }
}

// 非 Windows 平台（仅用于跨平台编译/单元测试）：不做真实加密，原样透传。
// 生产目标恒为 Windows，走上面的 DPAPI 分支。
#[cfg(not(target_os = "windows"))]
fn dpapi_protect(plain: &[u8]) -> Result<Vec<u8>, CommandError> {
    Ok(plain.to_vec())
}

#[cfg(not(target_os = "windows"))]
fn dpapi_unprotect(cipher: &[u8]) -> Result<Vec<u8>, CommandError> {
    Ok(cipher.to_vec())
}

fn encrypt_token(token: &str) -> Result<Vec<u8>, CommandError> {
    dpapi_protect(token.as_bytes())
}

fn decrypt_token(cipher: &[u8]) -> Result<String, CommandError> {
    let bytes = dpapi_unprotect(cipher)?;
    String::from_utf8(bytes).map_err(|_| CommandError::system("token 密文解码失败"))
}

// The assistant reuses the OS credential boundary, never the OAuth account
// tokens themselves. Unlike the legacy non-Windows test fallback, fail closed.
pub(crate) fn protect_secret(secret: &str) -> Result<Vec<u8>, CommandError> {
    if !cfg!(target_os = "windows") {
        return Err(CommandError::validation(
            "apiKey",
            "当前平台未提供安全凭据存储。",
        ));
    }
    encrypt_token(secret)
}

pub(crate) fn unprotect_secret(cipher: &[u8]) -> Result<String, CommandError> {
    if !cfg!(target_os = "windows") {
        return Err(CommandError::validation(
            "apiKey",
            "当前平台未提供安全凭据存储。",
        ));
    }
    decrypt_token(cipher)
}

// ---- 账户存储 -------------------------------------------------------------

/// 一次授权后要落库的完整 token 组。
#[derive(Debug)]
pub struct TokenSet {
    pub access_token: String,
    /// 刷新令牌。首次授权通常有；Microsoft/Google 某些刷新响应不返回新 refresh_token，
    /// 此时保留旧值（调用方负责传 None 表示“不更新”）。
    pub refresh_token: Option<String>,
    /// access_token 过期的 UTC 时间戳（RFC3339）。
    pub expires_at: String,
    pub scopes: String,
}

/// 后端内部使用的、含解密后 token 的账户视图（永不序列化给前端）。
#[allow(dead_code)]
pub struct AccountTokens {
    pub id: String,
    pub provider: String,
    pub account_label: String,
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: Option<String>,
    pub scopes: String,
}

fn now_utc() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

fn read_account(row: &Row<'_>) -> rusqlite::Result<OAuthAccount> {
    Ok(OAuthAccount {
        id: row.get(0)?,
        provider: row.get(1)?,
        account_label: row.get(2)?,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
    })
}

/// 列出全部 OAuth 账户（不含 token），供前端展示与管理。
pub fn list_accounts(connection: &Connection) -> Result<Vec<OAuthAccount>, CommandError> {
    let mut statement = connection
        .prepare(
            "SELECT id,provider,account_label,created_at,updated_at
             FROM oauth_accounts ORDER BY created_at ASC",
        )
        .map_err(CommandError::database)?;
    let rows = statement
        .query_map([], read_account)
        .map_err(CommandError::database)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(CommandError::database)?);
    }
    Ok(out)
}

/// 新建或按 (provider, account_label) 复用一个账户，写入加密后的 token。
/// 同一账户再次授权时更新其 token 而不是产生重复账户。返回账户 id。
pub fn upsert_account(
    connection: &mut Connection,
    provider: &str,
    account_label: &str,
    tokens: &TokenSet,
) -> Result<String, CommandError> {
    let access_enc = encrypt_token(&tokens.access_token)?;
    let refresh_enc = match &tokens.refresh_token {
        Some(value) => Some(encrypt_token(value)?),
        None => None,
    };
    let now = now_utc();

    let existing: Option<String> = connection
        .query_row(
            "SELECT id FROM oauth_accounts WHERE provider=?1 AND account_label=?2",
            params![provider, account_label],
            |row| row.get(0),
        )
        .ok();

    if let Some(id) = existing {
        // 更新 token；refresh_token 为 None 时保留旧值（授权刷新常见）。
        if let Some(refresh) = refresh_enc {
            connection
                .execute(
                    "UPDATE oauth_accounts
                        SET access_token_enc=?2, refresh_token_enc=?3,
                            token_expires_at=?4, scopes=?5, updated_at=?6
                     WHERE id=?1",
                    params![
                        id,
                        access_enc,
                        refresh,
                        tokens.expires_at,
                        tokens.scopes,
                        now
                    ],
                )
                .map_err(CommandError::database)?;
        } else {
            connection
                .execute(
                    "UPDATE oauth_accounts
                        SET access_token_enc=?2, token_expires_at=?3,
                            scopes=?4, updated_at=?5
                     WHERE id=?1",
                    params![id, access_enc, tokens.expires_at, tokens.scopes, now],
                )
                .map_err(CommandError::database)?;
        }
        return Ok(id);
    }

    let id = Uuid::new_v4().to_string();
    connection
        .execute(
            "INSERT INTO oauth_accounts
                (id,provider,account_label,access_token_enc,refresh_token_enc,
                 token_expires_at,scopes,created_at,updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?8)",
            params![
                id,
                provider,
                account_label,
                access_enc,
                refresh_enc,
                tokens.expires_at,
                tokens.scopes,
                now
            ],
        )
        .map_err(CommandError::database)?;
    Ok(id)
}

/// 读取账户的解密 token（后端内部使用）。账户不存在返回校验错误。
pub fn account_tokens(
    connection: &Connection,
    account_id: &str,
) -> Result<AccountTokens, CommandError> {
    let (provider, label, access_enc, refresh_enc, expires, scopes): (
        String,
        String,
        Vec<u8>,
        Option<Vec<u8>>,
        Option<String>,
        String,
    ) = connection
        .query_row(
            "SELECT provider,account_label,access_token_enc,refresh_token_enc,
                    token_expires_at,scopes
             FROM oauth_accounts WHERE id=?1",
            params![account_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            },
        )
        .map_err(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => {
                CommandError::validation("accountId", "账户不存在。")
            }
            other => CommandError::database(other),
        })?;

    let refresh_token = match refresh_enc {
        Some(bytes) => Some(decrypt_token(&bytes)?),
        None => None,
    };
    Ok(AccountTokens {
        id: account_id.to_owned(),
        provider,
        account_label: label,
        access_token: decrypt_token(&access_enc)?,
        refresh_token,
        expires_at: expires,
        scopes,
    })
}

/// 刷新后仅更新 access_token 与过期时间（refresh_token 通常不变）。
pub fn update_access_token(
    connection: &Connection,
    account_id: &str,
    access_token: &str,
    expires_at: &str,
) -> Result<(), CommandError> {
    let access_enc = encrypt_token(access_token)?;
    connection
        .execute(
            "UPDATE oauth_accounts
                SET access_token_enc=?2, token_expires_at=?3, updated_at=?4
             WHERE id=?1",
            params![account_id, access_enc, expires_at, now_utc()],
        )
        .map_err(CommandError::database)?;
    Ok(())
}

/// 删除账户（其订阅与外部事件经外键级联删除）。
pub fn delete_account(connection: &mut Connection, account_id: &str) -> Result<(), CommandError> {
    let affected = connection
        .execute(
            "DELETE FROM oauth_accounts WHERE id=?1",
            params![account_id],
        )
        .map_err(CommandError::database)?;
    if affected == 0 {
        return Err(CommandError::validation("accountId", "账户不存在。"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn memory_db() -> Connection {
        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch("PRAGMA foreign_keys = ON;")
            .unwrap();
        crate::db::migrate(&mut connection).unwrap();
        connection
    }

    fn token_set() -> TokenSet {
        TokenSet {
            access_token: "access-abc".into(),
            refresh_token: Some("refresh-xyz".into()),
            expires_at: "2026-08-15T10:00:00Z".into(),
            scopes: "calendar.readonly".into(),
        }
    }

    #[test]
    fn upsert_then_read_roundtrips_tokens() {
        let mut connection = memory_db();
        let id = upsert_account(&mut connection, "google", "me@example.com", &token_set()).unwrap();

        let tokens = account_tokens(&connection, &id).unwrap();
        assert_eq!(tokens.provider, "google");
        assert_eq!(tokens.account_label, "me@example.com");
        assert_eq!(tokens.access_token, "access-abc");
        assert_eq!(tokens.refresh_token.as_deref(), Some("refresh-xyz"));
        assert_eq!(tokens.expires_at.as_deref(), Some("2026-08-15T10:00:00Z"));
    }

    #[test]
    fn upsert_same_account_updates_instead_of_duplicating() {
        let mut connection = memory_db();
        let first =
            upsert_account(&mut connection, "google", "me@example.com", &token_set()).unwrap();
        let mut next = token_set();
        next.access_token = "access-2".into();
        next.refresh_token = None; // 刷新响应不带新 refresh_token
        let second = upsert_account(&mut connection, "google", "me@example.com", &next).unwrap();
        assert_eq!(first, second);
        assert_eq!(list_accounts(&connection).unwrap().len(), 1);

        let tokens = account_tokens(&connection, &first).unwrap();
        assert_eq!(tokens.access_token, "access-2");
        // 旧 refresh_token 应保留。
        assert_eq!(tokens.refresh_token.as_deref(), Some("refresh-xyz"));
    }

    #[test]
    fn update_access_token_keeps_refresh() {
        let mut connection = memory_db();
        let id = upsert_account(&mut connection, "google", "me@example.com", &token_set()).unwrap();
        update_access_token(&connection, &id, "fresh-access", "2026-08-15T11:00:00Z").unwrap();
        let tokens = account_tokens(&connection, &id).unwrap();
        assert_eq!(tokens.access_token, "fresh-access");
        assert_eq!(tokens.refresh_token.as_deref(), Some("refresh-xyz"));
        assert_eq!(tokens.expires_at.as_deref(), Some("2026-08-15T11:00:00Z"));
    }

    #[test]
    fn list_accounts_excludes_token_material() {
        let mut connection = memory_db();
        upsert_account(&mut connection, "microsoft", "a@b.com", &token_set()).unwrap();
        let accounts = list_accounts(&connection).unwrap();
        assert_eq!(accounts.len(), 1);
        assert_eq!(accounts[0].provider, "microsoft");
        assert_eq!(accounts[0].account_label, "a@b.com");
    }

    #[test]
    fn delete_account_removes_it() {
        let mut connection = memory_db();
        let id = upsert_account(&mut connection, "google", "me@example.com", &token_set()).unwrap();
        delete_account(&mut connection, &id).unwrap();
        assert!(list_accounts(&connection).unwrap().is_empty());
        let err = delete_account(&mut connection, &id).unwrap_err();
        assert_eq!(err.field.as_deref(), Some("accountId"));
    }
}
