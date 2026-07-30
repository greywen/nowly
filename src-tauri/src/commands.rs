use crate::db::AppDb;
use crate::error::CommandError;
use crate::models::{AppSettings, Note, Task};
use crate::settings::read_app_settings;
use rusqlite::{params, Connection};
use tauri::State;

pub fn query_tasks(connection: &Connection) -> rusqlite::Result<Vec<Task>> {
    let mut statement = connection.prepare(
        "SELECT id, title, quadrant, due_at, priority, completed,
                linked_event_id, note, created_at, updated_at
         FROM tasks
         ORDER BY completed ASC, due_at IS NULL ASC, due_at ASC, priority ASC",
    )?;
    let tasks = statement
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
        })?
        .collect();
    tasks
}

pub fn query_notes(connection: &Connection) -> rusqlite::Result<Vec<Note>> {
    let mut statement = connection.prepare(
        "SELECT id, title, content, color, pinned, created_at, updated_at
         FROM notes ORDER BY pinned DESC, updated_at DESC",
    )?;
    let notes = statement
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
        })?
        .collect();
    notes
}

fn with_connection<T>(
    db: State<'_, AppDb>,
    operation: impl FnOnce(&Connection) -> rusqlite::Result<T>,
) -> Result<T, CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    operation(&connection).map_err(CommandError::database)
}

#[tauri::command]
pub fn list_tasks(db: State<'_, AppDb>) -> Result<Vec<Task>, CommandError> {
    with_connection(db, query_tasks)
}

#[tauri::command]
pub fn list_notes(db: State<'_, AppDb>) -> Result<Vec<Note>, CommandError> {
    with_connection(db, query_notes)
}

#[tauri::command]
pub fn get_app_settings(db: State<'_, AppDb>) -> Result<AppSettings, CommandError> {
    with_connection(db, read_app_settings)
}

#[cfg(test)]
mod tests {
    use super::{query_notes, query_tasks};
    use crate::db::migrate;
    use rusqlite::Connection;

    #[test]
    fn fresh_database_returns_empty_business_lists() {
        let mut connection = Connection::open_in_memory().unwrap();
        migrate(&mut connection).unwrap();

        assert!(query_tasks(&connection).unwrap().is_empty());
        assert!(query_notes(&connection).unwrap().is_empty());
    }
}
