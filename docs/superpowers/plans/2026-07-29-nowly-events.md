# Nowly Event Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver month-scoped event reads, calendar navigation, date detail, complete event CRUD, offline date/time controls, permanent-delete confirmation, and transactional event-task linking from React through Tauri to SQLite.

**Architecture:** A dedicated `useEvents` feature hook owns the visible month, stale-request protection, writes, and refreshes. Typed repository methods are implemented by the sole Tauri adapter; Rust event commands delegate to an isolated event service that validates requests and performs versioned SQLite transactions. Dialogs own drafts and errors while widgets only render state and emit user intent.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Playwright, Tauri 2, Rust, rusqlite/SQLite, chrono, uuid, lucide-react.

---

## Completion status

| 项目 | 结果 |
|---|---|
| 状态 | **已完成**（2026-07-29） |
| React/Vitest | 20 个测试文件，94 个测试通过 |
| Rust | 34 个测试通过 |
| Playwright | 172 个测试通过（4 组视口） |
| 构建与静态检查 | `npm run build`、`git diff --check` 及禁止项扫描通过 |
| 审查 | 已按阶段 2 规格和本计划完成内联差异审查，无阻塞项 |
| 计划偏差 | 执行环境无 subagent/Task 工具，代码审查改为内联；移除废弃 `query_events` 及其专属测试后 Rust 测试数由 35 变为 34 |

**Specification:** `docs/superpowers/specs/2026-07-29-nowly-events-design.md`

**Prerequisites and constraints:**

- Read root `design.md` completely before every UI task.
- Keep migrations 1–4 unchanged; append migration 5 only.
- Keep camelCase IPC, `CommandError`, repository injection, static loading/error states, and no-motion rules from stage 1.
- Do not implement task CRUD, note CRUD, settings persistence, or new Windows lifecycle behavior.
- Do not modify `src/modals/NoteModal.tsx` or remove its legacy Tailwind tokens; that remains stage 4 scope.
- Every task follows Red-Green-Refactor and uses `<type>: <short description>` commits.

## File map

### Rust

- `src-tauri/Cargo.toml` — add UUID v4 generation.
- `src-tauri/src/db.rs` — append migration 5 and migration regression tests.
- `src-tauri/src/models.rs` — add camelCase `EventDraft` and `EventRange` requests.
- `src-tauri/src/error.rs` — add stable validation/not-found/conflict constructors.
- `src-tauri/src/events.rs` — event validation, range query, CRUD, and bidirectional link transactions.
- `src-tauri/src/commands.rs` — retain non-event startup commands; expose thin event wrappers or re-export wrappers from `events.rs`.
- `src-tauri/src/main.rs` — register event module and four commands.

### React data and state

- `src/calendar/calendar-model.ts` — fixed category/color enums, draft/range types, labels, and helpers.
- `src/data/nowly-repository.ts` — month query and event write methods.
- `src/data/tauri-nowly-repository.ts` — exact event Tauri invoke names and payloads.
- `src/data/tauri-nowly-repository.test.ts` — command-name and argument contract.
- `src/calendar/useEvents.ts` — visible month, stale-read protection, CRUD and refresh coordination.
- `src/calendar/useEvents.test.tsx` — hook behavior.
- `src/app/useAppBootstrap.ts` and test — remove event ownership; keep tasks/notes/settings.

### React UI

- `src/calendar/CalendarWidget.tsx` and test — legal accessible day/event controls, navigation, double-click, overflow count.
- `src/calendar/DateDetailDialog.tsx` and test — sorted day detail and event entry.
- `src/components/Dialog.tsx` and test — reusable top-layer Escape/focus trap/focus restore primitive.
- `src/components/ConfirmDialog.tsx` and test — discard/delete confirmation.
- `src/components/DatePicker.tsx` and test — offline 42-day Good date picker.
- `src/components/TimePicker.tsx` and test — offline Good 24-hour time picker.
- `src/modals/EventModal.tsx` and test — controlled create/edit form, validation, save/delete states.
- `src/lib/event-draft.ts` and test — defaults, normalization, validation, dirty comparison.
- `src/lib/modal-store.ts` — explicit date/event-create/event-edit overlay states.
- `src/modals/ModalRoot.tsx` and test — layered date/event/confirm flow.
- `src/app/App.tsx` and test — connect feature hook and refresh tasks after link changes.
- `src/app/styles.css` — authoritative semantic calendar/dialog/picker/form styles.

### End-to-end and docs

- `tests/nowly-events.spec.ts` — production React CRUD flow with stateful Tauri IPC stub.
- `tests/nowly-empty-startup.spec.ts` — update startup command stub for range reads.
- `docs/00-index.md` — record stage 2 plan and status after completion.
- `docs/superpowers/plans/2026-07-29-nowly-windows-product-roadmap.md` — close stage 2 only after all gates and review pass.

## Task 1: Add migration 5 with bidirectional nullable foreign keys

**Files:**
- Modify: `src-tauri/src/db.rs`

- [ ] **Step 1: Add failing migration-5 tests**

In `src-tauri/src/db.rs`, import `OptionalExtension` in the test module and add tests that create a version-4-shaped database, insert valid, dangling, and inconsistent links, run `migrate`, and assert version 5, foreign keys, preserved rows, and normalized links:

```rust
#[test]
fn migration_5_rebuilds_event_task_links_with_foreign_keys() {
    let mut connection = Connection::open_in_memory().unwrap();
    connection.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    migrate(&mut connection).unwrap();

    let versions: Vec<i64> = connection
        .prepare("SELECT version FROM schema_migrations ORDER BY version").unwrap()
        .query_map([], |row| row.get(0)).unwrap()
        .collect::<Result<_, _>>().unwrap();
    assert_eq!(versions, vec![1, 2, 3, 4, 5]);

    let event_fks: Vec<(String, String, String)> = connection
        .prepare("PRAGMA foreign_key_list(events)").unwrap()
        .query_map([], |row| Ok((row.get(2)?, row.get(3)?, row.get(6)?))).unwrap()
        .collect::<Result<_, _>>().unwrap();
    assert!(event_fks.contains(&("tasks".into(), "linked_task_id".into(), "SET NULL".into())));

    let task_fks: Vec<(String, String, String)> = connection
        .prepare("PRAGMA foreign_key_list(tasks)").unwrap()
        .query_map([], |row| Ok((row.get(2)?, row.get(3)?, row.get(6)?))).unwrap()
        .collect::<Result<_, _>>().unwrap();
    assert!(task_fks.contains(&("events".into(), "linked_event_id".into(), "SET NULL".into())));
    let violations: i64 = connection.query_row(
        "SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| row.get(0)
    ).unwrap();
    assert_eq!(violations, 0);
}

#[test]
fn migration_5_cleans_dangling_links_without_losing_business_rows() {
    let mut connection = Connection::open_in_memory().unwrap();
    migrate_through(&mut connection, 4).unwrap();
    connection.execute_batch(
        "INSERT INTO events VALUES
         ('e1','保留','2026-07-23T09:00','2026-07-23T10:00',0,'work','blue','missing','','2026-07-23T08:00:00Z','2026-07-23T08:00:00Z');
         INSERT INTO tasks VALUES
         ('t1','任务','important-urgent',NULL,1,0,'missing','','2026-07-23T08:00:00Z','2026-07-23T08:00:00Z');"
    ).unwrap();

    migrate(&mut connection).unwrap();

    let event_link: Option<String> = connection.query_row(
        "SELECT linked_task_id FROM events WHERE id='e1'", [], |row| row.get(0)
    ).unwrap();
    let task_link: Option<String> = connection.query_row(
        "SELECT linked_event_id FROM tasks WHERE id='t1'", [], |row| row.get(0)
    ).unwrap();
    assert_eq!(event_link, None);
    assert_eq!(task_link, None);
    assert_eq!(connection.query_row("SELECT COUNT(*) FROM events", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
    assert_eq!(connection.query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
}
```

