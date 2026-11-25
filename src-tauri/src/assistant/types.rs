use crate::models::EventTarget;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Permissions {
    pub calendar: bool,
    pub tasks: bool,
    pub external: bool,
    // Configs saved before notes existed have no such key.
    #[serde(default)]
    pub notes: bool,
    #[serde(default)]
    pub alarms: bool,
    /// Creating and editing events in connected Google/Microsoft calendars.
    /// Also needs `external`, which lets the assistant read them.
    #[serde(default)]
    pub external_write: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Action {
    CreateEvent { draft: Value },
    UpdateEvent { target: EventTarget, patch: Value },
    DeleteEvent { target: EventTarget },
    CreateTask { draft: Value },
    UpdateTask { id: String, patch: Value },
    DeleteTask { id: String },
    CreateNote { draft: Value },
    /// Retired: rewriting a note as plain text destroyed its formatting. Kept
    /// so stored plans still decode for history; never prepared again.
    UpdateNote { id: String, patch: Value },
    /// Retired together with `UpdateNote`.
    DeleteNote { id: String },
    CreateAlarm { draft: Value },
    UpdateAlarm { id: String, patch: Value },
    DeleteAlarm { id: String },
    CreateRemoteEvent { subscription_id: String, draft: Value },
    UpdateRemoteEvent { target: RemoteTarget, patch: Value },
}

/// An event in a connected Google or Microsoft calendar.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemoteTarget {
    pub subscription_id: String,
    pub remote_event_id: String,
}

impl Action {
    pub fn domain(&self) -> &'static str {
        match self {
            Self::CreateEvent { .. } | Self::UpdateEvent { .. } | Self::DeleteEvent { .. } => {
                "calendar"
            }
            Self::CreateNote { .. } | Self::UpdateNote { .. } | Self::DeleteNote { .. } => "notes",
            Self::CreateAlarm { .. } | Self::UpdateAlarm { .. } | Self::DeleteAlarm { .. } => {
                "alarms"
            }
            Self::CreateRemoteEvent { .. } | Self::UpdateRemoteEvent { .. } => "remoteCalendar",
            Self::CreateTask { .. } | Self::UpdateTask { .. } | Self::DeleteTask { .. } => "tasks",
        }
    }

    /// The action's `kind` tag, which is also its skill id.
    pub fn kind(&self) -> &'static str {
        match self {
            Self::CreateEvent { .. } => "createEvent",
            Self::UpdateEvent { .. } => "updateEvent",
            Self::DeleteEvent { .. } => "deleteEvent",
            Self::CreateTask { .. } => "createTask",
            Self::UpdateTask { .. } => "updateTask",
            Self::DeleteTask { .. } => "deleteTask",
            Self::CreateNote { .. } => "createNote",
            Self::UpdateNote { .. } => "updateNote",
            Self::DeleteNote { .. } => "deleteNote",
            Self::CreateAlarm { .. } => "createAlarm",
            Self::UpdateAlarm { .. } => "updateAlarm",
            Self::DeleteAlarm { .. } => "deleteAlarm",
            Self::CreateRemoteEvent { .. } => "createRemoteEvent",
            Self::UpdateRemoteEvent { .. } => "updateRemoteEvent",
        }
    }

    pub fn is_create(&self) -> bool {
        matches!(
            self,
            Self::CreateEvent { .. }
                | Self::CreateTask { .. }
                | Self::CreateNote { .. }
                | Self::CreateAlarm { .. }
                | Self::CreateRemoteEvent { .. }
        )
    }

    /// The record a modify/delete action touches, in the same key format as
    /// query records. Creates have no prior record.
    pub fn target_key(&self) -> Option<String> {
        match self {
            Self::UpdateEvent { target, .. } | Self::DeleteEvent { target } => {
                Some(super::actions::event_key(target))
            }
            Self::UpdateTask { id, .. } | Self::DeleteTask { id } => Some(format!("tasks:{id}")),
            Self::UpdateNote { id, .. } | Self::DeleteNote { id } => Some(format!("notes:{id}")),
            Self::UpdateAlarm { id, .. } | Self::DeleteAlarm { id } => Some(format!("alarms:{id}")),
            Self::UpdateRemoteEvent { target, .. } => Some(super::actions::remote_key(target)),
            _ => None,
        }
    }
}

impl Permissions {
    pub fn allows(&self, domain: &str) -> bool {
        match domain {
            "calendar" => self.calendar,
            "tasks" => self.tasks,
            "notes" => self.notes,
            "alarms" => self.alarms,
            "remoteCalendar" => self.external && self.external_write,
            _ => false,
        }
    }
}

/// Where a request came from. Only the host sets this; it decides whether a
/// plan made only of creates may be committed without a confirmation click.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Source {
    #[default]
    Chat,
    Voice,
    /// An agent outside Nowly (Codex, Claude Code, ...) through the `nowly` CLI.
    External,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub key: String,
    pub kind: String,
    pub title: String,
    pub before: Value,
    pub after: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub id: String,
    pub status: String,
    pub created_at: i64,
    pub expires_at: i64,
    pub revision: i64,
    pub actions: Vec<Action>,
    pub changes: Vec<Change>,
    pub warnings: Vec<String>,
    #[serde(default)]
    pub options: Value,
    #[serde(default)]
    pub source: Source,
    /// The external agent's self-reported name, for `Source::External` plans.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client: Option<String>,
}

/// A read. `domain` is calendar, tasks, notes or alarms. Calendar queries need
/// `startDate` and `endDate` (at most 90 days); the task filters are optional.
#[derive(Debug, Clone, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Query {
    pub domain: String,
    #[serde(default)]
    pub text: String,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub completed: Option<bool>,
    pub priority: Option<String>,
    pub lane_id: Option<String>,
    pub due_before: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    pub key: String,
    pub domain: String,
    pub title: String,
    pub source: String,
    pub read_only: bool,
    pub data: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub revision: i64,
    pub records: Vec<Record>,
    pub truncated: bool,
    pub metadata: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reply {
    pub kind: String,
    pub message: String,
    pub records: Vec<Record>,
    pub plan: Option<Plan>,
}
