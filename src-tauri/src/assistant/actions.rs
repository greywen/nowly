//! Typed domain adapters. Every payload is parsed into its `inputs` type first;
//! no arbitrary SQL or model-chosen fields reach a domain module.
use super::{inputs::*, store, types::*};
use crate::{
    error::CommandError,
    events,
    models::{
        EditScope, Event, EventDraft, EventRange, EventTarget, ExternalEvent, NoteDraft, Task,
        TaskDraft, TaskStepDraft, TaskWorkspaceSnapshot,
    },
    recurrence::Recurrence,
    task_workspace,
    time::types::AlarmDraft,
    timezone,
};
use chrono::{Duration, NaiveDate, TimeZone};
use rusqlite::{Connection, OptionalExtension};
use serde_json::{json, Value};

const MAX_TEXT: usize = 16000;

fn invalid(message: &str) -> CommandError {
    CommandError::validation("assistant", message)
}
fn date(raw: &str) -> Result<NaiveDate, CommandError> {
    if raw.len() != 10
        || !raw.bytes().enumerate().all(|(i, b)| {
            if i == 4 || i == 7 {
                b == b'-'
            } else {
                b.is_ascii_digit()
            }
        })
        || raw.starts_with("0000")
    {
        return Err(invalid("日期必须使用有效的四位年份 YYYY-MM-DD。"));
    }
    NaiveDate::parse_from_str(raw, "%Y-%m-%d").map_err(|_| invalid("日期不存在。"))
}
fn wall(raw: &str) -> Result<chrono::NaiveDateTime, CommandError> {
    if raw.len() != 16 || !raw.is_ascii() || &raw[10..11] != "T" || &raw[13..14] != ":" {
        return Err(invalid("时间必须使用 YYYY-MM-DDTHH:mm 格式。"));
    }
    date(&raw[..10])?;
    timezone::parse_wall(raw)
}
fn value<T: serde::Serialize>(v: &T) -> Result<Value, CommandError> {
    serde_json::to_value(v).map_err(CommandError::system)
}
fn bounded<'a>(texts: impl IntoIterator<Item = &'a String>) -> Result<(), CommandError> {
    if texts.into_iter().any(|text| text.len() > MAX_TEXT) {
        return Err(invalid("字段内容过长。"));
    }
    Ok(())
}
fn excerpt(text: &str) -> String {
    text.trim().chars().take(200).collect()
}

pub fn event_key(target: &EventTarget) -> String {
    format!(
        "calendar:{}:{}",
        target.id,
        target.occurrence_start_at.as_deref().unwrap_or("")
    )
}
pub fn remote_key(target: &RemoteTarget) -> String {
    format!("remote:{}:{}", target.subscription_id, target.remote_event_id)
}
pub fn resolve_event(db: &Connection, target: &EventTarget) -> Result<Event, CommandError> {
    let event = events::event_by_id(db, &target.id)?
        .ok_or_else(|| invalid("未找到本地日程，请重新查询。"))?;
    if event.series_id.is_none() && target.occurrence_start_at.is_none() {
        return Ok(event);
    }
    let slot = target
        .occurrence_start_at
        .as_deref()
        .ok_or_else(|| invalid("重复日程只能操作明确的某一次，不能修改整个系列。"))?;
    wall(slot)?;
    let override_start:Option<String>=db.query_row(
        "SELECT start_at FROM event_exceptions WHERE series_id=?1 AND occurrence_start_at=?2 AND kind='overridden'",
        rusqlite::params![target.id,slot],|r|r.get(0)).optional().map_err(CommandError::database)?;
    let display =
        events::to_display_wall(override_start.as_deref().unwrap_or(slot), &event.start_tz);
    let date = wall(&display)?.date();
    let range = EventRange {
        start_at: format!("{date}T00:00"),
        end_at_exclusive: format!(
            "{}T00:00",
            date.checked_add_signed(Duration::days(1))
                .ok_or_else(|| invalid("日期超出范围。"))?
        ),
    };
    events::list_in_range(db, &range)?
        .into_iter()
        .find(|e| e.id == target.id && e.occurrence_start_at == target.occurrence_start_at)
        .ok_or_else(|| invalid("这次重复日程不存在或已取消，请重新查询。"))
}

/// The fields an event action may set, whether it creates or changes.
#[derive(Default)]
struct EventInput {
    title: Option<String>,
    start_at: Option<String>,
    end_at: Option<String>,
    all_day: Option<bool>,
    category: Option<String>,
    note: Option<String>,
    reminders: Option<Vec<i64>>,
    recurrence: Option<Recurrence>,
}

impl From<EventCreate> for EventInput {
    fn from(draft: EventCreate) -> Self {
        Self {
            title: Some(draft.title),
            start_at: Some(draft.start_at),
            end_at: draft.end_at,
            all_day: Some(draft.all_day),
            category: draft.category,
            note: draft.note,
            reminders: Some(draft.reminders),
            recurrence: draft.recurrence,
        }
    }
}

