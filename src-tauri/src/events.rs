use crate::db::AppDb;
use crate::error::CommandError;
use crate::models::{Event, EventDraft, EventRange};
use chrono::{NaiveDateTime, SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension, Row, Transaction, TransactionBehavior};
use uuid::Uuid;
use tauri::State;

const LOCAL_MINUTE_FORMAT: &str = "%Y-%m-%dT%H:%M";
const CATEGORIES: &[&str] = &["work", "important", "personal", "learning"];
const COLORS: &[&str] = &["blue", "red", "green", "yellow"];

fn parse_local(value: &str, field: &str) -> Result<NaiveDateTime, CommandError> {
    NaiveDateTime::parse_from_str(value, LOCAL_MINUTE_FORMAT)
        .map_err(|_| CommandError::validation(field, "日期或时间格式无效。"))
}

fn read_event(row: &Row<'_>) -> rusqlite::Result<Event> {
    Ok(Event {
        id: row.get(0)?,
        title: row.get(1)?,
        start_at: row.get(2)?,
        end_at: row.get(3)?,
        all_day: row.get::<_, i64>(4)? == 1,
        category: row.get(5)?,
        color: row.get(6)?,
        linked_task_id: row.get(7)?,
        note: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

pub fn list_in_range(
    connection: &Connection,
    range: &EventRange,
) -> Result<Vec<Event>, CommandError> {
    let start = parse_local(&range.start_at, "startAt")?;
    let end = parse_local(&range.end_at_exclusive, "endAtExclusive")?;
    if start >= end {
        return Err(CommandError::validation(
            "endAtExclusive",
            "查询结束时间必须晚于开始时间。",
        ));
    }
    let mut statement = connection
        .prepare(
            "SELECT id,title,start_at,end_at,all_day,category,color,linked_task_id,note,created_at,updated_at
             FROM events
             WHERE start_at >= ?1 AND start_at < ?2
             ORDER BY start_at ASC,end_at ASC,id ASC",
        )
        .map_err(CommandError::database)?;
    let rows = statement
        .query_map(params![range.start_at, range.end_at_exclusive], read_event)
        .map_err(CommandError::database)?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(CommandError::database)
}

pub fn validate_and_normalize(mut draft: EventDraft) -> Result<EventDraft, CommandError> {
    draft.title = draft.title.trim().to_owned();
    if draft.title.is_empty() {
        return Err(CommandError::validation("title", "请输入日程标题。"));
    }
    let start = parse_local(&draft.start_at, "startAt")?;
    let end = parse_local(&draft.end_at, "endAt")?;
    if end.date() < start.date() {
        return Err(CommandError::validation(
            "endAt",
            "结束日期不能早于开始日期。",
        ));
    }
    if start.date() == end.date() && end < start {
        return Err(CommandError::validation(
            "endAt",
            "结束时间不能早于开始时间。",
        ));
    }
    if !CATEGORIES.contains(&draft.category.as_str()) {
        return Err(CommandError::validation("category", "请选择有效分类。"));
    }
    if !COLORS.contains(&draft.color.as_str()) {
        return Err(CommandError::validation("color", "请选择有效颜色。"));
    }
    if draft.all_day {
        let start_date = start.date().format("%Y-%m-%d");
        let end_date = end.date().format("%Y-%m-%d");
        draft.start_at = format!("{start_date}T00:00");
        draft.end_at = format!("{end_date}T23:59");
    }
    Ok(draft)
}

fn timestamp() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn event_by_id(connection: &Connection, id: &str) -> Result<Option<Event>, CommandError> {
    connection
        .query_row(
            "SELECT id,title,start_at,end_at,all_day,category,color,linked_task_id,note,created_at,updated_at
             FROM events WHERE id=?1",
            [id],
            read_event,
        )
        .optional()
        .map_err(CommandError::database)
}

fn sql_write_error(error: rusqlite::Error) -> CommandError {
    match &error {
        rusqlite::Error::SqliteFailure(details, _)
            if details.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            eprintln!("event relation constraint failed: {error}");
            CommandError::conflict("日程关联已变化，请重试。")
        }
        _ => CommandError::database(error),
    }
}

fn require_task(transaction: &Transaction<'_>, task_id: &str) -> Result<(), CommandError> {
    let exists: bool = transaction
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM tasks WHERE id=?1)",
            [task_id],
            |row| row.get(0),
        )
        .map_err(CommandError::database)?;
    if exists {
        Ok(())
    } else {
        Err(CommandError::validation(
            "linkedTaskId",
            "未找到要关联的任务。",
        ))
    }
}