Add this test-only helper beside the tests; it runs only the requested prefix and does not change production migration behavior:

```rust
fn migrate_through(connection: &mut Connection, max_version: i64) -> Result<()> {
    create_migration_table(connection)?;
    for (version, apply) in MIGRATIONS.iter().filter(|(version, _)| *version <= max_version) {
        let transaction = connection.transaction()?;
        apply(&transaction)?;
        transaction.execute(
            "INSERT INTO schema_migrations(version, applied_at) VALUES (?1, strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
            [version],
        )?;
        transaction.commit()?;
    }
    Ok(())
}
```

Refactor the existing migration-table creation into private `create_migration_table` so production `migrate` and the helper share the exact SQL.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml db::tests::migration_5 -- --nocapture
```

Expected: FAIL because migration version 5 and the foreign keys do not exist.

- [ ] **Step 3: Implement migration 5**

Append `(5, migration_5_event_task_foreign_keys)` to `MIGRATIONS`. Implement a table-rebuild migration using these exact constraints:

```rust
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
           all_day INTEGER NOT NULL CHECK (all_day IN (0,1)),
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
           completed INTEGER NOT NULL CHECK (completed IN (0,1)),
           linked_event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
           note TEXT NOT NULL DEFAULT '',
           created_at TEXT NOT NULL,
           updated_at TEXT NOT NULL
         );

         INSERT INTO events
         SELECT e.id,e.title,e.start_at,e.end_at,e.all_day,e.category,e.color,c.task_id,
                e.note,e.created_at,e.updated_at
         FROM events_v4 e LEFT JOIN canonical_links c ON c.event_id=e.id;
         INSERT INTO tasks
         SELECT t.id,t.title,t.quadrant,t.due_at,t.priority,t.completed,c.event_id,
                t.note,t.created_at,t.updated_at
         FROM tasks_v4 t LEFT JOIN canonical_links c ON c.task_id=t.id;

         DROP TABLE events_v4;
         DROP TABLE tasks_v4;
         DROP TABLE canonical_links;

         CREATE INDEX idx_events_range ON events(start_at,end_at);
         CREATE INDEX idx_tasks_quadrant ON tasks(quadrant,completed,due_at);
         CREATE UNIQUE INDEX idx_events_linked_task ON events(linked_task_id) WHERE linked_task_id IS NOT NULL;
         CREATE UNIQUE INDEX idx_tasks_linked_event ON tasks(linked_event_id) WHERE linked_event_id IS NOT NULL;"
    )?;
    let violations: i64 = transaction.query_row(
        "SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| row.get(0)
    )?;
    if violations != 0 {
        return Err(rusqlite::Error::ExecuteReturnedResults);
    }
    Ok(())
}
```

Update the existing version assertion to `vec![1, 2, 3, 4, 5]`. If SQLite reports a rename-time foreign-key reference issue, keep the same resulting schema and data rules but split rebuild SQL into individual `transaction.execute_batch` calls; do not disable foreign keys on the connection outside this transaction.

- [ ] **Step 4: Run focused and full Rust tests**

```bash
cargo test --manifest-path src-tauri/Cargo.toml db::tests -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: all migration tests and the existing 26-test suite pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/db.rs
git commit -m "feature: add event task foreign keys"
```

## Task 2: Add event request models and stable business errors

**Files:**
- Modify: `src-tauri/src/models.rs`
- Modify: `src-tauri/src/error.rs`
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add failing serialization and error tests**

Add to `models.rs` tests:

```rust
#[test]
fn event_draft_deserializes_camel_case() {
    let draft: EventDraft = serde_json::from_value(serde_json::json!({
        "title":"评审", "startAt":"2026-07-23T14:00", "endAt":"2026-07-23T15:00",
        "allDay":false, "category":"work", "color":"blue",
        "linkedTaskId":null, "note":"确认范围"
    })).unwrap();
    assert_eq!(draft.start_at, "2026-07-23T14:00");
    assert_eq!(draft.linked_task_id, None);
}
```

Add to `error.rs` tests:

```rust
#[test]
fn business_errors_have_stable_public_payloads() {
    assert_eq!(CommandError::validation("title", "请输入日程标题。"), CommandError {
        code: "validation_error".into(), message: "请输入日程标题。".into(), field: Some("title".into())
    });
    assert_eq!(CommandError::not_found("未找到该日程。"), CommandError {
        code: "not_found".into(), message: "未找到该日程。".into(), field: None
    });
    assert_eq!(CommandError::conflict("日程关联已变化，请重试。"), CommandError {
        code: "conflict".into(), message: "日程关联已变化，请重试。".into(), field: None
    });
}
```

- [ ] **Step 2: Verify RED**

```bash
cargo test --manifest-path src-tauri/Cargo.toml models::tests error::tests -- --nocapture
```

Expected: compile failure for missing `EventDraft`, `EventRange`, and error constructors.

- [ ] **Step 3: Add the request contracts and constructors**

Add to `models.rs`:

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventDraft {
    pub title: String,
    pub start_at: String,
    pub end_at: String,
    pub all_day: bool,
    pub category: String,
    pub color: String,
    pub linked_task_id: Option<String>,
    pub note: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventRange {
    pub start_at: String,
    pub end_at_exclusive: String,
}
```

Add to `CommandError`:

```rust
fn public(code: &str, message: impl Into<String>, field: Option<&str>) -> Self {
    Self { code: code.into(), message: message.into(), field: field.map(str::to_owned) }
}
pub fn validation(field: &str, message: impl Into<String>) -> Self {
    Self::public("validation_error", message, Some(field))
}
pub fn not_found(message: impl Into<String>) -> Self {
    Self::public("not_found", message, None)
}
pub fn conflict(message: impl Into<String>) -> Self {
    Self::public("conflict", message, None)
}
```

Add UUID to `Cargo.toml`:

```toml
uuid = { version = "1", features = ["v4"] }
```