impl From<EventPatch> for EventInput {
    fn from(patch: EventPatch) -> Self {
        Self {
            title: patch.title,
            start_at: patch.start_at,
            end_at: patch.end_at,
            all_day: patch.all_day,
            category: patch.category,
            note: patch.note,
            reminders: patch.reminders,
            recurrence: None,
        }
    }
}

/// A category id and the colour it gives an event today.
fn category(db: &Connection, id: &str) -> Result<(String, String), CommandError> {
    crate::categories::list(db)?
        .into_iter()
        .find(|c| c.id == id)
        .map(|c| (c.id, c.color))
        .ok_or_else(|| invalid("日程分类不存在，请使用查询结果中的分类。"))
}

/// The end time an input implies: given, kept, or the previous duration (one
/// hour for new events) after the start.
fn end_for(
    base: Option<(&str, &str)>,
    start: &str,
    input_start: bool,
    input_end: Option<String>,
) -> Result<String, CommandError> {
    if let Some(end) = input_end {
        return Ok(end);
    }
    match base {
        Some((_, end)) if !input_start => Ok(end.to_string()),
        _ => {
            let duration = base
                .map(|(s, e)| Ok::<_, CommandError>(wall(e)? - wall(s)?))
                .transpose()?
                .unwrap_or(Duration::hours(1));
            Ok(timezone::format_wall(
                wall(start)?
                    .checked_add_signed(duration)
                    .ok_or_else(|| invalid("日程结束时间超出范围。"))?,
            ))
        }
    }
}

fn event_draft(
    db: &Connection,
    base: Option<&Event>,
    input: EventInput,
) -> Result<EventDraft, CommandError> {
    bounded(input.title.iter().chain(input.note.iter()))?;
    let start = input
        .start_at
        .clone()
        .or_else(|| base.map(|e| e.start_at.clone()))
        .ok_or_else(|| invalid("开始时间格式无效。"))?;
    let end = end_for(
        base.map(|e| (e.start_at.as_str(), e.end_at.as_str())),
        &start,
        input.start_at.is_some(),
        input.end_at,
    )?;
    let (category, color) = match input.category.as_deref().map(str::trim) {
        Some("") => (String::new(), String::new()),
        Some(id) => category(db, id)?,
        None => base.map_or((String::new(), String::new()), |e| {
            (e.category.clone(), e.color.clone())
        }),
    };
    let mut draft = EventDraft {
        title: input
            .title
            .or_else(|| base.map(|e| e.title.clone()))
            .unwrap_or_default(),
        start_at: start,
        end_at: end,
        start_tz: None,
        end_tz: None,
        all_day: input
            .all_day
            .or_else(|| base.map(|e| e.all_day))
            .unwrap_or(false),
        category,
        color,
        linked_task_id: base.and_then(|e| e.linked_task_id.clone()),
        note: input
            .note
            .or_else(|| base.map(|e| e.note.clone()))
            .unwrap_or_default(),
        reminders: input
            .reminders
            .or_else(|| base.map(|e| e.reminders.clone()))
            .unwrap_or_default(),
        recurrence: input.recurrence,
    };
    for field in [&draft.start_at, &draft.end_at] {
        let parsed = wall(field)?;
        if !draft.all_day
            && timezone::device_tz()
                .from_local_datetime(&parsed)
                .single()
                .is_none()
        {
            return Err(invalid(
                "这个时间处于夏令时跳变或重复时段，请在日程编辑器中明确时间。",
            ));
        }
    }
    // UI/model dates are device wall time. Preserve an existing event's timezone
    // by converting its display time back before invoking the native domain.
    if let Some(e) = base {
        if !draft.all_day {
            for (wall, tz) in [
                (&mut draft.start_at, &e.start_tz),
                (&mut draft.end_at, &e.end_tz),
            ] {
                if let Some(name) = tz {
                    let instant =
                        timezone::wall_to_utc(timezone::parse_wall(wall)?, timezone::device_tz());
                    let zone = timezone::parse_tz(name)?;
                    let converted = timezone::utc_to_wall(instant, zone);
                    if zone.from_local_datetime(&converted).single().is_none() {
                        return Err(invalid(
                            "原日程时区中的该时间存在夏令时歧义，请使用日程编辑器明确时间。",
                        ));
                    }
                    *wall = timezone::format_wall(converted);
                }
            }
            draft.start_tz = e.start_tz.clone();
            draft.end_tz = e.end_tz.clone();
        }
    }
    events::validate_and_normalize(draft)
}

fn find_task<'a>(workspace: &'a TaskWorkspaceSnapshot, id: &str) -> Result<&'a Task, CommandError> {
    workspace
        .tasks
        .iter()
        .find(|t| t.id == id)
        .ok_or_else(|| invalid("任务不存在，请重新查询。"))
}

