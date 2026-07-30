use crate::db::AppDb;
use crate::error::CommandError;
use crate::models::{Task, TaskDraft};
use chrono::{NaiveDate, SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension, Row, Transaction, TransactionBehavior};
use tauri::State;
use uuid::Uuid;

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

fn timestamp() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn task_by_id(connection: &Connection, id: &str) -> Result<Option<Task>, CommandError> {
    connection
        .query_row(
            "SELECT id,title,quadrant,due_at,priority,completed,linked_event_id,note,created_at,updated_at FROM tasks WHERE id=?1",
            [id],
            read_task,
        )
        .optional()
        .map_err(CommandError::database)
}

fn sql_write_error(error: rusqlite::Error) -> CommandError {
    match &error {
        rusqlite::Error::SqliteFailure(details, _)
            if details.code == rusqlite::ErrorCode::ConstraintViolation => {
                eprintln!("task relation constraint failed: {error}");
                CommandError::conflict("任务关联已变化，请重试。")
            }
        _ => CommandError::database(error),
    }
}

fn require_event(transaction: &Transaction<'_>, event_id: &str) -> Result<(), CommandError> {
    let exists: bool = transaction
        .query_row("SELECT EXISTS(SELECT 1 FROM events WHERE id=?1)", [event_id], |row| row.get(0))
        .map_err(CommandError::database)?;
    if exists { Ok(()) } else { Err(CommandError::validation("linkedEventId", "未找到要关联的日程。")) }
}

fn relink(
    transaction: &Transaction<'_>, task_id: &str, old_event_id: Option<&str>,
    new_event_id: Option<&str>, updated_at: &str,
) -> Result<(), CommandError> {
    if old_event_id == new_event_id { return Ok(()); }
    if let Some(event_id) = new_event_id { require_event(transaction, event_id)?; }
    if let Some(event_id) = old_event_id {
        transaction.execute(
            "UPDATE events SET linked_task_id=NULL,updated_at=?2 WHERE id=?1 AND linked_task_id=?3",
            params![event_id, updated_at, task_id],
        ).map_err(sql_write_error)?;
    }
    if let Some(event_id) = new_event_id {
        let displaced_task: Option<String> = transaction.query_row(
            "SELECT linked_task_id FROM events WHERE id=?1", [event_id], |row| row.get(0),
        ).map_err(CommandError::database)?;
        if let Some(displaced_task) = displaced_task {
            transaction.execute(
                "UPDATE tasks SET linked_event_id=NULL,updated_at=?2 WHERE id=?1",
                params![displaced_task, updated_at],
            ).map_err(sql_write_error)?;
        }
        transaction.execute(
            "UPDATE events SET linked_task_id=NULL,updated_at=?2 WHERE linked_task_id=?1 AND id<>?3",
            params![task_id, updated_at, event_id],
        ).map_err(sql_write_error)?;
        transaction.execute(
            "UPDATE events SET linked_task_id=?2,updated_at=?3 WHERE id=?1",
            params![event_id, task_id, updated_at],
        ).map_err(sql_write_error)?;
    }
    Ok(())
}

pub fn create(connection: &mut Connection, draft: TaskDraft) -> Result<Task, CommandError> {
    let draft = validate_and_normalize(draft)?;
    let id = Uuid::new_v4().hyphenated().to_string();
    let now = timestamp();
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate).map_err(CommandError::database)?;
    if let Some(event_id) = draft.linked_event_id.as_deref() { require_event(&transaction, event_id)?; }
    transaction.execute(
        "INSERT INTO tasks(id,title,quadrant,due_at,priority,completed,linked_event_id,note,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,NULL,?7,?8,?8)",
        params![id, draft.title, draft.quadrant, draft.due_at, draft.priority, i64::from(draft.completed), draft.note, now],
    ).map_err(sql_write_error)?;
    relink(&transaction, &id, None, draft.linked_event_id.as_deref(), &now)?;
    transaction.execute("UPDATE tasks SET linked_event_id=?2 WHERE id=?1", params![id, draft.linked_event_id]).map_err(sql_write_error)?;
    let task = task_by_id(&transaction, &id)?.ok_or_else(|| CommandError::conflict("任务保存状态已变化，请重试。"))?;
    transaction.commit().map_err(sql_write_error)?;
    Ok(task)
}

pub fn update(connection: &mut Connection, id: &str, draft: TaskDraft) -> Result<Task, CommandError> {
    let draft = validate_and_normalize(draft)?;
    let now = timestamp();
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate).map_err(CommandError::database)?;
    let old_event_id: Option<Option<String>> = transaction.query_row(
        "SELECT linked_event_id FROM tasks WHERE id=?1", [id], |row| row.get(0),
    ).optional().map_err(CommandError::database)?;
    let old_event_id = old_event_id.ok_or_else(|| CommandError::not_found("未找到该任务。"))?;
    relink(&transaction, id, old_event_id.as_deref(), draft.linked_event_id.as_deref(), &now)?;
    let affected = transaction.execute(
        "UPDATE tasks SET title=?2,quadrant=?3,due_at=?4,priority=?5,completed=?6,linked_event_id=?7,note=?8,updated_at=?9 WHERE id=?1",
        params![id, draft.title, draft.quadrant, draft.due_at, draft.priority, i64::from(draft.completed), draft.linked_event_id, draft.note, now],
    ).map_err(sql_write_error)?;
    if affected != 1 { return Err(CommandError::not_found("未找到该任务。")); }
    let task = task_by_id(&transaction, id)?.ok_or_else(|| CommandError::not_found("未找到该任务。"))?;
    transaction.commit().map_err(sql_write_error)?;
    Ok(task)
}

