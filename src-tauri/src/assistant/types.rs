use crate::models::EventTarget;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Permissions {
    pub calendar: bool,
    pub tasks: bool,
    pub external: bool,
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
}

impl Action {
    pub fn domain(&self) -> &'static str {
        match self {
            Self::CreateEvent { .. } | Self::UpdateEvent { .. } | Self::DeleteEvent { .. } => {
                "calendar"
            }
            _ => "tasks",
        }
    }
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
}

#[derive(Debug, Clone, Deserialize, Serialize)]
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