fn require_lane(workspace: &TaskWorkspaceSnapshot, id: Option<&str>) -> Result<(), CommandError> {
    match id {
        Some(id) if !workspace.lanes.iter().any(|l| l.id == id) => {
            Err(invalid("看板列不存在，请使用查询结果中的列。"))
        }
        _ => Ok(()),
    }
}

/// Tags must exist; an archived tag is only kept where the task already has it.
fn require_tags(
    workspace: &TaskWorkspaceSnapshot,
    ids: &[String],
    current: &[String],
) -> Result<(), CommandError> {
    for id in ids {
        let tag = workspace
            .tags
            .iter()
            .find(|t| &t.id == id)
            .ok_or_else(|| invalid("标签不存在，请使用查询结果中的标签；助手不会新建标签。"))?;
        if tag.archived_at.is_some() && !current.contains(id) {
            return Err(invalid("标签已归档，不能再添加到任务。"));
        }
    }
    Ok(())
}

fn new_steps(titles: Vec<String>) -> Vec<TaskStepDraft> {
    titles
        .into_iter()
        .map(|title| TaskStepDraft {
            id: None,
            title,
            completed: false,
        })
        .collect()
}

/// Applies step edits to the stored steps; `None` when the patch has none.
fn patched_steps(task: &Task, patch: &mut TaskPatch) -> Result<Option<Vec<TaskStepDraft>>, CommandError> {
    if patch.add_steps.is_empty() && patch.update_steps.is_empty() && patch.remove_steps.is_empty()
    {
        return Ok(None);
    }
    let known = |id: &str| task.steps.iter().any(|s| s.id == id);
    for id in patch
        .update_steps
        .iter()
        .map(|s| s.id.as_str())
        .chain(patch.remove_steps.iter().map(String::as_str))
    {
        if !known(id) {
            return Err(invalid("步骤不存在，请使用查询结果中的步骤。"));
        }
    }
    if patch
        .update_steps
        .iter()
        .any(|s| patch.remove_steps.contains(&s.id))
    {
        return Err(invalid("同一步骤不能同时修改和删除。"));
    }
    let mut steps: Vec<TaskStepDraft> = task
        .steps
        .iter()
        .filter(|s| !patch.remove_steps.contains(&s.id))
        .map(|s| TaskStepDraft {
            id: Some(s.id.clone()),
            title: s.title.clone(),
            completed: s.completed,
        })
        .collect();
    for change in &patch.update_steps {
        let step = steps
            .iter_mut()
            .find(|s| s.id.as_deref() == Some(change.id.as_str()))
            .expect("checked above");
        if let Some(title) = &change.title {
            step.title = title.clone();
        }
        if let Some(completed) = change.completed {
            step.completed = completed;
        }
    }
    steps.extend(new_steps(std::mem::take(&mut patch.add_steps)));
    Ok(Some(steps))
}

fn task_draft(workspace: &TaskWorkspaceSnapshot, draft: TaskCreate) -> Result<TaskDraft, CommandError> {
    bounded(
        [&draft.title, &draft.description]
            .into_iter()
            .chain(draft.steps.iter()),
    )?;
    if let Some(value) = &draft.due_date {
        date(value)?;
    }
    require_lane(workspace, draft.lane_id.as_deref())?;
    require_tags(workspace, &draft.tag_ids, &[])?;
    Ok(TaskDraft {
        title: draft.title,
        description: draft.description,
        priority: draft.priority.map(|p| p.as_str().to_string()),
        due_date: draft.due_date,
        completed: draft.completed,
        lane_id: draft.lane_id,
        tag_ids: draft.tag_ids,
        linked_event_id: None,
        steps: (!draft.steps.is_empty()).then(|| new_steps(draft.steps)),
    })
}

fn task_patch_draft(
    workspace: &TaskWorkspaceSnapshot,
    task: &Task,
    mut patch: TaskPatch,
) -> Result<TaskDraft, CommandError> {
    if patch.is_empty() {
        return Err(invalid("修改内容不能为空。"));
    }
    bounded(
        patch
            .title
            .iter()
            .chain(patch.description.iter())
            .chain(patch.add_steps.iter())
            .chain(patch.update_steps.iter().filter_map(|s| s.title.as_ref())),
    )?;
    if let Some(Some(value)) = &patch.due_date {
        date(value)?;
    }
    if let Some(lane) = &patch.lane_id {
        require_lane(workspace, lane.as_deref())?;
    }
    if let Some(tags) = &patch.tag_ids {
        require_tags(workspace, tags, &task.tag_ids)?;
    }
    let steps = patched_steps(task, &mut patch)?;
    Ok(TaskDraft {
        title: patch.title.unwrap_or_else(|| task.title.clone()),
        description: patch
            .description
            .unwrap_or_else(|| task.description.clone()),
        priority: match patch.priority {
            Some(priority) => priority.map(|p| p.as_str().to_string()),
            None => Some(task.priority.clone()),
        },
        due_date: patch.due_date.unwrap_or_else(|| task.due_date.clone()),
        completed: patch.completed.unwrap_or(task.completed),
        lane_id: patch.lane_id.unwrap_or_else(|| task.lane_id.clone()),
        tag_ids: patch.tag_ids.unwrap_or_else(|| task.tag_ids.clone()),
        linked_event_id: task.linked_event_id.clone(),
        steps,
    })
}

