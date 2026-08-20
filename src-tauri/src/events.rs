use crate::db::AppDb;
use crate::error::CommandError;
use crate::event_exceptions::{self, Exception};
use crate::models::{Event, EventDraft, EventRange};
use crate::recurrence::{
    self, end_from_columns, freq_from_str, parse_by_day, Recurrence, Series,
};
use chrono::{Duration, NaiveDateTime, SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension, Row, Transaction, TransactionBehavior};
use uuid::Uuid;
use tauri::State;

const LOCAL_MINUTE_FORMAT: &str = "%Y-%m-%dT%H:%M";
const CATEGORIES: &[&str] = &["work", "important", "personal", "learning"];

const EVENT_COLUMNS: &str = "id,title,start_at,end_at,all_day,category,color,linked_task_id,note,\
                             created_at,updated_at,recurrence_freq,recurrence_interval,\
                             recurrence_by_day,recurrence_until,recurrence_count,recurrence_final_at";

fn parse_local(value: &str, field: &str) -> Result<NaiveDateTime, CommandError> {
    NaiveDateTime::parse_from_str(value, LOCAL_MINUTE_FORMAT)
        .map_err(|_| CommandError::validation(field, "日期或时间格式无效。"))
}

/// 系列行读出的原始数据。展开前的中间形态，不直接对外暴露。
struct SeriesRow {
    event: Event,
    rule: Option<Recurrence>,
    final_at: Option<String>,
}

/// 重复列的取值只由归一化写入，读到越界或未知值即为数据损坏，必须报错而非取默认值。
fn corrupt_column(index: usize, message: String) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(index, rusqlite::types::Type::Text, message.into())
}

fn read_series_row(row: &Row<'_>) -> rusqlite::Result<SeriesRow> {
    let freq: Option<String> = row.get(11)?;
    let interval: i64 = row.get(12)?;
    let by_day: String = row.get(13)?;
    let until: Option<String> = row.get(14)?;
    let count: Option<i64> = row.get(15)?;
    let final_at: Option<String> = row.get(16)?;

    let rule = match freq {
        Some(freq) => Some(Recurrence {
            freq: freq_from_str(&freq)
                .map_err(|_| corrupt_column(11, format!("未知的重复频率：{freq}")))?,
            interval: u32::try_from(interval)
                .map_err(|_| corrupt_column(12, format!("重复间隔越界：{interval}")))?,
            by_day: by_day
                .split(',')
                .filter(|code| !code.is_empty())
                .map(str::to_owned)
                .collect(),
            end: end_from_columns(
                until,
                count
                    .map(u32::try_from)
                    .transpose()
                    .map_err(|_| corrupt_column(15, "重复次数越界。".to_owned()))?,
            ),
        }),
        None => None,
    };

    Ok(SeriesRow {
        event: Event {
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
            recurrence: None,
            series_id: None,
            occurrence_start_at: None,
            is_overridden: false,
        },
        rule,
        final_at,
    })
}

/// 系列行本身即它的首个实例：R1 已保证 `start_at` 落在规则上。
fn read_event(row: &Row<'_>) -> rusqlite::Result<Event> {
    let series_row = read_series_row(row)?;
    let mut event = series_row.event;
    if series_row.rule.is_some() {
        event.series_id = Some(event.id.clone());
        event.occurrence_start_at = Some(event.start_at.clone());
        event.recurrence = series_row.rule;
    }
    Ok(event)
}

/// 把系列行按恒定时长平移到某个槽位，得到一个展开实例。
fn instance_from(row: &SeriesRow, slot: NaiveDateTime, duration: Duration) -> Event {
    let mut event = row.event.clone();
    event.start_at = slot.format(LOCAL_MINUTE_FORMAT).to_string();
    event.end_at = (slot + duration).format(LOCAL_MINUTE_FORMAT).to_string();
    event.recurrence = row.rule.clone();
    event.series_id = Some(row.event.id.clone());
    event.occurrence_start_at = Some(event.start_at.clone());
    event.is_overridden = false;
    event
}

