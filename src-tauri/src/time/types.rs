use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ClockMode {
    Digital,
    Analog,
    Mixed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldClock {
    pub id: String,
    pub time_zone: String,
    pub label: String,
    pub mode: ClockMode,
    pub hour_cycle: String,
    pub show_seconds: bool,
    pub show_label: bool,
    pub show_date: bool,
    pub show_difference: bool,
    #[serde(default = "default_clock_layout")]
    pub layout: String,
    #[serde(default = "default_font_mode")]
    pub font_mode: String,
    #[serde(default = "default_font_size")]
    pub font_size: u16,
}

fn default_clock_layout() -> String {
    "horizontal".to_owned()
}
fn default_font_mode() -> String {
    "auto".to_owned()
}
fn default_font_size() -> u16 {
    96
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeSettings {
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