/// The notes editor's default colour (`DEFAULT_NOTE_COLOR`).
const NOTE_COLOR: &str = "#E8C444";

/// One line of the Markdown subset notes accept, as Quill block attributes.
fn note_line(line: &str) -> (&str, Option<Value>) {
    let trimmed = line.trim_start();
    for (prefix, list) in [
        ("- [ ] ", "unchecked"),
        ("* [ ] ", "unchecked"),
        ("- [x] ", "checked"),
        ("- [X] ", "checked"),
        ("* [x] ", "checked"),
        ("* [X] ", "checked"),
        ("- ", "bullet"),
        ("* ", "bullet"),
    ] {
        if let Some(rest) = trimmed.strip_prefix(prefix) {
            return (rest, Some(json!({ "list": list })));
        }
    }
    let hashes = trimmed.bytes().take_while(|b| *b == b'#').count();
    if (1..=4).contains(&hashes) {
        if let Some(rest) = trimmed[hashes..].strip_prefix(' ') {
            return (rest, Some(json!({ "header": hashes })));
        }
    }
    let digits = trimmed.bytes().take_while(u8::is_ascii_digit).count();
    if digits > 0 {
        if let Some(rest) = trimmed[digits..].strip_prefix(". ") {
            return (rest, Some(json!({ "list": "ordered" })));
        }
    }
    (line, None)
}

/// Model text becomes the editor's Delta format. Block formats sit on the
/// newline that ends their line, as Quill 2 stores them.
fn note_delta(text: &str) -> Result<String, CommandError> {
    let text = text.replace("\r\n", "\n");
    let text = text.trim();
    if text.is_empty() {
        return Err(invalid("便签内容不能为空。"));
    }
    if text.len() > MAX_TEXT {
        return Err(invalid("字段内容过长。"));
    }
    let mut ops = vec![];
    for line in text.split('\n') {
        let (body, attributes) = note_line(line);
        if !body.is_empty() {
            ops.push(json!({ "insert": body }));
        }
        ops.push(match attributes {
            Some(attributes) => json!({ "insert": "\n", "attributes": attributes }),
            None => json!({ "insert": "\n" }),
        });
    }
    serde_json::to_string(&json!({ "v": 1, "ops": ops })).map_err(CommandError::system)
}

/// Plain text of stored content, for titles and queries. Legacy notes are
/// plain text or Markdown; current ones are Delta JSON.
pub fn note_text(content: &str) -> String {
    let parsed = serde_json::from_str::<Value>(content).ok();
    match parsed.as_ref().and_then(|v| v.get("ops")).and_then(Value::as_array) {
        Some(ops) => ops
            .iter()
            .filter_map(|op| op.get("insert").and_then(Value::as_str))
            .collect(),
        None => content.to_string(),
    }
}

fn note_title(content: &str) -> String {
    let text = note_text(content);
    let line = text
        .lines()
        .map(|line| line.trim().trim_start_matches('#').trim())
        .find(|line| !line.is_empty())
        .unwrap_or("");
    let mut title: String = line.chars().take(40).collect();
    if line.chars().count() > 40 {
        title.push('…');
    }
    title
}

fn note_value(note: &crate::models::Note) -> Result<Value, CommandError> {
    let mut v = value(note)?;
    v["title"] = note_title(&note.content).into();
    v["text"] = note_text(&note.content).trim().to_string().into();
    Ok(v)
}

fn alarm_by_id(db: &Connection, id: &str) -> Result<crate::time::types::Alarm, CommandError> {
    crate::time::store::list_alarms(db, chrono::Utc::now())?
        .into_iter()
        .find(|a| a.id == id)
        .ok_or_else(|| invalid("闹钟不存在，请重新查询。"))
}

fn change(key: String, kind: &str, title: String, before: Value, after: Value) -> Change {
    Change {
        key,
        kind: kind.into(),
        title,
        before,
        after,
    }
}

