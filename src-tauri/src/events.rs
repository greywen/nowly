use crate::db::AppDb;
use crate::error::CommandError;
use crate::models::{Event, EventDraft, EventRange};
use chrono::NaiveDateTime;
use rusqlite::{params, Connection, Row};
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
    if start.date() != end.date() {
        return Err(CommandError::validation("endAt", "首版日程不能跨日。"));
    }
    if end < start {
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
        let date = start.date().format("%Y-%m-%d");
        draft.start_at = format!("{date}T00:00");
        draft.end_at = format!("{date}T23:59");
    }
    Ok(draft)
}

#[tauri::command]
pub fn list_events_in_range(
    db: State<'_, AppDb>,
    range: EventRange,
) -> Result<Vec<Event>, CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    list_in_range(&connection, &range)
}

#[cfg(test)]
mod tests {
    use super::{list_in_range, validate_and_normalize};
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
            (EventDraft { end_at: "2026-07-24T15:00".into(), ..base.clone() }, "endAt"),
            (EventDraft { end_at: "2026-07-23T13:55".into(), ..base.clone() }, "endAt"),
            (EventDraft { category: "other".into(), ..base.clone() }, "category"),
            (EventDraft { color: "purple".into(), ..base.clone() }, "color"),
        ] {
            assert_eq!(validate_and_normalize(invalid).unwrap_err().field.as_deref(), Some(field));
        }
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
