# Nowly Task Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver stable quadrant task ordering, complete task CRUD, accessible optimistic completion with rollback/retry, date-detail task creation, and transactional event-task linking from React through Tauri to SQLite.

**Architecture:** A dedicated `useTasks` hook becomes the only frontend task-state owner and coordinates with the existing `useEvents` hook through stable refresh callbacks in App. Typed repository methods are implemented by the sole Tauri adapter; an isolated Rust task service validates requests and performs Immediate SQLite transactions that preserve bidirectional one-to-one links. `MatrixWidget` only renders state and emits intents, while `TaskModal` owns drafts, validation, picker state, confirmations, and submit errors.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Playwright, Tauri 2, Rust, rusqlite/SQLite, chrono, uuid, lucide-react.

---

**Specification:** `docs/superpowers/specs/2026-07-29-nowly-tasks-design.md`

**Prerequisites and constraints:**

- Read root `design.md` completely before every UI task.
- Keep migrations 1–5 unchanged; stage 3 has no schema migration.
- Keep camelCase IPC, `CommandError`, repository injection, static loading/error states, and no-motion rules from stages 1–2.
- Keep `src/data/tauri-nowly-repository.ts` as the only frontend module that knows Tauri command names.
- Do not implement note CRUD, settings persistence, cross-month event search, or Windows lifecycle behavior.
- Do not rewrite the WorkerW/taskbar/tray subsystem.
- Every production behavior follows Red-Green-Refactor and every commit uses `<type>: <short description>`.

## File map

### Rust

- `src-tauri/src/models.rs` — add camelCase `TaskDraft` request.
- `src-tauri/src/tasks.rs` — task row mapping, trusted validation, stable reads, CRUD, completion, and bidirectional event-link transactions.
- `src-tauri/src/commands.rs` — remove task SQL/command after the dedicated module takes ownership; retain notes/settings startup commands.
- `src-tauri/src/main.rs` — register the task module and five task commands.
- `src-tauri/src/db.rs` — unchanged; tests prove migration version remains 5.

### React data and state

- `src/matrix/matrix-model.ts` — task priority/draft types, fixed options, stable comparison, and labels.
- `src/data/nowly-repository.ts` — typed task write/completion methods.
- `src/data/tauri-nowly-repository.ts` — exact task invoke names/payloads.
- `src/data/tauri-nowly-repository.test.ts` — exact IPC contract.
- `src/matrix/useTasks.ts` — sole task resource owner, CRUD refresh, optimistic completion, rollback, retry, and stale guards.
- `src/matrix/useTasks.test.tsx` — hook behavior.
- `src/app/useAppBootstrap.ts` and test — remove task ownership; retain notes/settings.
- `src/lib/task-draft.ts` and test — form defaults, entity conversion, validation, dirty comparison, and display metadata.

### React UI

- `src/matrix/TaskRow.tsx` and test — compact two-line task row and accessible no-motion tooltip.
- `src/matrix/MatrixWidget.tsx` and test — quadrants, counts, completion error/retry, and task intents.
- `src/modals/TaskModal.tsx` and test — controlled task create/edit/delete workflow.
- `src/calendar/DateDetailDialog.tsx` and test — restore date-prefilled task creation entry.
- `src/lib/modal-store.ts` — explicit task-create/task-edit states.
- `src/modals/ModalRoot.tsx` and test — layered date/task routing.
- `src/app/App.tsx` and test — stable task/event refresh bridge and feature integration.
- `src/app/styles.css` — authoritative semantic task row, tooltip, error, and task form styles.

### End-to-end and docs

- `tests/nowly-tasks.spec.ts` — stateful task IPC CRUD, completion rollback/retry, linking, tooltip, and keyboard flow.
- `tests/nowly-events.spec.ts` and `tests/nowly-empty-startup.spec.ts` — extend repository stubs for new task commands only where needed.
- `docs/00-index.md` — add stage 3 plan and completion status only after review/gates.
- `docs/superpowers/plans/2026-07-29-nowly-windows-product-roadmap.md` — close stage 3 only after review/gates.
- `docs/superpowers/plans/2026-07-29-nowly-tasks.md` — record completion evidence at the end.

## Task 1: Define the Rust task write contract

**Files:**
- Modify: `src-tauri/src/models.rs`

- [ ] **Step 1: Write the failing camelCase request test**

Add this import and test in `src-tauri/src/models.rs`:

```rust
use super::{EventDraft, TaskDraft};

#[test]
fn task_draft_deserializes_camel_case() {
    let draft: TaskDraft = serde_json::from_value(serde_json::json!({
        "title": "发布 Nowly",
        "quadrant": "important_urgent",
        "dueAt": "2026-07-23",
        "priority": 1,
        "completed": false,
        "linkedEventId": "e1",
        "note": "发布前检查"
    }))
    .unwrap();

    assert_eq!(draft.due_at.as_deref(), Some("2026-07-23"));
    assert_eq!(draft.linked_event_id.as_deref(), Some("e1"));
    assert_eq!(draft.priority, 1);
}
```

- [ ] **Step 2: Run the test and verify RED**

```bash
cargo test --manifest-path src-tauri/Cargo.toml models::tests::task_draft_deserializes_camel_case -- --nocapture
```

Expected: compile failure because `TaskDraft` does not exist.

- [ ] **Step 3: Add the minimal request model**

Add beside `EventDraft`:

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskDraft {
    pub title: String,
    pub quadrant: String,
    pub due_at: Option<String>,
    pub priority: i64,
    pub completed: bool,
    pub linked_event_id: Option<String>,
    pub note: String,
}
```

- [ ] **Step 4: Verify GREEN and preserve migration version 5**

```bash
cargo test --manifest-path src-tauri/Cargo.toml models::tests -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml db::tests::migrate_records_each_schema_version_once -- --nocapture
```

Expected: all focused tests pass and migration versions remain `[1, 2, 3, 4, 5]`.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/models.rs
git commit -m "feature: define task write contract"
```

## Task 2: Isolate trusted task validation and stable reads

**Files:**
- Create: `src-tauri/src/tasks.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Create failing validation and ordering tests**

Create `src-tauri/src/tasks.rs` with the intended public stubs and tests:

```rust
use crate::error::CommandError;
use crate::models::{Task, TaskDraft};
use rusqlite::{Connection, Row};

pub fn validate_and_normalize(_: TaskDraft) -> Result<TaskDraft, CommandError> {
    unimplemented!("task validation")
}

pub fn list(connection: &Connection) -> Result<Vec<Task>, CommandError> {
    let _ = connection;
    unimplemented!("stable task query")
}

#[cfg(test)]
mod tests {
    use super::{list, validate_and_normalize};
    use crate::db::migrate;
    use crate::models::TaskDraft;
    use rusqlite::Connection;

    fn database() -> Connection {
        let mut connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        migrate(&mut connection).unwrap();
        connection
    }

    fn draft() -> TaskDraft {
        TaskDraft {
            title: "  发布 Nowly  ".into(),
            quadrant: "important_urgent".into(),
            due_at: Some("2026-07-23".into()),
            priority: 1,
            completed: false,
            linked_event_id: None,
            note: " 保留备注空白 ".into(),
        }
    }

    #[test]
    fn validation_trims_title_and_rejects_invalid_fields() {
        let valid = validate_and_normalize(draft()).unwrap();
        assert_eq!(valid.title, "发布 Nowly");
        assert_eq!(valid.note, " 保留备注空白 ");

        for (invalid, field) in [
            (TaskDraft { title: "  ".into(), ..draft() }, "title"),
            (TaskDraft { quadrant: "later".into(), ..draft() }, "quadrant"),
            (TaskDraft { due_at: Some("2026-02-30".into()), ..draft() }, "dueAt"),
            (TaskDraft { due_at: Some("2026-07-23T09:00".into()), ..draft() }, "dueAt"),
            (TaskDraft { priority: 0, ..draft() }, "priority"),
            (TaskDraft { priority: 4, ..draft() }, "priority"),
        ] {
            assert_eq!(validate_and_normalize(invalid).unwrap_err().field.as_deref(), Some(field));
        }
        assert!(validate_and_normalize(TaskDraft { due_at: None, ..draft() }).is_ok());
    }

