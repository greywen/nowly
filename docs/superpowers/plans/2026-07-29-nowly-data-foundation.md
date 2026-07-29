# Nowly Data Foundation and Empty Startup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Nowly's production sample data with versioned SQLite-backed reads, typed frontend repositories, static bootstrap states, and accessible empty widgets while preserving existing wallpaper behavior.

**Architecture:** Rust owns schema migration, default settings, data serialization, and Tauri read commands. React receives a replaceable `NowlyRepository`, loads all startup resources through one bootstrap hook, and renders independent module loading/error/empty states. This stage deliberately keeps CRUD for later vertical slices but fixes the contracts those slices will use.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Tauri 2, Rust, rusqlite/SQLite, serde, lucide-react, project Good design tokens.

---

**Specification:** `docs/superpowers/specs/2026-07-29-nowly-windows-complete-product-design.md`

**Before UI work:** Read root `design.md` completely. Do not copy legacy visual classes from the current components when they conflict with that file.

## File map

### Rust

- `src-tauri/src/db.rs` — open SQLite connections, enable foreign keys, and apply numbered transactional migrations.
- `src-tauri/src/models.rs` — IPC data contracts serialized in frontend camelCase.
- `src-tauri/src/error.rs` — stable command error payload and internal logging conversion.
- `src-tauri/src/settings.rs` — default settings and typed settings reads.
- `src-tauri/src/commands.rs` — read-only stage-1 Tauri commands using the shared error type.
- `src-tauri/src/main.rs` — register the new module and `get_app_settings` command.

### React

- `src/data/nowly-repository.ts` — frontend repository interface and shared startup result types.
- `src/data/tauri-nowly-repository.ts` — the only stage-1 module that knows Tauri command names.
- `src/data/RepositoryContext.tsx` — repository injection for production and tests.
- `src/app/useAppBootstrap.ts` — independent startup reads and retry behavior.
- `src/app/App.tsx` — consumes bootstrap state instead of sample arrays.
- `src/app/App.test.tsx` — app startup, partial failure, retry, and existing window-mode behavior.
- `src/app/layout/DesktopShell.tsx` — prototype-aligned shell and static global failure surface.
- `src/calendar/CalendarWidget.tsx` — loaded empty month state and module read error.
- `src/matrix/MatrixWidget.tsx` — four visible empty quadrants and module read error.
- `src/notes/NotesWidget.tsx` — accessible empty note state and module read error.
- `src/modals/ModalRoot.tsx` — receives loaded related entities; no production sample imports.
- `src/app/styles.css` — authoritative Good tokens and reusable stage-1 shell/widget/error styles.
- `src/lib/sample-data.ts` — remains test fixture only; no production import is allowed after this stage.

## Task 1: Add transactional, versioned SQLite migrations

**Files:**
- Modify: `src-tauri/src/db.rs`

- [ ] **Step 1: Replace the database test module with failing migration tests**

Keep the existing production code temporarily. Replace only `#[cfg(test)] mod tests` in `src-tauri/src/db.rs` with:

```rust
#[cfg(test)]
mod tests {
    use super::{migrate, open_database};
    use rusqlite::Connection;
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

        assert_eq!(versions, vec![1, 2, 3]);
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
```

- [ ] **Step 2: Run the Rust test and verify RED**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml db::tests -- --nocapture
```

Expected: compilation fails because `migrate` currently accepts `&Connection` rather than `&mut Connection`, and the version/upgrade assertions are not implemented.

- [ ] **Step 3: Replace `src-tauri/src/db.rs` with the minimal migration runner**

Use the following production implementation above the test module from Step 1:

```rust
use rusqlite::{Connection, Result, Transaction};
use std::path::PathBuf;
use std::sync::Mutex;

pub struct AppDb(pub Mutex<Connection>);

