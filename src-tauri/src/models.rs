use crate::recurrence::Recurrence;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub id: String,
    pub title: String,
    pub start_at: String,
    pub end_at: String,
    /// 事件自身的具名 IANA 时区；浮动/全天为 None。
    pub start_tz: Option<String>,
    pub end_tz: Option<String>,
    pub all_day: bool,
    pub category: String,
    pub color: String,
    pub linked_task_id: Option<String>,
    pub note: String,
    /// 提前提醒的分钟数偏移量列表，例如 [10, 60] 表示开始前 10 分钟与 60 分钟各提醒一次。
    #[serde(default)]
    pub reminders: Vec<i64>,
    pub created_at: String,
    pub updated_at: String,
    pub recurrence: Option<Recurrence>,
    /// 标准 RFC 5545 RRULE 串（不含 `RRULE:` 前缀），供前端只读展示与 Spec B 使用。
    /// 单次事件为 None。
    pub rrule: Option<String>,
    /// 重复实例所属系列的行 id；单次日程为 None。`id` 始终是数据库行 id。
    pub series_id: Option<String>,
    /// 该实例所属系列的开始时刻（dtstart）；单次日程为 None。
    /// 与 `occurrence_start_at` 相等即表示这是系列的首个实例。
    pub series_start_at: Option<String>,
    /// 该实例原本应发生的时刻，即例外的身份键；单次日程为 None。
    pub occurrence_start_at: Option<String>,
    pub is_overridden: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub title: String,
    pub quadrant: String,
    pub due_at: Option<String>,
    pub priority: i64,
    pub completed: bool,
    pub linked_event_id: Option<String>,
    pub note: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub title: String,
    pub content: String,
    pub color: String,
    pub pinned: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventDraft {
    pub title: String,
    pub start_at: String,
    pub end_at: String,
    #[serde(default)]
    pub start_tz: Option<String>,
    #[serde(default)]
    pub end_tz: Option<String>,
    pub all_day: bool,
    pub category: String,
    pub color: String,
    pub linked_task_id: Option<String>,
    pub note: String,
    #[serde(default)]
    pub reminders: Vec<i64>,
    pub recurrence: Option<Recurrence>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventTarget {
    pub id: String,
    /// 为 None 时表示目标是单次日程，此时 scope 必须为 All。
    pub occurrence_start_at: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EditScope {
    Occurrence,
    ThisAndFollowing,
    All,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskDraft {
    pub title: String,
    pub quadrant: String,
    pub due_at: Option<String>,
    pub priority: i64,
    pub completed: bool,
    pub linked_event_id: Option<String>,
    pub note: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteDraft {
    pub title: String,
    pub content: String,
    pub color: String,
    pub pinned: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventRange {
    pub start_at: String,
    pub end_at_exclusive: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub wallpaper_enabled: bool,
    pub launch_at_login: bool,
    pub target_monitor_id: Option<String>,
    pub density: String,
    pub week_start: String,
    pub date_format: String,
    pub show_weekends: bool,
    #[serde(default)]
    pub recent_colors: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleLayoutEntry {
    pub id: String,
    pub x: i64,
    pub y: i64,
    pub w: i64,
    pub h: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KanbanLane {
    pub id: String,
    pub name: String,
    pub color: String,
    pub position: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KanbanLaneDraft {
    pub name: String,
    pub color: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KanbanCard {
    pub id: String,
    pub lane_id: String,
    pub title: String,
    pub description: Option<String>,
    pub due_date: Option<String>,
    pub priority_id: Option<String>,
    pub position: i64,
    pub tag_ids: Vec<String>,
    pub collaborator_ids: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KanbanCardDraft {
    pub lane_id: String,
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub due_date: Option<String>,
    #[serde(default)]
    pub priority_id: Option<String>,
    #[serde(default)]
    pub tag_ids: Vec<String>,
    #[serde(default)]
    pub collaborator_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KanbanPriority {
    pub id: String,
    pub name: String,
    pub color: String,
    pub position: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KanbanPriorityDraft {
    pub name: String,
    pub color: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KanbanTag {
    pub id: String,
    pub name: String,
    pub color: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KanbanTagDraft {
    pub name: String,
    pub color: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KanbanCollaborator {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KanbanCollaboratorDraft {
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KanbanSnapshot {
    pub lanes: Vec<KanbanLane>,
    pub cards: Vec<KanbanCard>,
    pub priorities: Vec<KanbanPriority>,
    pub tags: Vec<KanbanTag>,
    pub collaborators: Vec<KanbanCollaborator>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SandboxExtension {
    pub id: String,
    pub name: String,
    pub description: String,
    pub source: String,
    pub permissions: Vec<String>,
    #[serde(default)]
    pub allowed_hosts: Vec<String>,
    pub min_w: i64,
    pub min_h: i64,
    pub default_w: i64,
    pub default_h: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SandboxExtensionDraft {
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub source: String,
    #[serde(default)]
    pub permissions: Vec<String>,
    #[serde(default)]
    pub allowed_hosts: Vec<String>,
    pub default_w: i64,
    pub default_h: i64,
}

#[cfg(test)]
mod tests {
    use super::{EditScope, Event, EventDraft, EventTarget, NoteDraft, TaskDraft};
    use crate::recurrence::{Freq, Recurrence, RecurrenceEnd};
    use serde_json::{json, Value};

    fn event() -> Event {
        Event {
            id: "e1".into(),
            title: "评审".into(),
            start_at: "2026-08-10T10:00".into(),
            end_at: "2026-08-10T11:00".into(),
            start_tz: None,
            end_tz: None,
            all_day: false,
            category: "work".into(),
            color: "#4FC9DA".into(),
            linked_task_id: None,
            note: "".into(),
            reminders: Vec::new(),
            created_at: "2026-08-01T08:00:00Z".into(),
            updated_at: "2026-08-01T08:00:00Z".into(),
            recurrence: None,
            rrule: None,
            series_id: None,
            series_start_at: None,
            occurrence_start_at: None,
            is_overridden: false,
        }
    }

    #[test]
    fn event_serializes_timezone_and_rrule_fields() {
        let value = serde_json::to_value(event()).expect("event serializes");
        let object = value.as_object().expect("object");
        // 浮动事件三字段为 null。
        assert_eq!(object.get("startTz"), Some(&Value::Null));
        assert_eq!(object.get("endTz"), Some(&Value::Null));
        assert_eq!(object.get("rrule"), Some(&Value::Null));
        // snake_case 不泄漏。
        for snake in ["start_tz", "end_tz"] {
            assert!(!object.contains_key(snake));
        }
    }

    #[test]
    fn serializes_event_target_and_scope_in_camel_case() {
        let target = EventTarget {
            id: "s1".into(),
            occurrence_start_at: Some("2026-08-10T10:00".into()),
        };
        assert_eq!(
            serde_json::to_value(&target).expect("target serializes"),
            json!({ "id": "s1", "occurrenceStartAt": "2026-08-10T10:00" })
        );

        // 单次日程目标必须序列化出显式 null，前端类型是 string | null 而非可选属性。
        assert_eq!(
            serde_json::to_value(EventTarget {
                id: "e1".into(),
                occurrence_start_at: None,
            })
            .expect("target serializes"),
            json!({ "id": "e1", "occurrenceStartAt": null })
        );

        for (scope, literal) in [
            (EditScope::Occurrence, "\"occurrence\""),
            (EditScope::ThisAndFollowing, "\"thisAndFollowing\""),
            (EditScope::All, "\"all\""),
        ] {
            assert_eq!(
                serde_json::to_string(&scope).expect("scope serializes"),
                literal
            );
            assert_eq!(
                serde_json::from_str::<EditScope>(literal).expect("scope parses"),
                scope
            );
        }
    }

    #[test]
    fn serializes_event_recurrence_fields_in_camel_case() {
        let value = serde_json::to_value(event()).expect("event serializes");
        let object = value.as_object().expect("event serializes to an object");

        // 用 Some(&Null) 而不是 is_null()，以区分「键存在且为 null」与「键被省略」。
        assert_eq!(object.get("recurrence"), Some(&Value::Null));
        assert_eq!(object.get("seriesId"), Some(&Value::Null));
        assert_eq!(object.get("seriesStartAt"), Some(&Value::Null));
        assert_eq!(object.get("occurrenceStartAt"), Some(&Value::Null));
        assert_eq!(object.get("isOverridden"), Some(&Value::Bool(false)));
        for snake in [
            "series_id",
            "series_start_at",
            "occurrence_start_at",
            "is_overridden",
        ] {
            assert!(!object.contains_key(snake), "{snake} 不应出现在契约里");
        }

        let overridden = Event {
            series_id: Some("s1".into()),
            series_start_at: Some("2026-08-03T10:00".into()),
            occurrence_start_at: Some("2026-08-10T10:00".into()),
            is_overridden: true,
            recurrence: Some(rule()),
            ..event()
        };
        let value = serde_json::to_value(&overridden).expect("event serializes");
        assert_eq!(value["seriesId"], json!("s1"));
        assert_eq!(value["seriesStartAt"], json!("2026-08-03T10:00"));
        assert_eq!(value["occurrenceStartAt"], json!("2026-08-10T10:00"));
        assert_eq!(value["isOverridden"], json!(true));
        assert_eq!(
            serde_json::from_value::<Event>(value).expect("event parses"),
            overridden
        );
    }

    fn rule() -> Recurrence {
        Recurrence {
            freq: Freq::Weekly,
            interval: 2,
            by_day: vec!["MO".into()],
            end: RecurrenceEnd::Count { count: 5 },
        }
    }

    #[test]
    fn serializes_recurrence_end_as_a_tagged_union() {
        assert_eq!(
            serde_json::to_value(rule()).expect("rule serializes"),
            json!({
                "freq": "weekly",
                "interval": 2,
                "byDay": ["MO"],
                "end": { "kind": "count", "count": 5 }
            })
        );
        assert_eq!(
            serde_json::to_value(RecurrenceEnd::Never).expect("end serializes"),
            json!({ "kind": "never" })
        );
        assert_eq!(
            serde_json::to_value(RecurrenceEnd::Until {
                date: "2026-09-30".into()
            })
            .expect("end serializes"),
            json!({ "kind": "until", "date": "2026-09-30" })
        );
    }

    #[test]
    fn event_draft_carries_an_optional_recurrence() {
        let base = json!({
            "title": "评审",
            "startAt": "2026-08-10T10:00",
            "endAt": "2026-08-10T11:00",
            "allDay": false,
            "category": "work",
            "color": "blue",
            "linkedTaskId": null,
            "note": ""
        });

        let plain: EventDraft = serde_json::from_value(base.clone()).expect("draft parses");
        assert_eq!(plain.recurrence, None);

        let mut with_rule = base;
        with_rule["recurrence"] = json!({
            "freq": "weekly",
            "interval": 2,
            "byDay": ["MO"],
            "end": { "kind": "count", "count": 5 }
        });
        let repeating: EventDraft = serde_json::from_value(with_rule).expect("draft parses");
        assert_eq!(repeating.recurrence, Some(rule()));
    }

    #[test]
    fn note_draft_deserializes_camel_case() {
        let draft: NoteDraft = serde_json::from_value(serde_json::json!({
            "title": "产品原则",
            "content": "保持简单",
            "color": "purple",
            "pinned": true
        }))
        .unwrap();

        assert_eq!(draft.title, "产品原则");
        assert_eq!(draft.color, "purple");
        assert!(draft.pinned);
    }

    #[test]
    fn task_draft_deserializes_camel_case() {
        let draft: TaskDraft = serde_json::from_value(serde_json::json!({
            "title": "发布 Nowly",
            "quadrant": "important_urgent",
            "dueAt": "2026-07-23",
            "priority": 1,
            "completed": false,
            "linkedEventId": "e1",
            "note": "发布前检查"
        }))
        .unwrap();

        assert_eq!(draft.due_at.as_deref(), Some("2026-07-23"));
        assert_eq!(draft.linked_event_id.as_deref(), Some("e1"));
        assert_eq!(draft.priority, 1);
    }

    #[test]
    fn event_draft_deserializes_camel_case() {
        let draft: EventDraft = serde_json::from_value(serde_json::json!({
            "title": "评审",
            "startAt": "2026-07-23T14:00",
            "endAt": "2026-07-23T15:00",
            "allDay": false,
            "category": "work",
            "color": "blue",
            "linkedTaskId": null,
            "note": "确认范围"
        }))
        .unwrap();
        assert_eq!(draft.start_at, "2026-07-23T14:00");
        assert_eq!(draft.linked_task_id, None);
    }
}