    #[test]
    fn list_orders_completion_due_date_priority_creation_and_id() {
        let connection = database();
        for (id, due, priority, completed, created) in [
            ("no-due", None, 1, 0, "2026-07-20T00:00:00Z"),
            ("done", Some("2026-07-01"), 1, 1, "2026-07-20T00:00:00Z"),
            ("low", Some("2026-07-23"), 3, 0, "2026-07-20T00:00:00Z"),
            ("newer", Some("2026-07-23"), 1, 0, "2026-07-21T00:00:00Z"),
            ("older-b", Some("2026-07-23"), 1, 0, "2026-07-20T00:00:00Z"),
            ("older-a", Some("2026-07-23"), 1, 0, "2026-07-20T00:00:00Z"),
            ("earliest", Some("2026-07-01"), 2, 0, "2026-07-20T00:00:00Z"),
        ] {
            connection.execute(
                "INSERT INTO tasks(id,title,quadrant,due_at,priority,completed,note,created_at,updated_at)
                 VALUES (?1,?1,'important_urgent',?2,?3,?4,'',?5,?5)",
                rusqlite::params![id, due, priority, completed, created],
            ).unwrap();
        }
        let ids: Vec<String> = list(&connection).unwrap().into_iter().map(|task| task.id).collect();
        assert_eq!(ids, vec!["earliest", "older-a", "older-b", "newer", "low", "no-due", "done"]);
    }
}
```

- [ ] **Step 2: Run focused tests and verify RED**

```bash
cargo test --manifest-path src-tauri/Cargo.toml tasks::tests -- --nocapture
```

Expected: both tests panic at `unimplemented!`.

- [ ] **Step 3: Implement exact validation and row mapping**

Use these constants and helpers:

```rust
use chrono::NaiveDate;

const QUADRANTS: &[&str] = &[
    "important_urgent",
    "important_not_urgent",
    "not_important_urgent",
    "not_important_not_urgent",
];

fn read_task(row: &Row<'_>) -> rusqlite::Result<Task> {
    Ok(Task {
        id: row.get(0)?, title: row.get(1)?, quadrant: row.get(2)?, due_at: row.get(3)?,
        priority: row.get(4)?, completed: row.get::<_, i64>(5)? == 1,
        linked_event_id: row.get(6)?, note: row.get(7)?, created_at: row.get(8)?, updated_at: row.get(9)?,
    })
}

pub fn validate_and_normalize(mut draft: TaskDraft) -> Result<TaskDraft, CommandError> {
    draft.title = draft.title.trim().to_owned();
    if draft.title.is_empty() {
        return Err(CommandError::validation("title", "请输入任务标题。"));
    }
    if !QUADRANTS.contains(&draft.quadrant.as_str()) {
        return Err(CommandError::validation("quadrant", "请选择有效象限。"));
    }
    if let Some(due_at) = draft.due_at.as_deref() {
        if NaiveDate::parse_from_str(due_at, "%Y-%m-%d").is_err() {
            return Err(CommandError::validation("dueAt", "截止日期格式无效。"));
        }
    }
    if !(1..=3).contains(&draft.priority) {
        return Err(CommandError::validation("priority", "请选择有效优先级。"));
    }
    Ok(draft)
}
```

Implement `list` with this exact order:

```sql
SELECT id,title,quadrant,due_at,priority,completed,linked_event_id,note,created_at,updated_at
FROM tasks
ORDER BY completed ASC,
         due_at IS NULL ASC,
         due_at ASC,
         priority ASC,
         created_at ASC,
         id ASC
```

Map prepare/query/collect errors through `CommandError::database`.

- [ ] **Step 4: Move the read command into the dedicated module**

Add:

```rust
#[tauri::command]
pub fn list_tasks(db: tauri::State<'_, crate::db::AppDb>) -> Result<Vec<Task>, CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    list(&connection)
}
```

Remove `query_tasks`, its imports, and `commands::list_tasks` from `commands.rs`. Keep the empty-list regression by moving its task assertion into `tasks.rs`; leave `commands.rs` testing notes only. Add `mod tasks;` and replace `commands::list_tasks` with `tasks::list_tasks` in `main.rs`.

- [ ] **Step 5: Verify GREEN and commit**

```bash
cargo test --manifest-path src-tauri/Cargo.toml tasks::tests -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml

git add src-tauri/src/tasks.rs src-tauri/src/commands.rs src-tauri/src/main.rs
git commit -m "feature: validate and order tasks"
```

Expected: all Rust tests pass.

## Task 3: Implement transactional task CRUD and bidirectional relinking

**Files:**
- Modify: `src-tauri/src/tasks.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Add failing CRUD and relation tests**

Add helpers that insert an event and read both links, then add:

```rust
#[test]
fn create_update_and_delete_task_persist_without_deleting_events() {
    let mut connection = database();
    insert_event(&connection, "e1");
    let created = create(&mut connection, TaskDraft { linked_event_id: Some("e1".into()), ..draft() }).unwrap();
    assert_eq!(created.title, "发布 Nowly");
    assert!(uuid::Uuid::parse_str(&created.id).is_ok());
    assert_eq!(event_link(&connection, "e1").as_deref(), Some(created.id.as_str()));

    let updated = update(&mut connection, &created.id, TaskDraft {
        title: "正式发布".into(), quadrant: "important_not_urgent".into(), linked_event_id: None, ..draft()
    }).unwrap();
    assert_eq!(updated.title, "正式发布");
    assert_eq!(updated.created_at, created.created_at);
    assert_eq!(event_link(&connection, "e1"), None);

    delete(&mut connection, &created.id).unwrap();
    assert_eq!(connection.query_row("SELECT COUNT(*) FROM events WHERE id='e1'", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
    assert_eq!(delete(&mut connection, &created.id).unwrap_err().code, "not_found");
}

#[test]
fn relinking_displaces_both_old_relationships_atomically() {
    let mut connection = database();
    insert_event(&connection, "e1");
    insert_event(&connection, "e2");
    let first = create(&mut connection, TaskDraft { linked_event_id: Some("e1".into()), ..draft() }).unwrap();
    let second = create(&mut connection, TaskDraft { linked_event_id: Some("e2".into()), ..draft() }).unwrap();

    update(&mut connection, &second.id, TaskDraft { linked_event_id: Some("e1".into()), ..draft() }).unwrap();
    assert_eq!(task_link(&connection, &first.id), None);
    assert_eq!(task_link(&connection, &second.id).as_deref(), Some("e1"));
    assert_eq!(event_link(&connection, "e1").as_deref(), Some(second.id.as_str()));
    assert_eq!(event_link(&connection, "e2"), None);
}

#[test]
fn missing_linked_event_is_a_field_error_and_rolls_back() {
    let mut connection = database();
    let error = create(&mut connection, TaskDraft { linked_event_id: Some("missing".into()), ..draft() }).unwrap_err();
    assert_eq!(error.code, "validation_error");
    assert_eq!(error.field.as_deref(), Some("linkedEventId"));
    assert_eq!(connection.query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
}
```

Use this event insert shape:

```rust
fn insert_event(connection: &Connection, id: &str) {
    connection.execute(
        "INSERT INTO events(id,title,start_at,end_at,all_day,category,color,note,created_at,updated_at)
         VALUES (?1,?1,'2026-07-23T09:00','2026-07-23T10:00',0,'work','blue','','2026-07-23T08:00:00Z','2026-07-23T08:00:00Z')",
        [id],
    ).unwrap();
}
```

- [ ] **Step 2: Verify RED**

```bash
cargo test --manifest-path src-tauri/Cargo.toml tasks::tests -- --nocapture
```

Expected: compile failure because `create`, `update`, and `delete` do not exist.

- [ ] **Step 3: Implement transaction helpers and stable SQL errors**

Add:

```rust
use chrono::{SecondsFormat, Utc};
use rusqlite::{params, OptionalExtension, Transaction, TransactionBehavior};
use uuid::Uuid;

fn timestamp() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn sql_write_error(error: rusqlite::Error) -> CommandError {
    match &error {
        rusqlite::Error::SqliteFailure(details, _)
            if details.code == rusqlite::ErrorCode::ConstraintViolation => {
                eprintln!("task relation constraint failed: {error}");
                CommandError::conflict("任务关联已变化，请重试。")
            }
        _ => CommandError::database(error),
    }
}
```

Implement these exact public APIs:

```rust
pub fn create(connection: &mut Connection, draft: TaskDraft) -> Result<Task, CommandError>;
pub fn update(connection: &mut Connection, id: &str, draft: TaskDraft) -> Result<Task, CommandError>;
pub fn delete(connection: &mut Connection, id: &str) -> Result<(), CommandError>;
```

Private `relink(transaction, task_id, old_event_id, new_event_id, updated_at)` must:

1. return early when old/new IDs match;
2. verify a new event with `SELECT EXISTS` or return `validation("linkedEventId", "未找到要关联的日程。")`;
3. clear the old event only where `linked_task_id = task_id`;
4. read the new event's displaced `linked_task_id`;
5. clear the displaced task's `linked_event_id`;
6. clear any other event pointing to the current task;
7. set the new event's `linked_task_id = task_id`;
8. let create/update set the current task's `linked_event_id`;
9. update every changed row's `updated_at`.

Use `TransactionBehavior::Immediate`, UUID v4, timestamp metadata, affected-row checks, full row readback before commit, and never delete an event.

- [ ] **Step 4: Add and register thin Tauri commands**

```rust
#[tauri::command]
pub fn create_task(db: State<'_, AppDb>, draft: TaskDraft) -> Result<Task, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    create(&mut connection, draft)
}

#[tauri::command]
pub fn update_task(db: State<'_, AppDb>, id: String, draft: TaskDraft) -> Result<Task, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    update(&mut connection, &id, draft)
}

#[tauri::command]
pub fn delete_task(db: State<'_, AppDb>, id: String) -> Result<(), CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    delete(&mut connection, &id)
}
```

Register `tasks::create_task`, `tasks::update_task`, and `tasks::delete_task` in `main.rs`.

- [ ] **Step 5: Verify GREEN and commit**

```bash
cargo test --manifest-path src-tauri/Cargo.toml tasks::tests -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml

git add src-tauri/src/tasks.rs src-tauri/src/main.rs
git commit -m "feature: persist task changes transactionally"
```

## Task 4: Add the focused task-completion command

**Files:**
- Modify: `src-tauri/src/tasks.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Add failing completion tests**

```rust
#[test]
fn completion_updates_only_status_and_timestamp() {
    let mut connection = database();
    let created = create(&mut connection, draft()).unwrap();
    let completed = set_completed(&mut connection, &created.id, true).unwrap();
    assert!(completed.completed);
    assert_eq!(completed.title, created.title);
    assert_eq!(completed.linked_event_id, created.linked_event_id);
    assert!(completed.updated_at >= created.updated_at);

    let reopened = set_completed(&mut connection, &created.id, false).unwrap();
    assert!(!reopened.completed);
}

#[test]
fn completion_of_missing_task_returns_not_found() {
    let mut connection = database();
    assert_eq!(set_completed(&mut connection, "missing", true).unwrap_err().code, "not_found");
}
```

- [ ] **Step 2: Verify RED**

```bash
cargo test --manifest-path src-tauri/Cargo.toml tasks::tests::completion -- --nocapture
```

Expected: compile failure because `set_completed` is missing.

- [ ] **Step 3: Implement minimal completion update**

```rust
pub fn set_completed(
    connection: &mut Connection,
    id: &str,
    completed: bool,
) -> Result<Task, CommandError> {
    let now = timestamp();
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(CommandError::database)?;
    let affected = transaction.execute(
        "UPDATE tasks SET completed=?2,updated_at=?3 WHERE id=?1",
        params![id, i64::from(completed), now],
    ).map_err(sql_write_error)?;
    if affected != 1 {
        return Err(CommandError::not_found("未找到该任务。"));
    }
    let task = task_by_id(&transaction, id)?
        .ok_or_else(|| CommandError::not_found("未找到该任务。"))?;
    transaction.commit().map_err(sql_write_error)?;
    Ok(task)
}
```

Add/register:

```rust
#[tauri::command]
pub fn set_task_completed(
    db: State<'_, AppDb>,
    id: String,
    completed: bool,
) -> Result<Task, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    set_completed(&mut connection, &id, completed)
}
```

- [ ] **Step 4: Verify GREEN and commit**

```bash
cargo test --manifest-path src-tauri/Cargo.toml tasks::tests -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml

git add src-tauri/src/tasks.rs src-tauri/src/main.rs
git commit -m "feature: persist task completion"
```

## Task 5: Extend frontend task models and repository IPC

**Files:**
- Modify: `src/matrix/matrix-model.ts`
- Modify: `src/data/nowly-repository.ts`
- Modify: `src/data/tauri-nowly-repository.ts`
- Modify: `src/data/tauri-nowly-repository.test.ts`
- Modify: every test helper that returns `NowlyRepository`

- [ ] **Step 1: Add the failing exact IPC contract**

Extend `tauri-nowly-repository.test.ts`:

```ts
const taskDraft = {
  title: '发布 Nowly',
  quadrant: 'important_urgent' as const,
  dueAt: '2026-07-23',
  priority: 1 as const,
  completed: false,
  linkedEventId: 'e1',
  note: ''
};

await tauriNowlyRepository.createTask(taskDraft);
await tauriNowlyRepository.updateTask('t1', taskDraft);
await tauriNowlyRepository.deleteTask('t1');
await tauriNowlyRepository.setTaskCompleted('t1', true);

expect(invokeMock.mock.calls).toContainEqual(['create_task', { draft: taskDraft }]);
expect(invokeMock.mock.calls).toContainEqual(['update_task', { id: 't1', draft: taskDraft }]);
expect(invokeMock.mock.calls).toContainEqual(['delete_task', { id: 't1' }]);
expect(invokeMock.mock.calls).toContainEqual(['set_task_completed', { id: 't1', completed: true }]);
```

- [ ] **Step 2: Verify RED**

```bash
npm test -- src/data/tauri-nowly-repository.test.ts
```

Expected: TypeScript errors for missing methods and `TaskDraft`.

- [ ] **Step 3: Add exact TypeScript contracts**

In `matrix-model.ts` add:

```ts
export type TaskPriority = 1 | 2 | 3;
export type TaskDraft = Omit<MatrixTask, 'id' | 'createdAt' | 'updatedAt'>;

export const priorityLabels: Record<TaskPriority, string> = {
  1: '高', 2: '中', 3: '低'
};

