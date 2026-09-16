//! 日历分类存储层：分类 CRUD + 引用级联维护。
//!
//! 分类是用户自定义记录，拥有名称与颜色。选择分类即为事件/订阅上色，
//! 「分类」与「颜色」是同一个概念。无默认分类，表初始为空。
//!
//! 事件把所选分类 id 存在 `events.category`，并把分类颜色快照到 `events.color`；
//! 订阅把分类 id 存在 `calendar_subscriptions.category_id`，颜色同样快照到 `color`。
//! - 编辑分类颜色时，同步刷新所有引用该分类的事件/例外/订阅的颜色快照。
//! - 删除分类时，把引用它的事件/例外/订阅的分类清空、颜色回退为空（即“无分类=无颜色”）。

use crate::db::AppDb;
use crate::error::CommandError;
use crate::models::{Category, CategoryDraft};
use rusqlite::{params, Connection, Row};
use tauri::State;
use uuid::Uuid;

/// 分类数量上限，避免下拉失控。
pub const MAX_CATEGORIES: i64 = 100;

const CATEGORY_COLUMNS: &str = "id,name,color,position,created_at,updated_at";

fn read_category(row: &Row<'_>) -> rusqlite::Result<Category> {
    Ok(Category {
        id: row.get(0)?,
        name: row.get(1)?,
        color: row.get(2)?,
        position: row.get(3)?,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
    })
}

fn now_utc() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

/// 校验并规范化分类草稿，返回 (name, color)。
fn validate_draft(draft: &CategoryDraft) -> Result<(String, String), CommandError> {
    let name = draft.name.trim();
    if name.is_empty() {
        return Err(CommandError::validation("name", "分类名称不能为空。"));
    }
    if name.chars().count() > 40 {
        return Err(CommandError::validation("name", "分类名称过长。"));
    }
    let color = crate::color::normalize_hex(&draft.color)
        .ok_or_else(|| CommandError::validation("color", "请选择有效颜色。"))?;
    Ok((name.to_owned(), color))
}

/// 列出全部分类，按 position 升序（创建时间兜底）。
pub fn list(connection: &Connection) -> Result<Vec<Category>, CommandError> {
    let sql = format!(
        "SELECT {CATEGORY_COLUMNS} FROM categories ORDER BY position ASC, created_at ASC"
    );
    let mut statement = connection.prepare(&sql).map_err(CommandError::database)?;
    let rows = statement
        .query_map([], read_category)
        .map_err(CommandError::database)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(CommandError::database)?);
    }
    Ok(out)
}

fn fetch_one(connection: &Connection, id: &str) -> Result<Category, CommandError> {
    let sql = format!("SELECT {CATEGORY_COLUMNS} FROM categories WHERE id = ?1");
    connection
        .query_row(&sql, params![id], read_category)
        .map_err(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => CommandError::validation("id", "分类不存在。"),
            other => CommandError::database(other),
        })
}

/// 新建分类，追加到列表末尾。超过 `MAX_CATEGORIES` 拒绝。
pub fn create(
    connection: &mut Connection,
    draft: CategoryDraft,
) -> Result<Category, CommandError> {
    let (name, color) = validate_draft(&draft)?;
    let count: i64 = connection
        .query_row("SELECT COUNT(*) FROM categories", [], |row| row.get(0))
        .map_err(CommandError::database)?;
    if count >= MAX_CATEGORIES {
        return Err(CommandError::validation("name", "分类数量已达上限。"));
    }
    let next_position: i64 = connection
        .query_row(
            "SELECT COALESCE(MAX(position), -1) + 1 FROM categories",
            [],
            |row| row.get(0),
        )
        .map_err(CommandError::database)?;
    let id = Uuid::new_v4().to_string();
    let now = now_utc();
    connection
        .execute(
            "INSERT INTO categories(id,name,color,position,created_at,updated_at)
             VALUES (?1,?2,?3,?4,?5,?5)",
            params![id, name, color, next_position, now],
        )
        .map_err(CommandError::database)?;
    fetch_one(connection, &id)
}

/// 编辑分类（名称/颜色）。颜色变化时同步刷新所有引用该分类的颜色快照，
/// 因为「分类」与「颜色」是同一概念，事件/订阅上的颜色必须跟随分类。
pub fn update(
    connection: &mut Connection,
    id: &str,
    draft: CategoryDraft,
) -> Result<Category, CommandError> {
    let (name, color) = validate_draft(&draft)?;
    let now = now_utc();
    let transaction = connection.transaction().map_err(CommandError::database)?;
    let affected = transaction
        .execute(
            "UPDATE categories SET name=?2,color=?3,updated_at=?4 WHERE id=?1",
            params![id, name, color, now],
        )
        .map_err(CommandError::database)?;
    if affected == 0 {
        return Err(CommandError::validation("id", "分类不存在。"));
    }
    // 刷新颜色快照到所有引用该分类的记录。
    transaction
        .execute(
            "UPDATE events SET color=?2 WHERE category=?1",
            params![id, color],
        )
        .map_err(CommandError::database)?;
    transaction
        .execute(
            "UPDATE event_exceptions SET color=?2 WHERE category=?1",
            params![id, color],
        )
        .map_err(CommandError::database)?;
    transaction
        .execute(
            "UPDATE calendar_subscriptions SET color=?2 WHERE category_id=?1",
            params![id, color],
        )
        .map_err(CommandError::database)?;
    transaction.commit().map_err(CommandError::database)?;
    fetch_one(connection, id)
}