fn relink(
    transaction: &Transaction<'_>,
    event_id: &str,
    old_task_id: Option<&str>,
    new_task_id: Option<&str>,
    updated_at: &str,
) -> Result<(), CommandError> {
    if old_task_id == new_task_id {
        return Ok(());
    }
    if let Some(task_id) = new_task_id {
        require_task(transaction, task_id)?;
    }
    if let Some(task_id) = old_task_id {
        transaction
            .execute(
                "UPDATE tasks SET linked_event_id=NULL,updated_at=?2
                 WHERE id=?1 AND linked_event_id=?3",
                params![task_id, updated_at, event_id],
            )
            .map_err(sql_write_error)?;
    }
    if let Some(task_id) = new_task_id {
        let displaced_event: Option<String> = transaction
            .query_row(
                "SELECT linked_event_id FROM tasks WHERE id=?1",
                [task_id],
                |row| row.get(0),
            )
            .map_err(CommandError::database)?;
        if let Some(displaced_event) = displaced_event {
            transaction
                .execute(
                    "UPDATE events SET linked_task_id=NULL,updated_at=?2 WHERE id=?1",
                    params![displaced_event, updated_at],
                )
                .map_err(sql_write_error)?;
        }
        transaction
            .execute(
                "UPDATE events SET linked_task_id=NULL,updated_at=?2
                 WHERE linked_task_id=?1 AND id<>?3",
                params![task_id, updated_at, event_id],
            )
            .map_err(sql_write_error)?;
        transaction
            .execute(
                "UPDATE tasks SET linked_event_id=?2,updated_at=?3 WHERE id=?1",
                params![task_id, event_id, updated_at],
            )
            .map_err(sql_write_error)?;
    }
    Ok(())
}

pub fn create(connection: &mut Connection, draft: EventDraft) -> Result<Event, CommandError> {
    let draft = validate_and_normalize(draft)?;
    let id = Uuid::new_v4().hyphenated().to_string();
    let now = timestamp();
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(CommandError::database)?;
    if let Some(task_id) = draft.linked_task_id.as_deref() {
        require_task(&transaction, task_id)?;
    }
    transaction
        .execute(
            "INSERT INTO events(id,title,start_at,end_at,all_day,category,color,linked_task_id,note,created_at,updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,NULL,?8,?9,?9)",
            params![id, draft.title, draft.start_at, draft.end_at, i64::from(draft.all_day),
                    draft.category, draft.color, draft.note, now],
        )
        .map_err(sql_write_error)?;
    relink(
        &transaction,
        &id,
        None,
        draft.linked_task_id.as_deref(),
        &now,
    )?;
    transaction
        .execute(
            "UPDATE events SET linked_task_id=?2 WHERE id=?1",
            params![id, draft.linked_task_id],
        )
        .map_err(sql_write_error)?;
    let event = event_by_id(&transaction, &id)?.ok_or_else(|| {
        CommandError::conflict("日程保存状态已变化，请重试。")
    })?;
    transaction.commit().map_err(sql_write_error)?;
    Ok(event)
}

pub fn update(
    connection: &mut Connection,
    id: &str,
    draft: EventDraft,
) -> Result<Event, CommandError> {
    let draft = validate_and_normalize(draft)?;
    let now = timestamp();
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(CommandError::database)?;
    let old_task_id: Option<Option<String>> = transaction
        .query_row(
            "SELECT linked_task_id FROM events WHERE id=?1",
            [id],
            |row| row.get(0),
        )
        .optional()
        .map_err(CommandError::database)?;
    let old_task_id = old_task_id.ok_or_else(|| CommandError::not_found("未找到该日程。"))?;
    relink(
        &transaction,
        id,
        old_task_id.as_deref(),
        draft.linked_task_id.as_deref(),
        &now,
    )?;
    let affected = transaction
        .execute(
            "UPDATE events SET title=?2,start_at=?3,end_at=?4,all_day=?5,category=?6,color=?7,
             linked_task_id=?8,note=?9,updated_at=?10 WHERE id=?1",
            params![id, draft.title, draft.start_at, draft.end_at, i64::from(draft.all_day),
                    draft.category, draft.color, draft.linked_task_id, draft.note, now],
        )
        .map_err(sql_write_error)?;
    if affected != 1 {
        return Err(CommandError::not_found("未找到该日程。"));
    }
    let event = event_by_id(&transaction, id)?.ok_or_else(|| CommandError::not_found("未找到该日程。"))?;
    transaction.commit().map_err(sql_write_error)?;
    Ok(event)
}