export const quadrantOrder: Quadrant[] = [
  'important_urgent',
  'important_not_urgent',
  'not_important_urgent',
  'not_important_not_urgent'
];
```

Narrow `MatrixTask.priority` to `TaskPriority`. Add the four methods to `NowlyRepository`, then implement exactly:

```ts
createTask: (draft) => invoke('create_task', { draft }),
updateTask: (id, draft) => invoke('update_task', { id, draft }),
deleteTask: (id) => invoke('delete_task', { id }),
setTaskCompleted: (id, completed) => invoke('set_task_completed', { id, completed }),
```

Update every repository test factory with rejected-by-default writes:

```ts
createTask: vi.fn().mockRejectedValue(new Error('unexpected task write')),
updateTask: vi.fn().mockRejectedValue(new Error('unexpected task write')),
deleteTask: vi.fn().mockRejectedValue(new Error('unexpected task write')),
setTaskCompleted: vi.fn().mockRejectedValue(new Error('unexpected task write')),
```

- [ ] **Step 4: Verify GREEN and compile all consumers**

```bash
npm test -- src/data/tauri-nowly-repository.test.ts
npm run build
```

Expected: repository test and TypeScript build pass.

- [ ] **Step 5: Commit**

```bash
git add src/matrix/matrix-model.ts src/data src/**/*.test.tsx
git commit -m "feature: add task repository operations"
```

## Task 6: Add pure task draft, sorting, and display helpers

**Files:**
- Create: `src/lib/task-draft.ts`
- Create: `src/lib/task-draft.test.ts`
- Modify: `src/matrix/matrix-model.ts`

- [ ] **Step 1: Write failing pure-function tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  compareTasks, createTaskForm, formatTaskMeta, isTaskFormDirty,
  taskToForm, toTaskDraft, validateTaskForm
} from './task-draft';

it('creates approved defaults and date-detail defaults', () => {
  expect(createTaskForm(null)).toEqual({
    title: '', quadrant: 'important_urgent', dueAt: '', priority: 2,
    completed: false, linkedEventId: '', note: ''
  });
  expect(createTaskForm('2026-07-23').dueAt).toBe('2026-07-23');
});

it('normalizes and validates task forms', () => {
  const form = { ...createTaskForm('2026-07-23'), title: '  发布 Nowly  ', note: ' 保留 ' };
  expect(toTaskDraft(form)).toMatchObject({ title: '发布 Nowly', dueAt: '2026-07-23', note: ' 保留 ' });
  expect(validateTaskForm({ ...form, title: ' ' })).toEqual({ title: '请输入任务标题。' });
  expect(validateTaskForm({ ...form, dueAt: '2026-02-30' })).toEqual({ dueAt: '请选择有效截止日期。' });
});

it('sorts exactly like the server and formats visible metadata', () => {
  const sorted = [done, noDue, lowPriority, highPriority, earlierDue].sort(compareTasks);
  expect(sorted.map(task => task.id)).toEqual(['earlier', 'high', 'low', 'no-due', 'done']);
  expect(formatTaskMeta(highPriority, new Date(2026, 6, 23))).toBe('今天到期 · 高优先级');
  expect(formatTaskMeta(noDue, new Date(2026, 6, 23))).toBe('无截止日期 · 高优先级');
  expect(formatTaskMeta(done, new Date(2026, 6, 23))).toContain('已完成');
});

it('round-trips entities and compares semantic dirtiness', () => {
  const form = taskToForm(highPriority);
  expect(toTaskDraft(form).linkedEventId).toBe(highPriority.linkedEventId);
  expect(isTaskFormDirty(form, { ...form })).toBe(false);
  expect(isTaskFormDirty(form, { ...form, note: 'changed' })).toBe(true);
});
```

Define fixture entities in the test with distinct `dueAt`, `priority`, `completed`, `createdAt`, and `id` values matching the expected order.

- [ ] **Step 2: Verify RED**

```bash
npm test -- src/lib/task-draft.test.ts
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement the exact pure API**

```ts
export type TaskFormDraft = {
  title: string;
  quadrant: Quadrant;
  dueAt: string;
  priority: TaskPriority;
  completed: boolean;
  linkedEventId: string;
  note: string;
};

export type TaskFieldErrors = Partial<Record<'title' | 'quadrant' | 'dueAt' | 'priority' | 'linkedEventId', string>>;

export function createTaskForm(sourceDate: string | null): TaskFormDraft;
export function taskToForm(task: MatrixTask): TaskFormDraft;
export function toTaskDraft(form: TaskFormDraft): TaskDraft;
export function validateTaskForm(form: TaskFormDraft): TaskFieldErrors;
export function isTaskFormDirty(initial: TaskFormDraft, current: TaskFormDraft): boolean;
export function compareTasks(left: MatrixTask, right: MatrixTask): number;
export function sortTasks(tasks: MatrixTask[]): MatrixTask[];
export function formatTaskMeta(task: MatrixTask, today?: Date): string;
```

Implement strict date validation by parsing components and verifying the constructed local `Date` round-trips year/month/day. `compareTasks` must compare completed, null due date, due date, priority, createdAt, then id. Never use UTC conversion for `dueAt`.

- [ ] **Step 4: Verify GREEN and commit**

```bash
npm test -- src/lib/task-draft.test.ts

git add src/lib/task-draft.ts src/lib/task-draft.test.ts src/matrix/matrix-model.ts
git commit -m "feature: validate and sort task drafts"
```

## Task 7: Move task ownership into `useTasks`

**Files:**
- Create: `src/matrix/useTasks.ts`
- Create: `src/matrix/useTasks.test.tsx`
- Modify: `src/app/useAppBootstrap.ts`
- Modify: `src/app/useAppBootstrap.test.tsx`

- [ ] **Step 1: Write failing read and CRUD hook tests**

Use `RepositoryProvider`, deferred promises, and the same rejected-by-default repository factory as `useEvents.test.tsx`. Cover:

```tsx
it('loads and stably sorts tasks while ignoring a stale retry', async () => {
  const first = deferred<MatrixTask[]>();
  const retry = deferred<MatrixTask[]>();
  const repository = createRepository({
    listTasks: vi.fn().mockImplementationOnce(() => first.promise).mockImplementationOnce(() => retry.promise)
  });
  const { result } = renderHook(() => useTasks({ onRefreshEvents: vi.fn() }), { wrapper: wrapper(repository) });
  act(() => { void result.current.retryTasks(); });
  await act(() => retry.resolve([done, open]));
  await waitFor(() => expect(result.current.tasks.data.map(task => task.id)).toEqual(['open', 'done']));
  await act(() => first.resolve([stale]));
  expect(result.current.tasks.data.map(task => task.id)).toEqual(['open', 'done']);
});

it('refreshes events only when CRUD changes a relationship', async () => {
  const onRefreshEvents = vi.fn().mockResolvedValue(undefined);
  const repository = createRepository({
    createTask: vi.fn().mockResolvedValue(linkedTask),
    updateTask: vi.fn().mockResolvedValue(unlinkedTask),
    deleteTask: vi.fn().mockResolvedValue(undefined)
  });
  const { result } = renderHook(() => useTasks({ onRefreshEvents }), { wrapper: wrapper(repository) });
  await waitFor(() => expect(result.current.tasks.status).toBe('ready'));
  await act(() => result.current.createTask(linkedDraft));
  expect(onRefreshEvents).toHaveBeenCalledTimes(1);
  await act(() => result.current.updateTask(linkedTask, { ...linkedDraft, linkedEventId: null }));
  expect(onRefreshEvents).toHaveBeenCalledTimes(2);
  await act(() => result.current.deleteTask(unlinkedTask));
  expect(onRefreshEvents).toHaveBeenCalledTimes(2);
});
```

Also assert failed CRUD does not refresh events or mutate ready data.

- [ ] **Step 2: Verify RED**

```bash
npm test -- src/matrix/useTasks.test.tsx
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement reads and CRUD with stale-read protection**

Task 7 public shape intentionally contains only the behavior implemented by its failing tests:

```ts
export function useTasks({ onRefreshEvents }: { onRefreshEvents: () => Promise<unknown> }) {
  return { tasks, retryTasks, createTask, updateTask, deleteTask };
}
```

Task 8 extends that return value with completion operations after their tests fail. `loadTasks` increments `requestIdRef`, preserves current data while loading, ignores stale resolves/rejects, and sorts with `sortTasks`. CRUD awaits the repository write, reloads tasks, and calls `onRefreshEvents` only under the specification's relation conditions.

- [ ] **Step 4: Remove task ownership from bootstrap**

Delete task imports/state/load/retry from `useAppBootstrap`. Its return becomes:

```ts
return { notes, settings, retryNotes: loadNotes, retrySettings: loadSettings };
```

Update bootstrap tests to assert only notes/settings calls and no task properties:

```ts
expect(result.current).not.toHaveProperty('tasks');
expect(result.current).not.toHaveProperty('retryTasks');
expect(value.listTasks).not.toHaveBeenCalled();
```

- [ ] **Step 5: Verify GREEN and commit**

```bash
npm test -- src/matrix/useTasks.test.tsx src/app/useAppBootstrap.test.tsx
npm run build

git add src/matrix/useTasks.ts src/matrix/useTasks.test.tsx src/app/useAppBootstrap.ts src/app/useAppBootstrap.test.tsx
git commit -m "feature: manage task resource state"
```