type Migration = fn(&Transaction<'_>) -> Result<()>;

const MIGRATIONS: &[(i64, Migration)] = &[
    (1, migration_1_core_tables),
    (2, migration_2_current_columns),
    (3, migration_3_indexes),
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
```

Important: do not add foreign-key constraints by rebuilding existing tables in this stage. The unique indexes and transactional business rules are enough for read-only stage 1; the event/task plan will add a tested table-rebuild migration before write commands exist.

- [ ] **Step 4: Run focused and full Rust tests and verify GREEN**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml db::tests -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: all database tests and all existing wallpaper/tray tests pass.

- [ ] **Step 5: Commit the migration runner**

```bash
git add src-tauri/src/db.rs
git commit -m "feature: add versioned database migrations"
```

## Task 2: Add typed settings defaults and camelCase IPC models

**Files:**
- Create: `src-tauri/src/settings.rs`
- Modify: `src-tauri/src/models.rs`
- Modify: `src-tauri/src/db.rs`

- [ ] **Step 1: Add failing settings tests**

Create `src-tauri/src/settings.rs`:

```rust
use crate::models::AppSettings;
use rusqlite::Connection;

pub fn read_app_settings(_connection: &Connection) -> Result<AppSettings, rusqlite::Error> {
    unimplemented!("read typed defaults from settings")
}

#[cfg(test)]
mod tests {
    use super::read_app_settings;
    use crate::db::migrate;
    use rusqlite::Connection;

    #[test]
    fn fresh_database_returns_approved_defaults() {
        let mut connection = Connection::open_in_memory().unwrap();
        migrate(&mut connection).unwrap();

        let settings = read_app_settings(&connection).unwrap();

        assert!(!settings.wallpaper_enabled);
        assert!(!settings.launch_at_login);
        assert_eq!(settings.target_monitor_id, None);
        assert_eq!(settings.density, "balanced");
        assert_eq!(settings.week_start, "monday");
        assert_eq!(settings.date_format, "localized");
        assert!(settings.show_weekends);
        assert!(settings.calendar_enabled);
        assert!(settings.matrix_enabled);
        assert!(settings.notes_enabled);
    }

    #[test]
    fn stored_json_values_override_defaults() {
        let mut connection = Connection::open_in_memory().unwrap();
        migrate(&mut connection).unwrap();
        connection.execute(
            "UPDATE settings SET value = 'true' WHERE key = 'wallpaper_enabled'",
            [],
        ).unwrap();
        connection.execute(
            "UPDATE settings SET value = '\"comfortable\"' WHERE key = 'density'",
            [],
        ).unwrap();

        let settings = read_app_settings(&connection).unwrap();

        assert!(settings.wallpaper_enabled);
        assert_eq!(settings.density, "comfortable");
    }
}
```

Replace `src-tauri/src/models.rs` with the following contract so the test has the intended API:

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub id: String,
    pub title: String,
    pub start_at: String,
    pub end_at: String,
    pub all_day: bool,
    pub category: String,
    pub color: String,
    pub linked_task_id: Option<String>,
    pub note: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub title: String,
    pub quadrant: String,
    pub due_at: Option<String>,
    pub priority: i64,
    pub completed: bool,
    pub linked_event_id: Option<String>,
    pub note: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub title: String,
    pub content: String,
    pub color: String,
    pub pinned: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub wallpaper_enabled: bool,
    pub launch_at_login: bool,
    pub target_monitor_id: Option<String>,
    pub density: String,
    pub week_start: String,
    pub date_format: String,
    pub show_weekends: bool,
    pub calendar_enabled: bool,
    pub matrix_enabled: bool,
    pub notes_enabled: bool,
}
```

- [ ] **Step 2: Run the settings tests and verify RED**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml settings::tests -- --nocapture
```

Expected: FAIL/panic at `unimplemented!("read typed defaults from settings")`.

- [ ] **Step 3: Add migration 4 with explicit JSON defaults**

In `src-tauri/src/db.rs`, change `MIGRATIONS` to:

```rust
const MIGRATIONS: &[(i64, Migration)] = &[
    (1, migration_1_core_tables),
    (2, migration_2_current_columns),
    (3, migration_3_indexes),
    (4, migration_4_default_settings),
];
```

Add after `migration_3_indexes`:

```rust
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
```

Update Task 1's version assertion in `src-tauri/src/db.rs` from `vec![1, 2, 3]` to:

```rust
assert_eq!(versions, vec![1, 2, 3, 4]);
```

- [ ] **Step 4: Implement typed settings reads**

Replace the production portion of `src-tauri/src/settings.rs` above `#[cfg(test)]` with:

```rust
use crate::models::AppSettings;
use rusqlite::{Connection, OptionalExtension};
use serde::de::DeserializeOwned;

fn read_value<T: DeserializeOwned>(connection: &Connection, key: &str) -> Result<T, rusqlite::Error> {
    let value: Option<String> = connection
        .query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| row.get(0))
        .optional()?;
    let value = value.ok_or(rusqlite::Error::QueryReturnedNoRows)?;
    serde_json::from_str(&value).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            0,
            rusqlite::types::Type::Text,
            Box::new(error),
        )
    })
}

pub fn read_app_settings(connection: &Connection) -> Result<AppSettings, rusqlite::Error> {
    Ok(AppSettings {
        wallpaper_enabled: read_value(connection, "wallpaper_enabled")?,
        launch_at_login: read_value(connection, "launch_at_login")?,
        target_monitor_id: read_value(connection, "target_monitor_id")?,
        density: read_value(connection, "density")?,
        week_start: read_value(connection, "week_start")?,
        date_format: read_value(connection, "date_format")?,
        show_weekends: read_value(connection, "show_weekends")?,
        calendar_enabled: read_value(connection, "calendar_enabled")?,
        matrix_enabled: read_value(connection, "matrix_enabled")?,
        notes_enabled: read_value(connection, "notes_enabled")?,
    })
}
```

- [ ] **Step 5: Run focused and full Rust tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml settings::tests -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: all tests pass. If the existing `commands.rs` fails to compile because it still uses `category_id`, do not weaken the model; continue immediately to Task 3 before making the commit.

- [ ] **Step 6: Commit after Task 3 if compilation is blocked; otherwise commit now**

When `cargo test` is green:

```bash
git add src-tauri/src/db.rs src-tauri/src/models.rs src-tauri/src/settings.rs
git commit -m "feature: add typed application settings"
```

## Task 3: Expose read commands with one stable error contract

**Files:**
- Create: `src-tauri/src/error.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Add failing command/query tests to `src-tauri/src/commands.rs`**

Append this test module to the existing file before changing production code:

```rust
#[cfg(test)]
mod tests {
    use super::{query_events, query_notes, query_tasks};
    use crate::db::migrate;
    use rusqlite::Connection;

    #[test]
    fn fresh_database_returns_empty_business_lists() {
        let mut connection = Connection::open_in_memory().unwrap();
        migrate(&mut connection).unwrap();

        assert!(query_events(&connection).unwrap().is_empty());
        assert!(query_tasks(&connection).unwrap().is_empty());
        assert!(query_notes(&connection).unwrap().is_empty());
    }

    #[test]
    fn event_query_reads_the_current_category_column() {
        let mut connection = Connection::open_in_memory().unwrap();
        migrate(&mut connection).unwrap();
        connection.execute(
            "INSERT INTO events(id,title,start_at,end_at,all_day,category,color,linked_task_id,note,created_at,updated_at)
             VALUES ('e1','评审','2026-07-23T14:00','2026-07-23T15:00',0,'work','red',NULL,'','2026-07-23T09:00:00Z','2026-07-23T09:00:00Z')",
            [],
        ).unwrap();

        let events = query_events(&connection).unwrap();

        assert_eq!(events[0].category, "work");
    }
}
```

Create `src-tauri/src/error.rs` with a deliberately incomplete constructor:

```rust
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: String,
    pub message: String,
    pub field: Option<String>,
}

impl CommandError {
    pub fn database(_error: impl std::fmt::Display) -> Self {
        unimplemented!("map internal database errors")
    }
}

#[cfg(test)]
mod tests {
    use super::CommandError;

    #[test]
    fn database_error_hides_internal_details() {
        let error = CommandError::database("SQLITE_BUSY at C:\\private\\nowly.sqlite");
        assert_eq!(error.code, "database_error");
        assert_eq!(error.message, "无法读取本地数据，请重试。");
        assert_eq!(error.field, None);
        assert!(!error.message.contains("SQLITE"));
    }
}
```

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml error::tests commands::tests -- --nocapture
```

If Cargo accepts only one filter, run the two filters separately. Expected: compile failure because `query_events/query_tasks/query_notes` do not exist, followed by the unimplemented error constructor once query helpers exist.

- [ ] **Step 3: Replace `src-tauri/src/commands.rs` with query helpers and Tauri wrappers**

```rust
use crate::db::AppDb;
use crate::error::CommandError;
use crate::models::{AppSettings, Event, Note, Task};
use crate::settings::read_app_settings;
use rusqlite::{params, Connection};
use tauri::State;

pub fn query_events(connection: &Connection) -> rusqlite::Result<Vec<Event>> {
    let mut statement = connection.prepare(
        "SELECT id, title, start_at, end_at, all_day, category, color,
                linked_task_id, note, created_at, updated_at
         FROM events ORDER BY start_at ASC",
    )?;
    statement
        .query_map(params![], |row| {
            Ok(Event {
                id: row.get(0)?,
                title: row.get(1)?,
                start_at: row.get(2)?,
                end_at: row.get(3)?,
                all_day: row.get::<_, i64>(4)? == 1,
                category: row.get(5)?,
                color: row.get(6)?,
                linked_task_id: row.get(7)?,
                note: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        })?
        .collect()
}

pub fn query_tasks(connection: &Connection) -> rusqlite::Result<Vec<Task>> {
    let mut statement = connection.prepare(
        "SELECT id, title, quadrant, due_at, priority, completed,
                linked_event_id, note, created_at, updated_at
         FROM tasks
         ORDER BY completed ASC, due_at IS NULL ASC, due_at ASC, priority ASC",
    )?;
    statement
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
        .collect()
}

pub fn query_notes(connection: &Connection) -> rusqlite::Result<Vec<Note>> {
    let mut statement = connection.prepare(
        "SELECT id, title, content, color, pinned, created_at, updated_at
         FROM notes ORDER BY pinned DESC, updated_at DESC",
    )?;
    statement
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
        .collect()
}

fn with_connection<T>(
    db: State<'_, AppDb>,
    operation: impl FnOnce(&Connection) -> rusqlite::Result<T>,
) -> Result<T, CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    operation(&connection).map_err(CommandError::database)
}

#[tauri::command]
pub fn list_events(db: State<'_, AppDb>) -> Result<Vec<Event>, CommandError> {
    with_connection(db, query_events)
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
```

Retain the test module added in Step 1 below this code.

- [ ] **Step 4: Implement the safe error constructor**

Replace `CommandError::database` in `src-tauri/src/error.rs` with:

```rust
pub fn database(error: impl std::fmt::Display) -> Self {
    eprintln!("database operation failed: {error}");
    Self {
        code: "database_error".to_string(),
        message: "无法读取本地数据，请重试。".to_string(),
        field: None,
    }
}
```

- [ ] **Step 5: Register modules and the settings command in `src-tauri/src/main.rs`**

At the top, change the module declarations to:

```rust
mod commands;
mod db;
mod error;
mod models;
mod settings;
mod wallpaper;
```

In `tauri::generate_handler!`, add the settings command after `list_notes`:

```rust
commands::get_app_settings,
```

- [ ] **Step 6: Run Rust tests and verify GREEN**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: all tests pass, including fresh empty lists, current category column, safe error mapping, migrations, settings, tray, and wallpaper geometry.

- [ ] **Step 7: Commit the IPC read foundation**

If Task 2 was not committed because of compilation coupling, include its files here:

```bash
git add src-tauri/src/commands.rs src-tauri/src/error.rs src-tauri/src/main.rs src-tauri/src/models.rs src-tauri/src/settings.rs src-tauri/src/db.rs
git commit -m "feature: expose typed startup data commands"
```

## Task 4: Define and test the frontend repository boundary

**Files:**
- Create: `src/data/nowly-repository.ts`
- Create: `src/data/tauri-nowly-repository.ts`
- Create: `src/data/tauri-nowly-repository.test.ts`
- Create: `src/data/RepositoryContext.tsx`
- Modify: `src/calendar/calendar-model.ts`
- Modify: `src/notes/notes-model.ts`

- [ ] **Step 1: Write the failing Tauri repository test**

Create `src/data/tauri-nowly-repository.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tauriNowlyRepository } from './tauri-nowly-repository';

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

describe('tauriNowlyRepository', () => {
  beforeEach(() => invokeMock.mockReset());

  it('owns the exact startup command names', async () => {
    invokeMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ wallpaperEnabled: false });

    await tauriNowlyRepository.listEvents();
    await tauriNowlyRepository.listTasks();
    await tauriNowlyRepository.listNotes();
    await tauriNowlyRepository.getSettings();

    expect(invokeMock.mock.calls).toEqual([
      ['list_events'],
      ['list_tasks'],
      ['list_notes'],
      ['get_app_settings']
    ]);
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
npm test -- src/data/tauri-nowly-repository.test.ts
```

Expected: FAIL because the repository modules do not exist.

- [ ] **Step 3: Align frontend entity models with Rust IPC**

Replace `src/calendar/calendar-model.ts` with:

```ts
export type EventColor = 'blue' | 'red' | 'green' | 'yellow';

export type CalendarEvent = {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  category: string;
  color: EventColor;
  linkedTaskId: string | null;
  note: string;
  createdAt: string;
  updatedAt: string;
};

export type CalendarDay = {
  isoDate: string;
  dayOfMonth: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  events: CalendarEvent[];
};
```

Replace `src/notes/notes-model.ts` with:

```ts
export type Note = {
  id: string;
  title: string;
  content: string;
  color: 'yellow' | 'blue' | 'green' | 'purple';
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
};
```

Add timestamps to `MatrixTask` in `src/matrix/matrix-model.ts` immediately after `note`:

```ts
  createdAt: string;
  updatedAt: string;
```

Update `src/lib/sample-data.ts` test fixtures so every event/task has `createdAt` and `updatedAt`, rename each event `categoryId` property to `category`, and replace no colors unless a note currently uses `red` (change that fixture color to `purple`). Use `2026-07-23T09:00:00Z` for missing fixture timestamps.

- [ ] **Step 4: Create the repository interface**

Create `src/data/nowly-repository.ts`:

```ts
import type { CalendarEvent } from '../calendar/calendar-model';
import type { MatrixTask } from '../matrix/matrix-model';
import type { Note } from '../notes/notes-model';

export type AppSettings = {
  wallpaperEnabled: boolean;
  launchAtLogin: boolean;
  targetMonitorId: string | null;
  density: 'balanced' | 'comfortable';
  weekStart: 'monday' | 'sunday';
  dateFormat: 'localized' | 'iso';
  showWeekends: boolean;
  calendarEnabled: boolean;
  matrixEnabled: boolean;
  notesEnabled: boolean;
};

export type RepositoryError = {
  code: 'validation_error' | 'not_found' | 'conflict' | 'database_error' | 'system_error';
  message: string;
  field?: string;
};

export type NowlyRepository = {
  listEvents(): Promise<CalendarEvent[]>;
  listTasks(): Promise<MatrixTask[]>;
  listNotes(): Promise<Note[]>;
  getSettings(): Promise<AppSettings>;
};
```

Create `src/data/tauri-nowly-repository.ts`:

```ts
import { invoke } from '@tauri-apps/api/core';
import type { NowlyRepository } from './nowly-repository';

export const tauriNowlyRepository: NowlyRepository = {
  listEvents: () => invoke('list_events'),
  listTasks: () => invoke('list_tasks'),
  listNotes: () => invoke('list_notes'),
  getSettings: () => invoke('get_app_settings')
};
```

Create `src/data/RepositoryContext.tsx`:

```tsx
import { createContext, useContext, type ReactNode } from 'react';
import type { NowlyRepository } from './nowly-repository';
import { tauriNowlyRepository } from './tauri-nowly-repository';

const RepositoryContext = createContext<NowlyRepository>(tauriNowlyRepository);

export function RepositoryProvider({ repository, children }: { repository: NowlyRepository; children: ReactNode }) {
  return <RepositoryContext.Provider value={repository}>{children}</RepositoryContext.Provider>;
}

export function useNowlyRepository() {
  return useContext(RepositoryContext);
}
```

- [ ] **Step 5: Run repository and existing frontend tests**

Run:

```bash
npm test -- src/data/tauri-nowly-repository.test.ts
npm test
```

Expected: repository test passes. Existing component tests also pass after fixture shape updates; TypeScript errors caused by `categoryId` or `red` note colors are fixed at their usage sites rather than weakening the new contracts.

- [ ] **Step 6: Commit the repository boundary**

```bash
git add src/data src/calendar/calendar-model.ts src/matrix/matrix-model.ts src/notes/notes-model.ts src/lib/sample-data.ts
git commit -m "refactor: add typed data repository boundary"
```

## Task 5: Build independent startup loading and retry state

**Files:**
- Create: `src/app/useAppBootstrap.ts`
- Create: `src/app/useAppBootstrap.test.tsx`

- [ ] **Step 1: Write failing hook tests**

Create `src/app/useAppBootstrap.test.tsx`:

```tsx
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { RepositoryProvider } from '../data/RepositoryContext';
import type { AppSettings, NowlyRepository } from '../data/nowly-repository';
import { useAppBootstrap } from './useAppBootstrap';

const settings: AppSettings = {
  wallpaperEnabled: false,
  launchAtLogin: false,
  targetMonitorId: null,
  density: 'balanced',
  weekStart: 'monday',
  dateFormat: 'localized',
  showWeekends: true,
  calendarEnabled: true,
  matrixEnabled: true,
  notesEnabled: true
};

function repository(overrides: Partial<NowlyRepository> = {}): NowlyRepository {
  return {
    listEvents: vi.fn().mockResolvedValue([]),
    listTasks: vi.fn().mockResolvedValue([]),
    listNotes: vi.fn().mockResolvedValue([]),
    getSettings: vi.fn().mockResolvedValue(settings),
    ...overrides
  };
}

function wrapper(value: NowlyRepository) {
  return ({ children }: { children: ReactNode }) => (
    <RepositoryProvider repository={value}>{children}</RepositoryProvider>
  );
}

describe('useAppBootstrap', () => {
  it('loads empty data and settings independently', async () => {
    const { result } = renderHook(() => useAppBootstrap(), { wrapper: wrapper(repository()) });
    expect(result.current.events.status).toBe('loading');
    await waitFor(() => expect(result.current.settings.status).toBe('ready'));
    expect(result.current.events).toMatchObject({ status: 'ready', data: [] });
    expect(result.current.tasks).toMatchObject({ status: 'ready', data: [] });
    expect(result.current.notes).toMatchObject({ status: 'ready', data: [] });
  });

  it('keeps other modules ready when notes fail and retries notes only', async () => {
    const listNotes = vi.fn()
      .mockRejectedValueOnce({ code: 'database_error', message: '便签读取失败' })
      .mockResolvedValueOnce([]);
    const value = repository({ listNotes });
    const { result } = renderHook(() => useAppBootstrap(), { wrapper: wrapper(value) });

    await waitFor(() => expect(result.current.notes.status).toBe('error'));
    expect(result.current.events.status).toBe('ready');
    expect(result.current.tasks.status).toBe('ready');

    await act(() => result.current.retryNotes());
    await waitFor(() => expect(result.current.notes.status).toBe('ready'));
    expect(listNotes).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run and verify RED**

Run:

```bash
npm test -- src/app/useAppBootstrap.test.tsx
```

Expected: FAIL because `useAppBootstrap` does not exist.

- [ ] **Step 3: Implement `useAppBootstrap.ts`**

Create:

```ts
import { useCallback, useEffect, useState } from 'react';
import type { CalendarEvent } from '../calendar/calendar-model';
import type { AppSettings } from '../data/nowly-repository';
import { useNowlyRepository } from '../data/RepositoryContext';
import type { MatrixTask } from '../matrix/matrix-model';
import type { Note } from '../notes/notes-model';

type Resource<T> =
  | { status: 'loading'; data: T }
  | { status: 'ready'; data: T }
  | { status: 'error'; data: T; message: string };

const defaultSettings: AppSettings = {
  wallpaperEnabled: false,
  launchAtLogin: false,
  targetMonitorId: null,
  density: 'balanced',
  weekStart: 'monday',
  dateFormat: 'localized',
  showWeekends: true,
  calendarEnabled: true,
  matrixEnabled: true,
  notesEnabled: true
};

function messageFrom(error: unknown) {
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return '无法读取本地数据，请重试。';
}

export function useAppBootstrap() {
  const repository = useNowlyRepository();
  const [events, setEvents] = useState<Resource<CalendarEvent[]>>({ status: 'loading', data: [] });
  const [tasks, setTasks] = useState<Resource<MatrixTask[]>>({ status: 'loading', data: [] });
  const [notes, setNotes] = useState<Resource<Note[]>>({ status: 'loading', data: [] });
  const [settings, setSettings] = useState<Resource<AppSettings>>({ status: 'loading', data: defaultSettings });

  const loadEvents = useCallback(async () => {
    setEvents((current) => ({ status: 'loading', data: current.data }));
    try { setEvents({ status: 'ready', data: await repository.listEvents() }); }
    catch (error) { setEvents((current) => ({ status: 'error', data: current.data, message: messageFrom(error) })); }
  }, [repository]);

  const loadTasks = useCallback(async () => {
    setTasks((current) => ({ status: 'loading', data: current.data }));
    try { setTasks({ status: 'ready', data: await repository.listTasks() }); }
    catch (error) { setTasks((current) => ({ status: 'error', data: current.data, message: messageFrom(error) })); }
  }, [repository]);

  const loadNotes = useCallback(async () => {
    setNotes((current) => ({ status: 'loading', data: current.data }));
    try { setNotes({ status: 'ready', data: await repository.listNotes() }); }
    catch (error) { setNotes((current) => ({ status: 'error', data: current.data, message: messageFrom(error) })); }
  }, [repository]);

  const loadSettings = useCallback(async () => {
    setSettings((current) => ({ status: 'loading', data: current.data }));
    try { setSettings({ status: 'ready', data: await repository.getSettings() }); }
    catch (error) { setSettings((current) => ({ status: 'error', data: current.data, message: messageFrom(error) })); }
  }, [repository]);

  useEffect(() => { void Promise.allSettled([loadEvents(), loadTasks(), loadNotes(), loadSettings()]); }, [loadEvents, loadTasks, loadNotes, loadSettings]);

  return {
    events,
    tasks,
    notes,
    settings,
    retryEvents: loadEvents,
    retryTasks: loadTasks,
    retryNotes: loadNotes,
    retrySettings: loadSettings
  };
}
```

- [ ] **Step 4: Run focused test and verify GREEN**

Run:

```bash
npm test -- src/app/useAppBootstrap.test.tsx
```

Expected: both tests pass with no React `act` warnings.

- [ ] **Step 5: Commit the bootstrap hook**

```bash
git add src/app/useAppBootstrap.ts src/app/useAppBootstrap.test.tsx
git commit -m "feature: load startup resources independently"
```

## Task 6: Add explicit loading, error, and empty widget behavior

**Files:**
- Modify: `src/calendar/CalendarWidget.test.tsx`
- Modify: `src/calendar/CalendarWidget.tsx`
- Modify: `src/matrix/MatrixWidget.test.tsx`
- Modify: `src/matrix/MatrixWidget.tsx`
- Modify: `src/notes/NotesWidget.test.tsx`
- Modify: `src/notes/NotesWidget.tsx`

- [ ] **Step 1: Add failing empty/error tests**

Append to `CalendarWidget.test.tsx`:

```tsx
it('shows an empty month summary and a retryable read error', () => {
  const retry = vi.fn();
  const { rerender } = render(
    <CalendarWidget year={2026} monthIndex={6} todayIso="2026-07-23" events={[]} status="ready" onRetry={retry} onCreateEvent={vi.fn()} onOpenDate={vi.fn()} onOpenEvent={vi.fn()} />
  );
  expect(screen.getByText('本月暂无日程')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '新建日程' })).toBeInTheDocument();

  rerender(<CalendarWidget year={2026} monthIndex={6} todayIso="2026-07-23" events={[]} status="error" errorMessage="日程读取失败" onRetry={retry} onCreateEvent={vi.fn()} onOpenDate={vi.fn()} onOpenEvent={vi.fn()} />);
  screen.getByRole('button', { name: '重试读取日程' }).click();
  expect(screen.getByRole('alert')).toHaveTextContent('日程读取失败');
  expect(retry).toHaveBeenCalledOnce();
});
```

Append to `MatrixWidget.test.tsx`:

```tsx
it('keeps four quadrants visible when empty and retries module errors', () => {
  const retry = vi.fn();
  const { rerender } = render(<MatrixWidget tasks={[]} status="ready" onRetry={retry} onCreateTask={vi.fn()} onOpenTask={vi.fn()} />);
  expect(screen.getAllByText('暂无任务')).toHaveLength(4);
  expect(screen.getByRole('button', { name: '新增任务' })).toBeInTheDocument();

  rerender(<MatrixWidget tasks={[]} status="error" errorMessage="任务读取失败" onRetry={retry} onCreateTask={vi.fn()} onOpenTask={vi.fn()} />);
  screen.getByRole('button', { name: '重试读取任务' }).click();
  expect(screen.getByRole('alert')).toHaveTextContent('任务读取失败');
  expect(retry).toHaveBeenCalledOnce();
});
```

Append to `NotesWidget.test.tsx`:

```tsx
it('shows a create action when empty and retries module errors', () => {
  const retry = vi.fn();
  const { rerender } = render(<NotesWidget notes={[]} status="ready" onRetry={retry} onCreateNote={vi.fn()} onOpenNote={vi.fn()} />);
  expect(screen.getByText('还没有便签')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '新建便签' })).toBeInTheDocument();

  rerender(<NotesWidget notes={[]} status="error" errorMessage="便签读取失败" onRetry={retry} onCreateNote={vi.fn()} onOpenNote={vi.fn()} />);
  screen.getByRole('button', { name: '重试读取便签' }).click();
  expect(screen.getByRole('alert')).toHaveTextContent('便签读取失败');
  expect(retry).toHaveBeenCalledOnce();
});
```

Update existing renders in these three test files to pass `status="ready"`, `onRetry={vi.fn()}`, and the applicable create callback.

- [ ] **Step 2: Run widget tests and verify RED**

Run:

```bash
npm test -- src/calendar/CalendarWidget.test.tsx src/matrix/MatrixWidget.test.tsx src/notes/NotesWidget.test.tsx
```

Expected: TypeScript/React failures because the new props and empty/error states do not exist.

- [ ] **Step 3: Add common state props and static module messages**

In each widget define:

```ts
type LoadStatus = 'loading' | 'ready' | 'error';
```

Extend `CalendarWidgetProps` with:

```ts
status: LoadStatus;
errorMessage?: string;
onRetry: () => void;
onCreateEvent: () => void;
```

Replace its title copy with Chinese prototype copy and render these exact controls in the header:

```tsx
<div className="heading-group">
  <h1>{year} 年 {monthIndex + 1} 月</h1>
  <p>{status === 'loading' ? '正在读取本地日程' : events.length ? `本月 ${events.length} 个日程` : '本月暂无日程'}</p>