/// Simulates or applies one local action. Remote calendar actions never come
/// here; see [`preview_remote`].
pub fn perform(db: &Connection, action: &Action) -> Result<Change, CommandError> {
    super::skills::validate(action)?;
    let kind = action.kind();
    match action {
        Action::CreateEvent { draft } => {
            let input = EventInput::from(parse::<EventCreate>(draft)?);
            let event = events::create(db, event_draft(db, None, input)?)?;
            let target = EventTarget {
                id: event.id.clone(),
                occurrence_start_at: None,
            };
            Ok(change(event_key(&target), kind, event.title.clone(), Value::Null, value(&event)?))
        }
        Action::UpdateEvent { target, patch } => {
            let patch = parse::<EventPatch>(patch)?;
            if patch.is_empty() {
                return Err(invalid("修改内容不能为空。"));
            }
            let before = resolve_event(db, target)?;
            if before.series_id.is_some() && patch.all_day.is_some_and(|v| v != before.all_day) {
                return Err(invalid(
                    "暂不支持改变重复日程某一次的全天类型，请使用原有编辑器。",
                ));
            }
            if before.series_id.is_some() && patch.reminders.is_some() {
                return Err(invalid(
                    "重复日程的单次提醒暂不能修改；可调整这次的标题和时间。",
                ));
            }
            let draft = event_draft(db, Some(&before), patch.into())?;
            let scope = if target.occurrence_start_at.is_some() {
                EditScope::Occurrence
            } else {
                EditScope::All
            };
            events::update(db, target, draft, scope)?;
            let after = resolve_event(db, target)?;
            Ok(change(event_key(target), kind, after.title.clone(), value(&before)?, value(&after)?))
        }
        Action::DeleteEvent { target } => {
            let before = resolve_event(db, target)?;
            let scope = if target.occurrence_start_at.is_some() {
                EditScope::Occurrence
            } else {
                EditScope::All
            };
            events::delete(db, target, scope)?;
            Ok(change(event_key(target), kind, before.title.clone(), value(&before)?, Value::Null))
        }
        Action::CreateTask { draft } => {
            let workspace = task_workspace::snapshot(db)?;
            let draft = task_draft(&workspace, parse::<TaskCreate>(draft)?)?;
            let task = task_workspace::create(db, draft)?;
            Ok(change(format!("tasks:{}", task.id), kind, task.title.clone(), Value::Null, value(&task)?))
        }
        Action::UpdateTask { id, patch } => {
            let workspace = task_workspace::snapshot(db)?;
            let task = find_task(&workspace, id)?;
            let draft = task_patch_draft(&workspace, task, parse::<TaskPatch>(patch)?)?;
            let after = task_workspace::update(db, id, draft)?;
            Ok(change(format!("tasks:{id}"), kind, after.title.clone(), value(task)?, value(&after)?))
        }
        Action::DeleteTask { id } => {
            let workspace = task_workspace::snapshot(db)?;
            let task = find_task(&workspace, id)?;
            task_workspace::delete(db, id)?;
            Ok(change(format!("tasks:{id}"), kind, task.title.clone(), value(task)?, Value::Null))
        }
        Action::CreateNote { draft } => {
            let draft = parse::<NoteCreate>(draft)?;
            let note = crate::notes::create(
                db,
                NoteDraft {
                    content: note_delta(&draft.content)?,
                    color: draft.color.map_or(NOTE_COLOR, NoteColor::hex).to_string(),
                    pinned: draft.pinned,
                    icon: draft.icon.map(NoteIcon::as_str).unwrap_or_default().to_string(),
                },
            )?;
            Ok(change(format!("notes:{}", note.id), kind, note_title(&note.content), Value::Null, note_value(&note)?))
        }
        Action::CreateAlarm { draft } => {
            let draft = parse::<AlarmCreate>(draft)?;
            bounded([&draft.title])?;
            let alarm = crate::time::store::create_alarm(
                db,
                AlarmDraft {
                    title: draft.title,
                    hour: draft.hour,
                    minute: draft.minute,
                    repeat: draft.repeat,
                    enabled: draft.enabled,
                },
                chrono::Utc::now(),
            )?;
            Ok(change(format!("alarms:{}", alarm.id), kind, alarm.title.clone(), Value::Null, value(&alarm)?))
        }
        Action::UpdateAlarm { id, patch } => {
            let patch = parse::<AlarmPatch>(patch)?;
            if patch == AlarmPatch::default() {
                return Err(invalid("修改内容不能为空。"));
            }
            bounded(patch.title.iter())?;
            let before = alarm_by_id(db, id)?;
            let after = crate::time::store::update_alarm(db, id, patch, chrono::Utc::now())?;
            Ok(change(format!("alarms:{id}"), kind, after.title.clone(), value(&before)?, value(&after)?))
        }
        Action::DeleteAlarm { id } => {
            let before = alarm_by_id(db, id)?;
            crate::time::store::delete_alarm(db, id)?;
            Ok(change(format!("alarms:{id}"), kind, before.title.clone(), value(&before)?, Value::Null))
        }
        Action::CreateRemoteEvent { .. } | Action::UpdateRemoteEvent { .. } => {
            Err(invalid("远端日历操作不能在本地模拟执行。"))
        }
        Action::UpdateNote { .. } | Action::DeleteNote { .. } => {
            unreachable!("rejected by skills::validate")
        }
    }
}