## Task 8: Add optimistic completion rollback and original-intent retry

**Files:**
- Modify: `src/matrix/useTasks.ts`
- Modify: `src/matrix/useTasks.test.tsx`

- [ ] **Step 1: Add failing optimistic success and rollback tests**

```tsx
it('optimistically completes, disables the task, and accepts the server entity', async () => {
  const write = deferred<MatrixTask>();
  const repository = createRepository({ listTasks: vi.fn().mockResolvedValue([open, later]), setTaskCompleted: vi.fn(() => write.promise) });
  const { result } = renderHook(() => useTasks({ onRefreshEvents: vi.fn() }), { wrapper: wrapper(repository) });
  await waitFor(() => expect(result.current.tasks.status).toBe('ready'));
  act(() => { void result.current.setTaskCompleted(open, true); });
  expect(result.current.tasks.data.find(task => task.id === open.id)?.completed).toBe(true);
  expect(result.current.pendingTaskIds.has(open.id)).toBe(true);
  await act(() => write.resolve({ ...open, completed: true, updatedAt: 'server' }));
  expect(result.current.pendingTaskIds.has(open.id)).toBe(false);
  expect(result.current.tasks.data.find(task => task.id === open.id)?.updatedAt).toBe('server');
});

it('rolls back a failed completion and retries the original target', async () => {
  const setTaskCompleted = vi.fn()
    .mockRejectedValueOnce({ message: '完成状态保存失败' })
    .mockResolvedValueOnce({ ...open, completed: true, updatedAt: 'retry' });
  const repository = createRepository({ listTasks: vi.fn().mockResolvedValue([open]), setTaskCompleted });
  const { result } = renderHook(() => useTasks({ onRefreshEvents: vi.fn() }), { wrapper: wrapper(repository) });
  await waitFor(() => expect(result.current.tasks.status).toBe('ready'));
  await act(() => result.current.setTaskCompleted(open, true));
  expect(result.current.tasks.data[0].completed).toBe(false);
  expect(result.current.failedCompletion).toMatchObject({ taskId: open.id, targetCompleted: true });
  await act(() => result.current.retryFailedCompletion());
  expect(setTaskCompleted).toHaveBeenLastCalledWith(open.id, true);
  expect(result.current.tasks.data[0].completed).toBe(true);
  expect(result.current.failedCompletion).toBeNull();
});
```

- [ ] **Step 2: Add failing stale-intent tests**

Assert:

```tsx
await act(() => result.current.setTaskCompleted(open, true)); // fails and stores revision
await act(() => result.current.updateTask(open, changedDraft));
await act(() => result.current.retryFailedCompletion());
expect(setTaskCompleted).toHaveBeenCalledTimes(1);
expect(listTasks).toHaveBeenCalledTimes(3); // initial, update refresh, stale retry refresh
```

Add the equivalent delete case and a deferred old completion response that resolves after a newer successful write; the old response must not replace the newer entity.

- [ ] **Step 3: Verify RED**

```bash
npm test -- src/matrix/useTasks.test.tsx
```

Expected: completion tests fail because Task 7 left stubs.

- [ ] **Step 4: Implement revision-guarded optimistic state**

Use:

```ts
type FailedCompletion = {
  taskId: string;
  targetCompleted: boolean;
  revision: number;
  message: string;
};

const revisionsRef = useRef(new Map<string, number>());
const completionRequestRef = useRef(new Map<string, number>());
```

Rules:

- `nextRevision(id)` increments on every completion attempt and successful update/delete;
- reject duplicate completion while `pendingTaskIds` contains the ID;
- optimistic replace and `sortTasks` happen before awaiting;
- each request records its revision; only matching revisions may commit or rollback;
- failure restores the captured entity only if the revision still matches;
- retry verifies task existence and unchanged revision; otherwise clear intent and call `loadTasks`;
- retry uses the stored `targetCompleted`;
- `dismissTaskError` only clears `failedCompletion`;
- completion never calls `onRefreshEvents`.

- [ ] **Step 5: Verify GREEN and commit**

```bash
npm test -- src/matrix/useTasks.test.tsx
npm test

git add src/matrix/useTasks.ts src/matrix/useTasks.test.tsx
git commit -m "feature: recover failed task completion"
```

## Task 9: Build the compact task row and completion error UI

**Files:**
- Create: `src/matrix/TaskRow.tsx`
- Create: `src/matrix/TaskRow.test.tsx`
- Modify: `src/matrix/MatrixWidget.tsx`
- Modify: `src/matrix/MatrixWidget.test.tsx`
- Modify: `src/app/styles.css`

- [ ] **Step 1: Reread the authoritative UI specification**

```bash
# Read completely with the read tool, not cat:
design.md
```

Confirm no-motion, 28px Good controls, tooltip shadow, semantic token, focus, and overflow requirements before editing UI.

- [ ] **Step 2: Write failing TaskRow tests**

```tsx
it('renders a compact accessible two-line row and emits separate intents', async () => {
  const user = userEvent.setup();
  const onToggle = vi.fn(); const onOpen = vi.fn();
  render(<TaskRow task={open} events={[linkedEvent]} today={new Date(2026, 6, 23)} pending={false} onToggle={onToggle} onOpen={onOpen} />);
  expect(screen.getByText('今天到期 · 高优先级')).toBeInTheDocument();
  const checkbox = screen.getByRole('checkbox', { name: '完成任务：发布 Nowly' });
  await user.click(checkbox);
  expect(onToggle).toHaveBeenCalledWith(open, true);
  expect(onOpen).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: '编辑任务：发布 Nowly' }));
  expect(onOpen).toHaveBeenCalledWith(open, expect.any(HTMLElement));
});

it('shows an immediate hover/focus tooltip with complete metadata', async () => {
  const user = userEvent.setup();
  render(<TaskRow task={open} events={[linkedEvent]} pending={false} onToggle={vi.fn()} onOpen={vi.fn()} />);
  const title = screen.getByRole('button', { name: '编辑任务：发布 Nowly' });
  await user.hover(title);
  expect(screen.getByRole('tooltip')).toHaveTextContent('发布 Nowly');
  expect(screen.getByRole('tooltip')).toHaveTextContent('关联日程：设计评审');
  await user.unhover(title);
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  title.focus();
  expect(screen.getByRole('tooltip')).toBeInTheDocument();
});

it('announces completed and cross-month states without color alone', () => {
  render(<TaskRow task={{ ...open, completed:true, linkedEventId:'outside' }} events={[]} pending={false} onToggle={vi.fn()} onOpen={vi.fn()} />);
  expect(screen.getByText(/已完成/)).toBeInTheDocument();
  expect(screen.getByRole('tooltip')).toHaveTextContent('已关联其他月份日程');
  expect(screen.getByRole('checkbox', { name:/标记任务为未完成/ })).toBeChecked();
});
```

For the last test, focus the title before querying the tooltip.

- [ ] **Step 3: Write failing MatrixWidget error/retry/count tests**

Extend props with `events`, `pendingTaskIds`, `completionError`, `onRetryCompletion`, `onDismissCompletionError`, and `onToggleTask`. Assert quadrant counts, all four empty states, pending checkbox disablement, and:

```tsx
expect(screen.getByRole('alert')).toHaveTextContent('完成状态保存失败');
await user.click(screen.getByRole('button', { name:'重试完成状态' }));
expect(onRetryCompletion).toHaveBeenCalledOnce();
await user.click(screen.getByRole('button', { name:'关闭错误提示' }));
expect(onDismissCompletionError).toHaveBeenCalledOnce();
expect(screen.getByText('发布 Nowly')).toBeInTheDocument();
```

- [ ] **Step 4: Verify RED**

```bash
npm test -- src/matrix/TaskRow.test.tsx src/matrix/MatrixWidget.test.tsx
```

Expected: TaskRow module missing and MatrixWidget props/behavior absent.

- [ ] **Step 5: Implement semantic components**

`TaskRow` props:

```ts
type TaskRowProps = {
  task: MatrixTask;
  events: CalendarEvent[];
  today?: Date;
  pending: boolean;
  onToggle(task: MatrixTask, completed: boolean): void;
  onOpen(task: MatrixTask, trigger: HTMLElement): void;
};
```

Use native input structure:

```tsx
<div className={`task-row${task.completed ? ' task-row--completed' : ''}`}>
  <label className="form-check form-check-custom form-check-solid task-row__check">
    <input className="form-check-input" type="checkbox" checked={task.completed} disabled={pending}
      aria-label={task.completed ? `标记任务为未完成：${task.title}` : `完成任务：${task.title}`}
      onChange={event => onToggle(task, event.target.checked)} />
  </label>
  <div className="task-row__copy">
    <button type="button" className="task-row__title" aria-describedby={tooltipId}
      aria-label={`编辑任务：${task.title}`} onClick={event => onOpen(task, event.currentTarget)}
      onMouseEnter={() => setTooltipOpen(true)} onMouseLeave={() => setTooltipOpen(false)}
      onFocus={() => setTooltipOpen(true)} onBlur={() => setTooltipOpen(false)}>{task.title}</button>
    <span className="task-row__meta">{formatTaskMeta(task, today)}</span>
    {tooltipOpen ? (
      <span id={tooltipId} role="tooltip" className="task-tooltip">
        <strong>{task.title}</strong>
        <span>截止日期：{task.dueAt ?? '无截止日期'}</span>
        <span>优先级：{priorityLabels[task.priority]}</span>
        <span>关联日程：{linkedEvent?.title ?? (task.linkedEventId ? '已关联其他月份日程' : '未关联日程')}</span>
      </span>
    ) : null}
  </div>
</div>
```

`MatrixWidget` maps fixed `quadrantOrder`, renders a `.quadrant-head` with count, and keeps task data visible during a completion error.

- [ ] **Step 6: Add authoritative styles**

Replace `.quadrant-task` with semantic `.quadrant-head`, `.quadrant-count`, `.task-row`, `.task-row__check`, `.task-row__copy`, `.task-row__title`, `.task-row__meta`, `.task-row--completed`, and `.task-tooltip`. Use only existing tokens; add `--shadow-tooltip: 0 0 30px rgba(0,0,0,.15)` to `:root`. Tooltip is absolute, non-interactive, above the title, max-width constrained, and has no transition/animation.

Fix the current checkbox visual so checkbox and radio differ while preserving the Good structure: checkbox uses a CSS white check mark; radio uses a centered white dot. Do not use an SVG or icon to simulate either control.

- [ ] **Step 7: Verify GREEN and commit**

```bash
npm test -- src/matrix/TaskRow.test.tsx src/matrix/MatrixWidget.test.tsx
npm run build

git add src/matrix/TaskRow.tsx src/matrix/TaskRow.test.tsx src/matrix/MatrixWidget.tsx src/matrix/MatrixWidget.test.tsx src/app/styles.css
git commit -m "feature: add accessible quadrant task rows"
```

## Task 10: Build the controlled task editor workflow

**Files:**
- Create: `src/modals/TaskModal.test.tsx`
- Rewrite: `src/modals/TaskModal.tsx`
- Modify: `src/app/styles.css`

- [ ] **Step 1: Reread `design.md` completely**

Confirm modal, Radio, Checkbox, DatePicker, Select, no-motion, focus, and danger action requirements before changing TaskModal.

- [ ] **Step 2: Write failing create/default/validation tests**

Use this public API:

```ts
type TaskModalProps = {
  mode: { type:'create'; dueDate:string|null } | { type:'edit'; task:MatrixTask };
  events: CalendarEvent[];
  restoreFocusRef?: RefObject<HTMLElement | null>;
  onClose(): void;
  onSaved(task: MatrixTask, previousLinkedEventId: string|null): Promise<void> | void;
  onDeleted(task: MatrixTask): Promise<void> | void;
  createTask(draft: TaskDraft): Promise<MatrixTask>;
  updateTask(task: MatrixTask, draft: TaskDraft): Promise<MatrixTask>;
  deleteTask(task: MatrixTask): Promise<void>;
};
```

Tests must assert:

```tsx
expect(screen.getByRole('dialog', { name:'新建任务' })).toBeInTheDocument();
expect(screen.getByRole('radio', { name:'重要且紧急' })).toBeChecked();
expect(screen.getByRole('combobox', { name:'优先级' })).toHaveTextContent('中');
expect(screen.getByRole('button', { name:'截止日期' })).toHaveTextContent('2026 年 7 月 23 日');
expect(container.querySelector('input[type=date]')).toBeNull();
await user.click(screen.getByRole('button', { name:'保存任务' }));
expect(screen.getByText('请输入任务标题。')).toHaveAttribute('id', 'task-title-error');
expect(screen.getByLabelText('任务标题')).toHaveAttribute('aria-describedby', 'task-title-error');
```

Assert all four radios share one `name`, completed is a native checkbox, and create mode has no delete button.

- [ ] **Step 3: Add failing relation option and failed-save tests**

Cover current-month events, cross-month preservation, and server field mapping:

```tsx
renderTaskModal({ mode:{ type:'edit', task:{...task, linkedEventId:'outside'} }, events:[currentEvent] });
await user.click(screen.getByRole('combobox', { name:'关联日程' }));
expect(screen.getByRole('option', { name:'已关联其他月份日程' })).toBeInTheDocument();
await user.keyboard('{Escape}');
await user.clear(screen.getByLabelText('任务标题'));
await user.type(screen.getByLabelText('任务标题'), '保留草稿');
await user.click(screen.getByRole('button', { name:'保存任务' }));
await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('保存失败'));
expect(screen.getByLabelText('任务标题')).toHaveValue('保留草稿');
expect(screen.getByRole('dialog', { name:'编辑任务' })).toBeInTheDocument();
```

Also reject with `{code:'validation_error', field:'linkedEventId', message:'关联已变化'}` and assert a field error beneath the Select.

- [ ] **Step 4: Add failing dirty-close and permanent-delete tests**

Assert clean cancel closes directly; dirty cancel/Escape opens “放弃更改？”; delete confirmation uses exact task/event copy; Escape closes only confirmation; delete failure retains both dialogs; busy labels/disabled actions are static.

- [ ] **Step 5: Verify RED**

```bash
npm test -- src/modals/TaskModal.test.tsx
```

Expected: current presentation-only modal lacks controlled API and behavior.

- [ ] **Step 6: Implement the controlled form**

Compose `Dialog`, `ConfirmDialog`, `DatePicker`, and `Select`. Keep:

```ts
const [form, setForm] = useState<TaskFormDraft>(initial);
const [errors, setErrors] = useState<TaskFieldErrors>({});
const [dialogError, setDialogError] = useState('');
const [dateOpen, setDateOpen] = useState(false);
const [busy, setBusy] = useState(false);
const [confirm, setConfirm] = useState<'discard'|'delete'|null>(null);
```

Build event options exactly:

```ts
const eventOptions = [
  { value:'', label:'无关联' },
  ...(form.linkedEventId && !events.some(event => event.id === form.linkedEventId)
    ? [{ value:form.linkedEventId, label:'已关联其他月份日程' }]
    : []),
  ...events.map(event => ({ value:event.id, label:event.title }))
];
```

Save sequence: validate → busy → repository method → `onSaved(saved, oldLink)` → close. Delete sequence: confirmation → busy → repository delete → `onDeleted(task)` → close. Never close on rejection. Map camelCase repository fields to `TaskFieldErrors`.

- [ ] **Step 7: Add semantic task form styles**

Add `.task-dialog`, `.task-form`, `.task-quadrants`, `.task-dialog__actions`, and field grouping using existing tokens and exact `design.md` spacing. Reuse `.form-check*`, `.good-input`, `.good-button*`, `.field-error`, and `.dialog-error`; do not add utility-only layout or motion.

- [ ] **Step 8: Verify GREEN and commit**

```bash
npm test -- src/modals/TaskModal.test.tsx
npm run build

git add src/modals/TaskModal.tsx src/modals/TaskModal.test.tsx src/app/styles.css
git commit -m "feature: add task editor workflow"
```

