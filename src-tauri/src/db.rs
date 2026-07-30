use rusqlite::{Connection, Result, Transaction};
use std::path::PathBuf;
use std::sync::Mutex;

pub struct AppDb(pub Mutex<Connection>);

type Migration = fn(&Transaction<'_>) -> Result<()>;

const MIGRATIONS: &[(i64, Migration)] = &[
    (1, migration_1_core_tables),
    (2, migration_2_current_columns),
    (3, migration_3_indexes),
    (4, migration_4_default_settings),
    (5, migration_5_event_task_foreign_keys),
];

pub fn open_database(path: PathBuf) -> Result<Connection> {
    let mut connection = Connection::open(path)?;
    connection.execute_batch("PRAGMA foreign_keys = ON;")?;
    migrate(&mut connection)?;
    Ok(connection)
}

pub fn migrate(connection: &mut Connection) -> Result<()> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL
         );",
    )?;

    for (version, apply) in MIGRATIONS {
        let applied: bool = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = ?1)",
            [version],
            |row| row.get(0),
        )?;
        if applied {
            continue;
        }

        let transaction = connection.transaction()?;
        apply(&transaction)?;
        transaction.execute(
            "INSERT INTO schema_migrations(version, applied_at)
             VALUES (?1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
            [version],
        )?;
        transaction.commit()?;
    }
    Ok(())
}

fn column_exists(transaction: &Transaction<'_>, table: &str, column: &str) -> Result<bool> {
    let mut statement = transaction.prepare(&format!("PRAGMA table_info({table})"))?;
    let columns = statement.query_map([], |row| row.get::<_, String>(1))?;
    for value in columns {
        if value? == column {
            return Ok(true);
        }
    }
    Ok(false)
}

fn migration_1_core_tables(transaction: &Transaction<'_>) -> Result<()> {
    transaction.execute_batch(
        "CREATE TABLE IF NOT EXISTS events (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            start_at TEXT NOT NULL,
            end_at TEXT NOT NULL,
            all_day INTEGER NOT NULL CHECK (all_day IN (0, 1)),
            category_id TEXT,
            color TEXT NOT NULL,
            linked_task_id TEXT,
            note TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            quadrant TEXT NOT NULL,
            due_at TEXT,
            priority INTEGER NOT NULL,
            completed INTEGER NOT NULL CHECK (completed IN (0, 1)),
            linked_event_id TEXT,
            note TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS notes (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            content TEXT NOT NULL DEFAULT '',
            color TEXT NOT NULL,
            pinned INTEGER NOT NULL CHECK (pinned IN (0, 1)),
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
         );",
    )
}

fn migration_2_current_columns(transaction: &Transaction<'_>) -> Result<()> {
    if column_exists(transaction, "events", "category_id")?
        && !column_exists(transaction, "events", "category")?
    {
        transaction.execute_batch("ALTER TABLE events RENAME COLUMN category_id TO category;")?;
    }
    if !column_exists(transaction, "settings", "updated_at")? {
        transaction.execute_batch(
            "ALTER TABLE settings ADD COLUMN updated_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00Z';",
        )?;
    }
    Ok(())
}

fn migration_3_indexes(transaction: &Transaction<'_>) -> Result<()> {
    transaction.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_events_range ON events(start_at, end_at);
         CREATE INDEX IF NOT EXISTS idx_tasks_quadrant ON tasks(quadrant, completed, due_at);
         CREATE INDEX IF NOT EXISTS idx_notes_order ON notes(pinned, updated_at);
         CREATE UNIQUE INDEX IF NOT EXISTS idx_events_linked_task
            ON events(linked_task_id) WHERE linked_task_id IS NOT NULL;
         CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_linked_event
            ON tasks(linked_event_id) WHERE linked_event_id IS NOT NULL;",
    )
}

