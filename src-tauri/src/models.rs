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
pub struct AppSettings {
    pub wallpaper_enabled: bool,
    pub launch_at_login: bool,
    pub target_monitor_id: Option<String>,
    pub density: String,
    pub week_start: String,
    pub date_format: String,
    pub show_weekends: bool,
    pub calendar_enabled: bool,
    pub matrix_enabled: bool,
    pub notes_enabled: bool,
}
