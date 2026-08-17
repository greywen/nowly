use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub id: String,
    pub title: String,
    pub start_at: String,
    pub end_at: String,
    pub all_day: bool,
    pub category: String,
    pub color: String,
    pub linked_task_id: Option<String>,
    pub note: String,
    pub created_at: String,
    pub updated_at: String,
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
    pub all_day: bool,
    pub category: String,
    pub color: String,
    pub linked_task_id: Option<String>,
    pub note: String,
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
    use super::{EventDraft, NoteDraft, TaskDraft};

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