</div>
<div className="toolbar-actions">
  <button type="button" className="btn btn-icon" aria-label="上一个月"><ChevronLeft aria-hidden="true" /></button>
  <button type="button" className="btn">今天</button>
  <button type="button" className="btn btn-icon" aria-label="下一个月"><ChevronRight aria-hidden="true" /></button>
  <button type="button" className="btn btn-primary" onClick={onCreateEvent}>新建日程</button>
</div>
```

When `status === 'error'`, render before the calendar grid:

```tsx
<div className="module-message" role="alert">
  <span>{errorMessage ?? '无法读取日程。'}</span>
  <button type="button" className="link-btn" aria-label="重试读取日程" onClick={onRetry}>重试</button>
</div>
```

Extend `MatrixWidgetProps` with `status`, `errorMessage`, `onRetry`, `onCreateTask`. Replace the header action with:

```tsx
<button type="button" className="btn btn-icon" aria-label="新增任务" onClick={onCreateTask}><Plus aria-hidden="true" /></button>
```

Import `Plus` from `lucide-react`. In each quadrant's scroll container, render:

```tsx
{status === 'ready' && quadrantTasks.length === 0 ? <p className="empty-copy">暂无任务</p> : null}
```

At the beginning of the panel body render, when errored:

```tsx
<div className="module-message" role="alert">
  <span>{errorMessage ?? '无法读取任务。'}</span>
  <button type="button" className="link-btn" aria-label="重试读取任务" onClick={onRetry}>重试</button>
