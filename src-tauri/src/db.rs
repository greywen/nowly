use rusqlite::{Connection, OptionalExtension, Result, Transaction};
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
    (6, migration_6_module_layout_and_templates),
    (7, migration_7_module_state),
    (8, migration_8_extensions),
    (9, migration_9_kanban),
    (10, migration_10_hex_colors_and_recent_colors),
    (11, migration_11_focus_sessions),
    (12, migration_12_extension_allowed_hosts),
    (13, migration_13_recurrence),
    (14, migration_14_reminders),
    (15, migration_15_ics_rebuild),
    (16, migration_16_calendar_subscriptions),
    (17, migration_17_notes_styles_and_icons),
    (18, migration_18_unified_tasks),
];

pub fn open_database(path: PathBuf) -> Result<Connection> {
    // Before the first destructive unified-task migration runs, copy the
    // database to a versioned backup so a failed or unwanted upgrade can be
    // recovered by restoring the file. The backup only happens once: a database
    // already at version 18+ has no pending destructive migration.
    back_up_before_unified_tasks(&path)?;
    let mut connection = Connection::open(path)?;
    connection.execute_batch("PRAGMA foreign_keys = ON;")?;
    migrate(&mut connection)?;
    Ok(connection)
}

// The schema version at which the destructive tasks/kanban merge lands. If the
// on-disk database is below this and non-empty, back it up first.
const UNIFIED_TASKS_VERSION: i64 = 18;

fn back_up_before_unified_tasks(path: &PathBuf) -> Result<()> {
    if !path.exists() {
        return Ok(());
    }
    // Open read-only to learn the current applied version without mutating.
    let current = {
        let connection = Connection::open(path)?;
        let has_migrations: bool = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations')",
                [],
                |row| row.get(0),
            )
            .unwrap_or(false);
        if !has_migrations {
            return Ok(());
        }
        connection
            .query_row(
                "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap_or(0)
    };
    if current == 0 || current >= UNIFIED_TASKS_VERSION {
        return Ok(());
    }
    let backup = path.with_extension(format!("pre-v{UNIFIED_TASKS_VERSION}.sqlite.bak"));
    if backup.exists() {
        // A prior run already made the backup; do not overwrite it.
        return Ok(());
    }
    std::fs::copy(path, &backup).map_err(|error| {
        rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_CANTOPEN),
            Some(format!("数据库备份失败，已中止升级：{error}")),
        )
    })?;
    Ok(())
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
        ("recent_colors", "[]"),
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

fn migration_6_module_layout_and_templates(transaction: &Transaction<'_>) -> Result<()> {
    transaction.execute_batch(
        "CREATE TABLE IF NOT EXISTS module_layout (
            id TEXT PRIMARY KEY,
            x INTEGER NOT NULL,
            y INTEGER NOT NULL,
            w INTEGER NOT NULL,
            h INTEGER NOT NULL,
            position INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS custom_templates (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            blocks TEXT NOT NULL,
            min_w INTEGER NOT NULL,
            min_h INTEGER NOT NULL,
            default_w INTEGER NOT NULL,
            default_h INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
         );",
    )?;
    const DEFAULT_LAYOUT: &[(&str, i64, i64, i64, i64)] = &[
        ("calendar", 0, 0, 7, 8),
        ("matrix", 7, 0, 5, 5),
        ("notes", 7, 5, 5, 3),
    ];
    for (index, (id, x, y, w, h)) in DEFAULT_LAYOUT.iter().enumerate() {
        transaction.execute(
            "INSERT OR IGNORE INTO module_layout(id, x, y, w, h, position)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![id, x, y, w, h, index as i64],
        )?;
    }
    Ok(())
}

fn migration_7_module_state(transaction: &Transaction<'_>) -> Result<()> {
    // Per-module persisted state. Each module owns one JSON blob keyed by its
    // widget id. This is the storage a runnable module writes through the host
    // API, and the seam a future sandboxed extension would talk to.
    transaction.execute_batch(
        "CREATE TABLE IF NOT EXISTS module_state (
            module_id TEXT PRIMARY KEY,
            state TEXT NOT NULL,
            updated_at TEXT NOT NULL
         );",
    )
}

fn migration_8_extensions(transaction: &Transaction<'_>) -> Result<()> {
    // Installed sandbox extensions. Each row is third-party-style JS source that
    // runs in an isolated iframe, plus a declared permission set. This is the
    // real distribution seam: user-installed extension code lives here instead
    // of being hard-coded in the app.
    transaction.execute_batch(
        "CREATE TABLE IF NOT EXISTS extensions (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            source TEXT NOT NULL,
            permissions TEXT NOT NULL DEFAULT '[]',
            min_w INTEGER NOT NULL,
            min_h INTEGER NOT NULL,
            default_w INTEGER NOT NULL,
            default_h INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
         );",
    )?;
    // Seed a counter demo so the sandbox is discoverable out of the box. It is a
    // normal installed extension — nothing special beyond being pre-populated.
    let source = r#"
Nowly.defineModule(async function ({ host, root }) {
  var state = (await host.loadState()) || { count: 0 };

  function render() {
    root.innerHTML = '';

    var date = document.createElement('p');
    date.textContent = host.todayIso ? ('\u4eca\u5929\uff1a' + host.todayIso) : '';
    date.style.margin = '0 0 12px';
    date.style.color = '#5a6473';

    var value = document.createElement('p');
    value.textContent = '\u8ba1\u6570\uff1a' + state.count;
    value.style.margin = '0 0 12px';
    value.style.fontSize = '24px';
    value.style.fontWeight = '700';

    var row = document.createElement('div');
    row.style.display = 'flex';
    row.style.gap = '8px';

    var inc = document.createElement('button');
    inc.textContent = '+1';
    inc.onclick = async function () {
      state = { count: state.count + 1 };
      await host.saveState(state);
      render();
    };

    var resetBtn = document.createElement('button');
    resetBtn.textContent = '\u91cd\u7f6e';
    resetBtn.onclick = async function () {
      state = { count: 0 };
      await host.saveState(state);
      render();
    };

    row.appendChild(inc);
    row.appendChild(resetBtn);
    root.appendChild(date);
    root.appendChild(value);
    root.appendChild(row);
  }

  render();
});
"#;
    transaction.execute(
        "INSERT OR IGNORE INTO extensions(id,name,description,source,permissions,min_w,min_h,default_w,default_h,created_at,updated_at)
         VALUES ('counter-demo',?1,?2,?3,'[\"state\",\"today\"]',3,3,4,4,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
        rusqlite::params!["沙箱计数器", "运行在隔离沙箱中的示例扩展，演示第三方扩展契约。", source],
    )?;
    Ok(())
}

