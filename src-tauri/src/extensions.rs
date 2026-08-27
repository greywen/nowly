use crate::db::AppDb;
use crate::error::CommandError;
use crate::models::{SandboxExtension, SandboxExtensionDraft};
use chrono::{SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension, Row, TransactionBehavior};
use tauri::State;
use uuid::Uuid;

// The permissions an extension may declare. Anything outside this set is
// rejected at install time, so the host never has to reason about unknown
// capabilities at runtime.
const PERMISSIONS: &[&str] = &["state", "today", "network"];

// A conservative hostname check: non-empty, no scheme, no path, no port, no
// wildcard. The proxy layer (net.rs) is the real trust boundary, but rejecting
// malformed hosts at install time keeps the stored allow-list clean.
fn is_valid_host(host: &str) -> bool {
    if host.is_empty() || host.len() > 253 {
        return false;
    }
    if host.contains(['/', ':', ' ', '*', '?', '#', '@']) {
        return false;
    }
    host.split('.').all(|label| {
        !label.is_empty() && label.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    })
}

fn timestamp() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn clamp(value: i64, low: i64, high: i64) -> i64 {
    value.max(low).min(high)
}

fn read_extension(row: &Row<'_>) -> rusqlite::Result<SandboxExtension> {
    let permissions_json: String = row.get(4)?;
    let permissions: Vec<String> = serde_json::from_str(&permissions_json).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(4, rusqlite::types::Type::Text, Box::new(error))
    })?;
    let allowed_hosts_json: String = row.get(11)?;
    let allowed_hosts: Vec<String> =
        serde_json::from_str(&allowed_hosts_json).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                11,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })?;
    Ok(SandboxExtension {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        source: row.get(3)?,
        permissions,
        allowed_hosts,
        min_w: row.get(5)?,
        min_h: row.get(6)?,
        default_w: row.get(7)?,
        default_h: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

pub fn validate_and_normalize(
    mut draft: SandboxExtensionDraft,
) -> Result<SandboxExtensionDraft, CommandError> {
    draft.name = draft.name.trim().to_owned();
    if draft.name.is_empty() {
        return Err(CommandError::validation("name", "请输入扩展名称。"));
    }
    draft.description = draft.description.trim().to_owned();
    if draft.source.trim().is_empty() {
        return Err(CommandError::validation("source", "请提供扩展代码。"));
    }
    // Deduplicate and reject unknown permissions.
    let mut seen: Vec<String> = Vec::new();
    for permission in &draft.permissions {
        if !PERMISSIONS.contains(&permission.as_str()) {
            return Err(CommandError::validation("permissions", "声明了未知权限。"));
        }
        if !seen.contains(permission) {
            seen.push(permission.clone());
        }
    }
    draft.permissions = seen;
    // Network access requires a non-empty, well-formed host allow-list. Dedupe
    // and normalize to lowercase so matching in the proxy is case-insensitive.
    let mut hosts: Vec<String> = Vec::new();
    for host in &draft.allowed_hosts {
        let host = host.trim().to_ascii_lowercase();
        if host.is_empty() {
            continue;
        }
        if !is_valid_host(&host) {
            return Err(CommandError::validation(
                "allowedHosts",
                "声明了无效的联网域名。",
            ));
        }
        if !hosts.contains(&host) {
            hosts.push(host);
        }
    }
    if draft.permissions.iter().any(|p| p == "network") && hosts.is_empty() {
        return Err(CommandError::validation(
            "allowedHosts",
            "联网权限需要至少声明一个域名。",
        ));
    }
    if !draft.permissions.iter().any(|p| p == "network") {
        // Drop any stray hosts when network was not requested.
        hosts.clear();
    }
    draft.allowed_hosts = hosts;
    draft.default_w = clamp(draft.default_w, 2, 12);
    draft.default_h = clamp(draft.default_h, 2, 8);
    Ok(draft)
}

pub fn list(connection: &Connection) -> Result<Vec<SandboxExtension>, CommandError> {
    let mut statement = connection
        .prepare(
            "SELECT id,name,description,source,permissions,min_w,min_h,default_w,default_h,created_at,updated_at,allowed_hosts
             FROM extensions ORDER BY created_at ASC, id ASC",
        )
        .map_err(CommandError::database)?;
    let rows = statement
        .query_map([], read_extension)
        .map_err(CommandError::database)?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(CommandError::database)
}

fn by_id(connection: &Connection, id: &str) -> Result<Option<SandboxExtension>, CommandError> {
    connection
        .query_row(
            "SELECT id,name,description,source,permissions,min_w,min_h,default_w,default_h,created_at,updated_at,allowed_hosts
             FROM extensions WHERE id=?1",
            [id],
            read_extension,
        )
        .optional()
        .map_err(CommandError::database)
}

pub fn install(
    connection: &mut Connection,
    draft: SandboxExtensionDraft,
) -> Result<SandboxExtension, CommandError> {
    let draft = validate_and_normalize(draft)?;
    let id = Uuid::new_v4().hyphenated().to_string();
    let now = timestamp();
    let permissions = serde_json::to_string(&draft.permissions).map_err(|error| {
        CommandError::database(rusqlite::Error::ToSqlConversionFailure(Box::new(error)))
    })?;
    let allowed_hosts = serde_json::to_string(&draft.allowed_hosts).map_err(|error| {
        CommandError::database(rusqlite::Error::ToSqlConversionFailure(Box::new(error)))
    })?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(CommandError::database)?;
    transaction
        .execute(
            "INSERT INTO extensions(id,name,description,source,permissions,min_w,min_h,default_w,default_h,created_at,updated_at,allowed_hosts)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?10,?11)",
            params![id, draft.name, draft.description, draft.source, permissions, 3i64, 3i64, draft.default_w, draft.default_h, now, allowed_hosts],
        )
        .map_err(CommandError::database)?;
    let extension = by_id(&transaction, &id)?
        .ok_or_else(|| CommandError::conflict("扩展安装状态已变化，请重试。"))?;
    transaction.commit().map_err(CommandError::database)?;
    Ok(extension)
}

pub fn uninstall(connection: &mut Connection, id: &str) -> Result<(), CommandError> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(CommandError::database)?;
    let affected = transaction
        .execute("DELETE FROM extensions WHERE id=?1", [id])
        .map_err(CommandError::database)?;
    // Drop any layout entry and persisted state that referenced this extension
    // so the grid and storage stay consistent.
    transaction
        .execute(
            "DELETE FROM module_layout WHERE id=?1",
            [format!("sandbox:{id}")],
        )
        .map_err(CommandError::database)?;
    transaction
        .execute(
            "DELETE FROM module_state WHERE module_id=?1",
            [format!("sandbox:{id}")],
        )
        .map_err(CommandError::database)?;
    if affected != 1 {
        return Err(CommandError::not_found("未找到该扩展。"));
    }
    transaction.commit().map_err(CommandError::database)
}

#[tauri::command]
pub fn list_extensions(db: State<'_, AppDb>) -> Result<Vec<SandboxExtension>, CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    list(&connection)
}

#[tauri::command]
pub fn install_extension(
    db: State<'_, AppDb>,
    draft: SandboxExtensionDraft,
) -> Result<SandboxExtension, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    install(&mut connection, draft)
}

