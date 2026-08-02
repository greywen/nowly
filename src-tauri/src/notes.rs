use crate::db::AppDb;
use crate::error::CommandError;
use crate::models::{Note, NoteDraft};
use chrono::{SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension, Row, TransactionBehavior};
use tauri::State;
use uuid::Uuid;

const COLORS: &[&str] = &["yellow", "blue", "green", "purple"];

fn read_note(row: &Row<'_>) -> rusqlite::Result<Note> {
    Ok(Note {
        id: row.get(0)?, title: row.get(1)?, content: row.get(2)?, color: row.get(3)?,
        pinned: row.get::<_, i64>(4)? == 1, created_at: row.get(5)?, updated_at: row.get(6)?,
    })
}

pub fn validate_and_normalize(mut draft: NoteDraft) -> Result<NoteDraft, CommandError> {
    draft.title = draft.title.trim().to_owned();
    if draft.title.is_empty() {
        return Err(CommandError::validation("title", "请输入便签标题。"));
    }
    if !COLORS.contains(&draft.color.as_str()) {
        return Err(CommandError::validation("color", "请选择有效颜色。"));
    }
    Ok(draft)
}

pub fn list(connection: &Connection) -> Result<Vec<Note>, CommandError> {
    let mut statement = connection.prepare(
        "SELECT id,title,content,color,pinned,created_at,updated_at FROM notes ORDER BY pinned DESC,updated_at DESC,id ASC"
    ).map_err(CommandError::database)?;
    let rows = statement.query_map([], read_note).map_err(CommandError::database)?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(CommandError::database)
}

fn timestamp() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn by_id(connection: &Connection, id: &str) -> Result<Option<Note>, CommandError> {
    connection.query_row(
        "SELECT id,title,content,color,pinned,created_at,updated_at FROM notes WHERE id=?1",
        [id], read_note,
    ).optional().map_err(CommandError::database)
}

pub fn create(connection: &mut Connection, draft: NoteDraft) -> Result<Note, CommandError> {
    let draft = validate_and_normalize(draft)?;
    let id = Uuid::new_v4().hyphenated().to_string();
    let now = timestamp();
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate).map_err(CommandError::database)?;
    transaction.execute(
        "INSERT INTO notes(id,title,content,color,pinned,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?6)",
        params![id, draft.title, draft.content, draft.color, i64::from(draft.pinned), now],
    ).map_err(CommandError::database)?;
    let note = by_id(&transaction, &id)?.ok_or_else(|| CommandError::conflict("便签保存状态已变化，请重试。"))?;
    transaction.commit().map_err(CommandError::database)?;
    Ok(note)
}

pub fn update(connection: &mut Connection, id: &str, draft: NoteDraft) -> Result<Note, CommandError> {
    let draft = validate_and_normalize(draft)?;
    let now = timestamp();
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate).map_err(CommandError::database)?;
    let affected = transaction.execute(
        "UPDATE notes SET title=?2,content=?3,color=?4,pinned=?5,updated_at=?6 WHERE id=?1",
        params![id, draft.title, draft.content, draft.color, i64::from(draft.pinned), now],
    ).map_err(CommandError::database)?;
    if affected != 1 { return Err(CommandError::not_found("未找到该便签。")); }
    let note = by_id(&transaction, id)?.ok_or_else(|| CommandError::not_found("未找到该便签。"))?;
    transaction.commit().map_err(CommandError::database)?;
    Ok(note)
}

pub fn delete(connection: &mut Connection, id: &str) -> Result<(), CommandError> {
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate).map_err(CommandError::database)?;
    let affected = transaction.execute("DELETE FROM notes WHERE id=?1", [id]).map_err(CommandError::database)?;
    if affected != 1 { return Err(CommandError::not_found("未找到该便签。")); }
    transaction.commit().map_err(CommandError::database)
}

#[tauri::command]
pub fn list_notes(db: State<'_, AppDb>) -> Result<Vec<Note>, CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    list(&connection)
}

#[tauri::command]
pub fn create_note(db: State<'_, AppDb>, draft: NoteDraft) -> Result<Note, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    create(&mut connection, draft)
}

#[tauri::command]
pub fn update_note(db: State<'_, AppDb>, id: String, draft: NoteDraft) -> Result<Note, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    update(&mut connection, &id, draft)
}

#[tauri::command]
pub fn delete_note(db: State<'_, AppDb>, id: String) -> Result<(), CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    delete(&mut connection, &id)
}

#[cfg(test)]
mod tests {
    use super::{create, delete, list, update, validate_and_normalize};
    use crate::db::migrate;
    use crate::models::NoteDraft;
    use rusqlite::Connection;

    fn database() -> Connection {
        let mut connection = Connection::open_in_memory().unwrap();
        migrate(&mut connection).unwrap();
        connection
    }

    fn draft() -> NoteDraft {
        NoteDraft {
            title: "  产品原则  ".into(),
            content: " 保持简单 ".into(),
            color: "purple".into(),
            pinned: true,
        }
    }

    #[test]
    fn validation_trims_title_preserves_content_and_checks_colors() {
        let valid = validate_and_normalize(draft()).unwrap();
        assert_eq!(valid.title, "产品原则");
        assert_eq!(valid.content, " 保持简单 ");
        assert_eq!(validate_and_normalize(NoteDraft { title: "  ".into(), ..draft() }).unwrap_err().field.as_deref(), Some("title"));
        assert_eq!(validate_and_normalize(NoteDraft { color: "red".into(), ..draft() }).unwrap_err().field.as_deref(), Some("color"));
    }

    #[test]
    fn create_update_and_delete_persist_notes() {
        let mut connection = database();
        let created = create(&mut connection, draft()).unwrap();
        assert_eq!(created.title, "产品原则");
        assert!(uuid::Uuid::parse_str(&created.id).is_ok());
        let updated = update(&mut connection, &created.id, NoteDraft {
            title: "新原则".into(), pinned: false, ..draft()
        }).unwrap();
        assert_eq!(updated.title, "新原则");
        assert_eq!(updated.created_at, created.created_at);
        assert!(!updated.pinned);
        delete(&mut connection, &created.id).unwrap();
        assert!(list(&connection).unwrap().is_empty());
        assert_eq!(update(&mut connection, "missing", draft()).unwrap_err().code, "not_found");
        assert_eq!(delete(&mut connection, "missing").unwrap_err().code, "not_found");
    }

    #[test]
    fn list_orders_pinned_then_updated_descending_and_id() {
        let connection = database();
        for (id, pinned, updated) in [("old", 0, "2026-07-20T00:00:00Z"), ("b", 1, "2026-07-21T00:00:00Z"), ("a", 1, "2026-07-21T00:00:00Z"), ("new", 0, "2026-07-22T00:00:00Z")] {
            connection.execute(
                "INSERT INTO notes(id,title,content,color,pinned,created_at,updated_at) VALUES (?1,?1,'','yellow',?2,?3,?3)",
                rusqlite::params![id, pinned, updated],
            ).unwrap();
        }
        let ids: Vec<String> = list(&connection).unwrap().into_iter().map(|note| note.id).collect();
        assert_eq!(ids, vec!["a", "b", "new", "old"]);
    }
}