fn migration_9_kanban(transaction: &Transaction<'_>) -> Result<()> {
    // Kanban module tables. A single board first version: lanes hold cards,
    // cards may reference one priority and many tags / collaborators through
    // join tables. Deleting a lane cascades to its cards and their links;
    // deleting a global field only clears its links (or nulls a card's
    // priority) without removing cards. Positions are dense integers per
    // parent, renumbered on every mutation by the repository layer.
    transaction.execute_batch(
        "CREATE TABLE IF NOT EXISTS kanban_lanes (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            color TEXT NOT NULL,
            position INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS kanban_priorities (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            color TEXT NOT NULL,
            position INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS kanban_tags (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            color TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS kanban_collaborators (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS kanban_cards (
            id TEXT PRIMARY KEY,
            lane_id TEXT NOT NULL REFERENCES kanban_lanes(id) ON DELETE CASCADE,
            title TEXT NOT NULL,
            description TEXT,
            due_date TEXT,
            priority_id TEXT REFERENCES kanban_priorities(id) ON DELETE SET NULL,
            position INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS kanban_card_tags (
            card_id TEXT NOT NULL REFERENCES kanban_cards(id) ON DELETE CASCADE,
            tag_id TEXT NOT NULL REFERENCES kanban_tags(id) ON DELETE CASCADE,
            PRIMARY KEY (card_id, tag_id)
         );
         CREATE TABLE IF NOT EXISTS kanban_card_collaborators (
            card_id TEXT NOT NULL REFERENCES kanban_cards(id) ON DELETE CASCADE,
            collaborator_id TEXT NOT NULL REFERENCES kanban_collaborators(id) ON DELETE CASCADE,
            PRIMARY KEY (card_id, collaborator_id)
         );
         CREATE INDEX IF NOT EXISTS idx_kanban_lanes_position ON kanban_lanes(position);
         CREATE INDEX IF NOT EXISTS idx_kanban_cards_lane ON kanban_cards(lane_id, position);
         CREATE INDEX IF NOT EXISTS idx_kanban_priorities_position ON kanban_priorities(position);",
    )?;
    // Seed the three default lanes exactly once. Because the migration runs a
    // single time, this is naturally idempotent and never re-creates lanes the
    // user later deletes.
    const DEFAULT_LANES: &[(&str, &str, &str, i64)] = &[
        ("kanban-lane-todo", "待处理", "#4FC9DA", 0),
        ("kanban-lane-doing", "进行中", "#E8C444", 1),
        ("kanban-lane-done", "已完成", "#B8D935", 2),
    ];
    for (id, name, color, position) in DEFAULT_LANES {
        transaction.execute(
            "INSERT OR IGNORE INTO kanban_lanes(id, name, color, position, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
            rusqlite::params![id, name, color, position],
        )?;
    }
    Ok(())
}

fn migration_11_focus_sessions(transaction: &Transaction<'_>) -> Result<()> {
    transaction.execute_batch(
        "CREATE TABLE IF NOT EXISTS focus_sessions (
            id TEXT PRIMARY KEY,
            planned_seconds INTEGER NOT NULL CHECK (planned_seconds > 0),
            focused_seconds INTEGER NOT NULL CHECK (focused_seconds > 0),
            status TEXT NOT NULL CHECK (status IN ('completed', 'interrupted')),
            started_at TEXT NOT NULL,
            ended_at TEXT NOT NULL,
            created_at TEXT NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_focus_sessions_ended_at
            ON focus_sessions(ended_at);",
    )
}

fn migration_12_extension_allowed_hosts(transaction: &Transaction<'_>) -> Result<()> {
    // Network-capable modules declare the exact hosts they may reach. Stored as a
    // JSON string array; empty means "no network", which is the safe default for
    // every existing extension.
    if !column_exists(transaction, "extensions", "allowed_hosts")? {
        transaction.execute_batch(
            "ALTER TABLE extensions ADD COLUMN allowed_hosts TEXT NOT NULL DEFAULT '[]';",
        )?;
    }
    Ok(())
}

// 跨列 CHECK 只能挂在最后添加的那一列上，因为被引用的列必须已经存在。
// SQLite 不会用新增的 CHECK 回验存量行，而存量行取默认值本就满足约束。
fn migration_13_recurrence(transaction: &Transaction<'_>) -> Result<()> {
    transaction.execute_batch(
        "ALTER TABLE events ADD COLUMN recurrence_freq TEXT;
         ALTER TABLE events ADD COLUMN recurrence_interval INTEGER NOT NULL DEFAULT 1
            CHECK (recurrence_interval >= 1);
         ALTER TABLE events ADD COLUMN recurrence_by_day TEXT NOT NULL DEFAULT '';
         ALTER TABLE events ADD COLUMN recurrence_until TEXT;
         ALTER TABLE events ADD COLUMN recurrence_count INTEGER;
         ALTER TABLE events ADD COLUMN recurrence_final_at TEXT
            CHECK ((recurrence_until IS NULL OR recurrence_count IS NULL)
                   AND (recurrence_freq IS NOT NULL
                        OR (recurrence_until IS NULL
                            AND recurrence_count IS NULL
                            AND recurrence_final_at IS NULL)));

         CREATE INDEX idx_events_recurrence_active
            ON events(recurrence_final_at) WHERE recurrence_freq IS NOT NULL;

         CREATE TABLE IF NOT EXISTS event_exceptions (
           id TEXT PRIMARY KEY,
           series_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
           occurrence_start_at TEXT NOT NULL,
           kind TEXT NOT NULL CHECK (kind IN ('excluded','overridden')),
           title TEXT,
           start_at TEXT,
           end_at TEXT,
           all_day INTEGER,
           category TEXT,
           color TEXT,
           note TEXT,
           created_at TEXT NOT NULL,
           updated_at TEXT NOT NULL
         );
         CREATE UNIQUE INDEX IF NOT EXISTS idx_event_exceptions_slot
            ON event_exceptions(series_id, occurrence_start_at);
         CREATE INDEX IF NOT EXISTS idx_event_exceptions_moved
            ON event_exceptions(series_id, start_at);",
    )
}

// 提醒以「事件开始前多少分钟」的偏移量数组存储，落在 events 行上（整个系列共享一套提醒）。
// reminder_dispatches 记录已经弹出过的提醒，(event_id, occurrence_start_at, offset_minutes)
// 唯一，保证同一次提醒只通知一次；外键 CASCADE 让日程删除时自动清理派发记录。
fn migration_14_reminders(transaction: &Transaction<'_>) -> Result<()> {
    transaction.execute_batch(
        "ALTER TABLE events ADD COLUMN reminders TEXT NOT NULL DEFAULT '[]';
         CREATE TABLE IF NOT EXISTS reminder_dispatches (
            event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
            occurrence_start_at TEXT NOT NULL,
            offset_minutes INTEGER NOT NULL,
            dispatched_at TEXT NOT NULL,
            PRIMARY KEY (event_id, occurrence_start_at, offset_minutes)
         );",
    )
}

// ICS 彻底革新：清空并重建 events / event_exceptions / reminder_dispatches 为 RFC 5545
// 时间模型。带时区列、UTC 缓存列、标准 RRULE 串、rdate/exdate。这是不可逆的破坏性迁移：
// 所有既有日程、改期、提醒记录被清空（已与需求方确认采用彻底革新、不保留旧数据）。
// tasks 表保留，但其 linked_event_id 指向的事件已被清空，一并置 NULL 以免悬空引用。
fn migration_15_ics_rebuild(transaction: &Transaction<'_>) -> Result<()> {
    transaction.execute_batch(
        // 先在 events 仍存在时置空 tasks 的外键，避免开启外键时 UPDATE 找不到父表。
        "UPDATE tasks SET linked_event_id = NULL;
         DROP TABLE IF EXISTS reminder_dispatches;
         DROP TABLE IF EXISTS event_exceptions;
         DROP TABLE IF EXISTS events;

         CREATE TABLE events (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            start_at TEXT NOT NULL,
            end_at TEXT NOT NULL,
            start_tz TEXT,
            end_tz TEXT,
            start_utc TEXT,
            end_utc TEXT,
            all_day INTEGER NOT NULL CHECK (all_day IN (0, 1)),
            category TEXT NOT NULL,
            color TEXT NOT NULL,
            linked_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
            note TEXT NOT NULL DEFAULT '',
            reminders TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            rrule TEXT,
            recurrence_final_at TEXT,
            rdate TEXT,
            exdate TEXT
         );

         CREATE INDEX idx_events_range ON events(start_at, end_at);
         CREATE INDEX idx_events_start_utc ON events(start_utc) WHERE start_utc IS NOT NULL;
         CREATE INDEX idx_events_recurrence_active
            ON events(recurrence_final_at) WHERE rrule IS NOT NULL;
         CREATE UNIQUE INDEX idx_events_linked_task
            ON events(linked_task_id) WHERE linked_task_id IS NOT NULL;

         CREATE TABLE event_exceptions (
            id TEXT PRIMARY KEY,
            series_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
            occurrence_start_at TEXT NOT NULL,
            kind TEXT NOT NULL CHECK (kind IN ('excluded','overridden')),
            title TEXT,
            start_at TEXT,
            end_at TEXT,
            all_day INTEGER,
            category TEXT,
            color TEXT,
            note TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
         );
         CREATE UNIQUE INDEX idx_event_exceptions_slot
            ON event_exceptions(series_id, occurrence_start_at);
         CREATE INDEX idx_event_exceptions_moved
            ON event_exceptions(series_id, start_at);

         CREATE TABLE reminder_dispatches (
            event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
            occurrence_start_at TEXT NOT NULL,
            offset_minutes INTEGER NOT NULL,
            dispatched_at TEXT NOT NULL,
            PRIMARY KEY (event_id, occurrence_start_at, offset_minutes)
         );",
    )
}

fn migration_10_hex_colors_and_recent_colors(transaction: &Transaction<'_>) -> Result<()> {
    transaction.execute_batch(
        "UPDATE events SET color = CASE lower(color)
           WHEN 'blue' THEN '#4FC9DA' WHEN 'red' THEN '#F06445'
           WHEN 'green' THEN '#B8D935' WHEN 'yellow' THEN '#E8C444'
           ELSE upper(color) END;
         UPDATE notes SET color = CASE lower(color)
           WHEN 'yellow' THEN '#E8C444' WHEN 'blue' THEN '#4FC9DA'
           WHEN 'green' THEN '#B8D935' WHEN 'purple' THEN '#4F55DA'
           ELSE upper(color) END;
         UPDATE kanban_lanes SET color = CASE lower(color)
           WHEN 'primary' THEN '#4FC9DA' WHEN 'success' THEN '#B8D935'
           WHEN 'info' THEN '#4F55DA' WHEN 'warning' THEN '#E8C444'
           WHEN 'danger' THEN '#F06445' ELSE upper(color) END;
         UPDATE kanban_priorities SET color = CASE lower(color)
           WHEN 'primary' THEN '#4FC9DA' WHEN 'success' THEN '#B8D935'
           WHEN 'info' THEN '#4F55DA' WHEN 'warning' THEN '#E8C444'
           WHEN 'danger' THEN '#F06445' ELSE upper(color) END;
         UPDATE kanban_tags SET color = CASE lower(color)
           WHEN 'primary' THEN '#4FC9DA' WHEN 'success' THEN '#B8D935'
           WHEN 'info' THEN '#4F55DA' WHEN 'warning' THEN '#E8C444'
           WHEN 'danger' THEN '#F06445' ELSE upper(color) END;
         INSERT OR IGNORE INTO settings(key,value,updated_at)
           VALUES ('recent_colors','[]',strftime('%Y-%m-%dT%H:%M:%fZ','now'));",
    )?;
    for (table, fallback) in [
        ("events", "#4FC9DA"),
        ("notes", "#E8C444"),
        ("kanban_lanes", "#4FC9DA"),
        ("kanban_priorities", "#4FC9DA"),
        ("kanban_tags", "#4FC9DA"),
    ] {
        transaction.execute(
            &format!("UPDATE {table} SET color=?1 WHERE color NOT GLOB '#[0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F]'"),
            [fallback],
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
    let violations: i64 =
        transaction.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
            row.get(0)
        })?;
    if violations != 0 {
        return Err(rusqlite::Error::ExecuteReturnedResults);
    }
    Ok(())
}

fn migration_16_calendar_subscriptions(transaction: &Transaction<'_>) -> Result<()> {
    transaction.execute_batch(
        "CREATE TABLE calendar_subscriptions (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            url TEXT NOT NULL,
            color TEXT NOT NULL,
            refresh_interval_minutes INTEGER NOT NULL DEFAULT 15,
            last_synced_at TEXT,
            last_attempted_at TEXT,
            last_status TEXT CHECK (last_status IN ('ok','failed')),
            last_error TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
         );

         CREATE TABLE external_events (
            id TEXT PRIMARY KEY,
            subscription_id TEXT NOT NULL
                REFERENCES calendar_subscriptions(id) ON DELETE CASCADE,
            uid TEXT,
            start_at TEXT NOT NULL,
            end_at TEXT NOT NULL,
            start_tz TEXT,
            end_tz TEXT,
            start_utc TEXT,
            end_utc TEXT,
            all_day INTEGER NOT NULL CHECK (all_day IN (0, 1)),
            title TEXT NOT NULL,
            location TEXT,
            description TEXT,
            last_synced_at TEXT NOT NULL
         );

         CREATE INDEX idx_external_events_subscription
            ON external_events(subscription_id);
         CREATE INDEX idx_external_events_range
            ON external_events(start_at, end_at);
         CREATE INDEX idx_external_events_start_utc
            ON external_events(start_utc) WHERE start_utc IS NOT NULL;",
    )
}

fn migration_17_notes_styles_and_icons(transaction: &Transaction<'_>) -> Result<()> {
    transaction.execute_batch(
        "ALTER TABLE notes ADD COLUMN style_variant INTEGER NOT NULL DEFAULT 0
            CHECK (style_variant BETWEEN 0 AND 8);
         ALTER TABLE notes ADD COLUMN icon TEXT NOT NULL DEFAULT '';
         UPDATE notes SET style_variant = ABS(RANDOM()) % 9;",
    )
}

// Unify the two task systems (matrix `tasks` and kanban `kanban_cards`) into a
// single `tasks` domain projected into three views. This is a destructive,
// non-reversible structural migration; `open_database` copies a versioned
// backup before it runs. Everything happens in the migration's own
// transaction: on any error the whole thing rolls back and the backup remains.
fn migration_18_unified_tasks(transaction: &Transaction<'_>) -> Result<()> {
    // Fixed priority values. The old matrix `quadrant` maps straight across;
    // the old integer `priority` (1|2|3) is dropped as a business field.
    const FIXED_PRIORITIES: &[&str] = &[
        "important_urgent",
        "important_not_urgent",
        "not_important_urgent",
        "not_important_not_urgent",
    ];

    // --- 1. New global field tables (lanes/tags/collaborators + links) -------
    // Lanes evolve from kanban_lanes; tags/collaborators gain `archived_at`.
    transaction.execute_batch(
        "CREATE TABLE task_lanes (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            color TEXT NOT NULL,
            position INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
         );
         INSERT INTO task_lanes(id,name,color,position,created_at,updated_at)
            SELECT id,name,color,position,created_at,updated_at FROM kanban_lanes;

         CREATE TABLE task_tags (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            color TEXT NOT NULL,
            archived_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
         );
         INSERT INTO task_tags(id,name,color,archived_at,created_at,updated_at)
            SELECT id,name,color,NULL,created_at,updated_at FROM kanban_tags;

         CREATE TABLE task_collaborators (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            archived_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
         );
         INSERT INTO task_collaborators(id,name,archived_at,created_at,updated_at)
            SELECT id,name,NULL,created_at,updated_at FROM kanban_collaborators;",
    )?;

    // Guarantee at least two lanes exist so default/completion lane settings
    // always resolve, even if the user deleted the seeded lanes.
    let lane_count: i64 =
        transaction.query_row("SELECT COUNT(*) FROM task_lanes", [], |row| row.get(0))?;
    if lane_count == 0 {
        transaction.execute_batch(
            "INSERT INTO task_lanes(id,name,color,position,created_at,updated_at) VALUES
               ('kanban-lane-todo','待处理','#4FC9DA',0,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
               ('kanban-lane-done','已完成','#B8D935',1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'));",
        )?;
    }

    // Resolve the default (not-done) lane and the completion lane by stable id
    // when present, otherwise the first / last lane by position.
    let default_lane_id: String = transaction.query_row(
        "SELECT id FROM task_lanes
         ORDER BY CASE WHEN id='kanban-lane-todo' THEN 0 ELSE 1 END,
                  position ASC, id ASC
         LIMIT 1",
        [],
        |row| row.get(0),
    )?;
    let completion_lane_id: String = transaction.query_row(
        "SELECT id FROM task_lanes
         ORDER BY CASE WHEN id='kanban-lane-done' THEN 0 ELSE 1 END,
                  position DESC, id DESC
         LIMIT 1",
        [],
        |row| row.get(0),
    )?;

    // --- 2. Rebuild the mutually-referencing task/event tables ---------------
    // SQLite rewrites foreign-key targets when a referenced table is renamed.
    // Rebuild both sides of the task<->event relationship, plus the event child
    // tables, so no final FK can accidentally keep targeting a `_v17` table.
    transaction.execute_batch(
        "PRAGMA defer_foreign_keys = ON;
         DROP INDEX IF EXISTS idx_tasks_quadrant;
         DROP INDEX IF EXISTS idx_tasks_linked_event;
         DROP INDEX IF EXISTS idx_events_range;
         DROP INDEX IF EXISTS idx_events_start_utc;
         DROP INDEX IF EXISTS idx_events_recurrence_active;
         DROP INDEX IF EXISTS idx_events_linked_task;
         DROP INDEX IF EXISTS idx_event_exceptions_slot;
         DROP INDEX IF EXISTS idx_event_exceptions_moved;

         ALTER TABLE event_exceptions RENAME TO event_exceptions_v17;
         ALTER TABLE reminder_dispatches RENAME TO reminder_dispatches_v17;
         ALTER TABLE events RENAME TO events_v17;
         ALTER TABLE tasks RENAME TO tasks_v17;

         CREATE TABLE tasks (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            priority TEXT CHECK (priority IN
              ('important_urgent','important_not_urgent','not_important_urgent','not_important_not_urgent')),
            due_date TEXT,
            completed INTEGER NOT NULL CHECK (completed IN (0,1)),
            lane_id TEXT NOT NULL REFERENCES task_lanes(id),
            board_position INTEGER NOT NULL,
            linked_event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
         );
         CREATE TABLE events (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            start_at TEXT NOT NULL,
            end_at TEXT NOT NULL,
            start_tz TEXT,
            end_tz TEXT,
            start_utc TEXT,
            end_utc TEXT,
            all_day INTEGER NOT NULL CHECK (all_day IN (0, 1)),
            category TEXT NOT NULL,
            color TEXT NOT NULL,
            linked_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
            note TEXT NOT NULL DEFAULT '',
            reminders TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            rrule TEXT,
            recurrence_final_at TEXT,
            rdate TEXT,
            exdate TEXT
         );
         CREATE TABLE event_exceptions (
            id TEXT PRIMARY KEY,
            series_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
            occurrence_start_at TEXT NOT NULL,
            kind TEXT NOT NULL CHECK (kind IN ('excluded','overridden')),
            title TEXT,
            start_at TEXT,
            end_at TEXT,
            all_day INTEGER,
            category TEXT,
            color TEXT,
            note TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
         );
         CREATE TABLE reminder_dispatches (
            event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
            occurrence_start_at TEXT NOT NULL,
            offset_minutes INTEGER NOT NULL,
            dispatched_at TEXT NOT NULL,
            PRIMARY KEY (event_id, occurrence_start_at, offset_minutes)
         );

         CREATE TABLE task_tag_links (
            task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            tag_id TEXT NOT NULL REFERENCES task_tags(id) ON DELETE CASCADE,
            PRIMARY KEY (task_id, tag_id)
         );
         CREATE TABLE task_collaborator_links (
            task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            collaborator_id TEXT NOT NULL REFERENCES task_collaborators(id) ON DELETE CASCADE,
            PRIMARY KEY (task_id, collaborator_id)
         );
         CREATE TABLE task_view_memberships (
            task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            view TEXT NOT NULL CHECK (view IN ('kanban','matrix','calendar')),
            position INTEGER,
            created_at TEXT NOT NULL,
            PRIMARY KEY (task_id, view)
         );",
    )?;

    // --- 3. Migrate matrix tasks --------------------------------------------
    // quadrant -> priority (validated against the four fixed values);
    // note -> description; done tasks land in the completion lane, others in
    // the default lane. board_position is renumbered densely below.
    transaction.execute(
        "INSERT INTO tasks(id,title,description,priority,due_date,completed,lane_id,board_position,linked_event_id,created_at,updated_at)
         SELECT id, title, note,
                CASE WHEN quadrant IN ('important_urgent','important_not_urgent','not_important_urgent','not_important_not_urgent')
                     THEN quadrant ELSE NULL END,
                due_at, completed,
                CASE WHEN completed=1 THEN ?1 ELSE ?2 END,
                0, linked_event_id, created_at, updated_at
         FROM tasks_v17",
        rusqlite::params![completion_lane_id, default_lane_id],
    )?;
    transaction.execute_batch(
        "INSERT INTO events(
            id,title,start_at,end_at,start_tz,end_tz,start_utc,end_utc,all_day,
            category,color,linked_task_id,note,reminders,created_at,updated_at,
            rrule,recurrence_final_at,rdate,exdate
         )
         SELECT id,title,start_at,end_at,start_tz,end_tz,start_utc,end_utc,all_day,
                category,color,linked_task_id,note,reminders,created_at,updated_at,
                rrule,recurrence_final_at,rdate,exdate
         FROM events_v17;
         INSERT INTO event_exceptions(
            id,series_id,occurrence_start_at,kind,title,start_at,end_at,all_day,
            category,color,note,created_at,updated_at
         )
         SELECT id,series_id,occurrence_start_at,kind,title,start_at,end_at,all_day,
                category,color,note,created_at,updated_at
         FROM event_exceptions_v17;
         INSERT INTO reminder_dispatches(
            event_id,occurrence_start_at,offset_minutes,dispatched_at
         )
         SELECT event_id,occurrence_start_at,offset_minutes,dispatched_at
         FROM reminder_dispatches_v17;",
    )?;

    // --- 4. Migrate kanban cards --------------------------------------------
    // Cards keep their lane and become tasks. Completion is derived from the
    // completion lane only (no name guessing for custom lanes). Ids are
    // UUIDs in both systems so a collision is astronomically unlikely, but if
    // one occurs we prefix the card id and remember the remap for its links.
    transaction.execute_batch(
        "CREATE TEMP TABLE card_id_map(old_id TEXT PRIMARY KEY, new_id TEXT NOT NULL);
         INSERT INTO card_id_map(old_id,new_id)
            SELECT c.id,
                   CASE WHEN EXISTS(SELECT 1 FROM tasks t WHERE t.id=c.id)
                        THEN 'kanban-'||c.id ELSE c.id END
            FROM kanban_cards c;",
    )?;
    transaction.execute(
        "INSERT INTO tasks(id,title,description,priority,due_date,completed,lane_id,board_position,linked_event_id,created_at,updated_at)
         SELECT m.new_id, c.title, COALESCE(c.description,''), NULL, c.due_date,
                CASE WHEN c.lane_id=?1 THEN 1 ELSE 0 END,
                c.lane_id, c.position, NULL, c.created_at, c.updated_at
         FROM kanban_cards c JOIN card_id_map m ON m.old_id=c.id",
        rusqlite::params![completion_lane_id],
    )?;

    // Card tag / collaborator links, remapped through card_id_map.
    transaction.execute_batch(
        "INSERT OR IGNORE INTO task_tag_links(task_id,tag_id)
            SELECT m.new_id, kt.tag_id FROM kanban_card_tags kt
            JOIN card_id_map m ON m.old_id=kt.card_id;
         INSERT OR IGNORE INTO task_collaborator_links(task_id,collaborator_id)
            SELECT m.new_id, kc.collaborator_id FROM kanban_card_collaborators kc
            JOIN card_id_map m ON m.old_id=kc.card_id;",
    )?;

    // --- 5. Old custom kanban priorities -> tags ----------------------------
    // Only exact matches to the four fixed values map to a real priority; that
    // is applied to their cards. Everything else becomes a tag named
    // "旧优先级：{name}" so no priority information is silently dropped. If such
    // a tag name already exists (case-insensitive, trimmed) we reuse it.
    {
        let mut stmt = transaction
            .prepare("SELECT id,name,color FROM kanban_priorities ORDER BY position ASC,id ASC")?;
        let rows: Vec<(String, String, String)> = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
            .collect::<Result<_, _>>()?;
        drop(stmt);
        for (priority_id, name, color) in rows {
            let normalized = name.trim().to_lowercase();
            let fixed = FIXED_PRIORITIES.iter().find(|value| {
                **value == normalized
                    || matches!(
                        (normalized.as_str(), **value),
                        ("重要且紧急", "important_urgent")
                            | ("重要不紧急", "important_not_urgent")
                            | ("不重要但紧急", "not_important_urgent")
                            | ("不重要不紧急", "not_important_not_urgent")
                    )
            });
            if let Some(fixed) = fixed {
                // Apply the mapped priority to every card that used it.
                transaction.execute(
                    "UPDATE tasks SET priority=?1 WHERE id IN (
                        SELECT m.new_id FROM kanban_cards c
                        JOIN card_id_map m ON m.old_id=c.id WHERE c.priority_id=?2)",
                    rusqlite::params![fixed, priority_id],
                )?;
                continue;
            }
            // Convert to a tag. Reuse an existing tag with the same normalized
            // name, otherwise create one with a deterministic id.
            let tag_name = format!("旧优先级：{}", name.trim());
            let existing: Option<String> = transaction
                .query_row(
                    "SELECT id FROM task_tags WHERE lower(trim(name))=lower(trim(?1)) LIMIT 1",
                    [&tag_name],
                    |row| row.get(0),
                )
                .optional()?;
            let tag_id = match existing {
                Some(id) => id,
                None => {
                    let id = format!("migrated-priority-{priority_id}");
                    transaction.execute(
                        "INSERT INTO task_tags(id,name,color,archived_at,created_at,updated_at)
                         VALUES (?1,?2,?3,NULL,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
                        rusqlite::params![id, tag_name, color],
                    )?;
                    id
                }
            };
            transaction.execute(
                "INSERT OR IGNORE INTO task_tag_links(task_id,tag_id)
                 SELECT m.new_id, ?1 FROM kanban_cards c
                 JOIN card_id_map m ON m.old_id=c.id WHERE c.priority_id=?2",
                rusqlite::params![tag_id, priority_id],
            )?;
        }
    }

    // --- 6. Dense board_position per lane -----------------------------------
    // Keep kanban cards in their original order first, matrix tasks after.
    transaction.execute_batch(
        "UPDATE tasks SET board_position = board_position + 1000000
            WHERE id IN (SELECT id FROM tasks_v17);
         WITH ordered AS (
            SELECT id, row_number() OVER (
                PARTITION BY lane_id ORDER BY board_position ASC, created_at ASC, id ASC
            ) - 1 AS rn FROM tasks
         )
         UPDATE tasks SET board_position = (SELECT rn FROM ordered WHERE ordered.id = tasks.id);",
    )?;

    // --- 7. Initial view memberships (linking enabled by default) -----------
    // All tasks -> kanban; priority!=null -> matrix; due_date!=null -> calendar.
    // Matrix position preserves the old list order (creation order).
    transaction.execute_batch(
        "INSERT INTO task_view_memberships(task_id,view,position,created_at)
            SELECT id,'kanban',NULL,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM tasks;
         INSERT INTO task_view_memberships(task_id,view,position,created_at)
            SELECT id,'matrix',
                   row_number() OVER (PARTITION BY priority ORDER BY created_at ASC, id ASC) - 1,
                   strftime('%Y-%m-%dT%H:%M:%fZ','now')
            FROM tasks WHERE priority IS NOT NULL;
         INSERT INTO task_view_memberships(task_id,view,position,created_at)
            SELECT id,'calendar',NULL,strftime('%Y-%m-%dT%H:%M:%fZ','now')
            FROM tasks WHERE due_date IS NOT NULL;",
    )?;

    // --- 8. Settings ---------------------------------------------------------
    transaction.execute(
        "INSERT OR IGNORE INTO settings(key,value,updated_at) VALUES
            ('task_view_linking_enabled','true',strftime('%Y-%m-%dT%H:%M:%fZ','now')),
            ('task_view_preferences','{}',strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
        [],
    )?;
    transaction.execute(
        "INSERT INTO settings(key,value,updated_at)
         VALUES ('default_task_lane_id',json_quote(?1),strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
        [&default_lane_id],
    )?;
    transaction.execute(
        "INSERT INTO settings(key,value,updated_at)
         VALUES ('completion_task_lane_id',json_quote(?1),strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
        [&completion_lane_id],
    )?;

    // --- 9. Drop old tables and rebuild indexes ------------------------------
    transaction.execute_batch(
        "DROP TABLE event_exceptions_v17;
         DROP TABLE reminder_dispatches_v17;
         DROP TABLE events_v17;
         DROP TABLE tasks_v17;
         DROP TABLE card_id_map;
         DROP TABLE kanban_card_tags;
         DROP TABLE kanban_card_collaborators;
         DROP TABLE kanban_cards;
         DROP TABLE kanban_priorities;
         DROP TABLE kanban_tags;
         DROP TABLE kanban_collaborators;
         DROP TABLE kanban_lanes;

         CREATE INDEX idx_tasks_lane ON tasks(lane_id, board_position);
         CREATE INDEX idx_tasks_priority ON tasks(priority, completed);
         CREATE INDEX idx_tasks_due ON tasks(due_date, completed);
         CREATE INDEX idx_tasks_updated ON tasks(updated_at);
         CREATE UNIQUE INDEX idx_tasks_linked_event
            ON tasks(linked_event_id) WHERE linked_event_id IS NOT NULL;
         CREATE INDEX idx_task_view_memberships
            ON task_view_memberships(view, position, task_id);
         CREATE INDEX idx_events_range ON events(start_at, end_at);
         CREATE INDEX idx_events_start_utc ON events(start_utc) WHERE start_utc IS NOT NULL;
         CREATE INDEX idx_events_recurrence_active
            ON events(recurrence_final_at) WHERE rrule IS NOT NULL;
         CREATE UNIQUE INDEX idx_events_linked_task
            ON events(linked_task_id) WHERE linked_task_id IS NOT NULL;
         CREATE UNIQUE INDEX idx_event_exceptions_slot
            ON event_exceptions(series_id, occurrence_start_at);
         CREATE INDEX idx_event_exceptions_moved
            ON event_exceptions(series_id, start_at);",
    )?;

    // --- 10. Integrity check -------------------------------------------------
    let violations: i64 =
        transaction.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
            row.get(0)
        })?;
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
            "CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL
             );",
        )?;
        for (version, apply) in MIGRATIONS
            .iter()
            .filter(|(version, _)| *version <= max_version)
        {
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

    #[test]
    fn migration_5_rebuilds_event_task_links_with_foreign_keys() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch("PRAGMA foreign_keys = ON;")
            .unwrap();
        migrate(&mut connection).unwrap();

        let versions: Vec<i64> = connection
            .prepare("SELECT version FROM schema_migrations ORDER BY version")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(
            versions,
            vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]
        );

        let event_fks: Vec<(String, String, String)> = connection
            .prepare("PRAGMA foreign_key_list(events)")
            .unwrap()
            .query_map([], |row| Ok((row.get(2)?, row.get(3)?, row.get(6)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert!(event_fks.contains(&("tasks".into(), "linked_task_id".into(), "SET NULL".into())));

        let task_fks: Vec<(String, String, String)> = connection
            .prepare("PRAGMA foreign_key_list(tasks)")
            .unwrap()
            .query_map([], |row| Ok((row.get(2)?, row.get(3)?, row.get(6)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert!(task_fks.contains(&("events".into(), "linked_event_id".into(), "SET NULL".into())));
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

        // 只跑到迁移 14：迁移 15 会清空 events，破坏本测试对存量行的断言；
        // 本测试专验迁移 5 的悬空链接清理，故在其生效的 schema 版本上隔离验证。
        migrate_through(&mut connection, 14).unwrap();

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
                .query_row("SELECT COUNT(*) FROM events", [], |row| row
                    .get::<_, i64>(0))
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

        assert_eq!(
            versions,
            vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]
        );
        for table in [
            "events",
            "tasks",
            "notes",
            "settings",
            "widgets",
            "module_layout",
            "custom_templates",
            "module_state",
            "extensions",
            "task_lanes",
            "task_tags",
            "task_collaborators",
            "task_tag_links",
            "task_collaborator_links",
            "task_view_memberships",
            "focus_sessions",
        ] {
            assert!(table_exists(&connection, table), "missing table {table}");
        }
        connection.execute_batch(
            "INSERT INTO focus_sessions(id, planned_seconds, focused_seconds, status, started_at, ended_at, created_at)
             VALUES ('valid', 1500, 1200, 'completed', '2026-08-14T09:00:00Z', '2026-08-14T09:20:00Z', '2026-08-14T09:20:00Z');"
        ).expect("valid focus session inserts");
        assert!(connection.execute_batch(
            "INSERT INTO focus_sessions(id, planned_seconds, focused_seconds, status, started_at, ended_at, created_at)
             VALUES ('invalid', 1500, 0, 'unknown', '2026-08-14T09:00:00Z', '2026-08-14T09:20:00Z', '2026-08-14T09:20:00Z');"
        ).is_err());
    }

    #[test]
    fn migration_9_seeds_three_default_lanes_once_and_never_recreates_them() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch("PRAGMA foreign_keys = ON;")
            .unwrap();
        // Only migrate through 9: migration 18 folds kanban_lanes into
        // task_lanes and drops the old table, so this test isolates the
        // seeding behaviour on the schema version that owns it.
        migrate_through(&mut connection, 9).unwrap();

        let lanes: Vec<(String, String, String, i64)> = connection
            .prepare("SELECT id, name, color, position FROM kanban_lanes ORDER BY position")
            .unwrap()
            .query_map([], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            })
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(
            lanes,
            vec![
                (
                    "kanban-lane-todo".into(),
                    "待处理".into(),
                    "#4FC9DA".into(),
                    0
                ),
                (
                    "kanban-lane-doing".into(),
                    "进行中".into(),
                    "#E8C444".into(),
                    1
                ),
                (
                    "kanban-lane-done".into(),
                    "已完成".into(),
                    "#B8D935".into(),
                    2
                ),
            ]
        );

        // Deleting every lane and migrating again must not re-seed defaults,
        // because the migration version already ran once.
        connection.execute("DELETE FROM kanban_lanes", []).unwrap();
        migrate_through(&mut connection, 9).unwrap();
        let remaining: i64 = connection
            .query_row("SELECT COUNT(*) FROM kanban_lanes", [], |row| row.get(0))
            .unwrap();
        assert_eq!(remaining, 0);
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

    #[test]
    fn migration_13_exception_table_survives_rebuild() {
        // 迁移 15 已 DROP 并重建 events/event_exceptions，旧的分列重复模型与其
        // CHECK 约束不复存在。本测试改为验证重建后的最终 schema：事件用 rrule 串表达
        // 重复，例外表外键仍挂在真实系列上。
        let mut connection = Connection::open_in_memory().expect("memory db opens");
        connection
            .execute_batch("PRAGMA foreign_keys = ON;")
            .expect("foreign keys on");
        migrate(&mut connection).expect("migration succeeds");

        connection
            .execute(
                "INSERT INTO events(id,title,start_at,end_at,all_day,category,color,note,created_at,updated_at,rrule)
                 VALUES ('e1','会议','2026-08-03T10:00','2026-08-03T11:00',0,'work','#0BB783','','t','t','FREQ=WEEKLY;BYDAY=MO')",
                [],
            )
            .expect("recurring event inserts with rrule");

        connection
            .execute(
                "INSERT INTO event_exceptions(id,series_id,occurrence_start_at,kind,created_at,updated_at)
                 VALUES ('x1','e1','2026-08-10T10:00','excluded','t','t')",
                [],
            )
            .expect("exception inserts");
        let orphan = connection.execute(
            "INSERT INTO event_exceptions(id,series_id,occurrence_start_at,kind,created_at,updated_at)
             VALUES ('x2','missing','2026-08-10T10:00','excluded','t','t')",
            [],
        );
        assert!(orphan.is_err(), "例外必须挂在真实系列上");
    }

    #[test]
    fn deleting_a_series_cascades_its_exceptions() {
        let mut connection = Connection::open_in_memory().expect("memory db opens");
        connection
            .execute_batch("PRAGMA foreign_keys = ON;")
            .expect("foreign keys on");
        migrate(&mut connection).expect("migration succeeds");
        connection
            .execute(
                "INSERT INTO events(id,title,start_at,end_at,all_day,category,color,note,created_at,updated_at,rrule)
                 VALUES ('e1','会议','2026-08-03T10:00','2026-08-03T11:00',0,'work','#0BB783','','t','t','FREQ=WEEKLY;BYDAY=MO')",
                [],
            )
            .expect("series inserts");
        connection
            .execute(
                "INSERT INTO event_exceptions(id,series_id,occurrence_start_at,kind,created_at,updated_at)
                 VALUES ('x1','e1','2026-08-10T10:00','excluded','t','t')",
                [],
            )
            .expect("exception inserts");

        connection
            .execute("DELETE FROM events WHERE id='e1'", [])
            .expect("series deletes");
        let remaining: i64 = connection
            .query_row("SELECT COUNT(*) FROM event_exceptions", [], |row| {
                row.get(0)
            })
            .expect("count runs");
        assert_eq!(remaining, 0);
    }

    #[test]
    fn migration_14_adds_reminders_column_and_dispatch_table() {
        let mut connection = Connection::open_in_memory().expect("memory db opens");
        connection
            .execute_batch("PRAGMA foreign_keys = ON;")
            .expect("foreign keys on");
        migrate(&mut connection).expect("migration succeeds");

        // 新日程默认无提醒。
        connection
            .execute(
                "INSERT INTO events(id,title,start_at,end_at,all_day,category,color,note,created_at,updated_at)
                 VALUES ('e1','会议','2026-08-03T10:00','2026-08-03T11:00',0,'work','#0BB783','','t','t')",
                [],
            )
            .expect("event inserts with reminder default");
        let reminders: String = connection
            .query_row("SELECT reminders FROM events WHERE id='e1'", [], |row| {
                row.get(0)
            })
            .expect("reminders defaults");
        assert_eq!(reminders, "[]");

        // 派发记录随日程删除级联清理。
        connection
            .execute(
                "INSERT INTO reminder_dispatches(event_id,occurrence_start_at,offset_minutes,dispatched_at)
                 VALUES ('e1','2026-08-03T10:00',10,'t')",
                [],
            )
            .expect("dispatch inserts");
        // 同一提醒的第二次派发被主键挡下。
        let dup = connection.execute(
            "INSERT INTO reminder_dispatches(event_id,occurrence_start_at,offset_minutes,dispatched_at)
             VALUES ('e1','2026-08-03T10:00',10,'t')",
            [],
        );
        assert!(dup.is_err(), "重复派发键必须被主键拒绝");
        // 孤儿派发记录被外键拒绝。
        let orphan = connection.execute(
            "INSERT INTO reminder_dispatches(event_id,occurrence_start_at,offset_minutes,dispatched_at)
             VALUES ('missing','2026-08-03T10:00',10,'t')",
            [],
        );
        assert!(orphan.is_err(), "派发记录必须挂在真实日程上");

        connection
            .execute("DELETE FROM events WHERE id='e1'", [])
            .expect("event deletes");
        let remaining: i64 = connection
            .query_row("SELECT COUNT(*) FROM reminder_dispatches", [], |row| {
                row.get(0)
            })
            .expect("count runs");
        assert_eq!(remaining, 0, "派发记录随日程级联删除");
    }

    #[test]
    fn migration_15_rebuilds_events_with_ics_columns() {
        let mut connection = Connection::open_in_memory().expect("memory db opens");
        connection
            .execute_batch("PRAGMA foreign_keys = ON;")
            .expect("foreign keys on");
        migrate(&mut connection).expect("migration succeeds");

        // 版本序列包含 15。
        let versions: Vec<i64> = connection
            .prepare("SELECT version FROM schema_migrations ORDER BY version")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(
            versions,
            vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]
        );

        // 新列存在。
        let columns: Vec<String> = connection
            .prepare("PRAGMA table_info(events)")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        for expected in [
            "start_tz",
            "end_tz",
            "start_utc",
            "end_utc",
            "rrule",
            "rdate",
            "exdate",
            "recurrence_final_at",
        ] {
            assert!(columns.iter().any(|c| c == expected), "缺少列 {expected}");
        }
        // 旧的分列重复模型已移除。
        for gone in [
            "recurrence_freq",
            "recurrence_interval",
            "recurrence_by_day",
            "recurrence_count",
            "recurrence_until",
        ] {
            assert!(!columns.iter().any(|c| c == gone), "旧列 {gone} 应已移除");
        }
    }

    #[test]
    fn migration_15_nulls_linked_event_id() {
        let mut connection = Connection::open_in_memory().expect("memory db opens");
        connection
            .execute_batch("PRAGMA foreign_keys = ON;")
            .expect("foreign keys on");
        // 迁移 18 会把 tasks 重建为统一模型（无 quadrant/整型 priority 列），
        // 本测试只验证迁移 15 的 tasks 旧模型行为，故隔离在其 schema 版本上。
        migrate_through(&mut connection, 15).expect("migration succeeds");
        connection
            .execute(
                "INSERT INTO tasks(id,title,quadrant,priority,completed,note,created_at,updated_at,linked_event_id)
                 VALUES ('t1','任务','important_urgent',1,0,'','t','t',NULL)",
                [],
            )
            .expect("task inserts");
        let linked: Option<String> = connection
            .query_row(
                "SELECT linked_event_id FROM tasks WHERE id='t1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(linked, None);
    }

    #[test]
    fn migration_16_creates_subscription_tables() {
        let mut connection = Connection::open_in_memory().unwrap();
        migrate_through(&mut connection, 16).unwrap();

        // 两张表存在。
        for table in ["calendar_subscriptions", "external_events"] {
            let count: i64 = connection
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
                    [table],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(count, 1, "{table} 应存在");
        }

        // external_events 对 calendar_subscriptions 有级联删除外键。
        connection
            .execute_batch("PRAGMA foreign_keys = ON;")
            .unwrap();
        connection
            .execute(
                "INSERT INTO calendar_subscriptions
                    (id,name,url,color,refresh_interval_minutes,created_at,updated_at)
                 VALUES ('s1','家庭','https://example.com/a.ics','#4FC9DA',15,'t','t')",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO external_events
                    (id,subscription_id,start_at,end_at,all_day,title,last_synced_at)
                 VALUES ('x1','s1','2026-08-10T10:00','2026-08-10T11:00',0,'会议','t')",
                [],
            )
            .unwrap();
        connection
            .execute("DELETE FROM calendar_subscriptions WHERE id='s1'", [])
            .unwrap();
        let remaining: i64 = connection
            .query_row("SELECT COUNT(*) FROM external_events", [], |row| row.get(0))
            .unwrap();
        assert_eq!(remaining, 0, "删除订阅应级联删除其外部事件");
    }

    #[test]
    fn migration_17_adds_note_style_variant_and_icon() {
        let mut connection = Connection::open_in_memory().unwrap();
        migrate(&mut connection).unwrap();

        let columns: Vec<String> = connection
            .prepare("PRAGMA table_info(notes)")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert!(columns.iter().any(|column| column == "style_variant"));
        assert!(columns.iter().any(|column| column == "icon"));

        connection
            .execute(
                "INSERT INTO notes(id,title,content,color,pinned,style_variant,icon,created_at,updated_at)
                 VALUES ('n1','便签','','#E8C444',0,6,'smile','t','t')",
                [],
            )
            .unwrap();
        let stored: (i64, String) = connection
            .query_row(
                "SELECT style_variant, icon FROM notes WHERE id='n1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(stored, (6, "smile".into()));
    }

    // Seed the pre-18 (matrix tasks + kanban) world at version 17, then run
    // migration 18 and assert the merge invariants.
    fn seed_pre_18(connection: &mut Connection) {
        migrate_through(connection, 17).unwrap();
        connection
            .execute_batch(
                "PRAGMA foreign_keys = ON;
                 -- Two matrix tasks: one classified+dated, one unclassified+done.
                 INSERT INTO tasks(id,title,quadrant,due_at,priority,completed,note,created_at,updated_at)
                   VALUES ('m1','矩阵一','important_urgent','2026-08-01',1,0,'笔记一','2026-07-01T00:00:00Z','2026-07-01T00:00:00Z');
                 INSERT INTO tasks(id,title,quadrant,due_at,priority,completed,note,created_at,updated_at)
                   VALUES ('m2','矩阵二','not_important_not_urgent',NULL,2,1,'','2026-07-02T00:00:00Z','2026-07-02T00:00:00Z');
                 -- A kanban card in the done lane (completed) and one custom priority card.
                 INSERT INTO kanban_priorities(id,name,color,position,created_at,updated_at)
                   VALUES ('p-high','高','#F06445',0,'t','t');
                 INSERT INTO kanban_priorities(id,name,color,position,created_at,updated_at)
                   VALUES ('p-iu','重要且紧急','#E8C444',1,'t','t');
                 INSERT INTO kanban_tags(id,name,color,created_at,updated_at) VALUES ('tag-a','设计','#4FC9DA','t','t');
                 INSERT INTO kanban_collaborators(id,name,created_at,updated_at) VALUES ('co-a','小李','t','t');
                 INSERT INTO kanban_cards(id,lane_id,title,description,due_date,priority_id,position,created_at,updated_at)
                   VALUES ('c1','kanban-lane-done','卡片一','描述','2026-09-01','p-high',0,'2026-07-03T00:00:00Z','2026-07-03T00:00:00Z');
                 INSERT INTO kanban_cards(id,lane_id,title,description,due_date,priority_id,position,created_at,updated_at)
                   VALUES ('c2','kanban-lane-todo','卡片二',NULL,NULL,'p-iu',0,'2026-07-04T00:00:00Z','2026-07-04T00:00:00Z');
                 INSERT INTO kanban_card_tags(card_id,tag_id) VALUES ('c1','tag-a');
                 INSERT INTO kanban_card_collaborators(card_id,collaborator_id) VALUES ('c1','co-a');",
            )
            .unwrap();
    }

    #[test]
    fn migration_18_conserves_task_counts_and_maps_priorities() {
        let mut connection = Connection::open_in_memory().unwrap();
        seed_pre_18(&mut connection);
        migrate(&mut connection).unwrap();

        // 2 matrix + 2 kanban = 4 unified tasks, none lost.
        let total: i64 = connection
            .query_row("SELECT COUNT(*) FROM tasks", [], |row| row.get(0))
            .unwrap();
        assert_eq!(total, 4);

        // Matrix quadrant maps straight to fixed priority; note -> description.
        let (priority, description): (Option<String>, String) = connection
            .query_row(
                "SELECT priority, description FROM tasks WHERE id='m1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(priority.as_deref(), Some("important_urgent"));
        assert_eq!(description, "笔记一");

        // The exact-match custom priority '重要且紧急' maps to a real priority on c2.
        let c2_priority: Option<String> = connection
            .query_row("SELECT priority FROM tasks WHERE id='c2'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(c2_priority.as_deref(), Some("important_urgent"));

        // The unmappable '高' priority becomes a tag linked to c1, not dropped.
        let tag_name: String = connection
            .query_row(
                "SELECT t.name FROM task_tags t
                 JOIN task_tag_links l ON l.tag_id=t.id
                 WHERE l.task_id='c1' AND t.name LIKE '旧优先级：%'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(tag_name, "旧优先级：高");

        // Kanban tag/collaborator links survive.
        let has_tag: bool = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM task_tag_links WHERE task_id='c1' AND tag_id='tag-a')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(has_tag);
        let has_collab: bool = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM task_collaborator_links WHERE task_id='c1' AND collaborator_id='co-a')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(has_collab);
    }

    #[test]
    fn migration_18_derives_completion_from_completion_lane() {
        let mut connection = Connection::open_in_memory().unwrap();
        seed_pre_18(&mut connection);
        migrate(&mut connection).unwrap();

        // c1 sits in the done lane -> completed; c2 in todo -> not completed.
        let c1_completed: i64 = connection
            .query_row("SELECT completed FROM tasks WHERE id='c1'", [], |row| {
                row.get(0)
            })
            .unwrap();
        let c2_completed: i64 = connection
            .query_row("SELECT completed FROM tasks WHERE id='c2'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(c1_completed, 1);
        assert_eq!(c2_completed, 0);
        // Completed matrix task lands in the completion lane.
        let m2_lane: String = connection
            .query_row("SELECT lane_id FROM tasks WHERE id='m2'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(m2_lane, "kanban-lane-done");
    }

    #[test]
    fn migration_18_coordinates_initial_view_memberships() {
        let mut connection = Connection::open_in_memory().unwrap();
        seed_pre_18(&mut connection);
        migrate(&mut connection).unwrap();

        let views = |id: &str| -> Vec<String> {
            connection
                .prepare("SELECT view FROM task_view_memberships WHERE task_id=?1 ORDER BY view")
                .unwrap()
                .query_map([id], |row| row.get(0))
                .unwrap()
                .collect::<Result<Vec<String>, _>>()
                .unwrap()
        };
        // m1: classified + dated -> all three views.
        assert_eq!(views("m1"), vec!["calendar", "kanban", "matrix"]);
        // m2: classified, no date -> kanban + matrix.
        assert_eq!(views("m2"), vec!["kanban", "matrix"]);
        // c1: dated, priority via tag only (priority NULL) -> kanban + calendar.
        assert_eq!(views("c1"), vec!["calendar", "kanban"]);
        // c2: no date, mapped priority -> kanban + matrix.
        assert_eq!(views("c2"), vec!["kanban", "matrix"]);
    }

    #[test]
    fn migration_18_seeds_linking_and_lane_settings() {
        let mut connection = Connection::open_in_memory().unwrap();
        seed_pre_18(&mut connection);
        migrate(&mut connection).unwrap();

        let value = |key: &str| -> String {
            connection
                .query_row("SELECT value FROM settings WHERE key=?1", [key], |row| {
                    row.get(0)
                })
                .unwrap()
        };
        assert_eq!(value("task_view_linking_enabled"), "true");
        assert_eq!(value("default_task_lane_id"), "\"kanban-lane-todo\"");
        assert_eq!(value("completion_task_lane_id"), "\"kanban-lane-done\"");
    }

    #[test]
    fn migration_18_preserves_event_task_link_and_passes_fk_check() {
        let mut connection = Connection::open_in_memory().unwrap();
        migrate_through(&mut connection, 17).unwrap();
        connection
            .execute_batch(
                "PRAGMA foreign_keys = ON;
                 INSERT INTO events(id,title,start_at,end_at,all_day,category,color,note,created_at,updated_at)
                   VALUES ('e1','评审','2026-08-10T10:00','2026-08-10T11:00',0,'work','#4FC9DA','','t','t');
                 INSERT INTO tasks(id,title,quadrant,due_at,priority,completed,note,linked_event_id,created_at,updated_at)
                   VALUES ('m1','矩阵一','important_urgent',NULL,1,0,'','e1','t','t');
                 UPDATE events SET linked_task_id='m1' WHERE id='e1';",
            )
            .unwrap();

        migrate(&mut connection).unwrap();

        // The task keeps its event link, and the events FK still targets `tasks`.
        let linked: Option<String> = connection
            .query_row(
                "SELECT linked_event_id FROM tasks WHERE id='m1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(linked.as_deref(), Some("e1"));
        let event_fk_targets_tasks: bool = connection
            .prepare("PRAGMA foreign_key_list(events)")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(2))
            .unwrap()
            .collect::<Result<Vec<String>, _>>()
            .unwrap()
            .iter()
            .any(|target| target == "tasks");
        assert!(event_fk_targets_tasks);
        let violations: i64 = connection
            .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(violations, 0);
    }
}