pub fn delete(connection: &mut Connection, id: &str) -> Result<(), CommandError> {
    let now = timestamp();
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate).map_err(CommandError::database)?;
    let linked_event_id: Option<Option<String>> = transaction.query_row(
        "SELECT linked_event_id FROM tasks WHERE id=?1", [id], |row| row.get(0),
    ).optional().map_err(CommandError::database)?;
    let linked_event_id = linked_event_id.ok_or_else(|| CommandError::not_found("未找到该任务。"))?;
    if let Some(event_id) = linked_event_id {
        transaction.execute(
            "UPDATE events SET linked_task_id=NULL,updated_at=?2 WHERE id=?1 AND linked_task_id=?3",
            params![event_id, now, id],
        ).map_err(sql_write_error)?;
    }
    let affected = transaction.execute("DELETE FROM tasks WHERE id=?1", [id]).map_err(sql_write_error)?;
    if affected != 1 { return Err(CommandError::not_found("未找到该任务。")); }
    transaction.commit().map_err(sql_write_error)
}

#[tauri::command]
pub fn list_tasks(db: State<'_, AppDb>) -> Result<Vec<Task>, CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    list(&connection)
}

#[tauri::command]
pub fn create_task(db: State<'_, AppDb>, draft: TaskDraft) -> Result<Task, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    create(&mut connection, draft)
}

#[tauri::command]
pub fn update_task(db: State<'_, AppDb>, id: String, draft: TaskDraft) -> Result<Task, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    update(&mut connection, &id, draft)
}

#[tauri::command]
pub fn delete_task(db: State<'_, AppDb>, id: String) -> Result<(), CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    delete(&mut connection, &id)
}

#[cfg(test)]
mod tests {
    use super::{create, delete, list, update, validate_and_normalize};
    use crate::db::migrate;
    use crate::models::TaskDraft;
    use rusqlite::Connection;

    fn database() -> Connection {
        let mut connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        migrate(&mut connection).unwrap();
        connection
    }

    fn insert_event(connection: &Connection, id: &str) {
        connection.execute(
            "INSERT INTO events(id,title,start_at,end_at,all_day,category,color,note,created_at,updated_at)
             VALUES (?1,?1,'2026-07-23T09:00','2026-07-23T10:00',0,'work','blue','','2026-07-23T08:00:00Z','2026-07-23T08:00:00Z')",
            [id],
        ).unwrap();
    }

    fn event_link(connection: &Connection, id: &str) -> Option<String> {
        connection.query_row("SELECT linked_task_id FROM events WHERE id=?1", [id], |row| row.get(0)).unwrap()
    }

    fn task_link(connection: &Connection, id: &str) -> Option<String> {
        connection.query_row("SELECT linked_event_id FROM tasks WHERE id=?1", [id], |row| row.get(0)).unwrap()
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
    fn create_update_and_delete_task_persist_without_deleting_events() {
        let mut connection = database();
        insert_event(&connection, "e1");
        let created = create(&mut connection, TaskDraft { linked_event_id: Some("e1".into()), ..draft() }).unwrap();
        assert_eq!(created.title, "发布 Nowly");
        assert!(uuid::Uuid::parse_str(&created.id).is_ok());
        assert_eq!(event_link(&connection, "e1").as_deref(), Some(created.id.as_str()));

        let updated = update(&mut connection, &created.id, TaskDraft {
            title: "正式发布".into(), quadrant: "important_not_urgent".into(), linked_event_id: None, ..draft()
        }).unwrap();
        assert_eq!(updated.title, "正式发布");
        assert_eq!(updated.created_at, created.created_at);
        assert_eq!(event_link(&connection, "e1"), None);

        delete(&mut connection, &created.id).unwrap();
        assert_eq!(connection.query_row("SELECT COUNT(*) FROM events WHERE id='e1'", [], |row| row.get::<_, i64>(0)).unwrap(), 1);
        assert_eq!(delete(&mut connection, &created.id).unwrap_err().code, "not_found");
    }

    #[test]
    fn relinking_displaces_both_old_relationships_atomically() {
        let mut connection = database();
        insert_event(&connection, "e1");
        insert_event(&connection, "e2");
        let first = create(&mut connection, TaskDraft { linked_event_id: Some("e1".into()), ..draft() }).unwrap();
        let second = create(&mut connection, TaskDraft { linked_event_id: Some("e2".into()), ..draft() }).unwrap();

        update(&mut connection, &second.id, TaskDraft { linked_event_id: Some("e1".into()), ..draft() }).unwrap();
        assert_eq!(task_link(&connection, &first.id), None);
        assert_eq!(task_link(&connection, &second.id).as_deref(), Some("e1"));
        assert_eq!(event_link(&connection, "e1").as_deref(), Some(second.id.as_str()));
        assert_eq!(event_link(&connection, "e2"), None);
    }

    #[test]
    fn missing_linked_event_is_a_field_error_and_rolls_back() {
        let mut connection = database();
        let error = create(&mut connection, TaskDraft { linked_event_id: Some("missing".into()), ..draft() }).unwrap_err();
        assert_eq!(error.code, "validation_error");
        assert_eq!(error.field.as_deref(), Some("linkedEventId"));
        assert_eq!(connection.query_row("SELECT COUNT(*) FROM tasks", [], |row| row.get::<_, i64>(0)).unwrap(), 0);
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