</div>
```

Extend `NotesWidgetProps` with `status`, `errorMessage`, `onRetry`, `onCreateNote`. Use a `Plus` icon header button with accessible name `新增便签`. For ready/empty notes render:

```tsx
<div className="empty-state">
  <p>还没有便签</p>
  <button type="button" className="link-btn" aria-label="新建便签" onClick={onCreateNote}>新建便签</button>
</div>
```

For error render the same `module-message` pattern with `重试读取便签`.

For loading states, render these exact static messages in the respective panel bodies without icons or animated indicators:

```tsx
{status === 'loading' ? <p className="empty-copy">正在读取本地日程</p> : null}
{status === 'loading' ? <p className="empty-copy">正在读取本地任务</p> : null}
{status === 'loading' ? <p className="empty-copy">正在读取本地便签</p> : null}
```

Use only the matching line in each widget. Also update the existing calendar test assertion from `July 2026` to `2026 年 7 月` when changing the heading.

Keep all existing event/task/note rendering for non-empty data. Replace legacy color utility maps with semantic classes (`event--work`, `event--important`, `event--personal`, `event--learning`, and `note--yellow|blue|green|purple`) so Task 8 can style them from authoritative tokens.

- [ ] **Step 4: Run widget tests and verify GREEN**

Run:

```bash
npm test -- src/calendar/CalendarWidget.test.tsx src/matrix/MatrixWidget.test.tsx src/notes/NotesWidget.test.tsx
```

Expected: all widget tests pass. Loading copy is static and no spinner exists.

- [ ] **Step 5: Commit widget states**

```bash
git add src/calendar src/matrix src/notes
git commit -m "feature: add empty and error widget states"
```

## Task 7: Connect App to repositories and remove production sample imports

**Files:**
- Modify: `src/app/App.test.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/modals/ModalRoot.tsx`
- Modify: `src/main.tsx`

- [ ] **Step 1: Rewrite `src/app/App.test.tsx` around an injected repository**

Use this test setup while retaining the three existing window behavior assertions:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RepositoryProvider } from '../data/RepositoryContext';
import type { AppSettings, NowlyRepository } from '../data/nowly-repository';
import { App } from './App';

const invokeMock = vi.hoisted(() => vi.fn());
const listenMock = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }));

const settings: AppSettings = {
  wallpaperEnabled: false, launchAtLogin: false, targetMonitorId: null,
  density: 'balanced', weekStart: 'monday', dateFormat: 'localized',
  showWeekends: true, calendarEnabled: true, matrixEnabled: true, notesEnabled: true
};

function createRepository(overrides: Partial<NowlyRepository> = {}): NowlyRepository {
  return {
    listEvents: vi.fn().mockResolvedValue([]),
    listTasks: vi.fn().mockResolvedValue([]),
    listNotes: vi.fn().mockResolvedValue([]),
    getSettings: vi.fn().mockResolvedValue(settings),
    ...overrides
  };
}

function renderApp(repository = createRepository()) {
  return render(<RepositoryProvider repository={repository}><App /></RepositoryProvider>);
}

describe('App startup and window behavior', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();
    listenMock.mockResolvedValue(() => undefined);
    invokeMock.mockResolvedValue('ok');
  });

  it('renders persisted empty startup data instead of samples', async () => {
    renderApp();
    expect(screen.getByText('正在读取本地日程')).toBeInTheDocument();
    expect(screen.getByText('正在读取本地任务')).toBeInTheDocument();
    expect(screen.getByText('正在读取本地便签')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('本月暂无日程')).toBeInTheDocument());
    expect(screen.getAllByText('暂无任务')).toHaveLength(4);
    expect(screen.getByText('还没有便签')).toBeInTheDocument();
    expect(screen.queryByText('设计评审')).not.toBeInTheDocument();
    expect(screen.queryByText('产品原则')).not.toBeInTheDocument();
  });

  it('keeps healthy modules visible when one read fails', async () => {
    renderApp(createRepository({ listNotes: vi.fn().mockRejectedValue({ message: '便签读取失败' }) }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('便签读取失败'));
    expect(screen.getByText('本月暂无日程')).toBeInTheDocument();
    expect(screen.getAllByText('暂无任务')).toHaveLength(4);
  });

  it('starts in foreground without automatically entering wallpaper mode', async () => {
    renderApp();
    expect(screen.getByRole('button', { name: '设为壁纸' })).toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('enters wallpaper from the content action and returns on wallpaper double click', async () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: '设为壁纸' }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('enter_wallpaper_mode'));
    await waitFor(() => expect(screen.queryByRole('button', { name: '设为壁纸' })).not.toBeInTheDocument());
    fireEvent.doubleClick(screen.getByTestId('desktop-root'));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('enter_foreground_mode'));
  });

  it('updates the wallpaper action when the tray changes window mode', async () => {
    let listener: ((event: { payload: 'foreground' | 'wallpaper' }) => void) | undefined;
    listenMock.mockImplementation((_name, callback) => { listener = callback; return Promise.resolve(() => undefined); });
    renderApp();
    await waitFor(() => expect(listener).toBeDefined());
    listener?.({ payload: 'wallpaper' });
    await waitFor(() => expect(screen.queryByRole('button', { name: '设为壁纸' })).not.toBeInTheDocument());
    listener?.({ payload: 'foreground' });
    await waitFor(() => expect(screen.getByRole('button', { name: '设为壁纸' })).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run the App test and verify RED**

Run:

```bash
npm test -- src/app/App.test.tsx
```

Expected: FAIL because App still renders sample entities and does not show repository loading/empty/error states.

- [ ] **Step 3: Refactor `ModalRoot` so it has no sample imports**

Change its props to:

```ts
type ModalRootProps = {
  modal: ModalState;
  events: CalendarEvent[];
  tasks: MatrixTask[];
  onClose: () => void;
};
```

Import the two types from their model files, remove the `sample-data` import, and render:

```tsx
{modal.type === 'event' ? <EventModal event={modal.event} tasks={tasks} onClose={onClose} /> : null}
{modal.type === 'task' ? <TaskModal task={modal.task} events={events} onClose={onClose} /> : null}
```

Keep note rendering unchanged. Date-detail implementation remains in the event plan.

- [ ] **Step 4: Refactor `App` to consume `useAppBootstrap`**

Remove `sampleEvents`, `sampleTasks`, and `sampleNotes` imports. Add:

```ts
import { useAppBootstrap } from './useAppBootstrap';
```

At the start of `App`, add:

```ts
const bootstrap = useAppBootstrap();
const events = bootstrap.events.data;
const tasks = bootstrap.tasks.data;
const notes = bootstrap.notes.data;
```

Replace the three widget nodes with:

```tsx
calendar={
  <CalendarWidget
    year={2026}
    monthIndex={6}
    todayIso="2026-07-23"
    events={events}
    status={bootstrap.events.status}
    errorMessage={bootstrap.events.status === 'error' ? bootstrap.events.message : undefined}
    onRetry={() => void bootstrap.retryEvents()}
    onCreateEvent={() => undefined}
    onOpenDate={(isoDate) => openModalInForeground({ type: 'date', isoDate })}
    onOpenEvent={(event) => openModalInForeground({ type: 'event', event })}
  />
}
matrix={
  <MatrixWidget
    tasks={tasks}
    status={bootstrap.tasks.status}
    errorMessage={bootstrap.tasks.status === 'error' ? bootstrap.tasks.message : undefined}
    onRetry={() => void bootstrap.retryTasks()}
    onCreateTask={() => undefined}
    onOpenTask={(task) => openModalInForeground({ type: 'task', task })}
  />
}
notes={
  <NotesWidget
    notes={notes}
    status={bootstrap.notes.status}
    errorMessage={bootstrap.notes.status === 'error' ? bootstrap.notes.message : undefined}
    onRetry={() => void bootstrap.retryNotes()}
    onCreateNote={() => undefined}
    onOpenNote={(note) => openModalInForeground({ type: 'note', note })}
  />
}
```

Use dynamic current date rather than the demo date before committing. Add at module scope:

```ts
function localIsoDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
```

Inside App derive `const now = new Date(); const todayIso = localIsoDate(now);`, use `now.getFullYear()` and `now.getMonth()`, and format the topbar date with `Intl.DateTimeFormat('zh-CN', { dateStyle: 'full' })`. The time can use `Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })`; do not add a timer in stage 1.

Render:

```tsx
<ModalRoot modal={modal} events={events} tasks={tasks} onClose={() => setModal(null)} />
```

Pass each hook status through unchanged so the widgets display the exact static loading messages defined in Task 6. Do not add a second global loader, spinner, or skeleton.

- [ ] **Step 5: Keep production repository wiring explicit in `main.tsx`**

Wrap App:

```tsx
import { RepositoryProvider } from './data/RepositoryContext';
import { tauriNowlyRepository } from './data/tauri-nowly-repository';

