use rusqlite::{Connection, Result};
use std::path::PathBuf;
use std::sync::Mutex;

pub struct AppDb(pub Mutex<Connection>);

pub fn open_database(path: PathBuf) -> Result<Connection> {
    let connection = Connection::open(path)?;
    migrate(&connection)?;
    Ok(connection)
}

pub fn migrate(connection: &Connection) -> Result<()> {
    connection.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS events (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            start_at TEXT NOT NULL,
            end_at TEXT NOT NULL,
            all_day INTEGER NOT NULL,
            category_id TEXT,
            color TEXT NOT NULL,
            linked_task_id TEXT,
            note TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            quadrant TEXT NOT NULL,
            due_at TEXT,
            priority INTEGER NOT NULL,
            completed INTEGER NOT NULL,
            linked_event_id TEXT,
            note TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS notes (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            color TEXT NOT NULL,
            pinned INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS widgets (
            id TEXT PRIMARY KEY,
            enabled INTEGER NOT NULL,
            display_order INTEGER NOT NULL,
            size TEXT NOT NULL,
            config TEXT NOT NULL
        );
        ",
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::migrate;
    use rusqlite::Connection;

    #[test]
    fn migrate_creates_core_tables() {
        let connection = Connection::open_in_memory().expect("in-memory database opens");
        migrate(&connection).expect("migration succeeds");

        let table_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('events', 'tasks', 'notes', 'settings', 'widgets')",
                [],
                |row| row.get(0),
            )
            .expect("table count can be queried");

        assert_eq!(table_count, 5);
    }
}
