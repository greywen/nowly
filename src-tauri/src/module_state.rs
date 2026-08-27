use crate::db::AppDb;
use crate::error::CommandError;
use rusqlite::{params, Connection, OptionalExtension};
use tauri::State;

// Reads a module's persisted JSON state, or `None` when the module has never
// written any. The value is an opaque JSON string owned by the module.
pub fn get(connection: &Connection, module_id: &str) -> Result<Option<String>, CommandError> {
    connection
        .query_row(
            "SELECT state FROM module_state WHERE module_id = ?1",
            params![module_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(CommandError::database)
}

// Upserts a module's JSON state. The caller is responsible for the shape of the
// JSON; the store treats it as an opaque blob.
pub fn set(connection: &Connection, module_id: &str, state: &str) -> Result<(), CommandError> {
    connection
        .execute(
            "INSERT INTO module_state(module_id, state, updated_at)
             VALUES (?1, ?2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
             ON CONFLICT(module_id) DO UPDATE SET
                state = excluded.state,
                updated_at = excluded.updated_at",
            params![module_id, state],
        )
        .map_err(CommandError::database)?;
    Ok(())
}

#[tauri::command]
pub fn get_module_state(
    db: State<'_, AppDb>,
    module_id: String,
) -> Result<Option<String>, CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    get(&connection, &module_id)
}

#[tauri::command]
pub fn set_module_state(
    db: State<'_, AppDb>,
    module_id: String,
    state: String,
) -> Result<(), CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    set(&connection, &module_id, &state)
}

#[cfg(test)]
mod tests {
    use super::{get, set};
    use crate::db::migrate;
    use rusqlite::Connection;

    fn database() -> Connection {
        let mut connection = Connection::open_in_memory().unwrap();
        migrate(&mut connection).unwrap();
        connection
    }

    #[test]
    fn get_returns_none_before_any_write() {
        let connection = database();
        assert_eq!(get(&connection, "focusTimer").unwrap(), None);
    }

    #[test]
    fn set_then_get_round_trips_the_state() {
        let connection = database();
        set(&connection, "focusTimer", "{\"durationMinutes\":15}").unwrap();
        assert_eq!(
            get(&connection, "focusTimer").unwrap().as_deref(),
            Some("{\"durationMinutes\":15}")
        );
    }

    #[test]
    fn set_overwrites_existing_state() {
        let connection = database();
        set(&connection, "vocabulary", "{\"starred\":[]}").unwrap();
        set(&connection, "vocabulary", "{\"starred\":[\"nuance\"]}").unwrap();
        assert_eq!(
            get(&connection, "vocabulary").unwrap().as_deref(),
            Some("{\"starred\":[\"nuance\"]}")
        );
    }

    #[test]
    fn state_is_scoped_per_module_id() {
        let connection = database();
        set(&connection, "focusTimer", "\"a\"").unwrap();
        set(&connection, "vocabulary", "\"b\"").unwrap();
        assert_eq!(
            get(&connection, "focusTimer").unwrap().as_deref(),
            Some("\"a\"")
        );
        assert_eq!(
            get(&connection, "vocabulary").unwrap().as_deref(),
            Some("\"b\"")
        );
    }
}