<React.StrictMode>
  <RepositoryProvider repository={tauriNowlyRepository}>
    <App />
  </RepositoryProvider>
</React.StrictMode>
```

- [ ] **Step 6: Run focused and full frontend tests**

Run:

```bash
npm test -- src/app/App.test.tsx
npm test
```

Expected: all tests pass. App's production dependency graph has no import of `src/lib/sample-data.ts`.

Verify that condition:

```bash
rg "sample-data" src --glob '!**/*.test.*'
```

Expected: no output.

- [ ] **Step 7: Commit production data wiring**

```bash
git add src/app/App.tsx src/app/App.test.tsx src/main.tsx src/modals/ModalRoot.tsx
git commit -m "feature: start Nowly from persisted empty data"
```

## Task 8: Align the stage-1 shell with the approved prototype and design tokens

**Files:**
- Modify: `src/app/layout/DesktopShell.test.tsx`
- Modify: `src/app/layout/DesktopShell.tsx`
- Modify: `src/app/styles.css`
- Modify: `src/calendar/CalendarWidget.tsx`
- Modify: `src/matrix/MatrixWidget.tsx`
- Modify: `src/notes/NotesWidget.tsx`

- [ ] **Step 1: Add failing shell design tests**

Append to `src/app/layout/DesktopShell.test.tsx`:

```tsx
it('uses the approved single-screen Good shell without legacy visual effects', () => {
  render(
    <DesktopShell
      time="09:41"
      dateText="2026 年 7 月 23 日，星期四"
      summary="今天暂无日程 · 暂无重要任务 · 暂无便签"
      calendar={<div>calendar</div>}
      matrix={<div>matrix</div>}
      notes={<div>notes</div>}
    />
  );

  const root = screen.getByTestId('desktop-root');
  expect(root).toHaveClass('app-shell');
  expect(root.className).not.toMatch(/gradient|backdrop|shadow-soft/);
  expect(screen.getByRole('banner')).toHaveClass('topbar');
  expect(screen.getByRole('main')).toHaveClass('workspace');
});
```

If the existing test file lacks Testing Library imports, use:

```ts
import { render, screen } from '@testing-library/react';
```

- [ ] **Step 2: Run the shell test and verify RED**

Run:

```bash
npm test -- src/app/layout/DesktopShell.test.tsx
```

Expected: FAIL because the shell still contains gradient, translucent, backdrop blur, and old utility classes.

- [ ] **Step 3: Replace `DesktopShell` markup with semantic project classes**

Keep the existing props and window behavior, but use this component body:

```tsx
const foreground = mode === 'foreground';
return (
  <div data-testid="desktop-root" onDoubleClickCapture={foreground ? undefined : onWallpaperDoubleClick} className="app-shell">
    <header className="topbar">
      <div className="date-copy">
        <strong>{dateText}</strong>
        <p>{summary}</p>
      </div>
      <div className="top-actions">
        <span className="topbar-time" aria-label={`当前时间 ${time}`}>{time}</span>
        {foreground ? (
          <button type="button" className="btn btn-primary" aria-label="设为壁纸" disabled={isModeSwitching} onClick={onSetWallpaper}>
            <MonitorDown aria-hidden="true" />
            {isModeSwitching ? '设置中' : '设为壁纸'}
          </button>
        ) : null}
      </div>
    </header>
    <main className="workspace">
      <section className="card calendar-card">{calendar}</section>
      <aside className="side-column">
        <section className="card priority-card">{matrix}</section>
        <section className="card notes-card">{notes}</section>
      </aside>
    </main>
  </div>
);
```

`MonitorDown` remains the lucide icon; do not write inline SVG.

- [ ] **Step 4: Replace legacy widget layout utility strings with prototype class names**

Use these structural wrappers:

- Calendar root: `calendar-card-content`; header: `card-header`; body: `calendar-body`; weekdays: `weekdays`; grid: `calendar-grid`; day: `day`, plus `outside` and `today`; number: `day-number`; event: `event` plus semantic color class.
- Matrix root: `widget-content`; header: `card-header`; body: `panel-body`; grid: `quadrant-grid`; quadrant: `quadrant` plus `q-danger`, `q-primary`, `q-warning`, or `q-neutral`; task list: `quadrant-tasks`.
- Notes root: `widget-content`; header: `card-header`; body: `panel-body`; list: `notes-list`; note: `note` plus its semantic color class.

Do not alter widget behavior while replacing classes.

- [ ] **Step 5: Replace the shell/widget section of `styles.css` with authoritative rules**

Retain the existing Good modal/select styles below them. Ensure `:root` contains all tokens from design.md used here, then add:

```css
body { margin: 0; color: var(--text-secondary); background: var(--bg-subtle); font: 400 16px/1.5 var(--font-sans); }
button, input, textarea, select { font: inherit; }
button { cursor: pointer; }
button:disabled { cursor: default; opacity: .65; }
:where(button, input, textarea, select):focus-visible { outline: 0; box-shadow: 0 0 0 4px var(--focus-ring); }

