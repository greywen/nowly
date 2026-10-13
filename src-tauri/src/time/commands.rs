use super::types::{Alarm, AlarmDraft, TimeSettings};
use crate::db::AppDb;
use crate::error::CommandError;
use tauri::State;

#[tauri::command]
pub fn get_time_settings(db: State<'_, AppDb>) -> Result<TimeSettings, CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    super::store::get_time_settings(&connection)
}

#[tauri::command]
pub fn save_time_settings(
    db: State<'_, AppDb>,
    settings: TimeSettings,
) -> Result<TimeSettings, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    super::store::save_time_settings(&mut connection, settings)
}

#[tauri::command]
pub fn list_alarms(db: State<'_, AppDb>) -> Result<Vec<Alarm>, CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    super::store::list_alarms(&connection, chrono::Utc::now())
}

#[tauri::command]
pub fn create_alarm(db: State<'_, AppDb>, draft: AlarmDraft) -> Result<Alarm, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    super::store::create_alarm(&mut connection, draft, chrono::Utc::now())
}

#[tauri::command]
pub fn update_alarm(
    db: State<'_, AppDb>,
    id: String,
    draft: AlarmDraft,
) -> Result<Alarm, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    super::store::update_alarm(&mut connection, &id, draft, chrono::Utc::now())
}

#[tauri::command]
pub fn delete_alarm(db: State<'_, AppDb>, id: String) -> Result<(), CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    super::store::delete_alarm(&mut connection, &id)
}