/// 删除分类。引用它的事件/例外/订阅回退为「无分类、无颜色」。
pub fn delete(connection: &mut Connection, id: &str) -> Result<(), CommandError> {
    let transaction = connection.transaction().map_err(CommandError::database)?;
    let affected = transaction
        .execute("DELETE FROM categories WHERE id=?1", params![id])
        .map_err(CommandError::database)?;
    if affected == 0 {
        return Err(CommandError::validation("id", "分类不存在。"));
    }
    // 事件：清空分类与颜色快照 → 渲染为无色基础态。
    transaction
        .execute(
            "UPDATE events SET category='', color='' WHERE category=?1",
            params![id],
        )
        .map_err(CommandError::database)?;
    transaction
        .execute(
            "UPDATE event_exceptions SET category=NULL, color=NULL WHERE category=?1",
            params![id],
        )
        .map_err(CommandError::database)?;
    // 订阅：解除分类引用并清空颜色快照。
    transaction
        .execute(
            "UPDATE calendar_subscriptions SET category_id=NULL, color='' WHERE category_id=?1",
            params![id],
        )
        .map_err(CommandError::database)?;
    transaction.commit().map_err(CommandError::database)?;
    Ok(())
}

#[tauri::command]
pub fn list_categories(db: State<'_, AppDb>) -> Result<Vec<Category>, CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    list(&connection)
}

#[tauri::command]
pub fn create_category(
    db: State<'_, AppDb>,
    draft: CategoryDraft,
) -> Result<Category, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    create(&mut connection, draft)
}

#[tauri::command]
pub fn update_category(
    db: State<'_, AppDb>,
    id: String,
    draft: CategoryDraft,
) -> Result<Category, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    update(&mut connection, &id, draft)
}

#[tauri::command]
pub fn delete_category(db: State<'_, AppDb>, id: String) -> Result<(), CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    delete(&mut connection, &id)
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

    fn draft(name: &str, color: &str) -> CategoryDraft {
        CategoryDraft {
            name: name.into(),
            color: color.into(),
        }
    }

    #[test]
    fn create_list_update_delete_roundtrip() {
        let mut connection = memory_db();
        let work = create(&mut connection, draft("工作", "#4FC9DA")).unwrap();
        assert_eq!(work.name, "工作");
        assert_eq!(work.color, "#4FC9DA");
        assert_eq!(work.position, 0);

        let life = create(&mut connection, draft("生活", "#F06445")).unwrap();
        assert_eq!(life.position, 1);

        let listed = list(&connection).unwrap();
        assert_eq!(listed.len(), 2);
        assert_eq!(listed[0].id, work.id);

        let updated = update(&mut connection, &work.id, draft("上班", "#4F55DA")).unwrap();
        assert_eq!(updated.name, "上班");
        assert_eq!(updated.color, "#4F55DA");

        delete(&mut connection, &work.id).unwrap();
        assert_eq!(list(&connection).unwrap().len(), 1);
    }

    #[test]
    fn create_rejects_blank_name_and_bad_color() {
        let mut connection = memory_db();
        assert_eq!(
            create(&mut connection, draft("  ", "#4FC9DA"))
                .unwrap_err()
                .field
                .as_deref(),
            Some("name")
        );
        assert_eq!(
            create(&mut connection, draft("工作", "not-a-color"))
                .unwrap_err()
                .field
                .as_deref(),
            Some("color")
        );
    }

    #[test]
    fn updating_color_refreshes_event_snapshot() {
        let mut connection = memory_db();
        let cat = create(&mut connection, draft("工作", "#4FC9DA")).unwrap();
        connection
            .execute(
                "INSERT INTO events(id,title,start_at,end_at,all_day,category,color,note,reminders,created_at,updated_at)
                 VALUES ('e1','会议','2026-01-01T10:00','2026-01-01T11:00',0,?1,'#4FC9DA','','[]','t','t')",
                params![cat.id],
            )
            .unwrap();
        update(&mut connection, &cat.id, draft("工作", "#F06445")).unwrap();
        let color: String = connection
            .query_row("SELECT color FROM events WHERE id='e1'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(color, "#F06445");
    }

    #[test]
    fn deleting_clears_event_and_subscription_references() {
        let mut connection = memory_db();
        let cat = create(&mut connection, draft("工作", "#4FC9DA")).unwrap();
        connection
            .execute(
                "INSERT INTO events(id,title,start_at,end_at,all_day,category,color,note,reminders,created_at,updated_at)
                 VALUES ('e1','会议','2026-01-01T10:00','2026-01-01T11:00',0,?1,'#4FC9DA','','[]','t','t')",
                params![cat.id],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO calendar_subscriptions(id,name,url,color,category_id,refresh_interval_minutes,created_at,updated_at)
                 VALUES ('s1','家庭','https://x/a.ics','#4FC9DA',?1,15,'t','t')",
                params![cat.id],
            )
            .unwrap();
        delete(&mut connection, &cat.id).unwrap();

        let (category, color): (String, String) = connection
            .query_row("SELECT category,color FROM events WHERE id='e1'", [], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .unwrap();
        assert_eq!(category, "");
        assert_eq!(color, "");

        let (sub_category, sub_color): (Option<String>, String) = connection
            .query_row(
                "SELECT category_id,color FROM calendar_subscriptions WHERE id='s1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(sub_category, None);
        assert_eq!(sub_color, "");
    }
}
