use crate::db::AppDb;
use crate::error::CommandError;
use crate::models::ModuleLayoutEntry;
use rusqlite::{params, Connection, Row, TransactionBehavior};
use tauri::State;

fn read_entry(row: &Row<'_>) -> rusqlite::Result<ModuleLayoutEntry> {
    Ok(ModuleLayoutEntry {
        id: row.get(0)?,
        x: row.get(1)?,
        y: row.get(2)?,
        w: row.get(3)?,
        h: row.get(4)?,
    })
}

pub fn list(connection: &Connection) -> Result<Vec<ModuleLayoutEntry>, CommandError> {
    let mut statement = connection
        .prepare("SELECT id, x, y, w, h FROM module_layout ORDER BY position ASC, id ASC")
        .map_err(CommandError::database)?;
    let rows = statement
        .query_map([], read_entry)
        .map_err(CommandError::database)?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(CommandError::database)
}

pub fn replace(
    connection: &mut Connection,
    entries: &[ModuleLayoutEntry],
) -> Result<Vec<ModuleLayoutEntry>, CommandError> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(CommandError::database)?;
    transaction
        .execute("DELETE FROM module_layout", [])
        .map_err(CommandError::database)?;
    for (index, entry) in entries.iter().enumerate() {
        transaction
            .execute(
                "INSERT INTO module_layout(id, x, y, w, h, position)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![entry.id, entry.x, entry.y, entry.w, entry.h, index as i64],
            )
            .map_err(CommandError::database)?;
    }
    transaction.commit().map_err(CommandError::database)?;
    list(connection)
}

#[tauri::command]
pub fn list_module_layout(db: State<'_, AppDb>) -> Result<Vec<ModuleLayoutEntry>, CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    list(&connection)
}

#[tauri::command]
pub fn save_module_layout(
    db: State<'_, AppDb>,
    layout: Vec<ModuleLayoutEntry>,
) -> Result<Vec<ModuleLayoutEntry>, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    replace(&mut connection, &layout)
}

#[cfg(test)]
mod tests {
    use super::{list, replace};
    use crate::db::migrate;
    use crate::models::ModuleLayoutEntry;
    use rusqlite::Connection;

    fn database() -> Connection {
        let mut connection = Connection::open_in_memory().unwrap();
        migrate(&mut connection).unwrap();
        connection
    }

    #[test]
    fn migration_seeds_the_default_layout() {
        let connection = database();
        let ids: Vec<String> = list(&connection).unwrap().into_iter().map(|e| e.id).collect();
        assert_eq!(ids, vec!["calendar", "matrix", "notes"]);
    }

    #[test]
    fn replace_persists_and_orders_entries() {
        let mut connection = database();
        let entries = vec![
            ModuleLayoutEntry { id: "notes".into(), x: 0, y: 0, w: 4, h: 3 },
            ModuleLayoutEntry { id: "calendar".into(), x: 4, y: 0, w: 8, h: 8 },
        ];
        let saved = replace(&mut connection, &entries).unwrap();
        assert_eq!(saved, entries);
        assert_eq!(list(&connection).unwrap(), entries);
    }

    #[test]
    fn replace_with_empty_clears_the_layout() {
        let mut connection = database();
        assert!(replace(&mut connection, &[]).unwrap().is_empty());
        assert!(list(&connection).unwrap().is_empty());
    }
}