- [ ] **Step 4: Verify GREEN**

```bash
cargo test --manifest-path src-tauri/Cargo.toml models::tests -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml error::tests -- --nocapture
```

Expected: all focused tests pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/models.rs src-tauri/src/error.rs
git commit -m "feature: define event write contracts"
```

## Task 3: Implement month-scoped event reads and trusted validation

**Files:**
- Create: `src-tauri/src/events.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Create `events.rs` with failing range and validation tests**

Define the intended API as stubs above the tests:

```rust
use crate::error::CommandError;
use crate::models::{Event, EventDraft, EventRange};
use rusqlite::Connection;

pub fn list_in_range(_: &Connection, _: &EventRange) -> Result<Vec<Event>, CommandError> {
    unimplemented!("month range query")
}
pub fn validate_and_normalize(_: EventDraft) -> Result<EventDraft, CommandError> {
    unimplemented!("event validation")
}
```

Tests must insert events at `2026-06-30T23:59`, `2026-07-01T00:00`, two equal-start July events, and `2026-08-01T00:00`, then assert only July records in `start_at/end_at/id` order. Add table-driven invalid drafts:

```rust
#[test]
fn validation_rejects_invalid_fields_and_normalizes_all_day() {
    let base = EventDraft {
        title: "  评审  ".into(), start_at: "2026-07-23T14:00".into(),
        end_at: "2026-07-23T15:00".into(), all_day: false,
        category: "work".into(), color: "blue".into(), linked_task_id: None, note: "".into()
    };
    assert_eq!(validate_and_normalize(base.clone()).unwrap().title, "评审");
    for (draft, field) in [
        (EventDraft { title: "  ".into(), ..base.clone() }, "title"),
        (EventDraft { start_at: "bad".into(), ..base.clone() }, "startAt"),
        (EventDraft { end_at: "2026-07-24T15:00".into(), ..base.clone() }, "endAt"),
        (EventDraft { end_at: "2026-07-23T13:55".into(), ..base.clone() }, "endAt"),
        (EventDraft { category: "other".into(), ..base.clone() }, "category"),
        (EventDraft { color: "purple".into(), ..base.clone() }, "color"),
    ] {
        assert_eq!(validate_and_normalize(draft).unwrap_err().field.as_deref(), Some(field));
    }
    let all_day = validate_and_normalize(EventDraft {
        all_day: true, start_at: "2026-07-23T09:30".into(), end_at: "2026-07-23T10:30".into(), ..base
    }).unwrap();
    assert_eq!(all_day.start_at, "2026-07-23T00:00");
    assert_eq!(all_day.end_at, "2026-07-23T23:59");
}
```

- [ ] **Step 2: Verify RED**

```bash
cargo test --manifest-path src-tauri/Cargo.toml events::tests -- --nocapture
```

Expected: panic at the two `unimplemented!` stubs.

- [ ] **Step 3: Implement parsing, validation, row mapping, and range query**

Use `chrono::NaiveDateTime::parse_from_str(value, "%Y-%m-%dT%H:%M")`. Validate range endpoints and require `start < endAtExclusive`. Use exact fixed arrays:

```rust
const CATEGORIES: &[&str] = &["work", "important", "personal", "learning"];
const COLORS: &[&str] = &["blue", "red", "green", "yellow"];
```

Implement `read_event(row: &Row<'_>) -> rusqlite::Result<Event>` once. Query:

```sql
SELECT id,title,start_at,end_at,all_day,category,color,linked_task_id,note,created_at,updated_at
FROM events
WHERE start_at >= ?1 AND start_at < ?2
ORDER BY start_at ASC,end_at ASC,id ASC
```

Map invalid request range to `validation_error` with `field = startAt` or `endAtExclusive`; map SQL errors through `CommandError::database`.

- [ ] **Step 4: Add the thin Tauri range command**

In `events.rs` add:

```rust
#[tauri::command]
pub fn list_events_in_range(
    db: tauri::State<'_, crate::db::AppDb>,
    range: EventRange,
) -> Result<Vec<Event>, CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    list_in_range(&connection, &range)
}
```

Register `mod events;` and `events::list_events_in_range` in `main.rs`. Keep old `commands::list_events` temporarily until Task 6 removes its production use.

- [ ] **Step 5: Verify GREEN and commit**

```bash
cargo test --manifest-path src-tauri/Cargo.toml events::tests -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml

git add src-tauri/src/events.rs src-tauri/src/main.rs src-tauri/src/commands.rs
git commit -m "feature: query events by month range"
```

Expected: all Rust tests pass.

## Task 4: Implement transactional event CRUD and task relinking

**Files:**
- Modify: `src-tauri/src/events.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Add failing CRUD and relation tests**

Add tests using a migrated in-memory DB and a helper `draft(linked_task_id)`:

```rust
#[test]
fn create_update_and_delete_event_persist_and_trim_values() {
    let mut connection = database();
    let created = create(&mut connection, draft(None)).unwrap();
    assert_eq!(created.title, "评审");
    assert!(uuid::Uuid::parse_str(&created.id).is_ok());

    let updated = update(&mut connection, &created.id, EventDraft {
        title: "复盘".into(), color: "red".into(), ..draft(None)
    }).unwrap();
    assert_eq!(updated.title, "复盘");
    assert_eq!(updated.created_at, created.created_at);
    assert!(updated.updated_at >= created.updated_at);

    delete(&mut connection, &created.id).unwrap();
    assert_eq!(update(&mut connection, &created.id, draft(None)).unwrap_err().code, "not_found");
    assert_eq!(delete(&mut connection, &created.id).unwrap_err().code, "not_found");
}

#[test]
fn relinking_is_bidirectional_and_delete_keeps_the_task() {
    let mut connection = database();
    insert_task(&connection, "t1");
    insert_task(&connection, "t2");
    let first = create(&mut connection, draft(Some("t1"))).unwrap();
    let second = create(&mut connection, draft(Some("t2"))).unwrap();

    update(&mut connection, &second.id, draft(Some("t1"))).unwrap();
    assert_eq!(event_link(&connection, &first.id), None);
    assert_eq!(event_link(&connection, &second.id).as_deref(), Some("t1"));
    assert_eq!(task_link(&connection, "t1").as_deref(), Some(second.id.as_str()));
    assert_eq!(task_link(&connection, "t2"), None);

    delete(&mut connection, &second.id).unwrap();
    assert_eq!(task_link(&connection, "t1"), None);
    assert_eq!(connection.query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get::<_, i64>(0)).unwrap(), 2);
}