.app-shell { width: 100vw; height: 100vh; display: grid; grid-template-rows: 70px minmax(0, 1fr); overflow: hidden; background: var(--bg-subtle); }
.topbar { min-width: 0; padding: 0 36px; display: flex; align-items: center; justify-content: space-between; gap: 24px; background: var(--bg-surface); border-bottom: 1px solid var(--border-default); }
.date-copy { min-width: 0; }
.date-copy strong { display: block; color: var(--text-primary); font-size: 17.2px; font-weight: 600; }
.date-copy p { margin: 0; color: var(--text-muted); font-size: 13.6px; font-weight: 500; }
.top-actions, .toolbar-actions { display: flex; align-items: center; gap: 8px; }
.topbar-time { color: var(--text-strong); font-size: 17.2px; font-weight: 600; }
.workspace { min-width: 0; min-height: 0; padding: 24px 36px 36px; display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(360px, .72fr); gap: 24px; }
.card { min-width: 0; min-height: 0; overflow: hidden; border: 1px solid var(--border-default); border-radius: var(--radius-default); background: var(--bg-surface); box-shadow: none; }
.calendar-card, .priority-card, .notes-card, .widget-content, .calendar-card-content { min-height: 0; display: flex; flex-direction: column; }
.card-header { min-height: 70px; padding: 12px 36px; display: flex; align-items: center; justify-content: space-between; gap: 16px; border-bottom: 1px dashed var(--border-default); }
.heading-group h1, .heading-group h2 { margin: 0; color: var(--text-primary); font-size: 20px; font-weight: 700; line-height: 1.4; }
.heading-group p { margin: 4px 0 0; color: var(--text-muted); font-size: 13.6px; font-weight: 500; }
.btn { min-height: 48px; padding: 12.4px 24px; border: 1px solid transparent; border-radius: var(--radius-default); display: inline-flex; align-items: center; justify-content: center; gap: 8px; color: var(--text-strong); background: var(--bg-subtle); font-size: 16px; font-weight: 500; white-space: nowrap; }
.btn:hover { color: var(--color-primary); background: var(--bg-secondary); }
.btn-primary { color: #fff; background: var(--color-primary); border-color: var(--color-primary); }
.btn-primary:hover { color: #fff; background: var(--color-primary-hover); border-color: var(--color-primary-hover); }
.btn-icon { width: 40px; height: 40px; min-height: 40px; padding: 0; }
.btn svg { width: 18px; height: 18px; }
.calendar-body { min-height: 0; flex: 1; padding: 12px 24px 24px; display: flex; flex-direction: column; }
.weekdays { height: 36px; flex: none; display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); align-items: center; }
.weekdays span { text-align: center; color: var(--text-muted); font-size: 13.6px; font-weight: 600; }
.calendar-grid { min-height: 0; flex: 1; display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); grid-template-rows: repeat(5, minmax(0, 1fr)); border-top: 1px solid var(--border-default); border-left: 1px solid var(--border-default); border-radius: var(--radius-default); overflow: hidden; }
.day { min-width: 0; min-height: 0; padding: 8px; overflow: hidden; text-align: left; border: 0; border-right: 1px solid var(--border-default); border-bottom: 1px solid var(--border-default); background: var(--bg-surface); }
.day:nth-child(7n), .day:nth-child(7n - 1) { background: var(--bg-subtle); }
.day.outside { color: var(--text-disabled); }
.day.today { background: var(--color-primary-light); box-shadow: inset 0 0 0 1px var(--color-primary); }
.day-number { width: 28px; height: 28px; display: grid; place-items: center; border-radius: var(--radius-sm); font-size: 13.6px; font-weight: 600; }
.event { width: 100%; min-height: 24px; margin-top: 4px; padding: 2px 8px; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border-radius: var(--radius-sm); font-size: 13.6px; font-weight: 500; }
.event--work { color: var(--color-primary-active); background: var(--color-primary-light); }
.event--important { color: var(--color-danger-active); background: var(--color-danger-light); }
.event--personal { color: #6f8617; background: var(--color-success-light); }
.event--learning { color: var(--color-info-active); background: var(--color-info-light); }
.side-column { min-width: 0; min-height: 0; display: grid; grid-template-rows: minmax(0, 1.15fr) minmax(0, .85fr); gap: 24px; }
.panel-body { min-height: 0; flex: 1; padding: 20px 24px 24px; overflow: auto; }
.quadrant-grid { min-height: 100%; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); grid-template-rows: repeat(2, minmax(0, 1fr)); gap: 12px; }
.quadrant { min-width: 0; min-height: 0; padding: 16px; border-radius: var(--radius-default); overflow: hidden; }
.q-danger { background: var(--color-danger-light); } .q-primary { background: var(--color-primary-light); } .q-warning { background: var(--color-warning-light); } .q-neutral { background: var(--bg-subtle); }
.quadrant h3 { margin: 0 0 8px; color: var(--text-primary); font-size: 15.2px; font-weight: 600; }
.quadrant-tasks { min-height: 0; overflow: auto; }
.empty-copy, .empty-state p { margin: 0; color: var(--text-muted); font-size: 13.6px; }
.notes-list { display: grid; gap: 12px; }
.note { width: 100%; padding: 12px 16px; border: 1px solid transparent; border-radius: var(--radius-default); text-align: left; }
.note--yellow { background: var(--color-warning-light); } .note--blue { background: var(--color-primary-light); } .note--green { background: var(--color-success-light); } .note--purple { background: var(--color-info-light); }
.note-title { color: var(--text-primary); font-size: 15.2px; font-weight: 600; }
.note-content { margin: 4px 0; color: var(--text-secondary); font-size: 13.6px; }
.empty-state { padding: 24px; border: 1px dashed var(--border-default); border-radius: var(--radius-default); text-align: center; }
.link-btn { padding: 0; border: 0; color: var(--color-primary-active); background: transparent; font-size: 13.6px; font-weight: 600; }
.module-message { margin-bottom: 12px; padding: 12px 16px; display: flex; justify-content: space-between; gap: 12px; color: var(--color-danger-active); background: var(--color-danger-light); border-radius: var(--radius-default); font-size: 13.6px; }
@media (max-width: 1500px), (max-height: 850px) { .topbar { padding-inline: 16px; } .workspace { padding: 16px; gap: 16px; } .side-column { gap: 16px; } .card-header { min-height: 64px; padding: 8px 20px; } .calendar-body, .panel-body { padding: 12px 16px 16px; } .quadrant-grid { gap: 8px; } .quadrant { padding: 12px; } .btn { min-height: 40px; padding: 8.8px 16px; font-size: 15.2px; } .btn-icon { width: 35px; height: 35px; min-height: 35px; padding: 0; } }
```

Add any missing root tokens exactly as specified by `design.md`: `--radius-sm`, success/info/warning/danger light and active colors, and `--font-sans`. Remove any gradient, backdrop-filter, legacy `#009ef7`, `#181c32`, or `#7e8299` declarations encountered in changed code.

