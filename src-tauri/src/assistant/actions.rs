//! Typed, field-whitelisted domain adapters. No arbitrary SQL/model code.
use super::{store, types::*};
use crate::{
    error::CommandError,
    events,
    models::{EditScope, Event, EventDraft, EventRange, EventTarget, TaskDraft},
    task_workspace, timezone,
};
use chrono::{Duration, NaiveDate, TimeZone};
use rusqlite::{Connection, OptionalExtension};
use serde_json::{json, Value};

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
fn merge(mut base: Value, patch: &Value, allowed: &[&str]) -> Result<Value, CommandError> {
    let fields = patch
        .as_object()
        .ok_or_else(|| invalid("操作字段必须是对象。"))?;
    if fields.is_empty() || fields.keys().any(|k| !allowed.contains(&k.as_str())) {
        return Err(invalid("操作包含不支持的字段。"));
    }
    for (k, v) in fields {
        if v.as_str().is_some_and(|s| s.len() > 16000) {
            return Err(invalid("字段内容过长。"));
        }
        base[k] = v.clone();
    }
    Ok(base)
}
pub fn event_key(target: &EventTarget) -> String {
    format!(
        "calendar:{}:{}",
        target.id,
        target.occurrence_start_at.as_deref().unwrap_or("")
    )
}
pub fn resolve_event(db: &Connection, target: &EventTarget) -> Result<Event, CommandError> {
    let event = events::event_by_id(db, &target.id)?
        .ok_or_else(|| invalid("未找到本地日程。外部日历不支持写入。"))?;
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

const EVENT_FIELDS: &[&str] = &[
    "title",
    "startAt",
    "endAt",
    "allDay",
    "category",
    "color",
    "note",
    "reminders",
];
const TASK_FIELDS: &[&str] = &[
    "title",
    "description",
    "priority",
    "dueDate",
    "completed",
    "laneId",
];

fn event_draft(base: Option<&Event>, patch: &Value) -> Result<EventDraft, CommandError> {
    let defaults = match base {
        Some(e) => {
            json!({"title":e.title,"startAt":e.start_at,"endAt":e.end_at,"allDay":e.all_day,"category":e.category,"color":e.color,"note":e.note,"reminders":e.reminders,"recurrence":null,"linkedTaskId":e.linked_task_id})
        }
        None => {
            json!({"title":"","startAt":"","endAt":"","allDay":false,"category":"work","color":"#4fc9da","note":"","reminders":[],"recurrence":null})
        }
    };
    let mut merged = merge(defaults, patch, EVENT_FIELDS)?;
    let start = merged["startAt"]
        .as_str()
        .ok_or_else(|| invalid("开始时间格式无效。"))?;
    let start_wall = wall(start)?;
    if patch.get("endAt").is_none() && (base.is_none() || patch.get("startAt").is_some()) {
        let duration = base
            .map(|e| Ok(wall(&e.end_at)? - wall(&e.start_at)?))
            .transpose()?
            .unwrap_or(Duration::hours(1));
        merged["endAt"] = timezone::format_wall(
            start_wall
                .checked_add_signed(duration)
                .ok_or_else(|| invalid("日程结束时间超出范围。"))?,
        )
        .into();
    }
    let mut draft: EventDraft =
        serde_json::from_value(merged).map_err(|_| invalid("日程字段类型无效。"))?;
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

pub fn perform(db: &Connection, action: &Action) -> Result<Change, CommandError> {
    match action {
        Action::CreateEvent { draft } => {
            let event = events::create(db, event_draft(None, draft)?)?;
            Ok(Change {
                key: event_key(&EventTarget {
                    id: event.id.clone(),
                    occurrence_start_at: None,
                }),
                kind: "createEvent".into(),
                title: event.title.clone(),
                before: Value::Null,
                after: value(&event)?,
            })
        }
        Action::UpdateEvent { target, patch } => {
            let before = resolve_event(db, target)?;
            if before.series_id.is_some()
                && patch
                    .get("allDay")
                    .is_some_and(|v| v.as_bool() != Some(before.all_day))
            {
                return Err(invalid(
                    "暂不支持改变重复日程某一次的全天类型，请使用原有编辑器。",
                ));
            }
            if before.series_id.is_some() && patch.get("reminders").is_some() {
                return Err(invalid(
                    "重复日程的单次提醒暂不能修改；可调整这次的标题和时间。",
                ));
            }
            let draft = event_draft(Some(&before), patch)?;
            let scope = if target.occurrence_start_at.is_some() {
                EditScope::Occurrence
            } else {
                EditScope::All
            };
            events::update(db, target, draft, scope)?;
            let after = resolve_event(db, target)?;
            Ok(Change {
                key: event_key(target),
                kind: "updateEvent".into(),
                title: after.title.clone(),
                before: value(&before)?,
                after: value(&after)?,
            })
        }
        Action::DeleteEvent { target } => {
            let before = resolve_event(db, target)?;
            let scope = if target.occurrence_start_at.is_some() {
                EditScope::Occurrence
            } else {
                EditScope::All
            };
            events::delete(db, target, scope)?;
            Ok(Change {
                key: event_key(target),
                kind: "deleteEvent".into(),
                title: before.title.clone(),
                before: value(&before)?,
                after: Value::Null,
            })
        }
        Action::CreateTask { draft } => {
            let workspace = task_workspace::snapshot(db)?;
            let defaults = json!({"title":"","description":"","priority":null,"dueDate":null,"completed":false,"laneId":workspace.default_lane_id});
            let mut merged = merge(defaults, draft, TASK_FIELDS)?;
            if draft.get("laneId").is_some() && draft.get("completed").is_none() {
                merged["completed"] = (merged["laneId"] == workspace.completion_lane_id).into();
            }
            let draft: TaskDraft =
                serde_json::from_value(merged).map_err(|_| invalid("任务字段类型无效。"))?;
            if let Some(value) = &draft.due_date {
                date(value)?;
            }
            let origin = if draft.priority.is_some() {
                "matrix"
            } else {
                "kanban"
            };
            let task = task_workspace::create(db, origin, draft)?;
            Ok(Change {
                key: format!("tasks:{}", task.id),
                kind: "createTask".into(),
                title: task.title.clone(),
                before: Value::Null,
                after: value(&task)?,
            })
        }
        Action::UpdateTask { id, patch } => {
            let workspace = task_workspace::snapshot(db)?;
            let task = workspace
                .tasks
                .iter()
                .find(|t| &t.id == id)
                .ok_or_else(|| invalid("任务不存在，请重新查询。"))?;
            let mut merged = merge(value(task)?, patch, TASK_FIELDS)?;
            if patch.get("laneId").is_some() && patch.get("completed").is_none() {
                merged["completed"] = (merged["laneId"] == workspace.completion_lane_id).into();
            }
            let mut draft: TaskDraft =
                serde_json::from_value(merged).map_err(|_| invalid("任务字段类型无效。"))?;
            if let Some(value) = &draft.due_date {
                date(value)?;
            }
            draft.views = None;
            let after = task_workspace::update(db, id, draft)?;
            Ok(Change {
                key: format!("tasks:{id}"),
                kind: "updateTask".into(),
                title: after.title.clone(),
                before: value(task)?,
                after: value(&after)?,
            })
        }
        Action::DeleteTask { id } => {
            let workspace = task_workspace::snapshot(db)?;
            let task = workspace
                .tasks
                .iter()
                .find(|t| &t.id == id)
                .ok_or_else(|| invalid("任务不存在，请重新查询。"))?;
            task_workspace::delete(db, id)?;
            Ok(Change {
                key: format!("tasks:{id}"),
                kind: "deleteTask".into(),
                title: task.title.clone(),
                before: value(task)?,
                after: Value::Null,
            })
        }
    }
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
                for e in events::list_in_range(db, &range)?
                    .into_iter()
                    .filter(|e| e.title.to_lowercase().contains(&text))
                {
                    let target = EventTarget {
                        id: e.id.clone(),
                        occurrence_start_at: e.occurrence_start_at.clone(),
                    };
                    records.push(Record{key:event_key(&target),domain:"calendar".into(),title:e.title.clone(),source:"本地日历".into(),read_only:false,
                        data:json!({"id":e.id,"target":target,"startAt":e.start_at,"endAt":e.end_at,"allDay":e.all_day,"reminders":e.reminders,"seriesId":e.series_id})});
                }
            }
            if p.external {
                let sources = crate::subscriptions::list(db)?;
                for e in crate::subscriptions::list_external_in_range(db, &range)?
                    .into_iter()
                    .filter(|e| e.title.to_lowercase().contains(&text))
                {
                    let source = sources.iter().find(|s| s.id == e.subscription_id);
                    records.push(Record{key:format!("external:{}",e.id),domain:"calendar".into(),title:e.title.clone(),
                        source:source.map(|s|s.name.clone()).unwrap_or_else(||"外部日历".into()),read_only:true,
                        data:json!({"id":e.id,"startAt":e.start_at,"endAt":e.end_at,"allDay":e.all_day,"lastSyncedAt":source.and_then(|s|s.last_synced_at.clone())})});
                }
            }
            metadata = json!({"startDate":start.to_string(),"endDate":end.to_string(),"externalIncluded":p.external,"localIncluded":p.calendar});
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
                    && q.priority
                        .as_ref()
                        .is_none_or(|v| t.priority.as_ref() == Some(v))
                    && q.lane_id.as_ref().is_none_or(|v| &t.lane_id == v)
                    && q.due_before
                        .as_ref()
                        .is_none_or(|v| t.due_date.as_ref().is_some_and(|d| d <= v))
            }) {
                records.push(Record{key:format!("tasks:{}",t.id),domain:"tasks".into(),title:t.title.clone(),source:"本地任务".into(),read_only:false,
                    data:json!({"id":t.id,"priority":t.priority,"dueDate":t.due_date,"completed":t.completed,"laneId":t.lane_id,"views":t.views})});
            }
            metadata = json!({"lanes":workspace.lanes.iter().map(|l|json!({"id":l.id,"name":l.name})).collect::<Vec<_>>(),
                "defaultLaneId":workspace.default_lane_id,"completionLaneId":workspace.completion_lane_id,"linkingEnabled":workspace.linking_enabled});
        }
        _ => return Err(invalid("只支持日历和任务查询。")),
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