#[test]
fn create_rejects_a_missing_linked_task() {
    let mut connection = database();
    let error = create(&mut connection, draft(Some("missing"))).unwrap_err();
    assert_eq!(error.code, "validation_error");
    assert_eq!(error.field.as_deref(), Some("linkedTaskId"));
}
```

- [ ] **Step 2: Verify RED**

```bash
cargo test --manifest-path src-tauri/Cargo.toml events::tests -- --nocapture
```

Expected: compile failure because `create`, `update`, and `delete` do not exist.

- [ ] **Step 3: Implement transaction helpers**

Add public functions:

```rust
pub fn create(connection: &mut Connection, draft: EventDraft) -> Result<Event, CommandError>;
pub fn update(connection: &mut Connection, id: &str, draft: EventDraft) -> Result<Event, CommandError>;
pub fn delete(connection: &mut Connection, id: &str) -> Result<(), CommandError>;
```

Implementation requirements:

- normalize with `validate_and_normalize` before opening the transaction;
- use `Uuid::new_v4().hyphenated().to_string()`;
- use UTC RFC3339 millisecond timestamps for metadata via `chrono::Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)`;
- check linked task existence inside the transaction;
- use a private `relink(transaction, event_id, old_task, new_task, updated_at)` implementing the seven steps in the design;
- select old link before update;
- update/delete affected-row count must be one or return `not_found`;
- read back the complete event before commit;
- convert unique/FK constraint failures to `conflict("日程关联已变化，请重试。")` and all other SQL errors to `database`;
- never delete a task.

Use `TransactionBehavior::Immediate` so two concurrent relinks serialize before uniqueness checks.

- [ ] **Step 4: Add Tauri write commands and register them**

```rust
#[tauri::command]
pub fn create_event(db: State<'_, AppDb>, draft: EventDraft) -> Result<Event, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    create(&mut connection, draft)
}
#[tauri::command]
pub fn update_event(db: State<'_, AppDb>, id: String, draft: EventDraft) -> Result<Event, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    update(&mut connection, &id, draft)
}
#[tauri::command]
pub fn delete_event(db: State<'_, AppDb>, id: String) -> Result<(), CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    delete(&mut connection, &id)
}
```

Register all three in `tauri::generate_handler!`.

- [ ] **Step 5: Verify GREEN and commit**

```bash
cargo test --manifest-path src-tauri/Cargo.toml events::tests -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml

git add src-tauri/src/events.rs src-tauri/src/main.rs
git commit -m "feature: persist event changes transactionally"
```

## Task 5: Extend frontend event contracts and the Tauri repository

**Files:**
- Modify: `src/calendar/calendar-model.ts`
- Modify: `src/data/nowly-repository.ts`
- Modify: `src/data/tauri-nowly-repository.ts`
- Modify: `src/data/tauri-nowly-repository.test.ts`
- Modify: tests that construct `NowlyRepository`

- [ ] **Step 1: Replace the repository test with the failing exact IPC contract**

The test must assert:

```ts
await tauriNowlyRepository.listEventsInRange({
  startAt: '2026-07-01T00:00', endAtExclusive: '2026-08-01T00:00'
});
await tauriNowlyRepository.createEvent(draft);
await tauriNowlyRepository.updateEvent('e1', draft);
await tauriNowlyRepository.deleteEvent('e1');