fn external_by_target(db: &Connection, target: &RemoteTarget) -> Result<ExternalEvent, CommandError> {
    crate::subscriptions::list_external(db)?
        .into_iter()
        .find(|e| {
            e.subscription_id == target.subscription_id
                && e.remote_event_id.as_deref() == Some(target.remote_event_id.as_str())
        })
        .ok_or_else(|| invalid("远端日程不存在或尚未同步，请重新查询。"))
}

fn writable_calendar(
    db: &Connection,
    subscription_id: &str,
) -> Result<crate::models::CalendarSubscription, CommandError> {
    if !crate::subscriptions::writable_ids(db)?
        .iter()
        .any(|id| id == subscription_id)
    {
        return Err(invalid("该日历不可写入。请使用查询结果中的可写日历，或重新连接账户。"));
    }
    crate::subscriptions::fetch_one(db, subscription_id)
}

/// The event a remote action will write, in the same shape it is shown in the
/// preview. Execution and undo rebuild drafts from this, so what runs is what
/// the user saw.
fn remote_value(
    target: Option<&RemoteTarget>,
    calendar: &crate::models::CalendarSubscription,
    draft: &EventDraft,
) -> Value {
    json!({
        "subscriptionId": calendar.id,
        "remoteEventId": target.map(|t| t.remote_event_id.clone()),
        "calendar": calendar.name,
        "provider": calendar.provider,
        "title": draft.title,
        "startAt": draft.start_at,
        "endAt": draft.end_at,
        "allDay": draft.all_day,
        "note": draft.note,
        "reminders": draft.reminders,
    })
}

/// Rebuilds the draft stored by [`remote_value`].
pub fn remote_draft(value: &Value) -> Result<EventDraft, CommandError> {
    let text = |key: &str| value[key].as_str().unwrap_or_default().to_string();
    Ok(EventDraft {
        title: text("title"),
        start_at: text("startAt"),
        end_at: text("endAt"),
        start_tz: None,
        end_tz: None,
        all_day: value["allDay"].as_bool().unwrap_or(false),
        category: String::new(),
        color: String::new(),
        linked_task_id: None,
        note: text("note"),
        reminders: serde_json::from_value(value["reminders"].clone()).unwrap_or_default(),
        recurrence: None,
    })
}

/// Builds the preview of a remote calendar write without any network I/O.
pub fn preview_remote(db: &Connection, action: &Action) -> Result<Change, CommandError> {
    super::skills::validate(action)?;
    let kind = action.kind();
    match action {
        Action::CreateRemoteEvent { subscription_id, draft } => {
            let calendar = writable_calendar(db, subscription_id)?;
            let draft = parse::<RemoteEventCreate>(draft)?;
            bounded([&draft.title].into_iter().chain(draft.note.iter()))?;
            let start = draft.start_at.clone();
            wall(&start)?;
            let event = crate::remote_events::validate_remote_draft(EventDraft {
                title: draft.title,
                end_at: end_for(None, &start, true, draft.end_at)?,
                start_at: start,
                start_tz: None,
                end_tz: None,
                all_day: draft.all_day,
                category: String::new(),
                color: String::new(),
                linked_task_id: None,
                note: draft.note.unwrap_or_default(),
                reminders: draft.reminders,
                recurrence: None,
            })?;
            Ok(change(
                format!("remote:{subscription_id}:new"),
                kind,
                event.title.clone(),
                Value::Null,
                remote_value(None, &calendar, &event),
            ))
        }
        Action::UpdateRemoteEvent { target, patch } => {
            let patch = parse::<RemoteEventPatch>(patch)?;
            if patch.is_empty() {
                return Err(invalid("修改内容不能为空。"));
            }
            bounded(patch.title.iter().chain(patch.note.iter()))?;
            let calendar = writable_calendar(db, &target.subscription_id)?;
            let base = external_by_target(db, target)?;
            let before = EventDraft {
                title: base.title.clone(),
                start_at: base.start_at.clone(),
                end_at: base.end_at.clone(),
                start_tz: None,
                end_tz: None,
                all_day: base.all_day,
                category: String::new(),
                color: String::new(),
                linked_task_id: None,
                note: base.description.clone().unwrap_or_default(),
                reminders: base.reminders.clone(),
                recurrence: None,
            };
            let start = patch.start_at.clone().unwrap_or_else(|| base.start_at.clone());
            wall(&start)?;
            let after = crate::remote_events::validate_remote_draft(EventDraft {
                title: patch.title.unwrap_or_else(|| before.title.clone()),
                end_at: end_for(
                    Some((&base.start_at, &base.end_at)),
                    &start,
                    patch.start_at.is_some(),
                    patch.end_at,
                )?,
                start_at: start,
                all_day: patch.all_day.unwrap_or(before.all_day),
                note: patch.note.unwrap_or_else(|| before.note.clone()),
                reminders: patch.reminders.unwrap_or_else(|| before.reminders.clone()),
                ..before.clone()
            })?;
            Ok(change(
                remote_key(target),
                kind,
                after.title.clone(),
                remote_value(Some(target), &calendar, &before),
                remote_value(Some(target), &calendar, &after),
            ))
        }
        _ => Err(invalid("不是远端日历操作。")),
    }
}