## Task 11: Restore date-detail task creation

**Files:**
- Modify: `src/calendar/DateDetailDialog.tsx`
- Modify: `src/calendar/DateDetailDialog.test.tsx`

- [ ] **Step 1: Replace the stage-2 negative assertion with a failing intent test**

Add `onCreateTask: (date: string, trigger: HTMLElement) => void` and assert:

```tsx
const onCreateTask = vi.fn();
render(<DateDetailDialog {...props} onCreateTask={onCreateTask} />);
const button = screen.getByRole('button', { name:'新建任务' });
await user.click(button);
expect(onCreateTask).toHaveBeenCalledWith('2026-07-23', button);
expect(screen.getByRole('button', { name:'新建日程' })).toBeInTheDocument();
```

Update all existing render sites in the test with `onCreateTask={vi.fn()}`.

- [ ] **Step 2: Verify RED**

```bash
npm test -- src/calendar/DateDetailDialog.test.tsx
```

Expected: TypeScript prop failure and missing button.

- [ ] **Step 3: Implement the two-action footer**

```tsx
footer={
  <>
    <button type="button" className="good-button"
      onClick={event => onCreateTask(isoDate, event.currentTarget)}>新建任务</button>
    <button type="button" className="good-button good-button--primary"
      onClick={() => onCreateEvent(isoDate)}>新建日程</button>
  </>
}
```

No task summary/query is added.

- [ ] **Step 4: Verify GREEN and commit**

```bash
npm test -- src/calendar/DateDetailDialog.test.tsx

git add src/calendar/DateDetailDialog.tsx src/calendar/DateDetailDialog.test.tsx
git commit -m "feature: create tasks from date detail"
```

## Task 12: Integrate task modal routing and the event/task refresh bridge

**Files:**
- Modify: `src/lib/modal-store.ts`
- Modify: `src/modals/ModalRoot.tsx`
- Modify: `src/modals/ModalRoot.test.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/app/App.test.tsx`

- [ ] **Step 1: Write failing modal routing tests**

Replace `{type:'task'; task}` with:

```ts
| { type:'task-create'; dueDate:string|null; trigger:HTMLElement|null; parentDate?:string }
| { type:'task-edit'; task:MatrixTask; trigger:HTMLElement|null; parentDate?:string }
```

Extend ModalRoot operation props with task CRUD callbacks. Test:

```tsx
await user.click(screen.getByRole('button', { name:'新建任务' }));
expect(onChangeModal).toHaveBeenCalledWith(expect.objectContaining({
  type:'task-create', dueDate:'2026-07-23', parentDate:'2026-07-23'
}));

rerender(<ModalRoot {...base({ modal:{type:'task-create', dueDate:'2026-07-23', trigger:null, parentDate:'2026-07-23'} })} />);
expect(screen.getByRole('dialog', { name:/2026年7月23日/ })).toBeInTheDocument();
expect(screen.getByRole('dialog', { name:'新建任务' })).toBeInTheDocument();
await user.click(screen.getByRole('button', { name:'取消' }));
expect(onChangeModal).toHaveBeenCalledWith(expect.objectContaining({ type:'date', isoDate:'2026-07-23' }));
```

Also assert standalone task cancel calls `onClose`, and edit mode receives the task.

- [ ] **Step 2: Write failing App integration tests**

Cover:

- task read belongs to `useTasks` and only one `listTasks` occurs on startup;
- Header “新增任务” opens create mode with no due date;
- task title opens edit mode with its HTMLElement trigger;
- checkbox calls `setTaskCompleted` and does not open the modal;
- linked task save refreshes `listTasks` and `listEventsInRange`;
- unlinked ordinary edit refreshes tasks only;
- completion failure shows rollback error and retry invokes the same target;
- event relation changes still call the new `useTasks.retryTasks` bridge.

Use a deferred first `setTaskCompleted` rejection and second success for the retry assertion.

- [ ] **Step 3: Verify RED**

```bash
npm test -- src/modals/ModalRoot.test.tsx src/app/App.test.tsx
```

Expected: old task state, old TaskModal props, and bootstrap task ownership fail.

- [ ] **Step 4: Implement layered ModalRoot task routing**

Add task operations to ModalRoot and derive `parentDate` for both event and task children. Render DateDetailDialog below either child. Task cancellation returns to the date parent or closes standalone. Task save/delete callbacks must not close until `useTasks` refresh and any event refresh complete.

- [ ] **Step 5: Implement the stable cross-feature bridge in App**

Use stable callbacks and refs before constructing either hook:

```ts
const refreshTasksRef = useRef<() => Promise<unknown>>(async () => undefined);
const refreshEventsRef = useRef<() => Promise<unknown>>(async () => undefined);
const refreshTasks = useCallback(() => refreshTasksRef.current(), []);
const refreshEvents = useCallback(() => refreshEventsRef.current(), []);

const eventsFeature = useEvents({ onRefreshTasks: refreshTasks });
const tasksFeature = useTasks({ onRefreshEvents: refreshEvents });
refreshTasksRef.current = tasksFeature.retryTasks;
refreshEventsRef.current = eventsFeature.retryEvents;
```

Use `tasksFeature.tasks.data` everywhere tasks are rendered/resolved. Wire MatrixWidget completion/error props and explicit task-create/task-edit modal intents. Preserve the existing foreground-mode guard before opening any overlay.

- [ ] **Step 6: Verify GREEN and commit**

```bash
npm test -- src/modals/ModalRoot.test.tsx src/app/App.test.tsx src/app/useAppBootstrap.test.tsx
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml

git add src/app src/modals src/lib/modal-store.ts
git commit -m "feature: connect task vertical slice"
```

## Task 13: Add production task Playwright coverage

**Files:**
- Create: `tests/nowly-tasks.spec.ts`
- Modify: `tests/nowly-events.spec.ts`
- Modify: `tests/nowly-empty-startup.spec.ts`

- [ ] **Step 1: Create a stateful task IPC fixture**

Before page load, freeze the browser clock, then define events/tasks/settings and implement exact commands:

```ts
await page.clock.setFixedTime(new Date(2026, 6, 23, 9, 42));
```

Seed one current-month event named `设计评审` on `2026-07-23` so linking and deletion assertions are deterministic. The task handlers must use:

```ts
if (command === 'create_task') {
  const task = { id:`t${sequence++}`, ...args.draft, createdAt:now, updatedAt:now };
  if (task.linkedEventId) {
    tasks = tasks.map(item => item.linkedEventId === task.linkedEventId ? {...item, linkedEventId:null, updatedAt:now} : item);
    events = events.map(event => event.id === task.linkedEventId ? {...event, linkedTaskId:task.id, updatedAt:now} : event);
  }
  tasks.push(task);
  return task;
}
if (command === 'update_task') {
  const previous = tasks.find(task => task.id === args.id);
  if (!previous) throw { code:'not_found', message:'未找到该任务。' };
  events = events.map(event => event.linkedTaskId === args.id ? {...event, linkedTaskId:null, updatedAt:now} : event);
  tasks = tasks.map(task => task.id !== args.id && task.linkedEventId === args.draft.linkedEventId
    ? {...task, linkedEventId:null, updatedAt:now} : task);
  const updated = {...previous, ...args.draft, updatedAt:now};
  tasks = tasks.map(task => task.id === args.id ? updated : task);
  if (updated.linkedEventId) events = events.map(event => event.id === updated.linkedEventId ? {...event, linkedTaskId:updated.id, updatedAt:now} : event);
  return updated;
}
if (command === 'delete_task') {
  events = events.map(event => event.linkedTaskId === args.id ? {...event, linkedTaskId:null, updatedAt:now} : event);
  tasks = tasks.filter(task => task.id !== args.id);
  return null;
}
if (command === 'set_task_completed') {
  if (failNextCompletion) { failNextCompletion = false; throw { code:'database_error', message:'完成状态保存失败' }; }
  const task = tasks.find(task => task.id === args.id);
  if (!task) throw { code:'not_found', message:'未找到该任务。' };
  const updated = {...task, completed:args.completed, updatedAt:now};
  tasks = tasks.map(task => task.id === args.id ? updated : task);
  return updated;
}
```