expect(invokeMock.mock.calls).toContainEqual([
  'list_events_in_range',
  { range: { startAt: '2026-07-01T00:00', endAtExclusive: '2026-08-01T00:00' } }
]);
expect(invokeMock.mock.calls).toContainEqual(['create_event', { draft }]);
expect(invokeMock.mock.calls).toContainEqual(['update_event', { id: 'e1', draft }]);
expect(invokeMock.mock.calls).toContainEqual(['delete_event', { id: 'e1' }]);
```

- [ ] **Step 2: Verify RED**

```bash
npm test -- src/data/tauri-nowly-repository.test.ts
```

Expected: TypeScript errors for missing methods and types.

- [ ] **Step 3: Add exact TypeScript contracts**

In `calendar-model.ts` export `EventCategory`, `EventDraft`, `EventRange`, `eventCategoryLabels`, `eventColorLabels`, and narrow `CalendarEvent.category` to `EventCategory`.

In `NowlyRepository`, replace `listEvents()` with:

```ts
listEventsInRange(range: EventRange): Promise<CalendarEvent[]>;
createEvent(draft: EventDraft): Promise<CalendarEvent>;
updateEvent(id: string, draft: EventDraft): Promise<CalendarEvent>;
deleteEvent(id: string): Promise<void>;
```

Implement the four invokes exactly as asserted. Update every test repository factory with these methods; default writes may be `vi.fn().mockRejectedValue(new Error('unexpected write'))` so accidental writes fail tests.

- [ ] **Step 4: Verify GREEN**

```bash
npm test -- src/data/tauri-nowly-repository.test.ts
npm run build
```

Expected: repository test and TypeScript build pass.

- [ ] **Step 5: Commit**

```bash
git add src/calendar/calendar-model.ts src/data src/app/*.test.tsx src/app/useAppBootstrap.test.tsx
git commit -m "refactor: add event repository operations"
```

## Task 6: Move month ownership into `useEvents`

**Files:**
- Create: `src/calendar/useEvents.ts`
- Create: `src/calendar/useEvents.test.tsx`
- Modify: `src/app/useAppBootstrap.ts`
- Modify: `src/app/useAppBootstrap.test.tsx`

- [ ] **Step 1: Write failing hook tests**

Use an injected repository and fake local date `2026-07-23T09:42:00`. Cover initial range, December/January rollover, today, retry, stale response, writes, and task refresh:

```tsx
it('loads the visible month and ignores stale previous-month responses', async () => {
  const july = deferred<CalendarEvent[]>();
  const august = deferred<CalendarEvent[]>();
  const repository = createRepository({
    listEventsInRange: vi.fn()
      .mockImplementationOnce(() => july.promise)
      .mockImplementationOnce(() => august.promise)
  });
  const { result } = renderHook(() => useEvents({ now: () => new Date(2026, 6, 23), onRefreshTasks: vi.fn() }), {
    wrapper: wrapper(repository)
  });
  act(() => result.current.goToNextMonth());
  await act(() => august.resolve([augustEvent]));
  await waitFor(() => expect(result.current.events.data).toEqual([augustEvent]));
  await act(() => july.resolve([julyEvent]));
  expect(result.current.events.data).toEqual([augustEvent]);
});

it('refreshes events and tasks after changing a linked event', async () => {
  const onRefreshTasks = vi.fn().mockResolvedValue(undefined);
  const repository = createRepository({ updateEvent: vi.fn().mockResolvedValue(updatedEvent) });
  const { result } = renderHook(() => useEvents({ now, onRefreshTasks }), { wrapper: wrapper(repository) });
  await waitFor(() => expect(result.current.events.status).toBe('ready'));
  await act(() => result.current.updateEvent(existingLinkedEvent, { ...draft, linkedTaskId: null }));
  expect(repository.updateEvent).toHaveBeenCalled();
  expect(onRefreshTasks).toHaveBeenCalledOnce();
  expect(repository.listEventsInRange).toHaveBeenCalledTimes(2);
});
```

Also assert unlinked-to-unlinked writes do not refresh tasks and failed writes neither close UI nor mutate event resource data.

- [ ] **Step 2: Verify RED**

```bash
npm test -- src/calendar/useEvents.test.tsx
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement `useEvents`**

Use this public shape:

```ts
export function useEvents({ now = () => new Date(), onRefreshTasks }: {
  now?: () => Date;
  onRefreshTasks: () => Promise<unknown>;
}) {
  return {
    year, monthIndex, events,
    retryEvents, goToPreviousMonth, goToNextMonth, goToToday, goToMonthContaining,
    createEvent, updateEvent, deleteEvent
  };
}
```

Create `monthRange(year, monthIndex)` using local date components and literal `T00:00`; do not use `toISOString()`. Increment a `requestIdRef` before each load and ignore resolves/rejects whose ID is no longer current. On month change set `{status:'loading', data:[]}` to prevent stale-month rendering. Write methods await repository writes, reload the current month, and refresh tasks iff old or new link is non-null.

- [ ] **Step 4: Remove event ownership from bootstrap**

Delete `events`, `loadEvents`, and `retryEvents` from `useAppBootstrap`; update tests to expect only tasks, notes and settings calls. This is the point where production has one event read owner.

- [ ] **Step 5: Verify GREEN and commit**

```bash
npm test -- src/calendar/useEvents.test.tsx src/app/useAppBootstrap.test.tsx
npm test

git add src/calendar/useEvents.ts src/calendar/useEvents.test.tsx src/app/useAppBootstrap.ts src/app/useAppBootstrap.test.tsx
git commit -m "feature: manage visible event month"
```

## Task 7: Make calendar navigation and day/event interaction accessible

**Files:**
- Modify: `src/lib/date.ts`
- Modify: `src/lib/date.test.ts`
- Modify: `src/calendar/CalendarWidget.tsx`
- Modify: `src/calendar/CalendarWidget.test.tsx`

- [ ] **Step 1: Add failing 42-day and interaction tests**

Update date tests to assert every month grid has 42 entries. Add widget tests asserting navigation callbacks, single-click date, double-click creation, event isolation, keyboard opening, overflow count, and no nested interactive elements:

```tsx
expect(container.querySelectorAll('.calendar-grid > [data-calendar-day]')).toHaveLength(42);
await user.click(screen.getByRole('button', { name: '上一个月' }));
expect(onPreviousMonth).toHaveBeenCalledOnce();
await user.dblClick(screen.getByRole('button', { name: /2026年7月23日/ }));
expect(onCreateEventForDate).toHaveBeenCalledWith('2026-07-23');
expect(onOpenDate).not.toHaveBeenCalled();
await user.keyboard('{Enter}');
expect(onOpenEvent).toHaveBeenCalledWith(sampleEvents[0]);
expect(container.querySelector('button button,[role="button"] [role="button"]')).toBeNull();
```

Use fake timers around the single/double click distinction: single click schedules detail after 250 ms; double click cancels that timer and opens create exactly once.

- [ ] **Step 2: Verify RED**

```bash
npm test -- src/lib/date.test.ts src/calendar/CalendarWidget.test.tsx
```

Expected: grid count is 35 and new callbacks/behavior are absent.

- [ ] **Step 3: Implement 42-day grid and legal DOM**

Change the date loop from 35 to 42. Extend widget props with:

```ts
onPreviousMonth(): void;
onNextMonth(): void;
onToday(): void;
onCreateEventForDate(isoDate: string): void;
```

Use a non-interactive `.day` container. Put one absolute/underlay day button and sibling event buttons inside it so no interactive element contains another. Event buttons include accessible names such as `14:00 设计评审，工作`; all-day uses `全天`. Implement Enter/Space naturally with real buttons. Render only three event buttons and a fourth `另有 N 个` button that opens date detail.

- [ ] **Step 4: Verify GREEN and commit**

```bash
npm test -- src/lib/date.test.ts src/calendar/CalendarWidget.test.tsx
npm run build

git add src/lib/date.ts src/lib/date.test.ts src/calendar/CalendarWidget.tsx src/calendar/CalendarWidget.test.tsx
git commit -m "feature: add accessible calendar navigation"
```

## Task 8: Add reusable dialog and confirmation primitives

**Files:**
- Create: `src/components/Dialog.tsx`
- Create: `src/components/Dialog.test.tsx`
- Create: `src/components/ConfirmDialog.tsx`
- Create: `src/components/ConfirmDialog.test.tsx`
- Modify: `src/app/styles.css`

- [ ] **Step 1: Write failing focus/Escape tests**

Test that `Dialog` has `role=dialog`, `aria-modal`, focuses the first focusable child, wraps Tab/Shift+Tab, closes on Escape only when `isTopLayer`, and restores the supplied trigger. Test `ConfirmDialog` exact discard/delete copy, disabled busy actions, and static labels.

- [ ] **Step 2: Verify RED**

```bash
npm test -- src/components/Dialog.test.tsx src/components/ConfirmDialog.test.tsx
```

Expected: module-not-found failures.

- [ ] **Step 3: Implement the primitives**

`Dialog` public API:

```tsx
type DialogProps = {
  title: string;
  ariaLabelledBy: string;
  isTopLayer?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  restoreFocusRef?: RefObject<HTMLElement | null>;
  onRequestClose(): void;
  headerActions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
};
```

Use a document `keydown` listener only while top-layer. Query focusables with:

```ts
const selector = 'button:not([disabled]),[href],input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';
```

No animation and no focus library dependency. `ConfirmDialog` composes `Dialog` and accepts `tone`, `confirmLabel`, `busyLabel`, `errorMessage`, `onCancel`, and `onConfirm`.

- [ ] **Step 4: Add semantic styles from `design.md`**

Add `.overlay`, `.good-dialog`, `.good-dialog__header/body/footer`, `.confirm-dialog`, `.field-error`, `.dialog-error`, and disabled/focus-visible states using existing root tokens. Do not style or edit `NoteModal`.

- [ ] **Step 5: Verify GREEN and commit**

```bash
npm test -- src/components/Dialog.test.tsx src/components/ConfirmDialog.test.tsx
npm run build

git add src/components/Dialog* src/components/ConfirmDialog* src/app/styles.css
git commit -m "feature: add accessible dialog primitives"
```

## Task 9: Implement the offline Good single-date picker

**Files:**
- Create: `src/components/DatePicker.tsx`
- Create: `src/components/DatePicker.test.tsx`
- Modify: `src/app/styles.css`

- [ ] **Step 1: Write failing date-picker behavior tests**

Cover exact requirements:

- trigger is a button, never `input[type=date]`;
- `aria-haspopup=dialog`, `aria-expanded`, and focus return;
- popup has 42 date buttons and Monday-first headings;
- previous/next month, today, clear;
- Arrow keys ±1/±7 days, PageUp/PageDown month, Enter/Space select;
- selected/current date ARIA;
- outside click and Escape close;
- `onOpenChange` allows EventModal to close the time picker.

- [ ] **Step 2: Verify RED**

```bash
npm test -- src/components/DatePicker.test.tsx
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement the complete component**

Public API:

```tsx
type DatePickerProps = {
  id: string;
  label: string;
  value: string;
  errorId?: string;
  disabled?: boolean;
  open: boolean;
  onOpenChange(open: boolean): void;
  onChange(value: string): void;
  today?: Date;
};
```

Use `buildMonthGrid` for the visible 42-day grid. Keep `visibleYear/month` and keyboard cursor local. Format display as `YYYY 年 M 月 D 日`; emit `YYYY-MM-DD`. Clicking a trailing/leading day selects it directly. “清除” emits `''`; “今天” emits local `toIsoDate(today)`. Every close path restores trigger focus except a parent-driven unmount.

- [ ] **Step 4: Add Good date-picker styles**

Implement 320px popup, 36px date buttons, selected/today/outside-month states, dropdown shadow, and safe positioning inside `.good-dialog__body`. Use no transitions.

- [ ] **Step 5: Verify GREEN and commit**

```bash
npm test -- src/components/DatePicker.test.tsx
npm run build

git add src/components/DatePicker* src/app/styles.css
git commit -m "feature: add offline date picker"
```

## Task 10: Implement the offline Good time picker

**Files:**
- Create: `src/components/TimePicker.tsx`
- Create: `src/components/TimePicker.test.tsx`
- Modify: `src/app/styles.css`

- [ ] **Step 1: Write failing time-picker tests**

Cover:

- trigger button and no `input[type=time]`;
- 24-hour display and five-minute values;
- two spinbuttons with min/max/now;
- ArrowUp/Down ±1 unit, PageUp/Down ±5 units, Home/End, Enter;
- hour wrap 23→00 and minute wrap 55→00 independently;
- six exact quick values;
- clear and injected “now” rounded down to the current five-minute value;
- outside click/Escape/focus return;
- controlled `open` for date/time mutual exclusion.

- [ ] **Step 2: Verify RED**

```bash
npm test -- src/components/TimePicker.test.tsx
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement the complete component**

Public API mirrors DatePicker with `value: string` in `HH:mm` and `now?: () => Date`. Use exact quick values:

```ts
const QUICK_TIMES = ['09:00','09:30','12:00','14:00','15:00','18:00'] as const;
```

Keep hour and minute numeric state, normalize minutes to `0,5,...55`, and emit only on quick choice, “现在”, or Enter. “清除” emits `''`. Add `role="spinbutton"` and full `aria-value*` attributes.

- [ ] **Step 4: Add Good time-picker styles and verify GREEN**

Implement 280px popup, 64×56 value surfaces, 35×35 controls, quick-value grid, dropdown shadow, and dialog-safe positioning.

```bash
npm test -- src/components/TimePicker.test.tsx
npm run build

git add src/components/TimePicker* src/app/styles.css
git commit -m "feature: add offline time picker"
```

## Task 11: Add event draft defaults, normalization, and client validation

**Files:**
- Create: `src/lib/event-draft.ts`
- Create: `src/lib/event-draft.test.ts`

- [ ] **Step 1: Write failing pure-function tests**

Test:

```ts
expect(createEventDraft('2026-07-23', new Date(2026,6,23,9,42))).toMatchObject({
  startDate:'2026-07-23', endDate:'2026-07-23', startTime:'09:45', endTime:'10:45',
  allDay:false, category:'work', color:'blue', linkedTaskId:null
});
expect(createEventDraft('2026-07-23', new Date(2026,6,23,23,20))).toMatchObject({
  startTime:'22:55', endTime:'23:55'
});
expect(toEventDraft({ ...form, allDay:true })).toMatchObject({
  startAt:'2026-07-23T00:00', endAt:'2026-07-23T23:59'
});
expect(validateEventForm({ ...form, title:' ' })).toEqual({ title:'请输入日程标题。' });
```

Also test cross-day, missing times, end-before-start, invalid enum, entity-to-form conversion, and dirty comparison that ignores hidden all-day times.

- [ ] **Step 2: Verify RED**

```bash
npm test -- src/lib/event-draft.test.ts
```

- [ ] **Step 3: Implement pure helpers**

Export:

```ts
export type EventFormDraft = { title:string; startDate:string; endDate:string; startTime:string; endTime:string; allDay:boolean; category:EventCategory; color:EventColor; linkedTaskId:string|null; note:string };
export type EventFieldErrors = Partial<Record<'title'|'startAt'|'endAt'|'category'|'color'|'linkedTaskId', string>>;
export function createEventDraft(dateIso:string, now:Date): EventFormDraft;
export function eventToForm(event:CalendarEvent): EventFormDraft;
export function toEventDraft(form:EventFormDraft): EventDraft;
export function validateEventForm(form:EventFormDraft): EventFieldErrors;
export function isEventFormDirty(initial:EventFormDraft,current:EventFormDraft): boolean;
```

Use local string operations, not UTC conversion. Preserve raw title/note in form state; trim only `toEventDraft().title`.

- [ ] **Step 4: Verify GREEN and commit**

```bash
npm test -- src/lib/event-draft.test.ts

git add src/lib/event-draft.ts src/lib/event-draft.test.ts
git commit -m "feature: validate event drafts"
```

## Task 12: Build date detail dialog

**Files:**
- Create: `src/calendar/DateDetailDialog.tsx`
- Create: `src/calendar/DateDetailDialog.test.tsx`
- Modify: `src/app/styles.css`

- [ ] **Step 1: Write failing date-detail tests**

Assert full Chinese date, count, empty state, all-day-first ordering, stable timed ordering, category text, linked task title lookup, no “新建任务”, create callback date, edit callback event, Escape, and focus restoration.

- [ ] **Step 2: Verify RED**

```bash
npm test -- src/calendar/DateDetailDialog.test.tsx
```

- [ ] **Step 3: Implement `DateDetailDialog`**

Props:

```ts
type DateDetailDialogProps = {
  isoDate: string;
  events: CalendarEvent[];
  tasks: MatrixTask[];
  isTopLayer: boolean;
  restoreFocusRef?: RefObject<HTMLElement | null>;
  onClose(): void;
  onCreateEvent(date:string): void;
  onEditEvent(event:CalendarEvent, trigger:HTMLElement): void;
};
```

Filter by `startAt.startsWith(isoDate)`. Sort all-day first, then `startAt`, `endAt`, `id`. Resolve task titles from `tasks`; if missing, omit the hint rather than inventing content. Compose `Dialog` and use real buttons for event rows.

- [ ] **Step 4: Add semantic timeline styles, verify, and commit**

```bash
npm test -- src/calendar/DateDetailDialog.test.tsx
npm run build

git add src/calendar/DateDetailDialog* src/app/styles.css
git commit -m "feature: add date detail dialog"
```

## Task 13: Replace the presentation event modal with a controlled CRUD dialog

**Files:**
- Rewrite: `src/modals/EventModal.tsx`
- Create: `src/modals/EventModal.test.tsx`
- Modify: `src/app/styles.css`

- [ ] **Step 1: Write failing create/edit/form tests**

Cover:

- mode titles and delete visibility;
- all specified fields and default values;
- Good Custom Solid checkbox/radios;
- category and searchable linked-task Select;
- date/time mutual exclusion;
- all-day hide/restore time;
- client field errors and `aria-describedby`;
- server field error mapping;
- failed save retains every draft value;
- busy labels and disabled controls;
- dirty close opens discard confirmation;
- edit delete opens permanent confirmation;
- delete failure retains confirm and error;
- success callbacks receive old/new link information.

- [ ] **Step 2: Verify RED**

```bash
npm test -- src/modals/EventModal.test.tsx
```

Expected: current presentation-only modal lacks the controlled API and behavior.

- [ ] **Step 3: Implement the controlled API**

```ts
type EventModalProps = {
  mode: { type:'create'; dateIso:string } | { type:'edit'; event:CalendarEvent };
  tasks: MatrixTask[];
  restoreFocusRef?: RefObject<HTMLElement | null>;
  onClose(): void;
  onSaved(event:CalendarEvent, previousLinkedTaskId:string|null): Promise<void> | void;
  onDeleted(event:CalendarEvent): Promise<void> | void;
  createEvent(draft:EventDraft): Promise<CalendarEvent>;
  updateEvent(event:CalendarEvent,draft:EventDraft): Promise<CalendarEvent>;
  deleteEvent(event:CalendarEvent): Promise<void>;
  now?: () => Date;
};
```

Use `Dialog`, `ConfirmDialog`, `DatePicker`, `TimePicker`, existing `Select`, and helpers from Task 11. Keep one `openPicker: 'startDate'|'endDate'|'startTime'|'endTime'|null` so popovers are mutually exclusive. Map `RepositoryError.field` to field errors; all other errors to one `role=alert` footer message.

- [ ] **Step 4: Implement confirmations and success ordering**

Save sequence: validate → set busy → await repository operation → await `onSaved` → close. Delete sequence: confirm → set deleting → await delete → await `onDeleted` → close both layers. Do not close on any rejection. Disable close/cancel/delete/save while busy.

- [ ] **Step 5: Add authoritative form styles**

Use semantic `.event-form`, `.form-row`, `.form-check*`, `.color-options`, `.good-input`, `.good-textarea`, `.good-button*`; remove EventModal’s legacy utility-only layout. Keep all values from root tokens and no motion.

- [ ] **Step 6: Verify GREEN and commit**

```bash
npm test -- src/modals/EventModal.test.tsx
npm run build

git add src/modals/EventModal.tsx src/modals/EventModal.test.tsx src/app/styles.css
git commit -m "feature: add event editor workflow"
```

## Task 14: Integrate overlay routing and the event feature into App

**Files:**
- Modify: `src/lib/modal-store.ts`
- Modify: `src/modals/ModalRoot.tsx`
- Modify: `src/modals/ModalRoot.test.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/app/App.test.tsx`

- [ ] **Step 1: Write failing integration tests**

Test App initial range query; navigation; Header create prefilled today; day double-click prefilled date; date detail create/edit; save closes and refreshes; relation change calls `listTasks` again; delete flow; and date detail return focus.

Define modal states:

```ts
type ModalState =
 | { type:'date'; isoDate:string; trigger:HTMLElement|null }
 | { type:'event-create'; dateIso:string; trigger:HTMLElement|null; parentDate?:string }
 | { type:'event-edit'; event:CalendarEvent; trigger:HTMLElement|null; parentDate?:string }
 | existing non-event states
 | null;
```

- [ ] **Step 2: Verify RED**

```bash
npm test -- src/modals/ModalRoot.test.tsx src/app/App.test.tsx
```

- [ ] **Step 3: Wire `useEvents` into App**

Call:

```ts
const bootstrap = useAppBootstrap();
const eventsFeature = useEvents({ onRefreshTasks: bootstrap.retryTasks });
```

Use `eventsFeature.events.data` for summary, CalendarWidget, date detail, and task editor options. Pass navigation callbacks and create/edit intents. Keep the existing foreground-mode guard before opening any business overlay.

- [ ] **Step 4: Implement layered `ModalRoot` routing**

When an event is opened from date detail, render date detail as the lower non-top layer and EventModal above it. On cancel return to detail. On successful save/delete, refresh through `useEvents`; close the event layer; keep date detail only if its date remains active. Existing task/note modal routing remains functional and is not refactored beyond type compatibility.

- [ ] **Step 5: Remove obsolete all-event Rust command**

After repository and App no longer reference `list_events`, remove its Tauri registration and the frontend method. Keep reusable row query helpers only if tests or other Rust code need them; otherwise remove `query_events` from `commands.rs`. Run `rg "list_events|listEvents" src src-tauri/src tests` and ensure only `list_events_in_range`/`listEventsInRange` remain.

- [ ] **Step 6: Verify GREEN and commit**

```bash
npm test -- src/modals/ModalRoot.test.tsx src/app/App.test.tsx src/calendar
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml

git add src src-tauri/src/commands.rs src-tauri/src/main.rs
git commit -m "feature: connect event vertical slice"
```

## Task 15: Add production event CRUD Playwright coverage

**Files:**
- Create: `tests/nowly-events.spec.ts`
- Modify: `tests/nowly-empty-startup.spec.ts`

- [ ] **Step 1: Build a stateful Tauri IPC test fixture**

Inside `nowly-events.spec.ts`, install `__TAURI_INTERNALS__` before page load. The stub stores events/tasks in browser memory and implements exact commands:

```ts
await page.addInitScript(() => {
  const now = '2026-07-23T09:42:00.000Z';
  const settings = {
    wallpaperEnabled: false, launchAtLogin: false, targetMonitorId: null,
    density: 'balanced', weekStart: 'monday', dateFormat: 'localized',
    showWeekends: true, calendarEnabled: true, matrixEnabled: true, notesEnabled: true
  };
  let sequence = 1;
  let events: Array<Record<string, unknown>> = [];
  let tasks: Array<Record<string, unknown>> = [{
    id: 't1', title: '发布 Nowly v0.1', quadrant: 'important-urgent', dueAt: '2026-07-23',
    priority: 1, completed: false, linkedEventId: null, note: '', createdAt: now, updatedAt: now
  }];
  Object.assign(window, { __NOWLY_TEST_CALLS__: [] as Array<{ command: string; args: any }> });
  Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {
    invoke: async (command: string, args: any = {}) => {
      (window as any).__NOWLY_TEST_CALLS__.push({ command, args });
      if (command === 'list_events_in_range') {
        return events.filter((event: any) =>
          event.startAt >= args.range.startAt && event.startAt < args.range.endAtExclusive
        );
      }
      if (command === 'create_event') {
        const event = { id: `e${sequence++}`, ...args.draft, createdAt: now, updatedAt: now };
        if (event.linkedTaskId) {
          events = events.map((item: any) => item.linkedTaskId === event.linkedTaskId
            ? { ...item, linkedTaskId: null, updatedAt: now } : item);
          tasks = tasks.map((task: any) => task.id === event.linkedTaskId
            ? { ...task, linkedEventId: event.id, updatedAt: now } : task);
        }
        events.push(event);
        return event;
      }
      if (command === 'update_event') {
        const previous: any = events.find((event: any) => event.id === args.id);
        if (!previous) throw { code: 'not_found', message: '未找到该日程。' };
        tasks = tasks.map((task: any) => task.linkedEventId === args.id
          ? { ...task, linkedEventId: null, updatedAt: now } : task);
        events = events.map((item: any) => item.id !== args.id && item.linkedTaskId === args.draft.linkedTaskId
          ? { ...item, linkedTaskId: null, updatedAt: now } : item);
        const updated = { ...previous, ...args.draft, updatedAt: now };
        events = events.map((event: any) => event.id === args.id ? updated : event);
        if (updated.linkedTaskId) {
          tasks = tasks.map((task: any) => task.id === updated.linkedTaskId
            ? { ...task, linkedEventId: updated.id, updatedAt: now } : task);
        }
        return updated;
      }
      if (command === 'delete_event') {
        const existing: any = events.find((event: any) => event.id === args.id);
        events = events.filter((event: any) => event.id !== args.id);
        if (existing?.linkedTaskId) {
          tasks = tasks.map((task: any) => task.id === existing.linkedTaskId
            ? { ...task, linkedEventId: null, updatedAt: now } : task);
        }
        return null;
      }
      if (command === 'list_tasks') return tasks;
      if (command === 'list_notes') return [];
      if (command === 'get_app_settings') return settings;
      if (command === 'enter_wallpaper_mode' || command === 'enter_foreground_mode') return 'ok';
      throw new Error(`Unexpected command: ${command}`);
    },
    transformCallback: (callback: (payload: unknown) => void) => {
      const id = Math.floor(Math.random() * 2 ** 32);
      Reflect.set(window, `_${id}`, callback);
      return id;
    }
  }});
});
```

Declare `Window.__NOWLY_TEST_CALLS__` in the test file for TypeScript and inspect it with `page.evaluate` for range assertions.

- [ ] **Step 2: Write the failing complete-path tests**

Cover:

1. empty July → Header new → fill title/date/time/category/color/task → save → event appears;
2. next month invokes August half-open range and previous month restores July;
3. day detail opens, event edit changes title, and save refreshes;
4. delete asks exact permanent warning, Escape returns to editor, second confirm deletes;
5. date/time/select keyboard paths work without native date/time inputs;
6. dialog focus stays in top layer and returns to trigger.

Update `nowly-empty-startup.spec.ts` so the IPC stub recognizes `list_events_in_range` and returns `[]`.

- [ ] **Step 3: Run and verify RED**

```bash
npx playwright test tests/nowly-events.spec.ts --project=1366x768
```

Expected: failures until production integration and selectors exactly match the tested path; fix production behavior rather than weakening user-visible assertions.

- [ ] **Step 4: Align the fixture and production accessibility selectors, then verify GREEN**

Use role/name selectors matching the visible accessible contract from Tasks 7–14. Do not use CSS implementation-detail selectors to bypass incorrect labels, and do not add browser fallbacks to production code. Keep all Tauri emulation inside Playwright fixtures.

```bash
npx playwright test tests/nowly-events.spec.ts
npx playwright test tests/nowly-empty-startup.spec.ts
```

Expected: event tests pass at all four configured viewports.

- [ ] **Step 5: Commit**

```bash
git add tests/nowly-events.spec.ts tests/nowly-empty-startup.spec.ts
git commit -m "test: cover persisted event workflows"
```

## Task 16: Run stage gates, review, and record completion

**Files:**
- Modify after review passes: `docs/00-index.md`
- Modify after review passes: `docs/superpowers/plans/2026-07-29-nowly-windows-product-roadmap.md`
- Modify: this plan’s status header after completion

- [ ] **Step 1: Run focused static checks**

```bash
rg -n "list_events\b|listEvents\b" src src-tauri/src tests
rg -n "type=\"date\"|type=\"time\"|<select" src/components/DatePicker.tsx src/components/TimePicker.tsx src/modals/EventModal.tsx
rg -n "#009ef7|#009EF7|transition:|animation:|scroll-behavior: smooth" src
rg -n "<button[^>]*>.*<button|role=\"button\"" src/calendar/CalendarWidget.tsx
```

Expected:

- no obsolete all-event production read;
- no native date/time/select in EventModal (native checkbox/radio inputs are required and allowed);
- no new legacy blue or motion declarations;
- no nested calendar controls or simulated role buttons.

- [ ] **Step 2: Run all automated gates**

```bash
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
npx playwright test
git diff --check
```

Expected: all Vitest, TypeScript/Vite, Rust, and Playwright tests pass; diff check is clean.

- [ ] **Step 3: Inspect responsive UI manually**

At 1366×768, 1920×1080, 2560×1440 and 5120×1440 verify:

- no document-level scrollbar;
- calendar remains usable with 42 cells;
- dialog Body scrolls internally when needed;
- picker popup stays below the business Header and inside horizontal bounds;
- confirm dialog is visibly above EventModal;
- no animation, spinner, skeleton, old blue, Emoji, or hand-written business SVG;
- all changed UI follows `design.md` token, typography, spacing, radius, border, and focus rules.

- [ ] **Step 4: Request code review**

Invoke the `requesting-code-review` skill. Review against the stage-2 spec, this plan, migration safety, transaction correctness, focus behavior, and stage gates. Fix all blocking and important findings with TDD, rerun affected focused tests, then rerun Step 2.

- [ ] **Step 5: Record stage completion only after review**

At the top of this file add a completion status table with actual test counts and any intentional plan deviations. Update:

- `docs/00-index.md`: stage 2 completed; next stage is task vertical slice and requires a detailed plan first;
- roadmap Overall status: stage 2 completed, stage 3 next;
- roadmap contract list: migration highest version 5, event month-query/CRUD contract, fixed enums, and transactional relinking rules.

Do not create the stage-3 plan in this task.

- [ ] **Step 6: Commit documentation**

```bash
git add -f docs/00-index.md docs/superpowers/plans/2026-07-29-nowly-events.md docs/superpowers/plans/2026-07-29-nowly-windows-product-roadmap.md
git commit -m "docs: record event stage completion"
```

- [ ] **Step 7: Confirm a clean handoff**

```bash
git status --short
git log --oneline -20
```

Expected: clean working tree; all stage-2 implementation commits and the completion documentation commit are present. Stop before planning or implementing stage 3.