#[tauri::command]
pub fn uninstall_extension(db: State<'_, AppDb>, id: String) -> Result<(), CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    uninstall(&mut connection, &id)
}

#[cfg(test)]
mod tests {
    use super::{install, list, uninstall, validate_and_normalize};
    use crate::db::migrate;
    use crate::models::SandboxExtensionDraft;
    use rusqlite::Connection;

    fn database() -> Connection {
        let mut connection = Connection::open_in_memory().unwrap();
        migrate(&mut connection).unwrap();
        connection
    }

    fn draft() -> SandboxExtensionDraft {
        SandboxExtensionDraft {
            name: "  计数器  ".into(),
            description: "  说明  ".into(),
            source: "Nowly.defineModule(function () {});".into(),
            permissions: vec!["state".into(), "state".into(), "today".into()],
            allowed_hosts: vec![],
            default_w: 4,
            default_h: 3,
        }
    }

    #[test]
    fn migration_seeds_the_counter_demo() {
        let connection = database();
        let ids: Vec<String> = list(&connection)
            .unwrap()
            .into_iter()
            .map(|e| e.id)
            .collect();
        assert_eq!(ids, vec!["counter-demo"]);
    }

    #[test]
    fn validation_trims_dedupes_and_clamps() {
        let valid = validate_and_normalize(draft()).unwrap();
        assert_eq!(valid.name, "计数器");
        assert_eq!(valid.description, "说明");
        assert_eq!(valid.permissions, vec!["state", "today"]);
    }