pub fn delete(connection: &mut Connection, id: &str) -> Result<(), CommandError> {
    let now = timestamp();
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(CommandError::database)?;
    let linked_task_id: Option<Option<String>> = transaction
        .query_row(
            "SELECT linked_task_id FROM events WHERE id=?1",
            [id],
            |row| row.get(0),
        )
        .optional()
        .map_err(CommandError::database)?;
    let linked_task_id = linked_task_id.ok_or_else(|| CommandError::not_found("未找到该日程。"))?;
    if let Some(task_id) = linked_task_id {
        transaction
            .execute(
                "UPDATE tasks SET linked_event_id=NULL,updated_at=?2 WHERE id=?1 AND linked_event_id=?3",
                params![task_id, now, id],
            )
            .map_err(sql_write_error)?;
    }
    let affected = transaction
        .execute("DELETE FROM events WHERE id=?1", [id])
        .map_err(sql_write_error)?;
    if affected != 1 {
        return Err(CommandError::not_found("未找到该日程。"));
    }
    transaction.commit().map_err(sql_write_error)
}

#[tauri::command]
pub fn list_events_in_range(
    db: State<'_, AppDb>,
    range: EventRange,
) -> Result<Vec<Event>, CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    list_in_range(&connection, &range)
}

#[tauri::command]
pub fn create_event(db: State<'_, AppDb>, draft: EventDraft) -> Result<Event, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    create(&mut connection, draft)
}

#[tauri::command]
pub fn update_event(
    db: State<'_, AppDb>,
    id: String,
    draft: EventDraft,
) -> Result<Event, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    update(&mut connection, &id, draft)
}

#[tauri::command]
pub fn delete_event(db: State<'_, AppDb>, id: String) -> Result<(), CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    delete(&mut connection, &id)
}

#[cfg(test)]
mod tests {
    use super::{create, delete, list_in_range, update, validate_and_normalize};
    use crate::db::migrate;
    use crate::models::{EventDraft, EventRange};
    use rusqlite::Connection;

    fn database() -> Connection {
        let mut connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        migrate(&mut connection).unwrap();
        connection
    }

    fn draft() -> EventDraft {
        EventDraft {
            title: "  评审  ".into(),
            start_at: "2026-07-23T14:00".into(),
            end_at: "2026-07-23T15:00".into(),
            all_day: false,
            category: "work".into(),
            color: "blue".into(),
            linked_task_id: None,
            note: "".into(),
        }
    }

    fn insert_task(connection: &Connection, id: &str) {
        connection.execute(
            "INSERT INTO tasks(id,title,quadrant,priority,completed,note,created_at,updated_at)
             VALUES (?1,?1,'important-urgent',1,0,'','2026-07-23T08:00:00Z','2026-07-23T08:00:00Z')",
            [id],
        ).unwrap();
    }

    fn event_link(connection: &Connection, id: &str) -> Option<String> {
        connection.query_row("SELECT linked_task_id FROM events WHERE id=?1", [id], |row| row.get(0)).unwrap()
    }

    fn task_link(connection: &Connection, id: &str) -> Option<String> {
        connection.query_row("SELECT linked_event_id FROM tasks WHERE id=?1", [id], |row| row.get(0)).unwrap()
    }

    #[test]
    fn create_update_and_delete_event_persist_and_trim_values() {
        let mut connection = database();
        let created = create(&mut connection, draft()).unwrap();
        assert_eq!(created.title, "评审");
        assert!(uuid::Uuid::parse_str(&created.id).is_ok());

        let updated = update(&mut connection, &created.id, EventDraft {
            title: "复盘".into(), color: "red".into(), ..draft()
        }).unwrap();
        assert_eq!(updated.title, "复盘");
        assert_eq!(updated.created_at, created.created_at);
        assert!(updated.updated_at >= created.updated_at);

        delete(&mut connection, &created.id).unwrap();
        assert_eq!(update(&mut connection, &created.id, draft()).unwrap_err().code, "not_found");
        assert_eq!(delete(&mut connection, &created.id).unwrap_err().code, "not_found");
    }

