use crate::db::AppDb;
use crate::error::CommandError;
use crate::models::{AppSettings, Note};
use crate::settings::read_app_settings;
use rusqlite::{params, Connection};
use tauri::State;

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
pub fn list_notes(db: State<'_, AppDb>) -> Result<Vec<Note>, CommandError> {
    with_connection(db, query_notes)
}

#[tauri::command]
pub fn get_app_settings(db: State<'_, AppDb>) -> Result<AppSettings, CommandError> {
    with_connection(db, read_app_settings)
}

#[cfg(test)]
mod tests {
    use super::query_notes;
    use crate::db::migrate;
    use rusqlite::Connection;

    #[test]
    fn fresh_database_returns_empty_business_lists() {
        let mut connection = Connection::open_in_memory().unwrap();
        migrate(&mut connection).unwrap();

        assert!(query_notes(&connection).unwrap().is_empty());
    }
}
