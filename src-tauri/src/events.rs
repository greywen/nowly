use crate::db::AppDb;
use crate::error::CommandError;
use crate::event_exceptions::{self, Exception};
use crate::models::{EditScope, Event, EventDraft, EventRange, EventTarget};
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
    if let Some(rule) = draft.recurrence.clone() {
        // R1 可能把开始日期顺延到规则内的首个匹配日，写库的必须是顺延后的值。
        let dtstart = parse_local(&draft.start_at, "startAt")?;
        let dtend = parse_local(&draft.end_at, "endAt")?;
        let duration = dtend - dtstart;
        let normalized = recurrence::normalize(&rule, dtstart)?;
        draft.start_at = normalized.dtstart.format(LOCAL_MINUTE_FORMAT).to_string();
        draft.end_at = (normalized.dtstart + duration)
            .format(LOCAL_MINUTE_FORMAT)
            .to_string();
        draft.recurrence = Some(normalized.rule);
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

/// 重复规则对应的六个存储列。返回元组而非结构体，因为它只在
/// INSERT / UPDATE 的参数位上原样展开，不参与任何其他运算。
type RecurrenceColumns = (
    Option<&'static str>,
    u32,
    String,
    Option<String>,
    Option<u32>,
    Option<String>,
);

fn recurrence_columns(draft: &EventDraft) -> Result<RecurrenceColumns, CommandError> {
    let Some(rule) = draft.recurrence.as_ref() else {
        return Ok((None, 1, String::new(), None, None, None));
    };
    let dtstart = parse_local(&draft.start_at, "startAt")?;
    let normalized = recurrence::normalize(rule, dtstart)?;
    let (until, count) = recurrence::end_to_columns(&normalized.rule.end);
    Ok((
        Some(recurrence::freq_to_str(normalized.rule.freq)),
        normalized.rule.interval,
        normalized.rule.by_day.join(","),
        until,
        count,
        normalized
            .final_at
            .map(|value| value.format(LOCAL_MINUTE_FORMAT).to_string()),
    ))
}

/// 规则与完整开始时刻均未变时，槽位序列 `f(dtstart, rule)` 不变，
/// 既有例外的身份键仍然有效。此处必须比完整的 `start_at`：只比 `HH:MM`
/// 会漏判「周一 8/3 平移到周一 8/10」这类日期平移，使旧例外整体错位。
fn slots_unchanged(
    old_start: &str,
    old_rule: &Option<Recurrence>,
    new_start: &str,
    new_rule: &Option<Recurrence>,
) -> bool {
    old_start == new_start && old_rule == new_rule
}

/// 自被编辑的槽位起，两段序列是否完全重合——重合时旧例外的身份键仍能精确命中新系列。
///
/// 「新系列的 `dtstart` 落在该槽位上」是充分性的前提，必须实际校验而非假设：用户在
/// 「此后所有」里可以改日期，把周一 8/17 改成周二 8/18 而规则仍是 weekly MO 时，R1 会把
/// 新 `dtstart` 对齐到 8/24，时刻与规则却都没变；只比后两项就会把 8/17 的例外迁到一个
/// 根本不产出该槽位的新系列上。`draft.start_at` 必须是归一化后的值，比的正是 R1 的结果。
/// 与 `slots_unchanged` 的判定条件不同，两者不可互换。
fn slots_continue(
    existing: &Event,
    draft: &EventDraft,
    slot: NaiveDateTime,
) -> Result<bool, CommandError> {
    let shape =
        |rule: Option<&Recurrence>| rule.map(|rule| (rule.freq, rule.interval, rule.by_day.clone()));
    let new_start = parse_local(&draft.start_at, "startAt")?;
    Ok(new_start == slot
        && parse_local(&existing.start_at, "startAt")?.time() == new_start.time()
        && shape(existing.recurrence.as_ref()) == shape(draft.recurrence.as_ref()))
}

/// 由系列行重建展开所需的 `Series`。`final_at` 由归一化重算，与写入时同源。
fn series_of(event: &Event, rule: &Recurrence) -> Result<Series, CommandError> {
    let dtstart = parse_local(&event.start_at, "startAt")?;
    let normalized = recurrence::normalize(rule, dtstart)?;
    Ok(Series {
        freq: normalized.rule.freq,
        interval: normalized.rule.interval,
        by_day: parse_by_day(&normalized.rule.by_day.join(","))?,
        dtstart: normalized.dtstart,
        final_at: normalized.final_at,
    })
}

/// 校验 `EventTarget` 带来的槽位确实由该系列展开得出。放在任何写入之前，
/// 使非法槽位在留下孤儿例外行之前就被挡住。
fn require_slot(existing: &Event, slot_text: &str) -> Result<NaiveDateTime, CommandError> {
    let rule = existing.recurrence.as_ref().ok_or_else(|| {
        CommandError::validation("occurrenceStartAt", "该日程不是重复日程。")
    })?;
    let slot = parse_local(slot_text, "occurrenceStartAt")?;
    if recurrence::slot_exists(&series_of(existing, rule)?, slot) {
        Ok(slot)
    } else {
        Err(CommandError::validation(
            "occurrenceStartAt",
            "该实例不属于此重复日程。",
        ))
    }
}

fn sql_write_error(error: rusqlite::Error) -> CommandError {    match &error {
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
    let (freq, interval, by_day, until, count, final_at) = recurrence_columns(&draft)?;
    transaction
        .execute(
            "INSERT INTO events(id,title,start_at,end_at,all_day,category,color,linked_task_id,note,
                                created_at,updated_at,recurrence_freq,recurrence_interval,
                                recurrence_by_day,recurrence_until,recurrence_count,recurrence_final_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,NULL,?8,?9,?9,?10,?11,?12,?13,?14,?15)",
            params![id, draft.title, draft.start_at, draft.end_at, i64::from(draft.all_day),
                    draft.category, draft.color, draft.note, now,
                    freq, interval, by_day, until, count, final_at],
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
    target: &EventTarget,
    draft: EventDraft,
    scope: EditScope,
) -> Result<(), CommandError> {
    if target.occurrence_start_at.is_none() && scope != EditScope::All {
        return Err(CommandError::validation("scope", "单次日程只能整体编辑。"));
    }
    // 「仅此次」写出的是覆盖行，行内不含重复列；带着规则做归一化会触发 R1，
    // 把改期后的开始时间挪回规则允许的星期，用户的改动就此丢失。
    let draft = if scope == EditScope::Occurrence {
        validate_and_normalize(EventDraft {
            recurrence: None,
            ..draft
        })?
    } else {
        validate_and_normalize(draft)?
    };
    let now = timestamp();
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(CommandError::database)?;

    let existing = event_by_id(&transaction, &target.id)?
        .ok_or_else(|| CommandError::not_found("未找到该日程。"))?;
    // 槽位校验先于任何写入：非法槽位既不得写出孤儿例外行，也不得拆分系列。
    let occurrence = match target.occurrence_start_at.as_deref() {
        Some(slot_text) => Some((slot_text, require_slot(&existing, slot_text)?)),
        None => None,
    };

    match (scope, occurrence) {
        (EditScope::All, _) => {
            relink(
                &transaction,
                &target.id,
                existing.linked_task_id.as_deref(),
                draft.linked_task_id.as_deref(),
                &now,
            )?;
            // 跨列一致性 CHECK 在 UPDATE 时重新求值整行，重复列必须一次写成一致状态。
            let (freq, interval, by_day, until, count, final_at) = recurrence_columns(&draft)?;
            transaction
                .execute(
                    "UPDATE events SET title=?2,start_at=?3,end_at=?4,all_day=?5,category=?6,color=?7,
                     linked_task_id=?8,note=?9,updated_at=?10,recurrence_freq=?11,recurrence_interval=?12,
                     recurrence_by_day=?13,recurrence_until=?14,recurrence_count=?15,recurrence_final_at=?16
                     WHERE id=?1",
                    params![target.id, draft.title, draft.start_at, draft.end_at,
                            i64::from(draft.all_day), draft.category, draft.color,
                            draft.linked_task_id, draft.note, now,
                            freq, interval, by_day, until, count, final_at],
                )
                .map_err(sql_write_error)?;
            if !slots_unchanged(
                &existing.start_at,
                &existing.recurrence,
                &draft.start_at,
                &draft.recurrence,
            ) {
                event_exceptions::delete_all(&transaction, &target.id)?;
            }
        }
        (EditScope::Occurrence, Some((slot_text, _))) => {
            // 不做冲突检测：把这一次挪到本就有实例的日子，两个实例并存是允许的结果。
            event_exceptions::upsert_overridden(
                &transaction,
                &target.id,
                slot_text,
                &event_exceptions::OverrideFields {
                    title: draft.title.clone(),
                    start_at: draft.start_at.clone(),
                    end_at: draft.end_at.clone(),
                    all_day: draft.all_day,
                    category: draft.category.clone(),
                    color: draft.color.clone(),
                    note: draft.note.clone(),
                },
                &now,
            )?;
        }
        (EditScope::ThisAndFollowing, Some((slot_text, slot))) => {
            if slot == parse_local(&existing.start_at, "startAt")? {
                // 首个实例即拆分点，等价于「全部」编辑；继续拆分会把原系列截成空系列。
                drop(transaction);
                return update(
                    connection,
                    &EventTarget {
                        id: target.id.clone(),
                        occurrence_start_at: None,
                    },
                    draft,
                    EditScope::All,
                );
            }
            let old_end = existing
                .recurrence
                .as_ref()
                .ok_or_else(|| {
                    CommandError::validation("occurrenceStartAt", "该日程不是重复日程。")
                })?
                .end
                .clone();
            // 用户在弹窗里改了结束条件时，新系列必须采用提交值：承接会把「永不结束改成共 3 次」
            // 静默丢弃，既不生效也不报错。原系列的截断不受影响，仍由原结束条件决定。
            let edited_end = draft
                .recurrence
                .as_ref()
                .map(|rule| rule.end.clone())
                .filter(|end| *end != old_end);

            // 结束条件承接：Count 在两段之间守恒，Never / Until 原样交给新系列。
            let carried_end = match &old_end {
                recurrence::RecurrenceEnd::Count { count } => {
                    let consumed = occurrences_before(&existing, slot)?;
                    let remaining = count
                        .checked_sub(consumed)
                        .filter(|value| *value > 0)
                        .ok_or_else(|| {
                            CommandError::validation("occurrenceStartAt", "该实例不属于此重复日程。")
                        })?;
                    rewrite_end(
                        &transaction,
                        &existing,
                        recurrence::RecurrenceEnd::Count { count: consumed },
                        &now,
                    )?;
                    recurrence::RecurrenceEnd::Count { count: remaining }
                }
                other => {
                    truncate_before(&transaction, &existing, slot, &now)?;
                    other.clone()
                }
            };
            let new_end = edited_end.unwrap_or(carried_end);

            let mut new_draft = draft;
            // 关联任务留在原系列：搬移要在两个唯一索引下做双向写，中间态易冲突。
            new_draft.linked_task_id = None;
            if let Some(rule) = new_draft.recurrence.as_mut() {
                rule.end = new_end;
            }

            let new_id = Uuid::new_v4().hyphenated().to_string();
            let (freq, interval, by_day, until, count, final_at) = recurrence_columns(&new_draft)?;
            transaction
                .execute(
                    "INSERT INTO events(id,title,start_at,end_at,all_day,category,color,linked_task_id,note,
                                        created_at,updated_at,recurrence_freq,recurrence_interval,
                                        recurrence_by_day,recurrence_until,recurrence_count,recurrence_final_at)
                     VALUES (?1,?2,?3,?4,?5,?6,?7,NULL,?8,?9,?9,?10,?11,?12,?13,?14,?15)",
                    params![new_id, new_draft.title, new_draft.start_at, new_draft.end_at,
                            i64::from(new_draft.all_day), new_draft.category, new_draft.color,
                            new_draft.note, now, freq, interval, by_day, until, count, final_at],
                )
                .map_err(sql_write_error)?;

            if slots_continue(&existing, &new_draft, slot)? {
                event_exceptions::move_from(&transaction, &target.id, slot_text, &new_id)?;
            } else {
                // 序列已错位，这些身份键在新系列上永不命中，留存即为幽灵行。
                event_exceptions::delete_from(&transaction, &target.id, slot_text)?;
            }
        }
        // 顶部守卫已排除「无实例目标 + 非 All」的组合。
        (EditScope::Occurrence | EditScope::ThisAndFollowing, None) => {
            return Err(CommandError::validation("scope", "单次日程只能整体编辑。"));
        }
    }

    transaction.commit().map_err(sql_write_error)
}

/// 该系列在 `slot` 之前已经产生的实例数，用于 Count 系列的守恒拆分。
/// `slot` 必须已通过 `require_slot`：游标因此必然走到它并终止，无限系列亦然。
fn occurrences_before(existing: &Event, slot: NaiveDateTime) -> Result<u32, CommandError> {
    let rule = existing.recurrence.as_ref().ok_or_else(|| {
        CommandError::validation("occurrenceStartAt", "该日程不是重复日程。")
    })?;
    let series = series_of(existing, rule)?;
    let consumed = recurrence::OccurrenceCursor::new(&series, None)
        .take_while(|value| *value < slot)
        .count();
    u32::try_from(consumed)
        .map_err(|_| CommandError::validation("recurrence", "重复次数过多，请减少次数。"))
}

/// 把系列的结束条件整体改写为 `end` 并重算 `recurrence_final_at`。
/// 三个结束条件列受同一条跨列 CHECK 约束，UPDATE 时整行重新求值，
/// 因此必须在同一条语句里写成一致状态。
fn rewrite_end(
    transaction: &Transaction<'_>,
    existing: &Event,
    end: recurrence::RecurrenceEnd,
    now: &str,
) -> Result<(), CommandError> {
    let Some(rule) = existing.recurrence.as_ref() else {
        return Err(CommandError::validation(
            "occurrenceStartAt",
            "该日程不是重复日程。",
        ));
    };
    let rewritten = Recurrence {
        end,
        ..rule.clone()
    };
    let dtstart = parse_local(&existing.start_at, "startAt")?;
    let normalized = recurrence::normalize(&rewritten, dtstart)?;
    let (until, count) = recurrence::end_to_columns(&normalized.rule.end);
    transaction
        .execute(
            "UPDATE events SET recurrence_until=?2,recurrence_count=?3,recurrence_final_at=?4,
             updated_at=?5 WHERE id=?1",
            params![
                existing.id,
                until,
                count,
                normalized
                    .final_at
                    .map(|value| value.format(LOCAL_MINUTE_FORMAT).to_string()),
                now
            ],
        )
        .map_err(sql_write_error)?;
    Ok(())
}

/// 把结束条件截断到该槽位之前。本规则模型下每个日期至多产生一个槽位，
/// 因此日期粒度的 `until` 足以精确切在该次之前。
fn truncate_before(
    transaction: &Transaction<'_>,
    existing: &Event,
    slot: NaiveDateTime,
    now: &str,
) -> Result<(), CommandError> {
    let until = (slot.date() - Duration::days(1))
        .format("%Y-%m-%d")
        .to_string();
    rewrite_end(
        transaction,
        existing,
        recurrence::RecurrenceEnd::Until { date: until },
        now,
    )
}

/// 删除整行日程并解除与任务的双向关联。例外行由外键 CASCADE 清理。
fn delete_series(transaction: &Transaction<'_>, id: &str, now: &str) -> Result<(), CommandError> {
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
    Ok(())
}

pub fn delete(
    connection: &mut Connection,
    target: &EventTarget,
    scope: EditScope,
) -> Result<(), CommandError> {
    if target.occurrence_start_at.is_none() && scope != EditScope::All {
        return Err(CommandError::validation("scope", "单次日程只能整体删除。"));
    }
    let now = timestamp();
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(CommandError::database)?;

    // 槽位校验先于任何写入：非法槽位既不得写出孤儿例外行，也不得截断系列。
    let occurrence = match target.occurrence_start_at.as_deref() {
        Some(slot_text) => {
            let existing = event_by_id(&transaction, &target.id)?
                .ok_or_else(|| CommandError::not_found("未找到该日程。"))?;
            let slot = require_slot(&existing, slot_text)?;
            Some((existing, slot_text, slot))
        }
        None => None,
    };

    match (scope, occurrence) {
        (EditScope::All, _) => delete_series(&transaction, &target.id, &now)?,
        (EditScope::Occurrence, Some((_, slot_text, _))) => {
            event_exceptions::upsert_excluded(&transaction, &target.id, slot_text, &now)?;
        }
        (EditScope::ThisAndFollowing, Some((existing, slot_text, slot))) => {
            if slot == parse_local(&existing.start_at, "startAt")? {
                // 目标是首个实例，等价于整体删除，否则会留下永远展开不出实例的空系列。
                delete_series(&transaction, &target.id, &now)?;
            } else {
                truncate_before(&transaction, &existing, slot, &now)?;
                // 截断后落在该次及之后的例外行再也匹配不到真实槽位，留存即为幽灵实例。
                event_exceptions::delete_from(&transaction, &target.id, slot_text)?;
            }
        }
        // 顶部守卫已排除「无实例目标 + 非 All」的组合。
        (EditScope::Occurrence | EditScope::ThisAndFollowing, None) => {
            return Err(CommandError::validation("scope", "单次日程只能整体删除。"));
        }
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
    // 命令契约的三选一改造属于 Task 12，此处先按整体编辑转发，保持前端行为不变。
    let target = EventTarget {
        id,
        occurrence_start_at: None,
    };
    update(&mut connection, &target, draft, EditScope::All)?;
    event_by_id(&connection, &target.id)?.ok_or_else(|| CommandError::not_found("未找到该日程。"))
}

#[tauri::command]
pub fn delete_event(db: State<'_, AppDb>, id: String) -> Result<(), CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    // 命令契约的三选一改造属于 Task 12，此处先按整体删除转发，保持前端行为不变。
    let target = EventTarget {
        id,
        occurrence_start_at: None,
    };
    delete(&mut connection, &target, EditScope::All)
}

#[cfg(test)]
mod tests {
    use super::{create, delete, event_by_id, list_in_range, update, validate_and_normalize};
    use crate::db::migrate;
    use crate::event_exceptions::{upsert_excluded, upsert_overridden, OverrideFields};
    use crate::models::{EditScope, Event, EventDraft, EventRange, EventTarget};
    use crate::recurrence::{Freq, Recurrence, RecurrenceEnd};
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

    fn whole(id: &str) -> EventTarget {
        EventTarget {
            id: id.into(),
            occurrence_start_at: None,
        }
    }

    fn at(id: &str, slot: &str) -> EventTarget {
        EventTarget {
            id: id.into(),
            occurrence_start_at: Some(slot.into()),
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

        update(&mut connection, &whole(&created.id), EventDraft {
            title: "复盘".into(), color: "#F06445".into(), ..draft()
        }, EditScope::All).unwrap();
        let updated = event_by_id(&connection, &created.id).unwrap().unwrap();
        assert_eq!(updated.title, "复盘");
        assert_eq!(updated.created_at, created.created_at);
        assert!(updated.updated_at >= created.updated_at);

        delete(&mut connection, &whole(&created.id), EditScope::All).unwrap();
        assert_eq!(update(&mut connection, &whole(&created.id), draft(), EditScope::All).unwrap_err().code, "not_found");
        assert_eq!(delete(&mut connection, &whole(&created.id), EditScope::All).unwrap_err().code, "not_found");
    }

    #[test]
    fn relinking_is_bidirectional_and_delete_keeps_the_task() {
        let mut connection = database();
        insert_task(&connection, "t1");
        insert_task(&connection, "t2");
        let first = create(&mut connection, EventDraft { linked_task_id: Some("t1".into()), ..draft() }).unwrap();
        let second = create(&mut connection, EventDraft { linked_task_id: Some("t2".into()), ..draft() }).unwrap();

        update(&mut connection, &whole(&second.id), EventDraft { linked_task_id: Some("t1".into()), ..draft() }, EditScope::All).unwrap();
        assert_eq!(event_link(&connection, &first.id), None);
        assert_eq!(event_link(&connection, &second.id).as_deref(), Some("t1"));
        assert_eq!(task_link(&connection, "t1").as_deref(), Some(second.id.as_str()));
        assert_eq!(task_link(&connection, "t2"), None);

        delete(&mut connection, &whole(&second.id), EditScope::All).unwrap();
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
    fn updating_all_keeps_the_series_shape_when_the_rule_is_resubmitted() {
        let mut connection = seeded();
        update(
            &mut connection,
            &at("s1", "2026-08-03T10:00"),
            EventDraft {
                title: "周会（改名）".into(),
                start_at: "2026-08-03T10:00".into(),
                end_at: "2026-08-03T11:00".into(),
                all_day: false,
                category: "work".into(),
                color: "#0BB783".into(),
                linked_task_id: None,
                note: String::new(),
                recurrence: Some(weekly(&["MO"], RecurrenceEnd::Never)),
            },
            EditScope::All,
        )
        .expect("update runs");
        let updated = event_by_id(&connection, "s1")
            .expect("query runs")
            .expect("series present");
        assert_eq!(updated.title, "周会（改名）");
        assert_eq!(
            updated.recurrence.as_ref().expect("rule survives update").freq,
            Freq::Weekly
        );
        assert_eq!(updated.series_id.as_deref(), Some("s1"));
        assert_eq!(updated.occurrence_start_at.as_deref(), Some("2026-08-03T10:00"));
        assert_eq!(august(&connection).len(), 5);
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

    fn draft_with(
        title: &str,
        start: &str,
        end: &str,
        recurrence: Option<Recurrence>,
    ) -> EventDraft {
        EventDraft {
            title: title.into(),
            start_at: start.into(),
            end_at: end.into(),
            all_day: false,
            category: "work".into(),
            color: "#0BB783".into(),
            linked_task_id: None,
            note: String::new(),
            recurrence,
        }
    }

    fn weekly(days: &[&str], end: RecurrenceEnd) -> Recurrence {
        Recurrence {
            freq: Freq::Weekly,
            interval: 1,
            by_day: days.iter().map(|value| (*value).to_string()).collect(),
            end,
        }
    }

    /// 直接回读重复列，用于区分「返回值对」与「真的写进库了」。
    type RecurrenceColumns = (
        Option<String>,
        i64,
        String,
        Option<String>,
        Option<i64>,
        Option<String>,
    );

    fn recurrence_columns_of(connection: &Connection, id: &str) -> RecurrenceColumns {
        connection
            .query_row(
                "SELECT recurrence_freq,recurrence_interval,recurrence_by_day,
                        recurrence_until,recurrence_count,recurrence_final_at
                 FROM events WHERE id=?1",
                [id],
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
            .expect("recurrence columns read")
    }

    fn stored_bounds(connection: &Connection, id: &str) -> (String, String) {
        connection
            .query_row(
                "SELECT start_at,end_at FROM events WHERE id=?1",
                [id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("bounds read")
    }

    fn exception_count(connection: &Connection, series_id: &str) -> i64 {
        connection
            .query_row(
                "SELECT COUNT(*) FROM event_exceptions WHERE series_id=?1",
                [series_id],
                |row| row.get(0),
            )
            .expect("count runs")
    }

    fn stored_title(connection: &Connection, id: &str) -> String {
        connection
            .query_row("SELECT title FROM events WHERE id=?1", [id], |row| {
                row.get(0)
            })
            .expect("title reads")
    }

    #[test]
    fn create_aligns_the_start_date_onto_the_rule() {
        let mut connection = database();
        // 2026-08-05 是周三，规则只含周一与周五 → 顺延到 8/7
        let created = create(
            &mut connection,
            draft_with(
                "健身",
                "2026-08-05T07:00",
                "2026-08-05T08:00",
                Some(weekly(&["MO", "FR"], RecurrenceEnd::Never)),
            ),
        )
        .expect("create runs");
        assert_eq!(created.start_at, "2026-08-07T07:00");
        assert_eq!(created.end_at, "2026-08-07T08:00");
        // 顺延必须落在库里，而不只是返回值上
        assert_eq!(
            stored_bounds(&connection, &created.id),
            ("2026-08-07T07:00".to_string(), "2026-08-07T08:00".to_string())
        );
        let (freq, interval, by_day, until, count, final_at) =
            recurrence_columns_of(&connection, &created.id);
        assert_eq!(freq.as_deref(), Some("weekly"));
        assert_eq!(interval, 1);
        assert_eq!(by_day, "MO,FR");
        assert_eq!(until, None);
        assert_eq!(count, None);
        assert_eq!(final_at, None);
    }

    #[test]
    fn create_stores_final_at_for_a_counted_series() {
        let mut connection = database();
        let created = create(
            &mut connection,
            draft_with(
                "复盘",
                "2026-08-03T19:00",
                "2026-08-03T20:00",
                Some(weekly(&["MO"], RecurrenceEnd::Count { count: 3 })),
            ),
        )
        .expect("create runs");
        let (freq, _, _, until, count, final_at) = recurrence_columns_of(&connection, &created.id);
        assert_eq!(freq.as_deref(), Some("weekly"));
        assert_eq!(until, None);
        assert_eq!(count, Some(3));
        assert_eq!(final_at.as_deref(), Some("2026-08-17T19:00"));
        assert_eq!(
            starts(&august(&connection)),
            vec!["2026-08-03T19:00", "2026-08-10T19:00", "2026-08-17T19:00"]
        );
    }

    #[test]
    fn create_leaves_the_recurrence_columns_empty_for_a_single_event() {
        let mut connection = database();
        let created = create(&mut connection, draft()).expect("create runs");
        assert_eq!(
            recurrence_columns_of(&connection, &created.id),
            (None, 1, String::new(), None, None, None)
        );
    }

    #[test]
    fn updating_all_keeps_exceptions_when_the_start_and_rule_are_unchanged() {
        let mut connection = seeded();
        upsert_excluded(&connection, "s1", "2026-08-10T10:00", "t").expect("exclude");
        update(
            &mut connection,
            &at("s1", "2026-08-03T10:00"),
            draft_with(
                "周会（改名）",
                "2026-08-03T10:00",
                "2026-08-03T11:00",
                Some(weekly(&["MO"], RecurrenceEnd::Never)),
            ),
            EditScope::All,
        )
        .expect("update runs");
        assert_eq!(exception_count(&connection, "s1"), 1);
        assert_eq!(august(&connection).len(), 4);
    }

    #[test]
    fn updating_all_clears_exceptions_when_the_start_date_moves() {
        let mut connection = seeded();
        upsert_excluded(&connection, "s1", "2026-08-10T10:00", "t").expect("exclude");
        update(
            &mut connection,
            &at("s1", "2026-08-03T10:00"),
            draft_with(
                "周会",
                "2026-08-10T10:00",
                "2026-08-10T11:00",
                Some(weekly(&["MO"], RecurrenceEnd::Never)),
            ),
            EditScope::All,
        )
        .expect("update runs");
        assert_eq!(exception_count(&connection, "s1"), 0);
        assert_eq!(
            starts(&august(&connection)),
            vec!["2026-08-10T10:00", "2026-08-17T10:00", "2026-08-24T10:00", "2026-08-31T10:00"]
        );
    }

    #[test]
    fn updating_all_clears_exceptions_when_only_the_time_of_day_moves() {
        let mut connection = seeded();
        upsert_excluded(&connection, "s1", "2026-08-10T10:00", "t").expect("exclude");
        update(
            &mut connection,
            &at("s1", "2026-08-03T10:00"),
            draft_with(
                "周会",
                "2026-08-03T15:00",
                "2026-08-03T16:00",
                Some(weekly(&["MO"], RecurrenceEnd::Never)),
            ),
            EditScope::All,
        )
        .expect("update runs");
        assert_eq!(exception_count(&connection, "s1"), 0);
        // 旧例外若残留会按 10:00 的身份键落空，实例数必须回到 5
        assert_eq!(august(&connection).len(), 5);
    }

    #[test]
    fn updating_all_clears_exceptions_when_only_the_rule_changes() {
        let mut connection = seeded();
        upsert_excluded(&connection, "s1", "2026-08-10T10:00", "t").expect("exclude");
        update(
            &mut connection,
            &at("s1", "2026-08-03T10:00"),
            draft_with(
                "周会",
                "2026-08-03T10:00",
                "2026-08-03T11:00",
                Some(weekly(&["MO", "WE"], RecurrenceEnd::Never)),
            ),
            EditScope::All,
        )
        .expect("update runs");
        assert_eq!(exception_count(&connection, "s1"), 0);
        assert_eq!(recurrence_columns_of(&connection, "s1").2, "MO,WE");
        // 8/10 若仍被排除，周一那次会缺失
        assert!(starts(&august(&connection)).contains(&"2026-08-10T10:00"));
    }

    #[test]
    fn updating_all_rewrites_the_end_condition_in_one_statement() {
        let mut connection = seeded();
        update(
            &mut connection,
            &at("s1", "2026-08-03T10:00"),
            draft_with(
                "周会",
                "2026-08-03T10:00",
                "2026-08-03T11:00",
                Some(weekly(
                    &["MO"],
                    RecurrenceEnd::Until {
                        date: "2026-08-17".into(),
                    },
                )),
            ),
            EditScope::All,
        )
        .expect("until update runs");
        let (_, _, _, until, count, final_at) = recurrence_columns_of(&connection, "s1");
        assert_eq!(until.as_deref(), Some("2026-08-17"));
        assert_eq!(count, None);
        assert_eq!(final_at.as_deref(), Some("2026-08-17T10:00"));
        assert_eq!(august(&connection).len(), 3);

        // until → count 是跨列 CHECK 最容易被中间态卡住的一步
        update(
            &mut connection,
            &at("s1", "2026-08-03T10:00"),
            draft_with(
                "周会",
                "2026-08-03T10:00",
                "2026-08-03T11:00",
                Some(weekly(&["MO"], RecurrenceEnd::Count { count: 2 })),
            ),
            EditScope::All,
        )
        .expect("count update runs");
        let (_, _, _, until, count, final_at) = recurrence_columns_of(&connection, "s1");
        assert_eq!(until, None);
        assert_eq!(count, Some(2));
        assert_eq!(final_at.as_deref(), Some("2026-08-10T10:00"));
        assert_eq!(august(&connection).len(), 2);
    }

    #[test]
    fn updating_all_can_turn_a_series_into_a_single_event() {
        let mut connection = seeded();
        upsert_excluded(&connection, "s1", "2026-08-10T10:00", "t").expect("exclude");
        update(
            &mut connection,
            &at("s1", "2026-08-03T10:00"),
            draft_with("只此一次", "2026-08-03T10:00", "2026-08-03T11:00", None),
            EditScope::All,
        )
        .expect("update runs");
        assert_eq!(
            recurrence_columns_of(&connection, "s1"),
            (None, 1, String::new(), None, None, None)
        );
        assert_eq!(exception_count(&connection, "s1"), 0);
        assert_eq!(starts(&august(&connection)), vec!["2026-08-03T10:00"]);
    }

    #[test]
    fn updating_all_rejects_a_slot_the_series_never_produces() {
        let mut connection = seeded();
        upsert_excluded(&connection, "s1", "2026-08-10T10:00", "t").expect("exclude");
        // 2026-08-04 是周二，2026-08-03T11:00 是对的日子、错的时刻
        for slot in ["2026-08-04T10:00", "2026-08-03T11:00"] {
            let error = update(
                &mut connection,
                &at("s1", slot),
                draft_with(
                    "偷改",
                    "2026-08-03T10:00",
                    "2026-08-03T11:00",
                    Some(weekly(&["MO"], RecurrenceEnd::Never)),
                ),
                EditScope::All,
            )
            .expect_err("slot must be rejected");
            assert_eq!(error.code, "validation_error");
            assert_eq!(error.field.as_deref(), Some("occurrenceStartAt"));
        }
        // 拒绝路径不得留下任何痕迹：例外仍在，系列行未被改写
        assert_eq!(exception_count(&connection, "s1"), 1);
        assert_eq!(stored_title(&connection, "s1"), "周会");
        assert_eq!(august(&connection).len(), 4);
    }

    #[test]
    fn updating_all_rejects_an_occurrence_target_on_a_single_event() {
        let mut connection = database();
        let created = create(&mut connection, draft()).expect("create runs");
        let error = update(
            &mut connection,
            &at(&created.id, "2026-07-23T14:00"),
            draft(),
            EditScope::All,
        )
        .expect_err("target must be rejected");
        assert_eq!(error.code, "validation_error");
        assert_eq!(error.field.as_deref(), Some("occurrenceStartAt"));
    }

    #[test]
    fn rejects_a_scope_other_than_all_for_single_events() {
        let mut connection = seeded();
        let error = update(
            &mut connection,
            &whole("s1"),
            draft_with("周会", "2026-08-03T10:00", "2026-08-03T11:00", None),
            EditScope::Occurrence,
        )
        .expect_err("scope must be rejected");
        assert_eq!(error.code, "validation_error");
    }

    #[test]
    fn updating_a_single_event_leaves_the_recurrence_columns_empty() {
        let mut connection = database();
        insert_task(&connection, "t1");
        let created = create(&mut connection, draft()).expect("create runs");
        update(
            &mut connection,
            &whole(&created.id),
            EventDraft {
                title: "复盘".into(),
                start_at: "2026-07-24T09:00".into(),
                end_at: "2026-07-24T10:00".into(),
                linked_task_id: Some("t1".into()),
                ..draft()
            },
            EditScope::All,
        )
        .expect("update runs");
        let updated = event_by_id(&connection, &created.id)
            .expect("query runs")
            .expect("event present");
        assert_eq!(updated.title, "复盘");
        assert_eq!(updated.start_at, "2026-07-24T09:00");
        assert_eq!(updated.linked_task_id.as_deref(), Some("t1"));
        assert!(updated.recurrence.is_none());
        assert!(updated.series_id.is_none());
        assert!(updated.occurrence_start_at.is_none());
        assert_eq!(
            recurrence_columns_of(&connection, &created.id),
            (None, 1, String::new(), None, None, None)
        );
        assert_eq!(task_link(&connection, "t1").as_deref(), Some(created.id.as_str()));
    }

    fn window(connection: &Connection, start: &str, end_exclusive: &str) -> Vec<Event> {
        list_in_range(
            connection,
            &EventRange {
                start_at: start.into(),
                end_at_exclusive: end_exclusive.into(),
            },
        )
        .expect("range query runs")
    }

    /// 例外行的槽位与类型，按槽位升序。用于区分「实例不见了」与「库里真的干净」。
    fn exception_rows(connection: &Connection, series_id: &str) -> Vec<(String, String)> {
        let mut statement = connection
            .prepare(
                "SELECT occurrence_start_at,kind FROM event_exceptions
                 WHERE series_id=?1 ORDER BY occurrence_start_at",
            )
            .expect("statement prepares");
        let rows = statement
            .query_map([series_id], |row| Ok((row.get(0)?, row.get(1)?)))
            .expect("query runs");
        rows.map(|row| row.expect("row reads")).collect()
    }

    fn event_row_count(connection: &Connection, id: &str) -> i64 {
        connection
            .query_row("SELECT COUNT(*) FROM events WHERE id=?1", [id], |row| {
                row.get(0)
            })
            .expect("count runs")
    }

    fn stored_updated_at(connection: &Connection, id: &str) -> String {
        connection
            .query_row("SELECT updated_at FROM events WHERE id=?1", [id], |row| {
                row.get(0)
            })
            .expect("updated_at reads")
    }

    fn task_updated_at(connection: &Connection, id: &str) -> String {
        connection
            .query_row("SELECT updated_at FROM tasks WHERE id=?1", [id], |row| {
                row.get(0)
            })
            .expect("updated_at reads")
    }

    fn weekly_columns() -> RecurrenceColumns {
        (
            Some("weekly".to_string()),
            1,
            "MO".to_string(),
            None,
            None,
            None,
        )
    }

    #[test]
    fn deleting_one_occurrence_only_adds_an_exclusion() {
        let mut connection = seeded();
        delete(
            &mut connection,
            &at("s1", "2026-08-10T10:00"),
            EditScope::Occurrence,
        )
        .expect("delete runs");
        assert_eq!(
            starts(&august(&connection)),
            vec![
                "2026-08-03T10:00",
                "2026-08-17T10:00",
                "2026-08-24T10:00",
                "2026-08-31T10:00"
            ]
        );
        assert_eq!(
            exception_rows(&connection, "s1"),
            vec![("2026-08-10T10:00".to_string(), "excluded".to_string())]
        );
        // 「仅此次」只写例外，系列行必须原封不动
        assert_eq!(recurrence_columns_of(&connection, "s1"), weekly_columns());
        assert_eq!(
            stored_bounds(&connection, "s1"),
            (
                "2026-08-03T10:00".to_string(),
                "2026-08-03T11:00".to_string()
            )
        );
        assert_eq!(stored_title(&connection, "s1"), "周会");
        assert_eq!(stored_updated_at(&connection, "s1"), "t");
    }

    #[test]
    fn deleting_one_occurrence_replaces_an_existing_override() {
        let mut connection = seeded();
        upsert_overridden(
            &connection,
            "s1",
            "2026-08-10T10:00",
            &override_fields("改期", "2026-08-11T14:00", "2026-08-11T15:00"),
            "t",
        )
        .expect("override");
        delete(
            &mut connection,
            &at("s1", "2026-08-10T10:00"),
            EditScope::Occurrence,
        )
        .expect("delete runs");
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
        // 覆盖行必须被就地改写，否则被挪走的那次仍会显示
        assert!(events.iter().all(|event| event.title != "改期"));
        assert_eq!(
            exception_rows(&connection, "s1"),
            vec![("2026-08-10T10:00".to_string(), "excluded".to_string())]
        );
    }

    #[test]
    fn deleting_this_and_following_truncates_the_end_condition() {
        let mut connection = seeded();
        delete(
            &mut connection,
            &at("s1", "2026-08-17T10:00"),
            EditScope::ThisAndFollowing,
        )
        .expect("delete runs");
        assert_eq!(
            starts(&august(&connection)),
            vec!["2026-08-03T10:00", "2026-08-10T10:00"]
        );
        let (freq, interval, by_day, until, count, final_at) =
            recurrence_columns_of(&connection, "s1");
        assert_eq!(freq.as_deref(), Some("weekly"));
        assert_eq!(interval, 1);
        assert_eq!(by_day, "MO");
        assert_eq!(until.as_deref(), Some("2026-08-16"));
        assert_eq!(count, None);
        assert_eq!(final_at.as_deref(), Some("2026-08-10T10:00"));
        // 截断后的系列不得在任何更远的窗口里复活
        assert!(window(&connection, "2026-09-01T00:00", "2027-09-01T00:00").is_empty());
        assert_ne!(stored_updated_at(&connection, "s1"), "t");
    }

    #[test]
    fn deleting_this_and_following_clears_exceptions_at_or_after_the_cut() {
        let mut connection = seeded();
        upsert_overridden(
            &connection,
            "s1",
            "2026-08-10T10:00",
            &override_fields("保留", "2026-08-12T09:00", "2026-08-12T10:00"),
            "t",
        )
        .expect("override before the cut");
        upsert_excluded(&connection, "s1", "2026-08-17T10:00", "t").expect("exclude at the cut");
        upsert_overridden(
            &connection,
            "s1",
            "2026-08-24T10:00",
            &override_fields("近幽灵", "2026-08-25T09:00", "2026-08-25T10:00"),
            "t",
        )
        .expect("override after the cut");
        upsert_overridden(
            &connection,
            "s1",
            "2026-08-31T10:00",
            &override_fields("远幽灵", "2026-12-05T09:00", "2026-12-05T10:00"),
            "t",
        )
        .expect("override moving out of august");

        delete(
            &mut connection,
            &at("s1", "2026-08-17T10:00"),
            EditScope::ThisAndFollowing,
        )
        .expect("delete runs");

        // 截断点之前的覆盖仍然有效；之后的覆盖不得作为幽灵实例残留
        assert_eq!(
            starts(&august(&connection)),
            vec!["2026-08-03T10:00", "2026-08-12T09:00"]
        );
        assert!(window(&connection, "2026-12-01T00:00", "2027-01-01T00:00").is_empty());
        assert_eq!(
            exception_rows(&connection, "s1"),
            vec![("2026-08-10T10:00".to_string(), "overridden".to_string())]
        );
    }

    #[test]
    fn deleting_this_and_following_cuts_a_daily_series_at_the_previous_day() {
        let mut connection = database();
        let created = create(
            &mut connection,
            draft_with(
                "站会",
                "2026-08-03T09:00",
                "2026-08-03T09:15",
                Some(Recurrence {
                    freq: Freq::Daily,
                    interval: 1,
                    by_day: Vec::new(),
                    end: RecurrenceEnd::Until {
                        date: "2026-08-07".into(),
                    },
                }),
            ),
        )
        .expect("create runs");
        assert_eq!(august(&connection).len(), 5);

        // 相邻槽位是「少减一天」最容易露馅的地方
        delete(
            &mut connection,
            &at(&created.id, "2026-08-05T09:00"),
            EditScope::ThisAndFollowing,
        )
        .expect("delete runs");
        let (_, _, _, until, count, final_at) = recurrence_columns_of(&connection, &created.id);
        assert_eq!(until.as_deref(), Some("2026-08-04"));
        assert_eq!(count, None);
        assert_eq!(final_at.as_deref(), Some("2026-08-04T09:00"));
        assert_eq!(
            starts(&august(&connection)),
            vec!["2026-08-03T09:00", "2026-08-04T09:00"]
        );
    }

    #[test]
    fn deleting_this_and_following_clears_a_counted_end_condition() {
        let mut connection = database();
        let created = create(
            &mut connection,
            draft_with(
                "复盘",
                "2026-08-03T19:00",
                "2026-08-03T20:00",
                Some(weekly(&["MO"], RecurrenceEnd::Count { count: 3 })),
            ),
        )
        .expect("create runs");
        // 删的是最后一次：count 必须与 until 在同一条 UPDATE 里清空，否则跨列 CHECK 会拒绝
        delete(
            &mut connection,
            &at(&created.id, "2026-08-17T19:00"),
            EditScope::ThisAndFollowing,
        )
        .expect("delete runs");
        let (_, _, _, until, count, final_at) = recurrence_columns_of(&connection, &created.id);
        assert_eq!(until.as_deref(), Some("2026-08-16"));
        assert_eq!(count, None);
        assert_eq!(final_at.as_deref(), Some("2026-08-10T19:00"));
        assert_eq!(
            starts(&august(&connection)),
            vec!["2026-08-03T19:00", "2026-08-10T19:00"]
        );
    }

    #[test]
    fn deleting_this_and_following_at_the_first_slot_removes_the_series() {
        let mut connection = seeded();
        upsert_excluded(&connection, "s1", "2026-08-10T10:00", "t").expect("exclude");
        delete(
            &mut connection,
            &at("s1", "2026-08-03T10:00"),
            EditScope::ThisAndFollowing,
        )
        .expect("delete runs");
        // 首次的「此后所有」等价于「全部」，不得留下展开不出实例的空系列
        assert!(august(&connection).is_empty());
        assert_eq!(event_row_count(&connection, "s1"), 0);
        assert_eq!(exception_count(&connection, "s1"), 0);
    }

    #[test]
    fn deleting_all_removes_the_series_and_its_exceptions() {
        let mut connection = seeded();
        upsert_excluded(&connection, "s1", "2026-08-10T10:00", "t").expect("exclude");
        upsert_overridden(
            &connection,
            "s1",
            "2026-08-17T10:00",
            &override_fields("改期", "2026-08-18T09:00", "2026-08-18T10:00"),
            "t",
        )
        .expect("override");
        delete(
            &mut connection,
            &at("s1", "2026-08-10T10:00"),
            EditScope::All,
        )
        .expect("delete runs");
        assert!(august(&connection).is_empty());
        assert_eq!(event_row_count(&connection, "s1"), 0);
        assert_eq!(exception_count(&connection, "s1"), 0);
        assert_eq!(
            delete(&mut connection, &whole("s1"), EditScope::All)
                .expect_err("second delete fails")
                .code,
            "not_found"
        );
    }

    #[test]
    fn deleting_all_unlinks_the_task_from_a_series() {
        let mut connection = database();
        insert_task(&connection, "t1");
        let created = create(
            &mut connection,
            EventDraft {
                linked_task_id: Some("t1".into()),
                ..draft_with(
                    "周会",
                    "2026-08-03T10:00",
                    "2026-08-03T11:00",
                    Some(weekly(&["MO"], RecurrenceEnd::Never)),
                )
            },
        )
        .expect("create runs");
        upsert_excluded(&connection, &created.id, "2026-08-10T10:00", "t").expect("exclude");
        // tasks.linked_event_id 的外键是 ON DELETE SET NULL，它会替显式解除兜底置空，
        // 因此只有 updated_at 能区分「真的写了」与「靠外键蓙到的」。
        connection
            .execute("UPDATE tasks SET updated_at='sentinel' WHERE id='t1'", [])
            .expect("sentinel writes");
        delete(
            &mut connection,
            &at(&created.id, "2026-08-10T10:00"),
            EditScope::All,
        )
        .expect("delete runs");
        assert_eq!(task_link(&connection, "t1"), None);
        assert_ne!(task_updated_at(&connection, "t1"), "sentinel");
        assert_eq!(exception_count(&connection, &created.id), 0);
        assert_eq!(
            connection
                .query_row("SELECT COUNT(*) FROM tasks", [], |row| row.get::<_, i64>(0))
                .expect("count runs"),
            1
        );
    }

    #[test]
    fn deleting_rejects_a_slot_the_series_never_produces() {
        let mut connection = seeded();
        upsert_excluded(&connection, "s1", "2026-08-10T10:00", "t").expect("exclude");
        // 8/4 是周二；8/3T11:00 是对的日子、错的时刻；7/27 是周一但早于系列开始
        for scope in [
            EditScope::Occurrence,
            EditScope::ThisAndFollowing,
            EditScope::All,
        ] {
            for slot in ["2026-08-04T10:00", "2026-08-03T11:00", "2026-07-27T10:00"] {
                let error = delete(&mut connection, &at("s1", slot), scope)
                    .expect_err("slot must be rejected");
                assert_eq!(error.code, "validation_error");
                assert_eq!(error.field.as_deref(), Some("occurrenceStartAt"));
            }
        }
        // 拒绝路径不得留下脏数据
        assert_eq!(
            exception_rows(&connection, "s1"),
            vec![("2026-08-10T10:00".to_string(), "excluded".to_string())]
        );
        assert_eq!(recurrence_columns_of(&connection, "s1"), weekly_columns());
        assert_eq!(event_row_count(&connection, "s1"), 1);
        assert_eq!(august(&connection).len(), 4);
    }

    #[test]
    fn deleting_rejects_an_occurrence_scope_without_an_occurrence() {
        let mut connection = database();
        let created = create(&mut connection, draft()).expect("create runs");
        for scope in [EditScope::Occurrence, EditScope::ThisAndFollowing] {
            let error = delete(&mut connection, &whole(&created.id), scope)
                .expect_err("scope must be rejected");
            assert_eq!(error.code, "validation_error");
            assert_eq!(error.field.as_deref(), Some("scope"));
        }
        // 单次日程带实例目标同样非法
        let error = delete(
            &mut connection,
            &at(&created.id, "2026-07-23T14:00"),
            EditScope::All,
        )
        .expect_err("target must be rejected");
        assert_eq!(error.code, "validation_error");
        assert_eq!(error.field.as_deref(), Some("occurrenceStartAt"));
        assert_eq!(event_row_count(&connection, &created.id), 1);
    }

    fn total_events(connection: &Connection) -> i64 {
        connection
            .query_row("SELECT COUNT(*) FROM events", [], |row| row.get(0))
            .expect("count runs")
    }

    /// 拆分产生的新系列 id。仅用于库中恰好只有原系列与新系列两行的场景。
    fn other_series_id(connection: &Connection, original: &str) -> String {
        connection
            .query_row(
                "SELECT id FROM events WHERE id<>?1",
                [original],
                |row| row.get(0),
            )
            .expect("new series id reads")
    }

    /// 某个系列在一个远超测试关注范围的窗口内展开出的全部实例起始时刻。
    /// 只查单月窗口无法区分「次数守恒」与「次数被改小又被 until 兜住」。
    fn instances_of(connection: &Connection, id: &str) -> Vec<String> {
        window(connection, "2026-01-01T00:00", "2028-01-01T00:00")
            .into_iter()
            .filter(|event| event.id == id)
            .map(|event| event.start_at)
            .collect()
    }

    #[test]
    fn editing_one_occurrence_moves_only_that_instance() {
        let mut connection = seeded();
        // 8/11 是周二，规则只含周一：草稿若被 R1 对齐，改期会被挪回 8/17
        update(
            &mut connection,
            &at("s1", "2026-08-10T10:00"),
            draft_with(
                "改期周会",
                "2026-08-11T14:00",
                "2026-08-11T15:00",
                Some(weekly(&["MO"], RecurrenceEnd::Never)),
            ),
            EditScope::Occurrence,
        )
        .expect("update runs");
        let events = august(&connection);
        assert_eq!(events.len(), 5);
        let moved = events
            .iter()
            .find(|event| event.title == "改期周会")
            .expect("override present");
        assert_eq!(moved.start_at, "2026-08-11T14:00");
        assert_eq!(moved.end_at, "2026-08-11T15:00");
        assert!(moved.is_overridden);
        assert_eq!(
            moved.occurrence_start_at.as_deref(),
            Some("2026-08-10T10:00")
        );
        // 「仅此次」只写一条覆盖行：系列行、行数都必须原封不动
        assert_eq!(
            exception_rows(&connection, "s1"),
            vec![("2026-08-10T10:00".to_string(), "overridden".to_string())]
        );
        assert_eq!(recurrence_columns_of(&connection, "s1"), weekly_columns());
        assert_eq!(
            stored_bounds(&connection, "s1"),
            (
                "2026-08-03T10:00".to_string(),
                "2026-08-03T11:00".to_string()
            )
        );
        assert_eq!(stored_title(&connection, "s1"), "周会");
        assert_eq!(stored_updated_at(&connection, "s1"), "t");
        assert_eq!(total_events(&connection), 1);
    }

    #[test]
    fn editing_one_occurrence_may_stack_two_instances_on_one_day() {
        let mut connection = seeded();
        // 8/10 这次挪到 8/17，而 8/17 本就有一次：规格明确不做冲突检测
        update(
            &mut connection,
            &at("s1", "2026-08-10T10:00"),
            draft_with(
                "挪到下周",
                "2026-08-17T10:00",
                "2026-08-17T11:00",
                Some(weekly(&["MO"], RecurrenceEnd::Never)),
            ),
            EditScope::Occurrence,
        )
        .expect("update runs");
        let events = august(&connection);
        assert_eq!(
            starts(&events),
            vec![
                "2026-08-03T10:00",
                "2026-08-17T10:00",
                "2026-08-17T10:00",
                "2026-08-24T10:00",
                "2026-08-31T10:00"
            ]
        );
        let stacked: Vec<&str> = events
            .iter()
            .filter(|event| event.start_at == "2026-08-17T10:00")
            .map(|event| event.title.as_str())
            .collect();
        assert_eq!(stacked, vec!["挪到下周", "周会"]);
    }

    #[test]
    fn editing_this_and_following_splits_the_series() {
        let mut connection = seeded();
        update(
            &mut connection,
            &at("s1", "2026-08-17T10:00"),
            draft_with(
                "新周会",
                "2026-08-17T15:00",
                "2026-08-17T16:00",
                Some(weekly(&["MO"], RecurrenceEnd::Never)),
            ),
            EditScope::ThisAndFollowing,
        )
        .expect("update runs");
        let events = august(&connection);
        let shape: Vec<(&str, &str)> = events
            .iter()
            .map(|event| (event.start_at.as_str(), event.title.as_str()))
            .collect();
        assert_eq!(
            shape,
            vec![
                ("2026-08-03T10:00", "周会"),
                ("2026-08-10T10:00", "周会"),
                ("2026-08-17T15:00", "新周会"),
                ("2026-08-24T15:00", "新周会"),
                ("2026-08-31T15:00", "新周会"),
            ]
        );

        let (_, _, _, until, count, final_at) = recurrence_columns_of(&connection, "s1");
        assert_eq!(until.as_deref(), Some("2026-08-16"));
        assert_eq!(count, None);
        assert_eq!(final_at.as_deref(), Some("2026-08-10T10:00"));

        // Never 原样承接：新系列的三个结束条件列都必须是空的
        let new_id = other_series_id(&connection, "s1");
        assert_eq!(total_events(&connection), 2);
        assert_eq!(recurrence_columns_of(&connection, &new_id), weekly_columns());
        assert_eq!(
            stored_bounds(&connection, &new_id),
            (
                "2026-08-17T15:00".to_string(),
                "2026-08-17T16:00".to_string()
            )
        );
        // 九月起只剩新系列，且它必须继续下去
        let later = window(&connection, "2026-09-01T00:00", "2026-10-01T00:00");
        assert!(!later.is_empty());
        assert!(later.iter().all(|event| event.id == new_id));
    }

    #[test]
    fn splitting_a_counted_series_preserves_the_total_count() {
        let mut connection = database();
        let created = create(
            &mut connection,
            draft_with(
                "复盘",
                "2026-08-03T19:00",
                "2026-08-03T20:00",
                Some(weekly(&["MO"], RecurrenceEnd::Count { count: 5 })),
            ),
        )
        .expect("create runs");
        assert_eq!(instances_of(&connection, &created.id).len(), 5);

        update(
            &mut connection,
            &at(&created.id, "2026-08-17T19:00"),
            draft_with(
                "复盘（新）",
                "2026-08-17T20:00",
                "2026-08-17T21:00",
                Some(weekly(&["MO"], RecurrenceEnd::Count { count: 5 })),
            ),
            EditScope::ThisAndFollowing,
        )
        .expect("update runs");

        let new_id = other_series_id(&connection, &created.id);
        let (_, _, _, old_until, old_count, old_final) =
            recurrence_columns_of(&connection, &created.id);
        assert_eq!(old_until, None);
        assert_eq!(old_count, Some(2));
        assert_eq!(old_final.as_deref(), Some("2026-08-10T19:00"));
        let (_, _, _, new_until, new_count, new_final) = recurrence_columns_of(&connection, &new_id);
        assert_eq!(new_until, None);
        assert_eq!(new_count, Some(3));
        assert_eq!(new_final.as_deref(), Some("2026-08-31T20:00"));

        // 列的字面值不够：真正要守住的是两段展开出的实例数之和仍是 5
        let old_instances = instances_of(&connection, &created.id);
        let new_instances = instances_of(&connection, &new_id);
        assert_eq!(old_instances, vec!["2026-08-03T19:00", "2026-08-10T19:00"]);
        assert_eq!(
            new_instances,
            vec![
                "2026-08-17T20:00",
                "2026-08-24T20:00",
                "2026-08-31T20:00"
            ]
        );
        assert_eq!(old_instances.len() + new_instances.len(), 5);
    }

    #[test]
    fn splitting_an_until_series_hands_over_the_same_until() {
        let mut connection = database();
        let created = create(
            &mut connection,
            draft_with(
                "周会",
                "2026-08-03T10:00",
                "2026-08-03T11:00",
                Some(weekly(
                    &["MO"],
                    RecurrenceEnd::Until {
                        date: "2026-09-28".into(),
                    },
                )),
            ),
        )
        .expect("create runs");
        assert_eq!(instances_of(&connection, &created.id).len(), 9);

        update(
            &mut connection,
            &at(&created.id, "2026-08-17T10:00"),
            draft_with(
                "新周会",
                "2026-08-17T10:00",
                "2026-08-17T11:00",
                Some(weekly(
                    &["MO"],
                    RecurrenceEnd::Until {
                        date: "2026-09-28".into(),
                    },
                )),
            ),
            EditScope::ThisAndFollowing,
        )
        .expect("update runs");

        let new_id = other_series_id(&connection, &created.id);
        let (_, _, _, old_until, old_count, old_final) =
            recurrence_columns_of(&connection, &created.id);
        assert_eq!(old_until.as_deref(), Some("2026-08-16"));
        assert_eq!(old_count, None);
        assert_eq!(old_final.as_deref(), Some("2026-08-10T10:00"));
        // 原样承接：既不得改写日期，也不得被换算成 count
        let (_, _, _, new_until, new_count, new_final) = recurrence_columns_of(&connection, &new_id);
        assert_eq!(new_until.as_deref(), Some("2026-09-28"));
        assert_eq!(new_count, None);
        assert_eq!(new_final.as_deref(), Some("2026-09-28T10:00"));
        assert_eq!(instances_of(&connection, &created.id).len(), 2);
        assert_eq!(instances_of(&connection, &new_id).len(), 7);
    }

    /// 拆分前的公共布景：切点前后各一条例外，外加一条被挪到十二月的覆盖行。
    /// 最后这条是关键——槽位仍在八月的幽灵行会被 `list_in_range` 静默丢弃，
    /// 只有被挪出原窗口的覆盖行才能在「漏迁移 / 漏删除」时显形。
    fn seeded_for_split() -> Connection {
        let connection = seeded();
        upsert_excluded(&connection, "s1", "2026-08-10T10:00", "t").expect("exclude before the cut");
        upsert_excluded(&connection, "s1", "2026-08-24T10:00", "t").expect("exclude after the cut");
        upsert_overridden(
            &connection,
            "s1",
            "2026-08-31T10:00",
            &override_fields("远期改期", "2026-12-07T09:00", "2026-12-07T10:00"),
            "t",
        )
        .expect("override into a far window");
        connection
    }

    /// 十二月窗口里的**覆盖实例**。拆分后的新系列本身也会在这个窗口里产出常规实例，
    /// 只有覆盖实例能回答「例外是被迁移了、被删除了、还是变成了幽灵行」。
    fn far_overrides(connection: &Connection) -> Vec<Event> {
        window(connection, "2026-12-01T00:00", "2027-01-01T00:00")
            .into_iter()
            .filter(|event| event.is_overridden)
            .collect()
    }

    #[test]
    fn splitting_migrates_exceptions_when_the_time_and_rule_are_unchanged() {
        let mut connection = seeded_for_split();
        update(
            &mut connection,
            &at("s1", "2026-08-17T10:00"),
            draft_with(
                "新周会",
                "2026-08-17T10:00",
                "2026-08-17T11:00",
                Some(weekly(&["MO"], RecurrenceEnd::Never)),
            ),
            EditScope::ThisAndFollowing,
        )
        .expect("update runs");

        let new_id = other_series_id(&connection, "s1");
        // 切点之前的例外留在原系列，切点及之后的改挂新系列且不得留下副本
        assert_eq!(
            exception_rows(&connection, "s1"),
            vec![("2026-08-10T10:00".to_string(), "excluded".to_string())]
        );
        assert_eq!(
            exception_rows(&connection, &new_id),
            vec![
                ("2026-08-24T10:00".to_string(), "excluded".to_string()),
                ("2026-08-31T10:00".to_string(), "overridden".to_string()),
            ]
        );

        let events = august(&connection);
        let shape: Vec<(&str, &str)> = events
            .iter()
            .map(|event| (event.start_at.as_str(), event.title.as_str()))
            .collect();
        assert_eq!(
            shape,
            vec![
                ("2026-08-03T10:00", "周会"),
                ("2026-08-17T10:00", "新周会"),
            ]
        );
        // 迁移过去的覆盖行必须在新系列上继续命中，而不是变成孤儿
        let far = far_overrides(&connection);
        assert_eq!(starts(&far), vec!["2026-12-07T09:00"]);
        assert_eq!(far[0].title, "远期改期");
        assert_eq!(far[0].series_id.as_deref(), Some(new_id.as_str()));
        assert_eq!(
            far[0].occurrence_start_at.as_deref(),
            Some("2026-08-31T10:00")
        );
    }

    #[test]
    fn splitting_drops_exceptions_when_the_time_of_day_changes() {
        let mut connection = seeded_for_split();
        update(
            &mut connection,
            &at("s1", "2026-08-17T10:00"),
            draft_with(
                "新周会",
                "2026-08-17T15:00",
                "2026-08-17T16:00",
                Some(weekly(&["MO"], RecurrenceEnd::Never)),
            ),
            EditScope::ThisAndFollowing,
        )
        .expect("update runs");

        let new_id = other_series_id(&connection, "s1");
        assert_eq!(
            exception_rows(&connection, "s1"),
            vec![("2026-08-10T10:00".to_string(), "excluded".to_string())]
        );
        assert!(exception_rows(&connection, &new_id).is_empty());
        assert_eq!(
            starts(&august(&connection)),
            vec![
                "2026-08-03T10:00",
                "2026-08-17T15:00",
                "2026-08-24T15:00",
                "2026-08-31T15:00"
            ]
        );
        assert!(far_overrides(&connection).is_empty());
    }

    #[test]
    fn splitting_drops_exceptions_when_the_rule_changes() {
        let mut connection = seeded_for_split();
        update(
            &mut connection,
            &at("s1", "2026-08-17T10:00"),
            draft_with(
                "新周会",
                "2026-08-17T10:00",
                "2026-08-17T11:00",
                Some(weekly(&["MO", "WE"], RecurrenceEnd::Never)),
            ),
            EditScope::ThisAndFollowing,
        )
        .expect("update runs");

        let new_id = other_series_id(&connection, "s1");
        assert_eq!(recurrence_columns_of(&connection, &new_id).2, "MO,WE");
        assert_eq!(
            exception_rows(&connection, "s1"),
            vec![("2026-08-10T10:00".to_string(), "excluded".to_string())]
        );
        assert!(exception_rows(&connection, &new_id).is_empty());
        assert_eq!(
            starts(&august(&connection)),
            vec![
                "2026-08-03T10:00",
                "2026-08-17T10:00",
                "2026-08-19T10:00",
                "2026-08-24T10:00",
                "2026-08-26T10:00",
                "2026-08-31T10:00"
            ]
        );
        assert!(far_overrides(&connection).is_empty());
    }

    #[test]
    fn splitting_keeps_the_linked_task_on_the_original_series() {
        let mut connection = database();
        insert_task(&connection, "t1");
        let created = create(
            &mut connection,
            EventDraft {
                linked_task_id: Some("t1".into()),
                ..draft_with(
                    "周会",
                    "2026-08-03T10:00",
                    "2026-08-03T11:00",
                    Some(weekly(&["MO"], RecurrenceEnd::Never)),
                )
            },
        )
        .expect("create runs");
        connection
            .execute("UPDATE tasks SET updated_at='sentinel' WHERE id='t1'", [])
            .expect("sentinel writes");

        // 草稿仍带着关联（前端会原样回填），拆分必须主动把它挡在新系列之外
        update(
            &mut connection,
            &at(&created.id, "2026-08-17T10:00"),
            EventDraft {
                linked_task_id: Some("t1".into()),
                ..draft_with(
                    "新周会",
                    "2026-08-17T15:00",
                    "2026-08-17T16:00",
                    Some(weekly(&["MO"], RecurrenceEnd::Never)),
                )
            },
            EditScope::ThisAndFollowing,
        )
        .expect("update runs");

        let new_id = other_series_id(&connection, &created.id);
        assert_eq!(total_events(&connection), 2);
        assert_eq!(event_link(&connection, &created.id).as_deref(), Some("t1"));
        assert_eq!(event_link(&connection, &new_id), None);
        // 任务侧一个字节都不该动：updated_at 是唯一能证明「没被顺手改写」的列
        assert_eq!(
            task_link(&connection, "t1").as_deref(),
            Some(created.id.as_str())
        );
        assert_eq!(task_updated_at(&connection, "t1"), "sentinel");
    }

    #[test]
    fn splitting_at_the_first_slot_edits_the_whole_series() {
        let mut connection = seeded();
        upsert_excluded(&connection, "s1", "2026-08-10T10:00", "t").expect("exclude");
        update(
            &mut connection,
            &at("s1", "2026-08-03T10:00"),
            draft_with(
                "全改",
                "2026-08-03T16:00",
                "2026-08-03T17:00",
                Some(weekly(&["MO"], RecurrenceEnd::Never)),
            ),
            EditScope::ThisAndFollowing,
        )
        .expect("update runs");
        // 首次的「此后所有」等价于「全部」：不得产生第二个系列
        assert_eq!(total_events(&connection), 1);
        assert_eq!(stored_title(&connection, "s1"), "全改");
        assert_eq!(recurrence_columns_of(&connection, "s1"), weekly_columns());
        assert_eq!(
            starts(&august(&connection)),
            vec![
                "2026-08-03T16:00",
                "2026-08-10T16:00",
                "2026-08-17T16:00",
                "2026-08-24T16:00",
                "2026-08-31T16:00"
            ]
        );
        // 「全部」的例外语义随之生效：开始时刻变了，旧例外必须被清空
        assert_eq!(exception_count(&connection, "s1"), 0);
    }

    #[test]
    fn splitting_a_counted_series_at_the_first_slot_keeps_the_whole_count() {
        let mut connection = database();
        let created = create(
            &mut connection,
            draft_with(
                "复盘",
                "2026-08-03T19:00",
                "2026-08-03T20:00",
                Some(weekly(&["MO"], RecurrenceEnd::Count { count: 3 })),
            ),
        )
        .expect("create runs");
        // 首次拆分若走到守恒分支，原系列会被写成 Count(0) 而被归一化拒绝
        update(
            &mut connection,
            &at(&created.id, "2026-08-03T19:00"),
            draft_with(
                "复盘（新）",
                "2026-08-03T21:00",
                "2026-08-03T22:00",
                Some(weekly(&["MO"], RecurrenceEnd::Count { count: 3 })),
            ),
            EditScope::ThisAndFollowing,
        )
        .expect("update runs");
        assert_eq!(total_events(&connection), 1);
        let (_, _, _, until, count, final_at) = recurrence_columns_of(&connection, &created.id);
        assert_eq!(until, None);
        assert_eq!(count, Some(3));
        assert_eq!(final_at.as_deref(), Some("2026-08-17T21:00"));
        assert_eq!(instances_of(&connection, &created.id).len(), 3);
    }

    #[test]
    fn splitting_drops_exceptions_when_the_start_date_moves_off_the_slot() {
        let mut connection = seeded();
        upsert_excluded(&connection, "s1", "2026-08-10T10:00", "t").expect("exclude before the cut");
        // 切点自身的覆盖行被挪到十二月：槽位仍在八月的幽灵行会被 list_in_range 静默丢弃
        upsert_overridden(
            &connection,
            "s1",
            "2026-08-17T10:00",
            &override_fields("远期改期", "2026-12-07T09:00", "2026-12-07T10:00"),
            "t",
        )
        .expect("override at the cut");

        // 8/18 是周二而规则仍是周一：R1 把新系列对齐到 8/24，切点 8/17 不再是它的槽位
        update(
            &mut connection,
            &at("s1", "2026-08-17T10:00"),
            draft_with(
                "新周会",
                "2026-08-18T10:00",
                "2026-08-18T11:00",
                Some(weekly(&["MO"], RecurrenceEnd::Never)),
            ),
            EditScope::ThisAndFollowing,
        )
        .expect("update runs");

        let new_id = other_series_id(&connection, "s1");
        assert_eq!(
            stored_bounds(&connection, &new_id),
            (
                "2026-08-24T10:00".to_string(),
                "2026-08-24T11:00".to_string()
            )
        );
        assert_eq!(
            exception_rows(&connection, "s1"),
            vec![("2026-08-10T10:00".to_string(), "excluded".to_string())]
        );
        // 时刻与规则都没变，但 8/17 不再是新系列的槽位：迁过去即为删不掉的幽灵行
        assert!(exception_rows(&connection, &new_id).is_empty());
        assert!(far_overrides(&connection).is_empty());
        assert_eq!(
            starts(&august(&connection)),
            vec!["2026-08-03T10:00", "2026-08-24T10:00", "2026-08-31T10:00"]
        );
    }

    #[test]
    fn splitting_migrates_exceptions_when_the_rule_realigns_onto_the_slot() {
        let mut connection = seeded_for_split();
        // 8/12 是周三，R1 把它对齐回 8/17：判定必须用归一化后的 dtstart，
        // 否则用户提交的原始日期一变就会误杀本该迁移的例外
        update(
            &mut connection,
            &at("s1", "2026-08-17T10:00"),
            draft_with(
                "新周会",
                "2026-08-12T10:00",
                "2026-08-12T11:00",
                Some(weekly(&["MO"], RecurrenceEnd::Never)),
            ),
            EditScope::ThisAndFollowing,
        )
        .expect("update runs");

        let new_id = other_series_id(&connection, "s1");
        assert_eq!(
            stored_bounds(&connection, &new_id),
            (
                "2026-08-17T10:00".to_string(),
                "2026-08-17T11:00".to_string()
            )
        );
        assert_eq!(
            exception_rows(&connection, &new_id),
            vec![
                ("2026-08-24T10:00".to_string(), "excluded".to_string()),
                ("2026-08-31T10:00".to_string(), "overridden".to_string()),
            ]
        );
        let far = far_overrides(&connection);
        assert_eq!(starts(&far), vec!["2026-12-07T09:00"]);
        assert_eq!(far[0].series_id.as_deref(), Some(new_id.as_str()));
    }

    #[test]
    fn splitting_applies_an_end_condition_the_user_changed() {
        let mut connection = seeded();
        // 「永不结束」改成「共 3 次」：静默忽略用户输入比报错更差
        update(
            &mut connection,
            &at("s1", "2026-08-17T10:00"),
            draft_with(
                "新周会",
                "2026-08-17T10:00",
                "2026-08-17T11:00",
                Some(weekly(&["MO"], RecurrenceEnd::Count { count: 3 })),
            ),
            EditScope::ThisAndFollowing,
        )
        .expect("update runs");

        let new_id = other_series_id(&connection, "s1");
        let (_, _, _, until, count, final_at) = recurrence_columns_of(&connection, &new_id);
        assert_eq!(until, None);
        assert_eq!(count, Some(3));
        assert_eq!(final_at.as_deref(), Some("2026-08-31T10:00"));
        assert_eq!(
            instances_of(&connection, &new_id),
            vec![
                "2026-08-17T10:00",
                "2026-08-24T10:00",
                "2026-08-31T10:00"
            ]
        );
        // 原系列仍按原结束条件截断：原为 Never，故切成 Until(该次前一天)
        let (_, _, _, old_until, old_count, old_final) = recurrence_columns_of(&connection, "s1");
        assert_eq!(old_until.as_deref(), Some("2026-08-16"));
        assert_eq!(old_count, None);
        assert_eq!(old_final.as_deref(), Some("2026-08-10T10:00"));
    }

    #[test]
    fn splitting_applies_an_until_the_user_shortened() {
        let mut connection = database();
        let created = create(
            &mut connection,
            draft_with(
                "周会",
                "2026-08-03T10:00",
                "2026-08-03T11:00",
                Some(weekly(
                    &["MO"],
                    RecurrenceEnd::Until {
                        date: "2026-09-28".into(),
                    },
                )),
            ),
        )
        .expect("create runs");

        update(
            &mut connection,
            &at(&created.id, "2026-08-17T10:00"),
            draft_with(
                "新周会",
                "2026-08-17T10:00",
                "2026-08-17T11:00",
                Some(weekly(
                    &["MO"],
                    RecurrenceEnd::Until {
                        date: "2026-08-24".into(),
                    },
                )),
            ),
            EditScope::ThisAndFollowing,
        )
        .expect("update runs");

        let new_id = other_series_id(&connection, &created.id);
        let (_, _, _, new_until, new_count, new_final) = recurrence_columns_of(&connection, &new_id);
        assert_eq!(new_until.as_deref(), Some("2026-08-24"));
        assert_eq!(new_count, None);
        assert_eq!(new_final.as_deref(), Some("2026-08-24T10:00"));
        assert_eq!(
            instances_of(&connection, &new_id),
            vec!["2026-08-17T10:00", "2026-08-24T10:00"]
        );
        assert_eq!(instances_of(&connection, &created.id).len(), 2);
    }

    #[test]
    fn splitting_a_counted_series_applies_an_edited_count() {
        let mut connection = database();
        let created = create(
            &mut connection,
            draft_with(
                "复盘",
                "2026-08-03T19:00",
                "2026-08-03T20:00",
                Some(weekly(&["MO"], RecurrenceEnd::Count { count: 5 })),
            ),
        )
        .expect("create runs");

        // 改动了次数：守恒让位于用户输入，新系列取 10 而不是 5-2
        update(
            &mut connection,
            &at(&created.id, "2026-08-17T19:00"),
            draft_with(
                "复盘（新）",
                "2026-08-17T19:00",
                "2026-08-17T20:00",
                Some(weekly(&["MO"], RecurrenceEnd::Count { count: 10 })),
            ),
            EditScope::ThisAndFollowing,
        )
        .expect("update runs");

        let new_id = other_series_id(&connection, &created.id);
        let (_, _, _, new_until, new_count, _) = recurrence_columns_of(&connection, &new_id);
        assert_eq!(new_until, None);
        assert_eq!(new_count, Some(10));
        assert_eq!(instances_of(&connection, &new_id).len(), 10);
        // 原系列仍按原规则截断为 Count(k)
        let (_, _, _, old_until, old_count, old_final) =
            recurrence_columns_of(&connection, &created.id);
        assert_eq!(old_until, None);
        assert_eq!(old_count, Some(2));
        assert_eq!(old_final.as_deref(), Some("2026-08-10T19:00"));
    }
}