    #[test]
    fn validation_rejects_empty_name_source_and_unknown_permissions() {
        assert_eq!(
            validate_and_normalize(SandboxExtensionDraft {
                name: "  ".into(),
                ..draft()
            })
            .unwrap_err()
            .field
            .as_deref(),
            Some("name")
        );
        assert_eq!(
            validate_and_normalize(SandboxExtensionDraft {
                source: "  ".into(),
                ..draft()
            })
            .unwrap_err()
            .field
            .as_deref(),
            Some("source")
        );
        assert_eq!(
            validate_and_normalize(SandboxExtensionDraft {
                permissions: vec!["bogus".into()],
                ..draft()
            })
            .unwrap_err()
            .field
            .as_deref(),
            Some("permissions")
        );
    }

    #[test]
    fn network_permission_requires_allowed_hosts() {
        // Declaring network without any host is rejected.
        assert_eq!(
            validate_and_normalize(SandboxExtensionDraft {
                permissions: vec!["network".into()],
                allowed_hosts: vec![],
                ..draft()
            })
            .unwrap_err()
            .field
            .as_deref(),
            Some("allowedHosts")
        );
        // Malformed host is rejected.
        assert_eq!(
            validate_and_normalize(SandboxExtensionDraft {
                permissions: vec!["network".into()],
                allowed_hosts: vec!["http://evil.com/path".into()],
                ..draft()
            })
            .unwrap_err()
            .field
            .as_deref(),
            Some("allowedHosts")
        );
        // Valid network module normalizes hosts to lowercase and dedupes.
        let valid = validate_and_normalize(SandboxExtensionDraft {
            permissions: vec!["network".into()],
            allowed_hosts: vec!["API.Example.com".into(), "api.example.com".into()],
            ..draft()
        })
        .unwrap();
        assert_eq!(valid.allowed_hosts, vec!["api.example.com"]);
    }

    #[test]
    fn hosts_are_dropped_without_network_permission() {
        let valid = validate_and_normalize(SandboxExtensionDraft {
            permissions: vec!["state".into()],
            allowed_hosts: vec!["api.example.com".into()],
            ..draft()
        })
        .unwrap();
        assert!(valid.allowed_hosts.is_empty());
    }

    #[test]
    fn install_and_uninstall_persist_extensions() {
        let mut connection = database();
        let installed = install(&mut connection, draft()).unwrap();
        assert_eq!(installed.name, "计数器");
        assert_eq!(installed.min_w, 3);
        assert!(uuid::Uuid::parse_str(&installed.id).is_ok());
        assert_eq!(list(&connection).unwrap().len(), 2); // seed + installed

        uninstall(&mut connection, &installed.id).unwrap();
        assert_eq!(list(&connection).unwrap().len(), 1);
        assert_eq!(
            uninstall(&mut connection, "missing").unwrap_err().code,
            "not_found"
        );
    }

    #[test]
    fn uninstalling_removes_layout_and_state() {
        let mut connection = database();
        let installed = install(&mut connection, draft()).unwrap();
        connection
            .execute(
                "INSERT INTO module_layout(id,x,y,w,h,position) VALUES (?1,0,0,4,3,9)",
                [format!("sandbox:{}", installed.id)],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO module_state(module_id,state,updated_at) VALUES (?1,'{}','2026-01-01T00:00:00Z')",
                [format!("sandbox:{}", installed.id)],
            )
            .unwrap();
        uninstall(&mut connection, &installed.id).unwrap();
        let layout_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM module_layout WHERE id LIKE 'sandbox:%'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let state_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM module_state WHERE module_id LIKE 'sandbox:%'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(layout_count, 0);
        assert_eq!(state_count, 0);
    }
}
