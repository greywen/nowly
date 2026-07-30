use crate::db::AppDb;
use crate::error::CommandError;
use crate::models::{Task, TaskDraft};
use chrono::NaiveDate;
use rusqlite::{Connection, Row};
use tauri::State;

const QUADRANTS: &[&str] = &[
    "important_urgent",
    "important_not_urgent",
    "not_important_urgent",
    "not_important_not_urgent",
];

fn read_task(row: &Row<'_>) -> rusqlite::Result<Task> {
    Ok(Task {
        id: row.get(0)?,
        title: row.get(1)?,
        quadrant: row.get(2)?,
        due_at: row.get(3)?,
        priority: row.get(4)?,
        completed: row.get::<_, i64>(5)? == 1,
        linked_event_id: row.get(6)?,
        note: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

pub fn validate_and_normalize(mut draft: TaskDraft) -> Result<TaskDraft, CommandError> {
    draft.title = draft.title.trim().to_owned();
    if draft.title.is_empty() {
        return Err(CommandError::validation("title", "请输入任务标题。"));
    }
    if !QUADRANTS.contains(&draft.quadrant.as_str()) {
        return Err(CommandError::validation("quadrant", "请选择有效象限。"));
    }
    if let Some(due_at) = draft.due_at.as_deref() {
        if NaiveDate::parse_from_str(due_at, "%Y-%m-%d").is_err() {
            return Err(CommandError::validation("dueAt", "截止日期格式无效。"));
        }
    }
    if !(1..=3).contains(&draft.priority) {
        return Err(CommandError::validation("priority", "请选择有效优先级。"));
    }
    Ok(draft)
}

pub fn list(connection: &Connection) -> Result<Vec<Task>, CommandError> {
    let mut statement = connection
        .prepare(
            "SELECT id,title,quadrant,due_at,priority,completed,linked_event_id,note,created_at,updated_at
             FROM tasks
             ORDER BY completed ASC,due_at IS NULL ASC,due_at ASC,priority ASC,created_at ASC,id ASC",
        )
        .map_err(CommandError::database)?;
    let rows = statement
        .query_map([], read_task)
        .map_err(CommandError::database)?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(CommandError::database)
}

#[tauri::command]
pub fn list_tasks(db: State<'_, AppDb>) -> Result<Vec<Task>, CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    list(&connection)
}

#[cfg(test)]
mod tests {
    use super::{list, validate_and_normalize};
    use crate::db::migrate;
    use crate::models::TaskDraft;
    use rusqlite::Connection;

    fn database() -> Connection {
        let mut connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        migrate(&mut connection).unwrap();
        connection
    }

    fn draft() -> TaskDraft {
        TaskDraft {
            title: "  发布 Nowly  ".into(),
            quadrant: "important_urgent".into(),
            due_at: Some("2026-07-23".into()),
            priority: 1,
            completed: false,
            linked_event_id: None,
            note: " 保留备注空白 ".into(),
        }
    }

    #[test]
    fn validation_trims_title_and_rejects_invalid_fields() {
        let valid = validate_and_normalize(draft()).unwrap();
        assert_eq!(valid.title, "发布 Nowly");
        assert_eq!(valid.note, " 保留备注空白 ");

        for (invalid, field) in [
            (TaskDraft { title: "  ".into(), ..draft() }, "title"),
            (TaskDraft { quadrant: "later".into(), ..draft() }, "quadrant"),
            (TaskDraft { due_at: Some("2026-02-30".into()), ..draft() }, "dueAt"),
            (TaskDraft { due_at: Some("2026-07-23T09:00".into()), ..draft() }, "dueAt"),
            (TaskDraft { priority: 0, ..draft() }, "priority"),
            (TaskDraft { priority: 4, ..draft() }, "priority"),
        ] {
            assert_eq!(validate_and_normalize(invalid).unwrap_err().field.as_deref(), Some(field));
        }
        assert!(validate_and_normalize(TaskDraft { due_at: None, ..draft() }).is_ok());
    }

    #[test]
    fn list_orders_completion_due_date_priority_creation_and_id() {
        let connection = database();
        for (id, due, priority, completed, created) in [
            ("no-due", None, 1, 0, "2026-07-20T00:00:00Z"),
            ("done", Some("2026-07-01"), 1, 1, "2026-07-20T00:00:00Z"),
            ("low", Some("2026-07-23"), 3, 0, "2026-07-20T00:00:00Z"),
            ("newer", Some("2026-07-23"), 1, 0, "2026-07-21T00:00:00Z"),
            ("older-b", Some("2026-07-23"), 1, 0, "2026-07-20T00:00:00Z"),
            ("older-a", Some("2026-07-23"), 1, 0, "2026-07-20T00:00:00Z"),
            ("earliest", Some("2026-07-01"), 2, 0, "2026-07-20T00:00:00Z"),
        ] {
            connection.execute(
                "INSERT INTO tasks(id,title,quadrant,due_at,priority,completed,note,created_at,updated_at)
                 VALUES (?1,?1,'important_urgent',?2,?3,?4,'',?5,?5)",
                rusqlite::params![id, due, priority, completed, created],
            ).unwrap();
        }
        let ids: Vec<String> = list(&connection).unwrap().into_iter().map(|task| task.id).collect();
        assert_eq!(ids, vec!["earliest", "older-a", "older-b", "newer", "low", "no-due", "done"]);
    }

    #[test]
    fn fresh_database_returns_no_tasks() {
        assert!(list(&database()).unwrap().is_empty());
    }
}
