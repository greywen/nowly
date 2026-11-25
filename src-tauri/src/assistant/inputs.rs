//! Typed inputs of every skill. Actions travel as JSON envelopes (stored plans
//! must keep decoding across versions); each payload is parsed into one of
//! these types before anything runs, so unknown or mistyped fields fail
//! closed. The same types generate the JSON Schemas shown to external agents.
use crate::recurrence::Recurrence;
use crate::time::types::AlarmRepeat;
use schemars::JsonSchema;
use serde::{Deserialize, Deserializer, Serialize};

/// `null` and a missing key differ: `Some(None)` clears the field.
fn present<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Priority {
    ImportantUrgent,
    ImportantNotUrgent,
    NotImportantUrgent,
    NotImportantNotUrgent,
}

impl Priority {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ImportantUrgent => "important_urgent",
            Self::ImportantNotUrgent => "important_not_urgent",
            Self::NotImportantUrgent => "not_important_urgent",
            Self::NotImportantNotUrgent => "not_important_not_urgent",
        }
    }
}

/// A new local calendar event.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EventCreate {
    pub title: String,
    /// Local wall time, `YYYY-MM-DDTHH:mm`.
    pub start_at: String,
    /// Local wall time; defaults to one hour after `startAt`.
    #[serde(default)]
    pub end_at: Option<String>,
    #[serde(default)]
    pub all_day: bool,
    /// Id of an existing category from the calendar query metadata. Omit for none.
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
    /// Minutes before the start; `0` reminds at the start.
    #[serde(default)]
    pub reminders: Vec<i64>,
    /// Repeat rule. `byDay` uses MO..SU and only applies to weekly rules.
    #[serde(default)]
    pub recurrence: Option<Recurrence>,
}

/// Changes to one event or one occurrence. Omitted fields stay as they are.
#[derive(Debug, Clone, Default, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EventPatch {
    pub title: Option<String>,
    pub start_at: Option<String>,
    pub end_at: Option<String>,
    pub all_day: Option<bool>,
    /// Existing category id; `""` removes the category.
    pub category: Option<String>,
    pub note: Option<String>,
    pub reminders: Option<Vec<i64>>,
}

impl EventPatch {
    pub fn is_empty(&self) -> bool {
        self.title.is_none()
            && self.start_at.is_none()
            && self.end_at.is_none()
            && self.all_day.is_none()
            && self.category.is_none()
            && self.note.is_none()
            && self.reminders.is_none()
    }
}

/// A new task. It always appears in the priority matrix; it joins the kanban
/// board only when `laneId` is set.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaskCreate {
    pub title: String,
    #[serde(default)]
    pub description: String,
    /// Omit when the user gave no importance and urgency.
    #[serde(default)]
    pub priority: Option<Priority>,
    /// `YYYY-MM-DD`.
    #[serde(default)]
    pub due_date: Option<String>,
    #[serde(default)]
    pub completed: bool,
    /// Lane id from the task query metadata. Only set when the user names the
    /// board, a lane or a column.
    #[serde(default)]
    pub lane_id: Option<String>,
    /// Ids of existing tags from the task query metadata.
    #[serde(default)]
    pub tag_ids: Vec<String>,
    /// Checklist step titles, in order.
    #[serde(default)]
    pub steps: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StepPatch {
    /// A step id from the task query result.
    pub id: String,
    pub title: Option<String>,
    pub completed: Option<bool>,
}

/// Changes to one task. Omitted fields stay as they are; steps not mentioned
/// are kept.
#[derive(Debug, Clone, Default, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaskPatch {
    pub title: Option<String>,
    pub description: Option<String>,
    /// `null` files the task under "not important, not urgent".
    #[serde(default, deserialize_with = "present")]
    #[schemars(with = "Option<Priority>")]
    pub priority: Option<Option<Priority>>,
    /// `YYYY-MM-DD`; `null` clears it.
    #[serde(default, deserialize_with = "present")]
    #[schemars(with = "Option<String>")]
    pub due_date: Option<Option<String>>,
    pub completed: Option<bool>,
    /// Lane id; `null` takes the task off the kanban board.
    #[serde(default, deserialize_with = "present")]
    #[schemars(with = "Option<String>")]
    pub lane_id: Option<Option<String>>,
    /// Replaces the task's tags with these existing tag ids.
    pub tag_ids: Option<Vec<String>>,
    /// Step titles appended after the existing steps.
    #[serde(default)]
    pub add_steps: Vec<String>,
    #[serde(default)]
    pub update_steps: Vec<StepPatch>,
    /// Ids of steps to remove.
    #[serde(default)]
    pub remove_steps: Vec<String>,
}

