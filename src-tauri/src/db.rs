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
        assert_eq!(versions, vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);

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

        assert_eq!(versions, vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
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
            "kanban_lanes",
            "kanban_cards",
            "kanban_priorities",
            "kanban_tags",
            "kanban_collaborators",
            "kanban_card_tags",
            "kanban_card_collaborators",
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
        migrate(&mut connection).unwrap();

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
        migrate(&mut connection).unwrap();
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
        assert_eq!(versions, vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);

        // 新列存在。
        let columns: Vec<String> = connection
            .prepare("PRAGMA table_info(events)")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        for expected in [
            "start_tz", "end_tz", "start_utc", "end_utc", "rrule", "rdate", "exdate",
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
        migrate(&mut connection).expect("migration succeeds");
        connection
            .execute(
                "INSERT INTO tasks(id,title,quadrant,priority,completed,note,created_at,updated_at,linked_event_id)
                 VALUES ('t1','任务','important_urgent',1,0,'','t','t',NULL)",
                [],
            )
            .expect("task inserts");
        let linked: Option<String> = connection
            .query_row("SELECT linked_event_id FROM tasks WHERE id='t1'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(linked, None);
    }
}
