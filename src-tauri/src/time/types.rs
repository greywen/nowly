use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ClockMode {
    Digital,
    Analog,
    Mixed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorldClock {
    pub id: String,
    pub time_zone: String,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TimeAppearance {
    pub mode: ClockMode,
    pub hour_cycle: String,
    pub show_seconds: bool,
    pub show_label: bool,
    pub show_date: bool,
    pub show_difference: bool,
    pub layout: String,
    pub font_mode: String,
    pub font_size: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FocusPreferences {
    pub default_minutes: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TimeSettings {
    pub display_content: String,
    pub appearance: TimeAppearance,
    pub focus_preferences: FocusPreferences,
    pub clocks: Vec<WorldClock>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AlarmRepeat {
    Once { date: String },
    Weekly { weekdays: Vec<u8> },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlarmDraft {
    pub title: String,
    pub hour: u8,
    pub minute: u8,
    pub repeat: AlarmRepeat,
    pub enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Alarm {
    pub id: String,
    pub title: String,
    pub hour: u8,
    pub minute: u8,
    pub repeat: AlarmRepeat,
    pub enabled: bool,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub next_occurrence: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AlarmNoticeKind {
    Alarm,
    MissedSummary,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlarmNotice {
    pub id: String,
    pub kind: AlarmNoticeKind,
    pub title: String,
    pub due_at: String,
    pub alarm_id: Option<String>,
    pub count: i64,
    pub range_start: String,
    pub range_end: String,
}