fn steps_value(task: &Task) -> Value {
    task.steps
        .iter()
        .map(|s| json!({"id":s.id,"title":s.title,"completed":s.completed}))
        .collect()
}

pub fn query(db: &Connection, q: &Query, p: &Permissions) -> Result<QueryResult, CommandError> {
    let mut records = vec![];
    let text = q.text.to_lowercase();
    if text.len() > 500 {
        return Err(invalid("查询文字过长。"));
    }
    let mut metadata = json!({});
    match q.domain.as_str() {
        "calendar" => {
            if !p.calendar && !p.external {
                return Err(invalid("尚未授权日历读取。"));
            }
            let start = date(q.start_date.as_deref().unwrap_or(""))?;
            let end = date(q.end_date.as_deref().unwrap_or(""))?;
            if end < start || (end - start).num_days() >= 90 {
                return Err(invalid("单次日历查询必须在1至90天内。"));
            }
            let range = EventRange {
                start_at: format!("{start}T00:00"),
                end_at_exclusive: format!(
                    "{}T00:00",
                    end.checked_add_signed(Duration::days(1))
                        .ok_or_else(|| invalid("日期超出范围。"))?
                ),
            };
            if p.calendar {
                for e in events::list_in_range(db, &range)? {
                    let target = EventTarget {
                        id: e.id.clone(),
                        occurrence_start_at: e.occurrence_start_at.clone(),
                    };
                    records.push(Record {
                        key: event_key(&target),
                        domain: "calendar".into(),
                        title: e.title.clone(),
                        source: "本地日历".into(),
                        read_only: false,
                        data: json!({"id":e.id,"target":target,"startAt":e.start_at,"endAt":e.end_at,"allDay":e.all_day,
                            "category":e.category,"reminders":e.reminders,"seriesId":e.series_id,"note":excerpt(&note_text(&e.note))}),
                    });
                }
            }
            let remote = p.allows("remoteCalendar");
            if p.external {
                let sources = crate::subscriptions::list(db)?;
                for e in crate::subscriptions::list_external_in_range(db, &range)? {
                    let source = sources.iter().find(|s| s.id == e.subscription_id);
                    let writable = remote && e.writable && e.remote_event_id.is_some();
                    let mut data = json!({"id":e.id,"startAt":e.start_at,"endAt":e.end_at,"allDay":e.all_day,
                        "lastSyncedAt":source.and_then(|s|s.last_synced_at.clone())});
                    if writable {
                        data["subscriptionId"] = e.subscription_id.clone().into();
                        data["remoteEventId"] = e.remote_event_id.clone().into();
                        data["reminders"] = json!(e.reminders);
                        data["note"] = excerpt(e.description.as_deref().unwrap_or_default()).into();
                    }
                    // Writable records use the key an updateRemoteEvent targets,
                    // so the host can check the model only changes what it read.
                    let key = match (&e.remote_event_id, writable) {
                        (Some(remote), true) => remote_key(&RemoteTarget {
                            subscription_id: e.subscription_id.clone(),
                            remote_event_id: remote.clone(),
                        }),
                        _ => format!("external:{}", e.id),
                    };
                    records.push(Record {
                        key,
                        domain: "calendar".into(),
                        title: e.title.clone(),
                        source: source.map(|s| s.name.clone()).unwrap_or_else(|| "外部日历".into()),
                        read_only: !writable,
                        data,
                    });
                }
            }
            // People name events loosely ("早会" for an event titled "开会") and
            // identify them by time, so a title that matches nothing in the
            // range returns the whole range instead of an empty result.
            let matched: Vec<Record> = records
                .iter()
                .filter(|r| r.title.to_lowercase().contains(&text))
                .cloned()
                .collect();
            let text_matched = !matched.is_empty() || records.is_empty();
            if text_matched {
                records = matched;
            }
            metadata = json!({"startDate":start.to_string(),"endDate":end.to_string(),"externalIncluded":p.external,"localIncluded":p.calendar,"textMatched":text_matched});
            if p.calendar {
                metadata["categories"] = crate::categories::list(db)?
                    .iter()
                    .map(|c| json!({"id":c.id,"name":c.name}))
                    .collect();
            }
            if remote {
                let writable = crate::subscriptions::writable_ids(db)?;
                metadata["writableCalendars"] = crate::subscriptions::list(db)?
                    .iter()
                    .filter(|s| writable.contains(&s.id))
                    .map(|s| json!({"id":s.id,"name":s.name,"provider":s.provider}))
                    .collect();
            }
            records.sort_by(|a, b| {
                a.data["startAt"]
                    .as_str()
                    .cmp(&b.data["startAt"].as_str())
                    .then(a.key.cmp(&b.key))
            });
        }
        "tasks" => {
            if !p.tasks {
                return Err(invalid("尚未授权任务读取。"));
            }
            let workspace = task_workspace::snapshot(db)?;
            if let Some(value) = &q.due_before {
                date(value)?;
            }
            for t in workspace.tasks.iter().filter(|t| {
                t.title.to_lowercase().contains(&text)
                    && q.completed.is_none_or(|v| t.completed == v)
                    && q.priority.as_ref().is_none_or(|v| &t.priority == v)
                    && q.lane_id.as_ref().is_none_or(|v| t.lane_id.as_ref() == Some(v))
                    && q.due_before
                        .as_ref()
                        .is_none_or(|v| t.due_date.as_ref().is_some_and(|d| d <= v))
            }) {
                records.push(Record {
                    key: format!("tasks:{}", t.id),
                    domain: "tasks".into(),
                    title: t.title.clone(),
                    source: "本地任务".into(),
                    read_only: false,
                    data: json!({"id":t.id,"description":excerpt(&t.description),"priority":t.priority,"dueDate":t.due_date,
                        "completed":t.completed,"completedAt":t.completed_at,"laneId":t.lane_id,"tagIds":t.tag_ids,"steps":steps_value(t)}),
                });
            }
            metadata = json!({
                "lanes": workspace.lanes.iter().map(|l| json!({"id":l.id,"name":l.name})).collect::<Vec<_>>(),
                "tags": workspace.tags.iter().filter(|t| t.archived_at.is_none()).map(|t| json!({"id":t.id,"name":t.name})).collect::<Vec<_>>(),
            });
        }
        "notes" => {
            if !p.notes {
                return Err(invalid("尚未授权便签读取。"));
            }
            for n in crate::notes::list(db)? {
                let body = note_text(&n.content);
                if !body.to_lowercase().contains(&text) {
                    continue;
                }
                records.push(Record {
                    key: format!("notes:{}", n.id),
                    domain: "notes".into(),
                    title: note_title(&n.content),
                    source: "本地便签".into(),
                    read_only: true,
                    data: json!({"id":n.id,"excerpt":excerpt(&body),"pinned":n.pinned,"updatedAt":n.updated_at}),
                });
            }
        }
        "alarms" => {
            if !p.alarms {
                return Err(invalid("尚未授权闹钟读取。"));
            }
            for a in crate::time::store::list_alarms(db, chrono::Utc::now())?
                .into_iter()
                .filter(|a| a.title.to_lowercase().contains(&text))
            {
                records.push(Record {
                    key: format!("alarms:{}", a.id),
                    domain: "alarms".into(),
                    title: a.title.clone(),
                    source: "本地闹钟".into(),
                    read_only: false,
                    data: json!({"id":a.id,"hour":a.hour,"minute":a.minute,"repeat":a.repeat,"enabled":a.enabled,"nextOccurrence":a.next_occurrence}),
                });
            }
        }
        _ => return Err(invalid("只支持日历、任务、便签和闹钟查询。")),
    }
    let truncated = records.len() > 200;
    records.truncate(200);
    Ok(QueryResult {
        revision: store::revision(db)?,
        records,
        truncated,
        metadata,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ops(text: &str) -> Vec<Value> {
        let delta: Value = serde_json::from_str(&note_delta(text).unwrap()).unwrap();
        delta["ops"].as_array().unwrap().clone()
    }

    #[test]
    fn note_markdown_becomes_quill_blocks() {
        assert_eq!(
            ops("# Trip\n- [ ] Passport\n- [x] Tickets\n- Snacks\n2. Pack\nplain"),
            vec![
                json!({"insert":"Trip"}),
                json!({"insert":"\n","attributes":{"header":1}}),
                json!({"insert":"Passport"}),
                json!({"insert":"\n","attributes":{"list":"unchecked"}}),
                json!({"insert":"Tickets"}),
                json!({"insert":"\n","attributes":{"list":"checked"}}),
                json!({"insert":"Snacks"}),
                json!({"insert":"\n","attributes":{"list":"bullet"}}),
                json!({"insert":"Pack"}),
                json!({"insert":"\n","attributes":{"list":"ordered"}}),
                json!({"insert":"plain"}),
                json!({"insert":"\n"}),
            ]
        );
        // Not Markdown: a hashtag, a five-level heading, a number without a dot.
        for text in ["#tag", "##### deep", "2026 plans"] {
            assert_eq!(ops(text)[0], json!({ "insert": text }), "{text}");
        }
        assert!(note_delta(" \n\n ").is_err());
    }
}