fn migration_4_default_settings(transaction: &Transaction<'_>) -> Result<()> {
    const DEFAULTS: &[(&str, &str)] = &[
        ("wallpaper_enabled", "false"),
        ("launch_at_login", "false"),
        ("target_monitor_id", "null"),
        ("density", "\"balanced\""),
        ("week_start", "\"monday\""),
        ("date_format", "\"localized\""),
        ("show_weekends", "true"),
        ("calendar_enabled", "true"),
        ("matrix_enabled", "true"),
        ("notes_enabled", "true"),
    ];
    for (key, value) in DEFAULTS {
        transaction.execute(
            "INSERT OR IGNORE INTO settings(key, value, updated_at)
             VALUES (?1, ?2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
            [key, value],
        )?;
    }
    Ok(())
}

fn migration_5_event_task_foreign_keys(transaction: &Transaction<'_>) -> Result<()> {
    transaction.execute_batch(
        "PRAGMA defer_foreign_keys = ON;
         DROP INDEX IF EXISTS idx_events_range;
         DROP INDEX IF EXISTS idx_tasks_quadrant;
         DROP INDEX IF EXISTS idx_events_linked_task;
         DROP INDEX IF EXISTS idx_tasks_linked_event;

         CREATE TEMP TABLE canonical_links(event_id TEXT PRIMARY KEY, task_id TEXT UNIQUE);
         INSERT OR IGNORE INTO canonical_links(event_id, task_id)
         SELECT event_id, task_id FROM (
           SELECT event_id, task_id,
                  row_number() OVER (PARTITION BY event_id ORDER BY changed_at DESC, task_id ASC) event_rank,
                  row_number() OVER (PARTITION BY task_id ORDER BY changed_at DESC, event_id ASC) task_rank
           FROM (
             SELECT e.id event_id, e.linked_task_id task_id, e.updated_at changed_at
             FROM events e JOIN tasks t ON t.id = e.linked_task_id
             UNION ALL
             SELECT t.linked_event_id, t.id, t.updated_at
             FROM tasks t JOIN events e ON e.id = t.linked_event_id
           ) candidates
         ) ranked WHERE event_rank = 1 AND task_rank = 1;

         ALTER TABLE events RENAME TO events_v4;
         ALTER TABLE tasks RENAME TO tasks_v4;

         CREATE TABLE events (
           id TEXT PRIMARY KEY,
           title TEXT NOT NULL,
           start_at TEXT NOT NULL,
           end_at TEXT NOT NULL,
           all_day INTEGER NOT NULL CHECK (all_day IN (0, 1)),
           category TEXT NOT NULL,
           color TEXT NOT NULL,
           linked_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
           note TEXT NOT NULL DEFAULT '',
           created_at TEXT NOT NULL,
           updated_at TEXT NOT NULL
         );
         CREATE TABLE tasks (
           id TEXT PRIMARY KEY,
           title TEXT NOT NULL,
           quadrant TEXT NOT NULL,
           due_at TEXT,
           priority INTEGER NOT NULL,
           completed INTEGER NOT NULL CHECK (completed IN (0, 1)),
           linked_event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
           note TEXT NOT NULL DEFAULT '',
           created_at TEXT NOT NULL,
           updated_at TEXT NOT NULL
         );

         INSERT INTO events
         SELECT e.id, e.title, e.start_at, e.end_at, e.all_day, e.category, e.color,
                c.task_id, e.note, e.created_at, e.updated_at
         FROM events_v4 e LEFT JOIN canonical_links c ON c.event_id = e.id;
         INSERT INTO tasks
         SELECT t.id, t.title, t.quadrant, t.due_at, t.priority, t.completed,
                c.event_id, t.note, t.created_at, t.updated_at
         FROM tasks_v4 t LEFT JOIN canonical_links c ON c.task_id = t.id;

         DROP TABLE events_v4;
         DROP TABLE tasks_v4;
         DROP TABLE canonical_links;

         CREATE INDEX idx_events_range ON events(start_at, end_at);
         CREATE INDEX idx_tasks_quadrant ON tasks(quadrant, completed, due_at);
         CREATE UNIQUE INDEX idx_events_linked_task
            ON events(linked_task_id) WHERE linked_task_id IS NOT NULL;
         CREATE UNIQUE INDEX idx_tasks_linked_event
            ON tasks(linked_event_id) WHERE linked_event_id IS NOT NULL;",
    )?;
    let violations: i64 = transaction.query_row(
        "SELECT COUNT(*) FROM pragma_foreign_key_check",
        [],
        |row| row.get(0),
    )?;
    if violations != 0 {
        return Err(rusqlite::Error::ExecuteReturnedResults);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{migrate, open_database, MIGRATIONS};
    use rusqlite::{Connection, Result};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn table_exists(connection: &Connection, name: &str) -> bool {
        connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
                [name],
                |row| row.get(0),
            )
            .expect("table lookup succeeds")
    }

    fn migrate_through(connection: &mut Connection, max_version: i64) -> Result<()> {
        connection.execute_batch(
            "CREATE TABLE schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL
             );",
        )?;
        for (version, apply) in MIGRATIONS
            .iter()
            .filter(|(version, _)| *version <= max_version)
        {
            let transaction = connection.transaction()?;
            apply(&transaction)?;
            transaction.execute(
                "INSERT INTO schema_migrations(version, applied_at)
                 VALUES (?1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
                [version],
            )?;
            transaction.commit()?;
        }
        Ok(())
    }

    #[test]
    fn migration_5_rebuilds_event_task_links_with_foreign_keys() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        migrate(&mut connection).unwrap();

        let versions: Vec<i64> = connection
            .prepare("SELECT version FROM schema_migrations ORDER BY version")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(versions, vec![1, 2, 3, 4, 5]);

        let event_fks: Vec<(String, String, String)> = connection
            .prepare("PRAGMA foreign_key_list(events)")
            .unwrap()
            .query_map([], |row| Ok((row.get(2)?, row.get(3)?, row.get(6)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert!(event_fks.contains(&(
            "tasks".into(),
            "linked_task_id".into(),
            "SET NULL".into()
        )));

        let task_fks: Vec<(String, String, String)> = connection
            .prepare("PRAGMA foreign_key_list(tasks)")
            .unwrap()
            .query_map([], |row| Ok((row.get(2)?, row.get(3)?, row.get(6)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert!(task_fks.contains(&(
            "events".into(),
            "linked_event_id".into(),
            "SET NULL".into()
        )));
        let violations: i64 = connection
            .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(violations, 0);
    }

    #[test]
    fn migration_5_cleans_dangling_links_without_losing_business_rows() {
        let mut connection = Connection::open_in_memory().unwrap();
        migrate_through(&mut connection, 4).unwrap();
        connection
            .execute_batch(
                "INSERT INTO events VALUES
                 ('e1','保留','2026-07-23T09:00','2026-07-23T10:00',0,'work','blue','missing','','2026-07-23T08:00:00Z','2026-07-23T08:00:00Z');
                 INSERT INTO tasks VALUES
                 ('t1','任务','important-urgent',NULL,1,0,'missing','','2026-07-23T08:00:00Z','2026-07-23T08:00:00Z');",
            )
            .unwrap();

        migrate(&mut connection).unwrap();

        let event_link: Option<String> = connection
            .query_row(
                "SELECT linked_task_id FROM events WHERE id='e1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let task_link: Option<String> = connection
            .query_row(
                "SELECT linked_event_id FROM tasks WHERE id='t1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(event_link, None);
        assert_eq!(task_link, None);
        assert_eq!(
            connection
                .query_row("SELECT COUNT(*) FROM events", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert_eq!(
            connection
                .query_row("SELECT COUNT(*) FROM tasks", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            1
        );
    }

    #[test]
    fn migrate_records_each_schema_version_once() {
        let mut connection = Connection::open_in_memory().expect("in-memory database opens");
        migrate(&mut connection).expect("first migration succeeds");
        migrate(&mut connection).expect("second migration succeeds");

        let versions: Vec<i64> = connection
            .prepare("SELECT version FROM schema_migrations ORDER BY version")
            .expect("version query prepares")
            .query_map([], |row| row.get(0))
            .expect("version query runs")
            .collect::<Result<_, _>>()
            .expect("versions collect");

        assert_eq!(versions, vec![1, 2, 3, 4, 5]);
        for table in ["events", "tasks", "notes", "settings", "widgets"] {
            assert!(table_exists(&connection, table), "missing table {table}");
        }
    }

    #[test]
    fn migrate_upgrades_the_legacy_event_and_settings_columns() {
        let mut connection = Connection::open_in_memory().expect("in-memory database opens");
        connection
            .execute_batch(
                "CREATE TABLE events (
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
                 CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
            )
            .expect("legacy tables are created");

        migrate(&mut connection).expect("legacy migration succeeds");

        let event_columns: Vec<String> = connection
            .prepare("PRAGMA table_info(events)")
            .unwrap()
            .query_map([], |row| row.get(1))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        let setting_columns: Vec<String> = connection
            .prepare("PRAGMA table_info(settings)")
            .unwrap()
            .query_map([], |row| row.get(1))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();

        assert!(event_columns.contains(&"category".to_string()));
        assert!(!event_columns.contains(&"category_id".to_string()));
        assert!(setting_columns.contains(&"updated_at".to_string()));
    }

    #[test]
    fn open_database_enables_foreign_keys() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("nowly-{suffix}.sqlite"));
        let connection = open_database(path.clone()).expect("database opens");
        let enabled: i64 = connection
            .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
            .unwrap();
        drop(connection);
        let _ = std::fs::remove_file(path);

        assert_eq!(enabled, 1);
    }
}