fn overridden_instance(
    row: &SeriesRow,
    slot: &str,
    fields: &event_exceptions::OverrideFields,
) -> Event {
    let mut event = row.event.clone();
    event.title = fields.title.clone();
    event.start_at = fields.start_at.clone();
    event.end_at = fields.end_at.clone();
    event.all_day = fields.all_day;
    event.category = fields.category.clone();
    event.color = fields.color.clone();
    event.note = fields.note.clone();
    event.recurrence = row.rule.clone();
    event.series_id = Some(row.event.id.clone());
    event.occurrence_start_at = Some(slot.to_owned());
    event.is_overridden = true;
    event
}

fn within(value: &str, window_start: &str, window_end_exclusive: &str) -> bool {
    value >= window_start && value < window_end_exclusive
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
    // 例外表与系列预筛都用字典序比较窗口，必须重新格式化成定长形式，
    // 因为 chrono 的解析接受 `2026-8-1T0:00` 这类变长写法。
    let window_start = start.format(LOCAL_MINUTE_FORMAT).to_string();
    let window_end = end.format(LOCAL_MINUTE_FORMAT).to_string();

    let mut results: Vec<Event> = Vec::new();

    let mut singles = connection
        .prepare(&format!(
            "SELECT {EVENT_COLUMNS} FROM events
             WHERE recurrence_freq IS NULL AND start_at >= ?1 AND start_at < ?2"
        ))
        .map_err(CommandError::database)?;
    let rows = singles
        .query_map(params![window_start, window_end], read_event)
        .map_err(CommandError::database)?;
    for row in rows {
        results.push(row.map_err(CommandError::database)?);
    }

    // 预筛仍可能与窗口相交的系列：规则本身够到窗口，或某次被覆盖后落进窗口。
    let mut series_statement = connection
        .prepare(&format!(
            "SELECT {EVENT_COLUMNS} FROM events
             WHERE recurrence_freq IS NOT NULL
               AND ((start_at < ?2
                     AND (recurrence_final_at IS NULL OR recurrence_final_at >= ?1))
                    OR EXISTS (SELECT 1 FROM event_exceptions
                               WHERE event_exceptions.series_id = events.id
                                 AND event_exceptions.kind = 'overridden'
                                 AND event_exceptions.start_at >= ?1
                                 AND event_exceptions.start_at < ?2))"
        ))
        .map_err(CommandError::database)?;
    let series_rows = series_statement
        .query_map(params![window_start, window_end], read_series_row)
        .map_err(CommandError::database)?;

    for series_row in series_rows {
        let series_row = series_row.map_err(CommandError::database)?;
        let Some(rule) = series_row.rule.clone() else {
            continue;
        };
        let dtstart = parse_local(&series_row.event.start_at, "startAt")?;
        let dtend = parse_local(&series_row.event.end_at, "endAt")?;
        let duration = dtend - dtstart;
        let final_at = match series_row.final_at.as_deref() {
            Some(value) => Some(parse_local(value, "recurrenceFinalAt")?),
            None => None,
        };
        let series = Series {
            freq: rule.freq,
            interval: rule.interval,
            by_day: parse_by_day(&rule.by_day.join(","))?,
            dtstart,
            final_at,
        };

        let exceptions = event_exceptions::load_for_window(
            connection,
            &series_row.event.id,
            &window_start,
            &window_end,
        )?;

        for slot in recurrence::expand(&series, start, end) {
            let key = slot.format(LOCAL_MINUTE_FORMAT).to_string();
            match exceptions.get(&key) {
                Some(Exception::Excluded) => {}
                // 覆盖可能把这一次移出窗口，此时它不属于本窗口。
                Some(Exception::Overridden(fields)) => {
                    if within(&fields.start_at, &window_start, &window_end) {
                        results.push(overridden_instance(&series_row, &key, fields));
                    }
                }
                None => results.push(instance_from(&series_row, slot, duration)),
            }
        }

        // 槽位在窗口外、被覆盖后移入窗口的实例不会被展开产出，需要单独补入。
        for (key, exception) in &exceptions {
            let Exception::Overridden(fields) = exception else {
                continue;
            };
            if within(key, &window_start, &window_end) {
                continue;
            }
            if within(&fields.start_at, &window_start, &window_end) {
                results.push(overridden_instance(&series_row, key, fields));
            }
        }
    }

    results.sort_by(|left, right| {
        left.start_at
            .cmp(&right.start_at)
            .then(left.end_at.cmp(&right.end_at))
            .then(left.id.cmp(&right.id))
            .then(left.occurrence_start_at.cmp(&right.occurrence_start_at))
    });
    Ok(results)
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
    draft.color = crate::color::normalize_hex(&draft.color)
        .ok_or_else(|| CommandError::validation("color", "请选择有效颜色。"))?;
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
            &format!("SELECT {EVENT_COLUMNS} FROM events WHERE id=?1"),
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
    use super::{create, delete, event_by_id, list_in_range, update, validate_and_normalize};
    use crate::db::migrate;
    use crate::event_exceptions::{upsert_excluded, upsert_overridden, OverrideFields};
    use crate::models::{Event, EventDraft, EventRange};
    use crate::recurrence::{Freq, RecurrenceEnd};
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
            color: "#4FC9DA".into(),
            linked_task_id: None,
            note: "".into(),
            recurrence: None,
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
            title: "复盘".into(), color: "#F06445".into(), ..draft()
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
            (EventDraft { color: "#GGGGGG".into(), ..base.clone() }, "color"),
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

    const SERIES_COLUMNS: &str = "id,title,start_at,end_at,all_day,category,color,note,created_at,updated_at,\
                                  recurrence_freq,recurrence_interval,recurrence_by_day,\
                                  recurrence_until,recurrence_final_at";

    /// 2026-08-03 是周一，因此 `s1` 在八月展开出 8/3、8/10、8/17、8/24、8/31 共五次。
    fn seeded() -> Connection {
        let connection = database();
        connection
            .execute(
                &format!(
                    "INSERT INTO events({SERIES_COLUMNS})
                     VALUES ('s1','周会','2026-08-03T10:00','2026-08-03T11:00',0,'work','#0BB783','','t','t',
                             'weekly',1,'MO',NULL,NULL)"
                ),
                [],
            )
            .expect("series inserts");
        connection
    }

    fn august(connection: &Connection) -> Vec<Event> {
        list_in_range(
            connection,
            &EventRange {
                start_at: "2026-08-01T00:00".into(),
                end_at_exclusive: "2026-09-01T00:00".into(),
            },
        )
        .expect("range query runs")
    }

    fn starts(events: &[Event]) -> Vec<&str> {
        events.iter().map(|event| event.start_at.as_str()).collect()
    }

    fn override_fields(title: &str, start_at: &str, end_at: &str) -> OverrideFields {
        OverrideFields {
            title: title.into(),
            start_at: start_at.into(),
            end_at: end_at.into(),
            all_day: false,
            category: "personal".into(),
            color: "#F1416C".into(),
            note: "改期".into(),
        }
    }

    #[test]
    fn expands_a_weekly_series_across_the_month() {
        let connection = seeded();
        let events = august(&connection);
        assert_eq!(
            starts(&events),
            vec![
                "2026-08-03T10:00",
                "2026-08-10T10:00",
                "2026-08-17T10:00",
                "2026-08-24T10:00",
                "2026-08-31T10:00"
            ]
        );
        for event in &events {
            assert_eq!(event.id, "s1");
            assert_eq!(event.series_id.as_deref(), Some("s1"));
            assert_eq!(event.occurrence_start_at.as_deref(), Some(event.start_at.as_str()));
            assert_eq!(event.title, "周会");
            assert!(!event.is_overridden);
            assert_eq!(
                event.recurrence.as_ref().expect("rule travels with the instance").freq,
                Freq::Weekly
            );
        }
        assert_eq!(events[0].end_at, "2026-08-03T11:00");
        assert_eq!(events[4].end_at, "2026-08-31T11:00");
    }

    #[test]
    fn the_series_upper_bound_is_inclusive() {
        let connection = database();
        connection
            .execute(
                &format!(
                    "INSERT INTO events({SERIES_COLUMNS})
                     VALUES ('bounded','晨会','2026-08-03T10:00','2026-08-03T11:00',0,'work','#0BB783','','t','t',
                             'weekly',1,'MO','2026-08-17','2026-08-17T10:00')"
                ),
                [],
            )
            .expect("bounded series inserts");
        let events = august(&connection);
        assert_eq!(
            starts(&events),
            vec!["2026-08-03T10:00", "2026-08-10T10:00", "2026-08-17T10:00"]
        );
        assert_eq!(
            events[0].recurrence.as_ref().expect("rule present").end,
            RecurrenceEnd::Until {
                date: "2026-08-17".into()
            }
        );
    }

    #[test]
    fn excluded_slots_disappear_from_the_window() {
        let connection = seeded();
        upsert_excluded(&connection, "s1", "2026-08-10T10:00", "t").expect("exclude");
        let events = august(&connection);
        assert_eq!(
            starts(&events),
            vec![
                "2026-08-03T10:00",
                "2026-08-17T10:00",
                "2026-08-24T10:00",
                "2026-08-31T10:00"
            ]
        );
    }

    #[test]
    fn overridden_slots_use_the_override_fields_and_keep_the_original_slot() {
        let connection = seeded();
        upsert_overridden(
            &connection,
            "s1",
            "2026-08-10T10:00",
            &override_fields("改期周会", "2026-08-11T14:00", "2026-08-11T15:00"),
            "t",
        )
        .expect("override");
        let events = august(&connection);
        assert_eq!(events.len(), 5);
        let moved = events
            .iter()
            .find(|event| event.occurrence_start_at.as_deref() == Some("2026-08-10T10:00"))
            .expect("override present");
        assert_eq!(moved.start_at, "2026-08-11T14:00");
        assert_eq!(moved.end_at, "2026-08-11T15:00");
        assert_eq!(moved.title, "改期周会");
        assert_eq!(moved.category, "personal");
        assert_eq!(moved.color, "#F1416C");
        assert_eq!(moved.note, "改期");
        assert_eq!(moved.id, "s1");
        assert_eq!(moved.series_id.as_deref(), Some("s1"));
        assert!(moved.is_overridden);
        assert!(events
            .iter()
            .filter(|event| !event.is_overridden)
            .all(|event| event.title == "周会"));
        assert_eq!(events.iter().filter(|event| event.is_overridden).count(), 1);
    }

    #[test]
    fn exclusions_and_overrides_apply_together_within_one_window() {
        let connection = seeded();
        upsert_excluded(&connection, "s1", "2026-08-10T10:00", "t").expect("exclude");
        upsert_overridden(
            &connection,
            "s1",
            "2026-08-17T10:00",
            &override_fields("挪到下午", "2026-08-17T15:00", "2026-08-17T16:00"),
            "t",
        )
        .expect("override");
        let events = august(&connection);
        assert_eq!(
            starts(&events),
            vec![
                "2026-08-03T10:00",
                "2026-08-17T15:00",
                "2026-08-24T10:00",
                "2026-08-31T10:00"
            ]
        );
        assert!(events
            .iter()
            .all(|event| event.occurrence_start_at.as_deref() != Some("2026-08-10T10:00")));
        assert_eq!(events.iter().filter(|event| event.is_overridden).count(), 1);
    }

    #[test]
    fn overrides_moving_out_of_the_window_disappear_and_moving_in_appear() {
        let connection = seeded();
        // 八月的一次被推迟到九月：八月窗口内应消失
        upsert_overridden(
            &connection,
            "s1",
            "2026-08-17T10:00",
            &override_fields("推迟", "2026-09-02T10:00", "2026-09-02T11:00"),
            "t",
        )
        .expect("override out");
        // 九月的一次被提前到八月：八月窗口内应出现
        upsert_overridden(
            &connection,
            "s1",
            "2026-09-07T10:00",
            &override_fields("提前", "2026-08-20T09:00", "2026-08-20T10:00"),
            "t",
        )
        .expect("override in");

        let events = august(&connection);
        assert_eq!(
            starts(&events),
            vec![
                "2026-08-03T10:00",
                "2026-08-10T10:00",
                "2026-08-20T09:00",
                "2026-08-24T10:00",
                "2026-08-31T10:00"
            ]
        );
        let titles: Vec<&str> = events.iter().map(|event| event.title.as_str()).collect();
        assert!(!titles.contains(&"推迟"));
        assert!(titles.contains(&"提前"));
        let moved_in = events
            .iter()
            .find(|event| event.title == "提前")
            .expect("moved in present");
        assert_eq!(
            moved_in.occurrence_start_at.as_deref(),
            Some("2026-09-07T10:00")
        );
        assert!(moved_in.is_overridden);
    }

    #[test]
    fn window_bounds_stay_half_open_for_overridden_instances() {
        let connection = seeded();
        // 移到窗口右端点（半开，不含）：应消失
        upsert_overridden(
            &connection,
            "s1",
            "2026-08-24T10:00",
            &override_fields("右端点", "2026-09-01T00:00", "2026-09-01T01:00"),
            "t",
        )
        .expect("override onto the end");
        // 窗口外的槽位被移到窗口左端点（含）：应出现
        upsert_overridden(
            &connection,
            "s1",
            "2026-09-07T10:00",
            &override_fields("左端点", "2026-08-01T00:00", "2026-08-01T01:00"),
            "t",
        )
        .expect("override onto the start");

        let events = august(&connection);
        assert_eq!(
            starts(&events),
            vec![
                "2026-08-01T00:00",
                "2026-08-03T10:00",
                "2026-08-10T10:00",
                "2026-08-17T10:00",
                "2026-08-31T10:00"
            ]
        );
        assert_eq!(events[0].title, "左端点");
        assert!(events.iter().all(|event| event.title != "右端点"));
    }

    #[test]
    fn overrides_move_instances_in_from_series_that_never_touch_the_window() {
        let connection = database();
        // 七月即已结束的系列，最后一次被补到八月
        connection
            .execute(
                &format!(
                    "INSERT INTO events({SERIES_COLUMNS})
                     VALUES ('past','旧周会','2026-07-06T10:00','2026-07-06T11:00',0,'work','#0BB783','','t','t',
                             'weekly',1,'MO','2026-07-27','2026-07-27T10:00')"
                ),
                [],
            )
            .expect("past series inserts");
        upsert_overridden(
            &connection,
            "past",
            "2026-07-27T10:00",
            &override_fields("补开", "2026-08-05T10:00", "2026-08-05T11:00"),
            "t",
        )
        .expect("override forward");
        // 九月才开始的系列，第一次被提前到八月
        connection
            .execute(
                &format!(
                    "INSERT INTO events({SERIES_COLUMNS})
                     VALUES ('future','新周会','2026-09-07T10:00','2026-09-07T11:00',0,'work','#0BB783','','t','t',
                             'weekly',1,'MO',NULL,NULL)"
                ),
                [],
            )
            .expect("future series inserts");
        upsert_overridden(
            &connection,
            "future",
            "2026-09-07T10:00",
            &override_fields("提前", "2026-08-26T10:00", "2026-08-26T11:00"),
            "t",
        )
        .expect("override backward");

        let events = august(&connection);
        assert_eq!(
            events.iter().map(|event| event.title.as_str()).collect::<Vec<_>>(),
            vec!["补开", "提前"]
        );
        assert!(events.iter().all(|event| event.is_overridden));
        assert_eq!(events[0].series_id.as_deref(), Some("past"));
        assert_eq!(
            events[0].occurrence_start_at.as_deref(),
            Some("2026-07-27T10:00")
        );
        assert_eq!(events[1].series_id.as_deref(), Some("future"));
        assert_eq!(
            events[1].occurrence_start_at.as_deref(),
            Some("2026-09-07T10:00")
        );
    }

    #[test]
    fn single_events_are_returned_unchanged_and_sort_among_instances() {
        let connection = seeded();
        connection
            .execute(
                "INSERT INTO events(id,title,start_at,end_at,all_day,category,color,note,created_at,updated_at)
                 VALUES ('e1','单次','2026-08-05T09:00','2026-08-05T10:00',0,'personal','#0BB783','备注','t','t')",
                [],
            )
            .expect("single event inserts");
        let events = august(&connection);
        assert_eq!(
            starts(&events),
            vec![
                "2026-08-03T10:00",
                "2026-08-05T09:00",
                "2026-08-10T10:00",
                "2026-08-17T10:00",
                "2026-08-24T10:00",
                "2026-08-31T10:00"
            ]
        );
        let single = events
            .iter()
            .find(|event| event.id == "e1")
            .expect("single present");
        assert_eq!(single.title, "单次");
        assert_eq!(single.end_at, "2026-08-05T10:00");
        assert_eq!(single.category, "personal");
        assert_eq!(single.note, "备注");
        assert!(single.recurrence.is_none());
        assert!(single.series_id.is_none());
        assert!(single.occurrence_start_at.is_none());
        assert!(!single.is_overridden);
    }

    #[test]
    fn event_by_id_reads_back_the_recurrence_rule() {
        let connection = seeded();
        let series = event_by_id(&connection, "s1")
            .expect("query runs")
            .expect("series present");
        let rule = series.recurrence.expect("rule present");
        assert_eq!(rule.freq, Freq::Weekly);
        assert_eq!(rule.interval, 1);
        assert_eq!(rule.by_day, vec!["MO".to_string()]);
        assert_eq!(rule.end, RecurrenceEnd::Never);
        assert_eq!(series.series_id.as_deref(), Some("s1"));
        assert_eq!(series.occurrence_start_at.as_deref(), Some("2026-08-03T10:00"));
        assert!(!series.is_overridden);
    }

    #[test]
    fn event_by_id_reads_back_a_counted_end_condition() {
        let connection = database();
        connection
            .execute(
                "INSERT INTO events(id,title,start_at,end_at,all_day,category,color,note,created_at,updated_at,
                                    recurrence_freq,recurrence_interval,recurrence_by_day,
                                    recurrence_count,recurrence_final_at)
                 VALUES ('daily','站会','2026-08-03T09:00','2026-08-03T09:15',0,'work','#0BB783','','t','t',
                         'daily',3,'',4,'2026-08-12T09:00')",
                [],
            )
            .expect("counted series inserts");
        let series = event_by_id(&connection, "daily")
            .expect("query runs")
            .expect("series present");
        let rule = series.recurrence.expect("rule present");
        assert_eq!(rule.freq, Freq::Daily);
        assert_eq!(rule.interval, 3);
        assert!(rule.by_day.is_empty());
        assert_eq!(rule.end, RecurrenceEnd::Count { count: 4 });
        assert_eq!(
            starts(&august(&connection)),
            vec![
                "2026-08-03T09:00",
                "2026-08-06T09:00",
                "2026-08-09T09:00",
                "2026-08-12T09:00"
            ]
        );
    }

    #[test]
    fn update_returns_the_recurrence_of_the_series_row() {
        let mut connection = seeded();
        let updated = update(
            &mut connection,
            "s1",
            EventDraft {
                title: "周会（改名）".into(),
                start_at: "2026-08-03T10:00".into(),
                end_at: "2026-08-03T11:00".into(),
                all_day: false,
                category: "work".into(),
                color: "#0BB783".into(),
                linked_task_id: None,
                note: String::new(),
                recurrence: None,
            },
        )
        .expect("update runs");
        assert_eq!(updated.title, "周会（改名）");
        assert_eq!(
            updated.recurrence.as_ref().expect("rule survives update").freq,
            Freq::Weekly
        );
        assert_eq!(updated.series_id.as_deref(), Some("s1"));
        assert_eq!(updated.occurrence_start_at.as_deref(), Some("2026-08-03T10:00"));
    }

    #[test]
    fn create_returns_a_single_event_without_recurrence_fields() {
        let mut connection = database();
        let created = create(&mut connection, draft()).expect("create runs");
        assert!(created.recurrence.is_none());
        assert!(created.series_id.is_none());
        assert!(created.occurrence_start_at.is_none());
        assert!(!created.is_overridden);

        let fetched = event_by_id(&connection, &created.id)
            .expect("query runs")
            .expect("event present");
        assert_eq!(fetched, created);
    }
}