- [ ] **Step 6: Run UI tests and build**

Run:

```bash
npm test
npm run build
```

Expected: all tests pass and TypeScript/Vite build succeeds.

Run static checks:

```bash
rg -n "transition:|animation:|backdrop-filter|linear-gradient|radial-gradient|#009ef7|#181c32|#7e8299" src || true
```

Expected: no prohibited declarations. The required global `animation: none` and `transition: none` rules may match; inspect output and ensure only prohibitive declarations remain.

- [ ] **Step 7: Commit the approved shell**

```bash
git add src/app/layout src/app/styles.css src/calendar/CalendarWidget.tsx src/matrix/MatrixWidget.tsx src/notes/NotesWidget.tsx
git commit -m "feature: align empty dashboard with final prototype"
```

## Task 9: Add production-page smoke coverage for empty startup

**Files:**
- Create: `tests/nowly-empty-startup.spec.ts`
- Modify: `playwright.config.ts` only if the existing config does not start Vite.

- [ ] **Step 1: Write the failing Playwright smoke test**

Create `tests/nowly-empty-startup.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

test('shows the persisted-data empty dashboard without page overflow or motion', async ({ page }) => {
  await page.addInitScript(() => {
    const settings = {
      wallpaperEnabled: false, launchAtLogin: false, targetMonitorId: null,
      density: 'balanced', weekStart: 'monday', dateFormat: 'localized',
      showWeekends: true, calendarEnabled: true, matrixEnabled: true, notesEnabled: true
    };
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: { invoke: async (command: string) => command === 'get_app_settings' ? settings : [] }
    });
  });
  await page.goto('/');

  await expect(page.getByText('本月暂无日程')).toBeVisible();
  await expect(page.getByText('暂无任务')).toHaveCount(4);
  await expect(page.getByText('还没有便签')).toBeVisible();
  await expect(page.getByText('设计评审')).toHaveCount(0);

  const metrics = await page.evaluate(() => ({
    bodyWidth: document.body.scrollWidth,
    bodyHeight: document.body.scrollHeight,
    viewportWidth: innerWidth,
    viewportHeight: innerHeight,
    transition: getComputedStyle(document.querySelector('.btn')!).transitionDuration,
    animation: getComputedStyle(document.querySelector('.btn')!).animationName
  }));
  expect(metrics.bodyWidth).toBeLessThanOrEqual(metrics.viewportWidth);
  expect(metrics.bodyHeight).toBeLessThanOrEqual(metrics.viewportHeight);
  expect(metrics.transition).toBe('0s');
  expect(metrics.animation).toBe('none');
});
```