Expose a test-only window function that sets `failNextCompletion = true`; it is fixture state only, never production API.

- [ ] **Step 2: Write task CRUD and date-detail tests**

```ts
test('creates from date detail, edits quadrant, links, and permanently deletes without deleting the event', async ({page}) => {
  const day = page.getByRole('button', { name:'2026年7月23日' });
  await day.click();
  await page.getByRole('button', { name:'新建任务' }).click();
  await expect(page.getByRole('button', { name:'截止日期' })).toContainText('23 日');
  await page.getByLabel('任务标题').fill('发布任务');
  await page.getByRole('radio', { name:'重要且紧急' }).check();
  await page.getByRole('combobox', { name:'关联日程' }).click();
  await page.getByRole('option', { name:'设计评审' }).click();
  await page.getByRole('button', { name:'保存任务' }).click();

  await page.getByRole('button', { name:'编辑任务：发布任务' }).click();
  await page.getByRole('radio', { name:'重要不紧急' }).check();
  await page.getByRole('button', { name:'保存任务' }).click();
  const quadrant = page.getByRole('region', { name:'重要不紧急' });
  await expect(quadrant.getByRole('button', { name:'编辑任务：发布任务' })).toBeVisible();

  await quadrant.getByRole('button', { name:'编辑任务：发布任务' }).click();
  await page.getByRole('button', { name:'删除任务' }).click();
  await expect(page.getByRole('dialog', { name:'永久删除“发布任务”？' })).toContainText('不删除关联日程');
  await page.getByRole('button', { name:'永久删除' }).click();
  await expect(page.getByRole('button', { name:'编辑任务：发布任务' })).toHaveCount(0);
  await expect(page.getByRole('button', { name:/设计评审/ })).toBeVisible();
});
```

Give each quadrant `<section>` an `aria-label` equal to its visible heading in Task 9 so the `region` locator is valid.

- [ ] **Step 3: Write completion rollback/retry and tooltip tests**

```ts
test('rolls back failed completion and retries the original target', async ({page}) => {
  await page.evaluate(() => (window as any).__NOWLY_FAIL_NEXT_COMPLETION__());
  const checkbox = page.getByRole('checkbox', { name:/完成任务：发布 Nowly/ });
  await checkbox.check();
  await expect(checkbox).not.toBeChecked();
  await expect(page.getByRole('alert')).toContainText('完成状态保存失败');
  await page.getByRole('button', { name:'重试完成状态' }).click();
  await expect(checkbox).toBeChecked();
  await expect(page.getByText(/已完成/)).toBeVisible();
});

test('shows complete task metadata by hover and keyboard focus', async ({page}) => {
  const title = page.getByRole('button', { name:/编辑任务：发布 Nowly/ });
  await title.hover();
  await expect(page.getByRole('tooltip')).toContainText('高优先级');
  await title.focus();
  await expect(page.getByRole('tooltip')).toContainText('关联日程');
});
```

- [ ] **Step 4: Update existing IPC fixtures**

Add `create_task`, `update_task`, `delete_task`, and `set_task_completed` branches to `tests/nowly-events.spec.ts`, because its date detail can open TaskModal after Task 12. Add the same four branches to `tests/nowly-empty-startup.spec.ts`; each must throw `new Error('Unexpected task write in empty-startup test')` so accidental writes fail deterministically. Keep all existing event and startup returns unchanged.

- [ ] **Step 5: Verify focused and full E2E**

```bash
npx playwright test tests/nowly-tasks.spec.ts
npx playwright test
```

Expected: task spec and all existing viewport/event/prototype suites pass.

- [ ] **Step 6: Commit**

```bash
git add tests/nowly-tasks.spec.ts tests/nowly-events.spec.ts tests/nowly-empty-startup.spec.ts
git commit -m "test: cover persisted task workflows"
```

## Task 14: Run stage gates, scan UI constraints, and review the stage

**Files:**
- Modify only if a failing gate produces a test-first fix in the owning file.

- [ ] **Step 1: Run all automated gates**

```bash
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
npx playwright test
git diff --check
```

Expected: all Vitest, TypeScript/Vite, Rust, and Playwright suites pass; diff check is silent.

- [ ] **Step 2: Run static forbidden-pattern scans**

```bash
rg -n "#009EF7|#181C32|#7E8299|transition:|animation:|scroll-behavior:\s*smooth|Spinner|spinner|Skeleton|skeleton" src tests
rg -n "<svg|😀|✅|❌|📅|📝|⚠️" src/matrix src/modals/TaskModal.tsx src/calendar/DateDetailDialog.tsx
rg -n "listTasks\(" src
```

Expected:

- no legacy blue, motion, spinner, or skeleton in changed production UI;
- no handwritten business SVG or Emoji in changed task UI;
- `listTasks()` appears only in `useTasks`, repository implementation/tests, and test fixtures—not App, widgets, dialogs, or bootstrap.

The global no-motion CSS declarations themselves are allowed scan matches; inspect and record them as intentional.

- [ ] **Step 3: Verify viewport and accessibility invariants manually from test output**

Confirm the Playwright matrix covers 1366×768, 1920×1080, 2560×1440 and the existing fourth viewport; no page-level scroll; internal quadrant/dialog scroll only; keyboard focus reaches checkbox, title, tooltip trigger, radios, Select, DatePicker, confirmation, and returns to the opening trigger.

- [ ] **Step 4: Request code review**

Invoke the `requesting-code-review` skill. Review the complete stage diff against:

- `docs/superpowers/specs/2026-07-29-nowly-tasks-design.md`;
- this implementation plan;
- root `design.md`;
- stage 1–2 contracts in the product roadmap.

Fix every blocking/high-confidence issue using a failing regression test first, rerun the owning focused suite, then rerun all gates.

- [ ] **Step 5: Commit review fixes when review changed files**

Stage each concrete regression test and its owning implementation file by exact path, verify with `git diff --cached --name-only`, then commit:

```bash
git diff --cached --name-only
git commit -m "fix: resolve task stage review findings"
```

When review finds no changes, record “no blocking findings” in the completion evidence and do not create an empty commit.

## Task 15: Record stage 3 completion

**Files:**
- Modify: `docs/superpowers/plans/2026-07-29-nowly-tasks.md`
- Modify: `docs/superpowers/plans/2026-07-29-nowly-windows-product-roadmap.md`
- Modify: `docs/00-index.md`

- [ ] **Step 1: Add actual completion evidence to this plan**

Insert a `## Completion status` table below the header with rows for 状态、React/Vitest、Rust、Playwright、构建与静态检查、审查、计划偏差. Copy the exact test-file/test counts and review result from the final command outputs. Write `无` for 计划偏差 only when execution matched the plan; otherwise list every concrete deviation. Do not enter projected counts or generic success claims.

- [ ] **Step 2: Update roadmap and index only after gates/review**

In the roadmap Overall status table set stage 3 to completed with the date, change stage 4 to the next stage, and append these stage-3 contracts:

- `useTasks` is the sole task read/write state owner;
- task ordering comparator is shared semantically between Rust and React;
- completion failure rolls back and stores a revision-guarded original-intent retry;
- task/event relinking remains Immediate and bidirectional;
- task relation changes refresh the current event month.

In `docs/00-index.md`, add the stage 3 design/plan links, completion status, and make stage 4 the next stage. Do not mark stage 4 started.

- [ ] **Step 3: Verify documentation diff and commit**

```bash
git diff --check
git status --short
git add -f docs/superpowers/plans/2026-07-29-nowly-tasks.md docs/superpowers/plans/2026-07-29-nowly-windows-product-roadmap.md docs/00-index.md
git commit -m "docs: record task stage completion"
```

- [ ] **Step 4: Confirm clean completion**

```bash
git status --short
git log -5 --oneline
```

Expected: clean working tree, stage 3 completion commit at HEAD, and stage 4 remains unplanned until the next approved design/plan cycle.
