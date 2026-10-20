use crate::db::AppDb;
use crate::error::CommandError;
use crate::models::{Note, NoteDraft};
use chrono::{SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension, Row, TransactionBehavior};
use tauri::State;
use uuid::Uuid;

const NOTE_STYLE_VARIANT_COUNT: u8 = 9;
const NOTE_ICONS: &[&str] = &[
    "", "smile", "grin", "love", "cool", "laugh", "spark", "star", "heart", "sad",
];

fn normalize_icon(value: &str) -> Option<String> {
    let normalized = value.trim().to_ascii_lowercase();
    if NOTE_ICONS.contains(&normalized.as_str()) {
        Some(normalized)
    } else {
        None
    }
}

fn read_note(row: &Row<'_>) -> rusqlite::Result<Note> {
    Ok(Note {
        id: row.get(0)?,
        content: row.get(1)?,
        color: row.get(2)?,
        pinned: row.get::<_, i64>(3)? == 1,
        style_variant: row.get(4)?,
        icon: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

fn content_is_empty(content: &str) -> bool {
    if content.trim().is_empty() {
        return true;
    }
    let Ok(value) = serde_json::from_str::<serde_json::Value>(content) else {
        return false;
    };
    let Some(ops) = value.get("ops").and_then(serde_json::Value::as_array) else {
        return false;
    };
    !ops.iter().any(|op| {
        if op.get("attributes").is_some_and(|attributes| !attributes.is_object()) {
            return false;
        }
        match op.get("insert") {
            Some(serde_json::Value::String(text)) => !text.trim().is_empty(),
            Some(serde_json::Value::Object(_)) => true,
            _ => false,
        }
    })
}

pub fn validate_and_normalize(mut draft: NoteDraft) -> Result<NoteDraft, CommandError> {
    draft.color = crate::color::normalize_hex(&draft.color)
        .ok_or_else(|| CommandError::validation("color", "请选择有效颜色。"))?;
    draft.icon = normalize_icon(&draft.icon)
        .ok_or_else(|| CommandError::validation("icon", "请选择有效图标。"))?;
    Ok(draft)
}

pub fn list(connection: &Connection) -> Result<Vec<Note>, CommandError> {
    let mut statement = connection.prepare(
        "SELECT id,content,color,pinned,style_variant,icon,created_at,updated_at FROM notes ORDER BY pinned DESC,updated_at DESC,id ASC"
    ).map_err(CommandError::database)?;
    let rows = statement
        .query_map([], read_note)
        .map_err(CommandError::database)?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(CommandError::database)
}

fn timestamp() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn by_id(connection: &Connection, id: &str) -> Result<Option<Note>, CommandError> {
    connection.query_row(
        "SELECT id,content,color,pinned,style_variant,icon,created_at,updated_at FROM notes WHERE id=?1",
        [id], read_note,
    ).optional().map_err(CommandError::database)
}

pub fn create(connection: &mut Connection, draft: NoteDraft) -> Result<Note, CommandError> {
    let draft = validate_and_normalize(draft)?;
    if content_is_empty(&draft.content) {
        return Err(CommandError::validation("content", "请输入便笺内容。"));
    }
    let id_seed = Uuid::new_v4();
    let id = id_seed.hyphenated().to_string();
    let style_variant = i64::from(id_seed.as_bytes()[0] % NOTE_STYLE_VARIANT_COUNT);
    let now = timestamp();
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(CommandError::database)?;
    transaction.execute(
        "INSERT INTO notes(id,content,color,pinned,style_variant,icon,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?7)",
                params![id, draft.content, draft.color, i64::from(draft.pinned), style_variant, draft.icon, now],
    ).map_err(CommandError::database)?;
    let note = by_id(&transaction, &id)?
        .ok_or_else(|| CommandError::conflict("便签保存状态已变化，请重试。"))?;
    transaction.commit().map_err(CommandError::database)?;
    Ok(note)
}

pub fn update(
    connection: &mut Connection,
    id: &str,
    draft: NoteDraft,
) -> Result<Note, CommandError> {
    let draft = validate_and_normalize(draft)?;
    let now = timestamp();
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(CommandError::database)?;
    let previous = by_id(&transaction, id)?.ok_or_else(|| CommandError::not_found("未找到该便签。"))?;
    if content_is_empty(&draft.content)
        && !(content_is_empty(&previous.content) && draft.content == previous.content)
    {
        return Err(CommandError::validation("content", "请输入便笺内容。"));
    }
    let affected = transaction.execute(
        "UPDATE notes SET content=?2,color=?3,pinned=?4,icon=?5,updated_at=?6 WHERE id=?1",
        params![id, draft.content, draft.color, i64::from(draft.pinned), draft.icon, now],
    ).map_err(CommandError::database)?;
    if affected != 1 {
        return Err(CommandError::not_found("未找到该便签。"));
    }
    let note = by_id(&transaction, id)?.ok_or_else(|| CommandError::not_found("未找到该便签。"))?;
    transaction.commit().map_err(CommandError::database)?;
    Ok(note)
}

pub fn delete(connection: &mut Connection, id: &str) -> Result<(), CommandError> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(CommandError::database)?;
    let affected = transaction
        .execute("DELETE FROM notes WHERE id=?1", [id])
        .map_err(CommandError::database)?;
    if affected != 1 {
        return Err(CommandError::not_found("未找到该便签。"));
    }
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
pub fn update_note(
    db: State<'_, AppDb>,
    id: String,
    draft: NoteDraft,
) -> Result<Note, CommandError> {
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
    use super::{create, delete, list, update, validate_and_normalize, NOTE_STYLE_VARIANT_COUNT};
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
            content: " 保持简单 ".into(),
            color: "#4F55DA".into(),
            pinned: true,
            icon: "cool".into(),
        }
    }

    #[test]
    fn validation_preserves_content_and_checks_colors() {
        let valid = validate_and_normalize(draft()).unwrap();
        assert_eq!(valid.content, " 保持简单 ");
        assert_eq!(
            validate_and_normalize(NoteDraft {
                color: "#GGGGGG".into(),
                ..draft()
            })
            .unwrap_err()
            .field
            .as_deref(),
            Some("color")
        );
        assert_eq!(
            validate_and_normalize(NoteDraft {
                icon: "???".into(),
                ..draft()
            })
            .unwrap_err()
            .field
            .as_deref(),
            Some("icon")
        );
    }

    #[test]
    fn create_rejects_empty_legacy_content() {
        let mut connection = database();
        for content in ["", " \t\r\n", "\u{00a0}\u{2003}"] {
            let error = create(&mut connection, NoteDraft {
                content: content.into(),
                ..draft()
            }).unwrap_err();
            assert_eq!(error.code, "validation_error");
            assert_eq!(error.field.as_deref(), Some("content"));
        }
        assert!(list(&connection).unwrap().is_empty());
    }

    #[test]
    fn create_rejects_empty_delta_content() {
        let mut connection = database();
        for content in [
            r#"{"v":1,"ops":[]}"#,
            r#"{"v":1,"ops":[{"insert":" \t\n"},{"insert":"\n","attributes":{"header":1}}]}"#,
            r#" { "v": 1, "ops": [{"insert":"\n","attributes":{"bold":true,"link":"attachment:a.pdf"}}] } "#,
            r#"{"v":1,"ops":["junk",null,{"retain":1},{"insert":null},{"insert":[]},{"insert":123}]}"#,
            r#"{"v":1,"ops":[{"insert":"text","attributes":null},{"insert":{"image":"a"},"attributes":[]}] }"#,
        ] {
            let error = create(&mut connection, NoteDraft {
                content: content.into(),
                ..draft()
            }).unwrap_err();
            assert_eq!(error.field.as_deref(), Some("content"), "{content}");
        }
        assert!(list(&connection).unwrap().is_empty());
    }

    #[test]
    fn create_preserves_rich_and_legacy_content_bytes() {
        let mut connection = database();
        for content in [
            "  旧的纯文本\r\n\0正文  ",
            "# 旧标题\n\n**正文**",
            "![](attachment:0123456789abcdef0123456789abcdef.png)",
            "[报告](attachment:0123456789abcdef0123456789abcdef.pdf)",
            "{not json",
            r#"{"a":1}"#,
            r#"{"ops":"not an array"}"#,
            r#" { "v": 1, "ops": [{"insert":"正文","attributes":{"bold":true}},{"insert":"\n"}] } "#,
            r#"{"v":1,"ops":[{"insert":{"image":"attachment:0123456789abcdef0123456789abcdef.png"}},{"insert":"\n"}]}"#,
            r#"{"v":1,"ops":[{"insert":"报告.pdf","attributes":{"link":"attachment:0123456789abcdef0123456789abcdef.pdf"}},{"insert":"\n"}]}"#,
            r#"{"v":1,"ops":[{"insert":{"formula":"e=mc^2"}},{"insert":"\n"}]}"#,
            r#"{"v":1,"ops":[{"insert":{"video":"https://example.com/e/1"}},{"insert":"\n"}]}"#,
            r#"{"v":1,"ops":[{"insert":{}},{"insert":"\n"}]}"#,
            r#"{"ops":[{"insert":"\n"},{"insert":{"formula":"x^2"}}]}"#,
            r#"{"v":1,"ops":[{"insert":false},{"insert":"正文"}]}"#,
        ] {
            let created = create(&mut connection, NoteDraft {
                content: content.into(),
                ..draft()
            }).unwrap();
            assert_eq!(created.content.as_bytes(), content.as_bytes());
            let stored = list(&connection).unwrap().into_iter()
                .find(|note| note.id == created.id).unwrap();
            assert_eq!(stored, created);
        }
    }

    #[test]
    fn note_serialization_has_no_independent_title() {
        let mut connection = database();
        let created = create(&mut connection, draft()).unwrap();
        let value = serde_json::to_value(created).unwrap();
        assert!(value.get("title").is_none());
        assert_eq!(value["content"], " 保持简单 ");
    }

    #[test]
    fn metadata_updates_allow_existing_empty_notes() {
        let mut connection = database();
        for content in ["", " \t\n", r#"{"v":1,"ops":[{"insert":"\n"}]}"#] {
            // Model an old note or a body emptied by attachment removal.
            let created = create(&mut connection, draft()).unwrap();
            connection.execute("UPDATE notes SET content=?2 WHERE id=?1",
                rusqlite::params![created.id, content]).unwrap();
            let updated = update(&mut connection, &created.id, NoteDraft {
                content: content.into(),
                pinned: false,
                color: "#E8C444".into(),
                icon: "heart".into(),
                ..draft()
            }).unwrap();
            assert_eq!(updated.content.as_bytes(), content.as_bytes());
            assert_eq!(updated.color, "#E8C444");
            assert_eq!(updated.icon, "heart");
            assert!(!updated.pinned);
            assert_eq!(updated.created_at, created.created_at);
            assert_eq!(updated.style_variant, created.style_variant);
        }
    }

    #[test]
    fn updating_a_nonempty_note_cannot_erase_its_content() {
        let mut connection = database();
        let created = create(&mut connection, draft()).unwrap();
        let error = update(&mut connection, &created.id, NoteDraft {
            content: String::new(),
            ..draft()
        }).unwrap_err();
        assert_eq!(error.field.as_deref(), Some("content"));
        assert_eq!(list(&connection).unwrap()[0], created);
    }

    #[test]
    fn create_update_and_delete_persist_notes() {
        let mut connection = database();
        let created = create(&mut connection, draft()).unwrap();
        assert_eq!(created.content, " 保持简单 ");
        assert!((0..i64::from(NOTE_STYLE_VARIANT_COUNT)).contains(&created.style_variant));
        assert_eq!(created.icon, "cool");
        assert!(uuid::Uuid::parse_str(&created.id).is_ok());
        let updated = update(
            &mut connection,
            &created.id,
            NoteDraft {
                content: "新原则\n正文".into(),
                pinned: false,
                icon: "heart".into(),
                ..draft()
            },
        )
        .unwrap();
        assert_eq!(updated.content, "新原则\n正文");
        assert_eq!(updated.created_at, created.created_at);
        assert_eq!(updated.style_variant, created.style_variant);
        assert_eq!(updated.icon, "heart");
        assert!(!updated.pinned);
        delete(&mut connection, &created.id).unwrap();
        assert!(list(&connection).unwrap().is_empty());
        assert_eq!(
            update(&mut connection, "missing", draft())
                .unwrap_err()
                .code,
            "not_found"
        );
        assert_eq!(
            delete(&mut connection, "missing").unwrap_err().code,
            "not_found"
        );
    }

    #[test]
    fn list_orders_pinned_then_updated_descending_and_id() {
        let connection = database();
        for (id, pinned, updated) in [
            ("old", 0, "2026-07-20T00:00:00Z"),
            ("b", 1, "2026-07-21T00:00:00Z"),
            ("a", 1, "2026-07-21T00:00:00Z"),
            ("new", 0, "2026-07-22T00:00:00Z"),
        ] {
            connection.execute(
                "INSERT INTO notes(id,content,color,pinned,style_variant,icon,created_at,updated_at) VALUES (?1,'','#E8C444',?2,0,'',?3,?3)",
                rusqlite::params![id, pinned, updated],
            ).unwrap();
        }
        let ids: Vec<String> = list(&connection)
            .unwrap()
            .into_iter()
            .map(|note| note.id)
            .collect();
        assert_eq!(ids, vec!["a", "b", "new", "old"]);
    }
}