    #[test]
    fn relinking_is_bidirectional_and_delete_keeps_the_task() {
        let mut connection = database();
        insert_task(&connection, "t1");
        insert_task(&connection, "t2");
        let first = create(&mut connection, EventDraft { linked_task_id: Some("t1".into()), ..draft() }).unwrap();
        let second = create(&mut connection, EventDraft { linked_task_id: Some("t2".into()), ..draft() }).unwrap();

        update(&mut connection, &second.id, EventDraft { linked_task_id: Some("t1".into()), ..draft() }).unwrap();
        assert_eq!(event_link(&connection, &first.id), None);
        assert_eq!(event_link(&connection, &second.id).as_deref(), Some("t1"));
        assert_eq!(task_link(&connection, "t1").as_deref(), Some(second.id.as_str()));
        assert_eq!(task_link(&connection, "t2"), None);

        delete(&mut connection, &second.id).unwrap();
        assert_eq!(task_link(&connection, "t1"), None);
        assert_eq!(connection.query_row("SELECT COUNT(*) FROM tasks", [], |row| row.get::<_, i64>(0)).unwrap(), 2);
    }

    #[test]
    fn create_rejects_a_missing_linked_task() {
        let mut connection = database();
        let error = create(&mut connection, EventDraft { linked_task_id: Some("missing".into()), ..draft() }).unwrap_err();
        assert_eq!(error.code, "validation_error");
        assert_eq!(error.field.as_deref(), Some("linkedTaskId"));
    }

    #[test]
    fn range_query_uses_half_open_bounds_and_stable_order() {
        let connection = database();
        for (id, start_at, end_at) in [
            ("june", "2026-06-30T23:59", "2026-06-30T23:59"),
            ("july-b", "2026-07-01T00:00", "2026-07-01T01:00"),
            ("july-a", "2026-07-01T00:00", "2026-07-01T00:30"),
            ("august", "2026-08-01T00:00", "2026-08-01T01:00"),
        ] {
            connection.execute(
                "INSERT INTO events(id,title,start_at,end_at,all_day,category,color,note,created_at,updated_at)
                 VALUES (?1,?1,?2,?3,0,'work','blue','','2026-07-01T00:00:00Z','2026-07-01T00:00:00Z')",
                (id, start_at, end_at),
            ).unwrap();
        }

        let events = list_in_range(&connection, &EventRange {
            start_at: "2026-07-01T00:00".into(),
            end_at_exclusive: "2026-08-01T00:00".into(),
        }).unwrap();

        assert_eq!(events.iter().map(|event| event.id.as_str()).collect::<Vec<_>>(), vec!["july-a", "july-b"]);
    }

    #[test]
    fn validation_rejects_invalid_fields_and_normalizes_all_day() {
        let base = draft();
        assert_eq!(validate_and_normalize(base.clone()).unwrap().title, "评审");
        for (invalid, field) in [
            (EventDraft { title: "  ".into(), ..base.clone() }, "title"),
            (EventDraft { start_at: "bad".into(), ..base.clone() }, "startAt"),
            (EventDraft { end_at: "2026-07-22T15:00".into(), ..base.clone() }, "endAt"),
            (EventDraft { end_at: "2026-07-23T13:55".into(), ..base.clone() }, "endAt"),
            (EventDraft { category: "other".into(), ..base.clone() }, "category"),
            (EventDraft { color: "purple".into(), ..base.clone() }, "color"),
        ] {
            assert_eq!(validate_and_normalize(invalid).unwrap_err().field.as_deref(), Some(field));
        }
        let multi_day = validate_and_normalize(EventDraft {
            start_at: "2026-07-23T14:00".into(),
            end_at: "2026-07-25T10:00".into(),
            ..base.clone()
        }).unwrap();
        assert_eq!(multi_day.start_at, "2026-07-23T14:00");
        assert_eq!(multi_day.end_at, "2026-07-25T10:00");
        let all_day = validate_and_normalize(EventDraft {
            all_day: true,
            start_at: "2026-07-23T09:30".into(),
            end_at: "2026-07-23T10:30".into(),
            ..base
        }).unwrap();
        assert_eq!(all_day.start_at, "2026-07-23T00:00");
        assert_eq!(all_day.end_at, "2026-07-23T23:59");
    }
}