- [ ] **Step 2: Run and verify RED**

Run:

```bash
npm run e2e -- tests/nowly-empty-startup.spec.ts
```

Expected before the stage-1 app wiring is complete: FAIL because the page shows samples or cannot resolve mocked Tauri invokes. If it fails because Tauri 2 uses a different browser global shape, inspect `@tauri-apps/api/core` once and adjust the `addInitScript` mock to that exact public runtime shape; do not add production browser fallbacks.

- [ ] **Step 3: Make only the test-harness/config adjustment needed for the real app page**

Use the existing `playwright.config.ts` web server if present. If absent, add exactly:

```ts
webServer: {
  command: 'npm run dev',
  url: 'http://127.0.0.1:1420',
  reuseExistingServer: true
},
use: { baseURL: 'http://127.0.0.1:1420' }
```

Do not change application behavior to satisfy browser-only mocking.

- [ ] **Step 4: Run Playwright at required viewport sizes**

Run:

```bash
npm run e2e -- tests/nowly-empty-startup.spec.ts --project=chromium
```

If the config has no named Chromium project, omit `--project=chromium`. Repeat with viewport overrides in the test or existing projects for 1366×768, 1920×1080, and 2560×1440. Expected: empty state visible, no page overflow, and motion disabled.

- [ ] **Step 5: Commit smoke coverage**

```bash
git add tests/nowly-empty-startup.spec.ts playwright.config.ts
git commit -m "test: cover persisted empty dashboard startup"
```

## Task 10: Run the stage gate and request review

**Files:**
- No production file changes; this task verifies the completed stage and hands it to review.

- [ ] **Step 1: Run all automated checks**

```bash
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
npm run e2e -- tests/nowly-empty-startup.spec.ts
git diff --check
```

Expected: all commands exit 0 and test output contains no unhandled errors or React warnings.

- [ ] **Step 2: Verify the production dependency graph and prohibited styles**

```bash
rg "sample-data" src --glob '!**/*.test.*'
rg -n "backdrop-filter|linear-gradient|radial-gradient|#009ef7|#181c32|#7e8299" src || true
git status --short
```

Expected:

- no production import of `sample-data`;
- no prohibited style/token matches;
- only intentional documentation edits remain before the final commit.

- [ ] **Step 3: Request code review before stage 2 planning**

Use the requesting-code-review skill. Review against:

- `docs/superpowers/specs/2026-07-29-nowly-windows-complete-product-design.md`, sections 3, 4, 5, 13, 14, and 15;
- this plan's file map and stage gate;
- no regressions in existing wallpaper/tray tests.

Do not write or execute the event CRUD plan until stage 1 review findings are resolved.
