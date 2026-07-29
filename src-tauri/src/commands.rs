use crate::db::AppDb;
use crate::models::{Event, Note, Task};
use rusqlite::params;
use tauri::State;

#[tauri::command]
pub fn list_events(db: State<AppDb>) -> Result<Vec<Event>, String> {
    let connection = db.0.lock().map_err(|error| error.to_string())?;
    let mut statement = connection
        .prepare("SELECT id, title, start_at, end_at, all_day, category_id, color, linked_task_id, note, created_at, updated_at FROM events ORDER BY start_at ASC")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![], |row| {
            Ok(Event {
                id: row.get(0)?,
                title: row.get(1)?,
                start_at: row.get(2)?,
                end_at: row.get(3)?,
                all_day: row.get::<_, i64>(4)? == 1,
                category_id: row.get(5)?,
                color: row.get(6)?,
                linked_task_id: row.get(7)?,
                note: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_tasks(db: State<AppDb>) -> Result<Vec<Task>, String> {
    let connection = db.0.lock().map_err(|error| error.to_string())?;
    let mut statement = connection
        .prepare("SELECT id, title, quadrant, due_at, priority, completed, linked_event_id, note, created_at, updated_at FROM tasks ORDER BY priority ASC, due_at ASC")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![], |row| {
            Ok(Task {
                id: row.get(0)?,
                title: row.get(1)?,
                quadrant: row.get(2)?,
                due_at: row.get(3)?,
                priority: row.get(4)?,
                completed: row.get::<_, i64>(5)? == 1,
                linked_event_id: row.get(6)?,
                note: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_notes(db: State<AppDb>) -> Result<Vec<Note>, String> {
    let connection = db.0.lock().map_err(|error| error.to_string())?;
    let mut statement = connection
        .prepare("SELECT id, title, content, color, pinned, created_at, updated_at FROM notes ORDER BY pinned DESC, updated_at DESC")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![], |row| {
            Ok(Note {
                id: row.get(0)?,
                title: row.get(1)?,
                content: row.get(2)?,
                color: row.get(3)?,
                pinned: row.get::<_, i64>(4)? == 1,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}