impl TaskPatch {
    pub fn is_empty(&self) -> bool {
        self.title.is_none()
            && self.description.is_none()
            && self.priority.is_none()
            && self.due_date.is_none()
            && self.completed.is_none()
            && self.lane_id.is_none()
            && self.tag_ids.is_none()
            && self.add_steps.is_empty()
            && self.update_steps.is_empty()
            && self.remove_steps.is_empty()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum NoteColor {
    Amber,
    Teal,
    Green,
    Indigo,
}

impl NoteColor {
    /// Mirrors `noteColorValues` in `src/notes/notes-model.ts`.
    pub fn hex(self) -> &'static str {
        match self {
            Self::Amber => "#E8C444",
            Self::Teal => "#4FC9DA",
            Self::Green => "#B8D935",
            Self::Indigo => "#4F55DA",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum NoteIcon {
    Smile,
    Grin,
    Love,
    Cool,
    Laugh,
    Spark,
    Star,
    Heart,
    Sad,
}

impl NoteIcon {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Smile => "smile",
            Self::Grin => "grin",
            Self::Love => "love",
            Self::Cool => "cool",
            Self::Laugh => "laugh",
            Self::Spark => "spark",
            Self::Star => "star",
            Self::Heart => "heart",
            Self::Sad => "sad",
        }
    }
}

/// A new note. Existing notes are rich text and are never rewritten.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NoteCreate {
    /// The first line is the title. Supports `#`-`####` headings, `- `/`* `
    /// bullets, `1. ` numbered items and `- [ ]` / `- [x]` checklist items.
    pub content: String,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub color: Option<NoteColor>,
    #[serde(default)]
    pub icon: Option<NoteIcon>,
}

/// A new alarm in local time.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AlarmCreate {
    pub title: String,
    pub hour: u8,
    pub minute: u8,
    /// `{"kind":"once"}` rings at the next matching time; weekly uses ISO
    /// weekdays 1 (Monday) to 7.
    #[serde(default = "once")]
    pub repeat: AlarmRepeat,
    #[serde(default = "enabled")]
    pub enabled: bool,
}

fn once() -> AlarmRepeat {
    AlarmRepeat::Once {}
}
fn enabled() -> bool {
    true
}

/// Changes to one alarm. Omitted fields stay as they are.
pub use crate::time::types::AlarmPatch;

/// A new single event in a connected Google or Microsoft calendar.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemoteEventCreate {
    pub title: String,
    pub start_at: String,
    #[serde(default)]
    pub end_at: Option<String>,
    #[serde(default)]
    pub all_day: bool,
    /// Plain-text description.
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub reminders: Vec<i64>,
}

/// Changes to one event in a connected Google or Microsoft calendar.
#[derive(Debug, Clone, Default, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemoteEventPatch {
    pub title: Option<String>,
    pub start_at: Option<String>,
    pub end_at: Option<String>,
    pub all_day: Option<bool>,
    pub note: Option<String>,
    pub reminders: Option<Vec<i64>>,
}

impl RemoteEventPatch {
    pub fn is_empty(&self) -> bool {
        self.title.is_none()
            && self.start_at.is_none()
            && self.end_at.is_none()
            && self.all_day.is_none()
            && self.note.is_none()
            && self.reminders.is_none()
    }
}

/// Parses an action payload into its typed input.
pub fn parse<T: serde::de::DeserializeOwned>(value: &serde_json::Value) -> Result<T, crate::error::CommandError> {
    serde_json::from_value(value.clone()).map_err(|error| {
        crate::error::CommandError::validation("assistant", format!("操作字段无效：{error}"))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn task_patch_tells_a_cleared_field_from_a_missing_one() {
        let cleared: TaskPatch = parse(&json!({"dueDate": null, "laneId": null})).unwrap();
        assert_eq!(cleared.due_date, Some(None));
        assert_eq!(cleared.lane_id, Some(None));
        assert_eq!(cleared.priority, None);
        assert!(!cleared.is_empty());
        assert!(parse::<TaskPatch>(&json!({})).unwrap().is_empty());
    }

    #[test]
    fn unknown_fields_are_rejected() {
        assert!(parse::<EventCreate>(&json!({"title":"x","startAt":"2026-01-01T09:00","color":"#000"})).is_err());
        assert!(parse::<NoteCreate>(&json!({"content":"x","color":"#000000"})).is_err());
        assert!(parse::<TaskPatch>(&json!({"steps":[]})).is_err());
    }
}
