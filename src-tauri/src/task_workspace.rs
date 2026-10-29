use crate::db::AppDb;
use crate::error::CommandError;
use crate::models::{
    Task, TaskDraft, TaskLane, TaskLaneDraft, TaskStep, TaskStepDraft, TaskTag, TaskTagDraft,
    TaskWorkspaceSnapshot,
};
use crate::write_scope::DomainWrite;
use chrono::{NaiveDate, SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use tauri::State;
use uuid::Uuid;

const PRIORITIES: &[&str] = &[
    "important_urgent",
    "important_not_urgent",
    "not_important_urgent",
    "not_important_not_urgent",
];
// Quadrant for tasks created without one (board quick add, assistant, etc.).
pub const DEFAULT_PRIORITY: &str = "not_important_not_urgent";
const DEFAULT_LANE_KEY: &str = "default_task_lane_id";
const VIEW_PREFERENCES_KEY: &str = "task_view_preferences";

fn timestamp() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn sql_write_error(error: rusqlite::Error) -> CommandError {
    match &error {
        rusqlite::Error::SqliteFailure(details, _)
            if details.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            eprintln!("task workspace constraint failed: {error}");
            CommandError::conflict("任务数据已变化，请重试。")
        }
        _ => CommandError::database(error),
    }
}

fn read_setting<T: DeserializeOwned>(
    connection: &Connection,
    key: &str,
    default: T,
) -> Result<T, CommandError> {
    let raw: Option<String> = connection
        .query_row("SELECT value FROM settings WHERE key=?1", [key], |row| {
            row.get(0)
        })
        .optional()
        .map_err(CommandError::database)?;
    match raw {
        Some(raw) => serde_json::from_str(&raw).map_err(CommandError::database),
        None => Ok(default),
    }
}

fn write_setting<T: Serialize>(
    transaction: &Connection,
    key: &str,
    value: &T,
) -> Result<(), CommandError> {
    let raw = serde_json::to_string(value).map_err(CommandError::database)?;
    transaction
        .execute(
            "INSERT INTO settings(key,value,updated_at)
             VALUES (?1,?2,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
             ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
            params![key, raw],
        )
        .map_err(sql_write_error)?;
    Ok(())
}

// The saved default when that lane still exists, else the first lane; None
// when the board has no lanes.
fn default_lane_id(connection: &Connection) -> Result<Option<String>, CommandError> {
    let saved: Option<String> = read_setting(connection, DEFAULT_LANE_KEY, None)?;
    connection
        .query_row(
            "SELECT id FROM task_lanes
             ORDER BY CASE WHEN id=?1 THEN 0 ELSE 1 END, position, id LIMIT 1",
            [saved],
            |row| row.get(0),
        )
        .optional()
        .map_err(CommandError::database)
}

fn view_preferences(connection: &Connection) -> Result<Value, CommandError> {
    read_setting(
        connection,
        VIEW_PREFERENCES_KEY,
        Value::Object(Default::default()),
    )
}

fn read_lane(row: &Row<'_>) -> rusqlite::Result<TaskLane> {
    Ok(TaskLane {
        id: row.get(0)?,
        name: row.get(1)?,
        color: row.get(2)?,
        position: row.get(3)?,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
    })
}

fn read_tag(row: &Row<'_>) -> rusqlite::Result<TaskTag> {
    Ok(TaskTag {
        id: row.get(0)?,
        name: row.get(1)?,
        color: row.get(2)?,
        archived_at: row.get(3)?,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
    })
}

fn read_task_base(row: &Row<'_>) -> rusqlite::Result<Task> {
    Ok(Task {
        id: row.get(0)?,
        title: row.get(1)?,
        description: row.get(2)?,
        priority: row.get(3)?,
        due_date: row.get(4)?,
        completed: row.get::<_, i64>(5)? == 1,
        completed_at: row.get(11)?,
        lane_id: row.get(6)?,
        board_position: row.get(7)?,
        tag_ids: Vec::new(),
        linked_event_id: row.get(8)?,
        steps: Vec::new(),
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

fn task_links(connection: &Connection, task: &mut Task) -> Result<(), CommandError> {
    task.tag_ids = connection
        .prepare("SELECT tag_id FROM task_tag_links WHERE task_id=?1 ORDER BY tag_id")
        .map_err(CommandError::database)?
        .query_map([&task.id], |row| row.get(0))
        .map_err(CommandError::database)?
        .collect::<rusqlite::Result<Vec<String>>>()
        .map_err(CommandError::database)?;
    task.steps = connection
        .prepare(
            "SELECT id,title,completed FROM task_steps WHERE task_id=?1
             ORDER BY position,created_at,id",
        )
        .map_err(CommandError::database)?
        .query_map([&task.id], |row| {
            Ok(TaskStep {
                id: row.get(0)?,
                title: row.get(1)?,
                completed: row.get::<_, i64>(2)? == 1,
            })
        })
        .map_err(CommandError::database)?
        .collect::<rusqlite::Result<Vec<TaskStep>>>()
        .map_err(CommandError::database)?;
    Ok(())
}

fn task_by_id(connection: &Connection, id: &str) -> Result<Option<Task>, CommandError> {
    let mut task = connection
        .query_row(
            "SELECT id,title,description,priority,due_date,completed,lane_id,board_position,
                    linked_event_id,created_at,updated_at,completed_at
             FROM tasks WHERE id=?1",
            [id],
            read_task_base,
        )
        .optional()
        .map_err(CommandError::database)?;
    if let Some(task) = task.as_mut() {
        task_links(connection, task)?;
    }
    Ok(task)
}

fn list_tasks(connection: &Connection) -> Result<Vec<Task>, CommandError> {
    let mut tasks = connection
        .prepare(
            "SELECT id,title,description,priority,due_date,completed,lane_id,board_position,
                    linked_event_id,created_at,updated_at,completed_at
             FROM tasks ORDER BY lane_id,board_position,id",
        )
        .map_err(CommandError::database)?
        .query_map([], read_task_base)
        .map_err(CommandError::database)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(CommandError::database)?;
    for task in &mut tasks {
        task_links(connection, task)?;
    }
    Ok(tasks)
}

fn list_lanes(connection: &Connection) -> Result<Vec<TaskLane>, CommandError> {
    connection
        .prepare(
            "SELECT id,name,color,position,created_at,updated_at
             FROM task_lanes ORDER BY position,id",
        )
        .map_err(CommandError::database)?
        .query_map([], read_lane)
        .map_err(CommandError::database)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(CommandError::database)
}

fn list_tags(connection: &Connection) -> Result<Vec<TaskTag>, CommandError> {
    connection
        .prepare(
            "SELECT id,name,color,archived_at,created_at,updated_at
             FROM task_tags ORDER BY archived_at IS NOT NULL,name COLLATE NOCASE,id",
        )
        .map_err(CommandError::database)?
        .query_map([], read_tag)
        .map_err(CommandError::database)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(CommandError::database)
}

pub fn snapshot(connection: &Connection) -> Result<TaskWorkspaceSnapshot, CommandError> {
    Ok(TaskWorkspaceSnapshot {
        tasks: list_tasks(connection)?,
        lanes: list_lanes(connection)?,
        tags: list_tags(connection)?,
        default_lane_id: default_lane_id(connection)?,
        view_preferences: view_preferences(connection)?,
    })
}

fn normalize_name(name: &str, field: &str, message: &str) -> Result<String, CommandError> {
    let name = name.trim().to_owned();
    if name.is_empty() {
        Err(CommandError::validation(field, message))
    } else {
        Ok(name)
    }
}

fn normalize_color(color: &str) -> Result<String, CommandError> {
    crate::color::normalize_hex(color)
        .ok_or_else(|| CommandError::validation("color", "请选择有效颜色。"))
}

fn normalize_priority(priority: Option<&str>) -> Result<String, CommandError> {
    match priority {
        None => Ok(DEFAULT_PRIORITY.to_owned()),
        Some(priority) if PRIORITIES.contains(&priority) => Ok(priority.to_owned()),
        Some(_) => Err(CommandError::validation("priority", "请选择有效优先分类。")),
    }
}

fn validate_draft(mut draft: TaskDraft) -> Result<TaskDraft, CommandError> {
    draft.title = draft.title.trim().to_owned();
    if draft.title.is_empty() {
        return Err(CommandError::validation("title", "请输入任务标题。"));
    }
    if let Some(steps) = draft.steps.as_mut() {
        for step in steps.iter_mut() {
            step.title = step.title.trim().to_owned();
            if step.title.is_empty() {
                return Err(CommandError::validation("steps", "请输入步骤内容。"));
            }
        }
    }
    draft.priority = Some(normalize_priority(draft.priority.as_deref())?);
    if let Some(due_date) = draft.due_date.as_deref() {
        if NaiveDate::parse_from_str(due_date, "%Y-%m-%d").is_err() {
            return Err(CommandError::validation("dueDate", "截止日期格式无效。"));
        }
    }
    Ok(draft)
}

fn require_lane(connection: &Connection, id: &str) -> Result<(), CommandError> {
    let exists: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM task_lanes WHERE id=?1)",
            [id],
            |row| row.get(0),
        )
        .map_err(CommandError::database)?;
    if exists {
        Ok(())
    } else {
        Err(CommandError::validation("laneId", "未找到所选泳道。"))
    }
}

fn require_ids(
    connection: &Connection,
    table: &str,
    field: &str,
    ids: &[String],
) -> Result<(), CommandError> {
    let mut seen = HashSet::new();
    for id in ids {
        if !seen.insert(id) {
            continue;
        }
        let sql = format!("SELECT EXISTS(SELECT 1 FROM {table} WHERE id=?1)");
        let exists: bool = connection
            .query_row(&sql, [id], |row| row.get(0))
            .map_err(CommandError::database)?;
        if !exists {
            return Err(CommandError::validation(field, "所选任务字段已不存在。"));
        }
    }
    Ok(())
}

fn require_event(transaction: &Connection, event_id: &str) -> Result<(), CommandError> {
    let exists: bool = transaction
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM events WHERE id=?1)",
            [event_id],
            |row| row.get(0),
        )
        .map_err(CommandError::database)?;
    if exists {
        Ok(())
    } else {
        Err(CommandError::validation(
            "linkedEventId",
            "未找到要关联的日程。",
        ))
    }
}

fn relink_event(
    transaction: &Connection,
    task_id: &str,
    old_event_id: Option<&str>,
    new_event_id: Option<&str>,
    updated_at: &str,
) -> Result<(), CommandError> {
    if old_event_id == new_event_id {
        return Ok(());
    }
    if let Some(event_id) = new_event_id {
        require_event(transaction, event_id)?;
    }
    if let Some(event_id) = old_event_id {
        transaction
            .execute(
                "UPDATE events SET linked_task_id=NULL,updated_at=?2
                 WHERE id=?1 AND linked_task_id=?3",
                params![event_id, updated_at, task_id],
            )
            .map_err(sql_write_error)?;
    }
    if let Some(event_id) = new_event_id {
        let displaced_task: Option<String> = transaction
            .query_row(
                "SELECT linked_task_id FROM events WHERE id=?1",
                [event_id],
                |row| row.get(0),
            )
            .map_err(CommandError::database)?;
        if let Some(displaced_task) = displaced_task {
            transaction
                .execute(
                    "UPDATE tasks SET linked_event_id=NULL,updated_at=?2 WHERE id=?1",
                    params![displaced_task, updated_at],
                )
                .map_err(sql_write_error)?;
        }
        transaction
            .execute(
                "UPDATE events SET linked_task_id=NULL,updated_at=?2
                 WHERE linked_task_id=?1 AND id<>?3",
                params![task_id, updated_at, event_id],
            )
            .map_err(sql_write_error)?;
        transaction
            .execute(
                "UPDATE events SET linked_task_id=?2,updated_at=?3 WHERE id=?1",
                params![event_id, task_id, updated_at],
            )
            .map_err(sql_write_error)?;
    }
    Ok(())
}

// Tasks off the board keep position 0.
fn next_position(connection: &Connection, lane_id: Option<&str>) -> Result<i64, CommandError> {
    let Some(lane_id) = lane_id else {
        return Ok(0);
    };
    connection
        .query_row(
            "SELECT COALESCE(MAX(board_position)+1,0) FROM tasks WHERE lane_id=?1",
            [lane_id],
            |row| row.get(0),
        )
        .map_err(CommandError::database)
}

fn renumber_lane(transaction: &Connection, lane_id: Option<&str>) -> Result<(), CommandError> {
    let Some(lane_id) = lane_id else {
        return Ok(());
    };
    let ids = transaction
        .prepare("SELECT id FROM tasks WHERE lane_id=?1 ORDER BY board_position,created_at,id")
        .map_err(CommandError::database)?
        .query_map([lane_id], |row| row.get::<_, String>(0))
        .map_err(CommandError::database)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(CommandError::database)?;
    for (position, id) in ids.iter().enumerate() {
        transaction
            .execute(
                "UPDATE tasks SET board_position=?2 WHERE id=?1",
                params![id, position as i64],
            )
            .map_err(sql_write_error)?;
    }
    Ok(())
}

fn replace_task_links(
    transaction: &Connection,
    task_id: &str,
    tag_ids: &[String],
) -> Result<(), CommandError> {
    require_ids(transaction, "task_tags", "tagIds", tag_ids)?;
    transaction
        .execute("DELETE FROM task_tag_links WHERE task_id=?1", [task_id])
        .map_err(sql_write_error)?;
    for tag_id in tag_ids.iter().collect::<HashSet<_>>() {
        transaction
            .execute(
                "INSERT INTO task_tag_links(task_id,tag_id) VALUES (?1,?2)",
                params![task_id, tag_id],
            )
            .map_err(sql_write_error)?;
    }
    Ok(())
}

// Replaces a task's steps in draft order. Ids the task owns keep their row and,
// when nothing changed, their timestamps; any other id (another task's, a
// repeat, or none) becomes a new step. Owned steps left out are deleted.
fn replace_task_steps(
    transaction: &Connection,
    task_id: &str,
    steps: &[TaskStepDraft],
    now: &str,
) -> Result<(), CommandError> {
    let owned = transaction
        .prepare("SELECT id FROM task_steps WHERE task_id=?1")
        .map_err(CommandError::database)?
        .query_map([task_id], |row| row.get(0))
        .map_err(CommandError::database)?
        .collect::<rusqlite::Result<HashSet<String>>>()
        .map_err(CommandError::database)?;
    let mut kept = HashSet::new();
    for (position, step) in steps.iter().enumerate() {
        let position = position as i64;
        let completed = i64::from(step.completed);
        match step.id.as_deref() {
            Some(id) if owned.contains(id) && kept.insert(id.to_owned()) => {
                transaction
                    .execute(
                        "UPDATE task_steps SET title=?2,completed=?3,position=?4,updated_at=?5
                         WHERE id=?1 AND (title<>?2 OR completed<>?3 OR position<>?4)",
                        params![id, step.title, completed, position, now],
                    )
                    .map_err(sql_write_error)?;
            }
            _ => {
                transaction
                    .execute(
                        "INSERT INTO task_steps(id,task_id,title,completed,position,created_at,updated_at)
                         VALUES (?1,?2,?3,?4,?5,?6,?6)",
                        params![
                            Uuid::new_v4().hyphenated().to_string(),
                            task_id,
                            step.title,
                            completed,
                            position,
                            now
                        ],
                    )
                    .map_err(sql_write_error)?;
            }
        }
    }
    for id in owned.difference(&kept) {
        transaction
            .execute("DELETE FROM task_steps WHERE id=?1", [id])
            .map_err(sql_write_error)?;
    }
    Ok(())
}

pub fn create(connection: &Connection, draft: TaskDraft) -> Result<Task, CommandError> {
    let draft = validate_draft(draft)?;
    let transaction = connection.domain_write().map_err(CommandError::database)?;
    if let Some(lane_id) = draft.lane_id.as_deref() {
        require_lane(&transaction, lane_id)?;
    }
    require_ids(&transaction, "task_tags", "tagIds", &draft.tag_ids)?;
    if let Some(event_id) = draft.linked_event_id.as_deref() {
        require_event(&transaction, event_id)?;
    }
    // Completion belongs to the task (the matrix checkbox), not to a lane.
    let target_lane = draft.lane_id.clone();
    let completed = draft.completed;
    let position = next_position(&transaction, target_lane.as_deref())?;
    let id = Uuid::new_v4().hyphenated().to_string();
    let now = timestamp();
    transaction
        .execute(
            "INSERT INTO tasks(id,title,description,priority,due_date,completed,lane_id,
                               board_position,linked_event_id,created_at,updated_at,completed_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,NULL,?9,?9,CASE WHEN ?6=1 THEN ?9 END)",
            params![
                id,
                draft.title,
                draft.description,
                draft.priority,
                draft.due_date,
                i64::from(completed),
                target_lane,
                position,
                now
            ],
        )
        .map_err(sql_write_error)?;
    relink_event(
        &transaction,
        &id,
        None,
        draft.linked_event_id.as_deref(),
        &now,
    )?;
    transaction
        .execute(
            "UPDATE tasks SET linked_event_id=?2 WHERE id=?1",
            params![id, draft.linked_event_id],
        )
        .map_err(sql_write_error)?;
    replace_task_links(&transaction, &id, &draft.tag_ids)?;
    if let Some(steps) = draft.steps.as_deref() {
        replace_task_steps(&transaction, &id, steps, &now)?;
    }
    let task = task_by_id(&transaction, &id)?
        .ok_or_else(|| CommandError::conflict("任务保存状态已变化，请重试。"))?;
    transaction.commit().map_err(sql_write_error)?;
    Ok(task)
}

pub fn update(connection: &Connection, id: &str, draft: TaskDraft) -> Result<Task, CommandError> {
    let draft = validate_draft(draft)?;
    let transaction = connection.domain_write().map_err(CommandError::database)?;
    let existing =
        task_by_id(&transaction, id)?.ok_or_else(|| CommandError::not_found("未找到该任务。"))?;
    if let Some(lane_id) = draft.lane_id.as_deref() {
        require_lane(&transaction, lane_id)?;
    }
    let target_lane = draft.lane_id.clone();
    let completed = draft.completed;
    let target_position = if target_lane == existing.lane_id {
        existing.board_position
    } else {
        next_position(&transaction, target_lane.as_deref())?
    };
    let now = timestamp();
    relink_event(
        &transaction,
        id,
        existing.linked_event_id.as_deref(),
        draft.linked_event_id.as_deref(),
        &now,
    )?;
    transaction
        .execute(
            "UPDATE tasks SET title=?2,description=?3,priority=?4,due_date=?5,
                    completed_at=CASE WHEN ?6=0 THEN NULL WHEN completed=1 THEN completed_at ELSE ?10 END,
                    completed=?6,lane_id=?7,board_position=?8,linked_event_id=?9,updated_at=?10
             WHERE id=?1",
            params![
                id,
                draft.title,
                draft.description,
                draft.priority,
                draft.due_date,
                i64::from(completed),
                target_lane,
                target_position,
                draft.linked_event_id,
                now
            ],
        )
        .map_err(sql_write_error)?;
    if target_lane != existing.lane_id {
        renumber_lane(&transaction, existing.lane_id.as_deref())?;
        renumber_lane(&transaction, target_lane.as_deref())?;
    }
    replace_task_links(&transaction, id, &draft.tag_ids)?;
    if let Some(steps) = draft.steps.as_deref() {
        replace_task_steps(&transaction, id, steps, &now)?;
    }
    let task =
        task_by_id(&transaction, id)?.ok_or_else(|| CommandError::not_found("未找到该任务。"))?;
    transaction.commit().map_err(sql_write_error)?;
    Ok(task)
}

pub fn delete(connection: &Connection, id: &str) -> Result<(), CommandError> {
    let transaction = connection.domain_write().map_err(CommandError::database)?;
    let task =
        task_by_id(&transaction, id)?.ok_or_else(|| CommandError::not_found("未找到该任务。"))?;
    if let Some(event_id) = task.linked_event_id.as_deref() {
        transaction
            .execute(
                "UPDATE events SET linked_task_id=NULL,updated_at=?2
                 WHERE id=?1 AND linked_task_id=?3",
                params![event_id, timestamp(), id],
            )
            .map_err(sql_write_error)?;
    }
    transaction
        .execute("DELETE FROM tasks WHERE id=?1", [id])
        .map_err(sql_write_error)?;
    renumber_lane(&transaction, task.lane_id.as_deref())?;
    transaction.commit().map_err(sql_write_error)
}

fn move_to_lane(
    connection: &Connection,
    id: &str,
    target_lane_id: &str,
    target_index: usize,
) -> Result<Task, CommandError> {
    let transaction = connection.domain_write().map_err(CommandError::database)?;
    require_lane(&transaction, target_lane_id)?;
    let task =
        task_by_id(&transaction, id)?.ok_or_else(|| CommandError::not_found("未找到该任务。"))?;
    // The board only shows open cards, so the index counts open cards; the
    // lane's completed tasks keep their relative order after them.
    let lane_ids = |completed: i64| -> Result<Vec<String>, CommandError> {
        transaction
            .prepare(
                "SELECT id FROM tasks WHERE lane_id=?1 AND id<>?2 AND completed=?3
                 ORDER BY board_position,created_at,id",
            )
            .map_err(CommandError::database)?
            .query_map(params![target_lane_id, id, completed], |row| row.get::<_, String>(0))
            .map_err(CommandError::database)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(CommandError::database)
    };
    let mut ids = lane_ids(0)?;
    ids.insert(target_index.min(ids.len()), id.to_owned());
    ids.extend(lane_ids(1)?);
    let now = timestamp();
    // Dropping a card into a lane means it is in progress again.
    transaction
        .execute(
            "UPDATE tasks SET lane_id=?2,completed=0,completed_at=NULL,updated_at=?3 WHERE id=?1",
            params![id, target_lane_id, now],
        )
        .map_err(sql_write_error)?;
    for (position, task_id) in ids.iter().enumerate() {
        transaction
            .execute(
                "UPDATE tasks SET board_position=?2 WHERE id=?1",
                params![task_id, position as i64],
            )
            .map_err(sql_write_error)?;
    }
    if task.lane_id.as_deref() != Some(target_lane_id) {
        renumber_lane(&transaction, task.lane_id.as_deref())?;
    }
    let moved =
        task_by_id(&transaction, id)?.ok_or_else(|| CommandError::not_found("未找到该任务。"))?;
    transaction.commit().map_err(sql_write_error)?;
    Ok(moved)
}

fn set_completed_value(
    connection: &Connection,
    id: &str,
    completed: bool,
) -> Result<Task, CommandError> {
    // The task keeps its lane so reopening returns it there, at the top.
    let transaction = connection.domain_write().map_err(CommandError::database)?;
    let existing =
        task_by_id(&transaction, id)?.ok_or_else(|| CommandError::not_found("未找到该任务。"))?;
    if existing.completed == completed {
        transaction.commit().map_err(sql_write_error)?;
        return Ok(existing);
    }
    let now = timestamp();
    transaction
        .execute(
            "UPDATE tasks SET completed=?2,completed_at=CASE WHEN ?2=1 THEN ?3 END,
                    board_position=CASE WHEN ?2=0 AND lane_id IS NOT NULL THEN -1 ELSE board_position END,
                    updated_at=?3
             WHERE id=?1",
            params![id, i64::from(completed), now],
        )
        .map_err(sql_write_error)?;
    if !completed {
        renumber_lane(&transaction, existing.lane_id.as_deref())?;
    }
    let task =
        task_by_id(&transaction, id)?.ok_or_else(|| CommandError::not_found("未找到该任务。"))?;
    transaction.commit().map_err(sql_write_error)?;
    Ok(task)
}

fn update_priority(
    connection: &Connection,
    id: &str,
    priority: Option<String>,
) -> Result<Task, CommandError> {
    let priority = normalize_priority(priority.as_deref())?;
    let transaction = connection.domain_write().map_err(CommandError::database)?;
    let affected = transaction
        .execute(
            "UPDATE tasks SET priority=?2,updated_at=?3 WHERE id=?1",
            params![id, priority, timestamp()],
        )
        .map_err(sql_write_error)?;
    if affected != 1 {
        return Err(CommandError::not_found("未找到该任务。"));
    }
    let task =
        task_by_id(&transaction, id)?.ok_or_else(|| CommandError::not_found("未找到该任务。"))?;
    transaction.commit().map_err(sql_write_error)?;
    Ok(task)
}

fn update_date(
    connection: &Connection,
    id: &str,
    due_date: Option<String>,
) -> Result<Task, CommandError> {
    if let Some(due_date) = due_date.as_deref() {
        if NaiveDate::parse_from_str(due_date, "%Y-%m-%d").is_err() {
            return Err(CommandError::validation("dueDate", "截止日期格式无效。"));
        }
    }
    let transaction = connection.domain_write().map_err(CommandError::database)?;
    let affected = transaction
        .execute(
            "UPDATE tasks SET due_date=?2,updated_at=?3 WHERE id=?1",
            params![id, due_date, timestamp()],
        )
        .map_err(sql_write_error)?;
    if affected != 1 {
        return Err(CommandError::not_found("未找到该任务。"));
    }
    let task =
        task_by_id(&transaction, id)?.ok_or_else(|| CommandError::not_found("未找到该任务。"))?;
    transaction.commit().map_err(sql_write_error)?;
    Ok(task)
}

fn lane_by_id(connection: &Connection, id: &str) -> Result<Option<TaskLane>, CommandError> {
    connection
        .query_row(
            "SELECT id,name,color,position,created_at,updated_at FROM task_lanes WHERE id=?1",
            [id],
            read_lane,
        )
        .optional()
        .map_err(CommandError::database)
}

fn create_lane_value(
    connection: &Connection,
    draft: TaskLaneDraft,
) -> Result<TaskLane, CommandError> {
    let name = normalize_name(&draft.name, "name", "请输入泳道名称。")?;
    let color = normalize_color(&draft.color)?;
    let transaction = connection.domain_write().map_err(CommandError::database)?;
    let position: i64 = transaction
        .query_row(
            "SELECT COALESCE(MAX(position)+1,0) FROM task_lanes",
            [],
            |row| row.get(0),
        )
        .map_err(CommandError::database)?;
    let id = Uuid::new_v4().hyphenated().to_string();
    let now = timestamp();
    transaction
        .execute(
            "INSERT INTO task_lanes(id,name,color,position,created_at,updated_at)
             VALUES (?1,?2,?3,?4,?5,?5)",
            params![id, name, color, position, now],
        )
        .map_err(sql_write_error)?;
    let lane = lane_by_id(&transaction, &id)?
        .ok_or_else(|| CommandError::conflict("泳道保存状态已变化，请重试。"))?;
    transaction.commit().map_err(sql_write_error)?;
    Ok(lane)
}

fn update_lane_value(
    connection: &Connection,
    id: &str,
    draft: TaskLaneDraft,
) -> Result<TaskLane, CommandError> {
    let name = normalize_name(&draft.name, "name", "请输入泳道名称。")?;
    let color = normalize_color(&draft.color)?;
    let affected = connection
        .execute(
            "UPDATE task_lanes SET name=?2,color=?3,updated_at=?4 WHERE id=?1",
            params![id, name, color, timestamp()],
        )
        .map_err(sql_write_error)?;
    if affected != 1 {
        return Err(CommandError::not_found("未找到该泳道。"));
    }
    lane_by_id(connection, id)?.ok_or_else(|| CommandError::not_found("未找到该泳道。"))
}

// The lane's tasks leave the board (they stay in the matrix); any lane,
// including the last one, can be deleted.
fn delete_lane_value(connection: &Connection, id: &str) -> Result<TaskWorkspaceSnapshot, CommandError> {
    let transaction = connection.domain_write().map_err(CommandError::database)?;
    require_lane(&transaction, id)?;
    transaction
        .execute(
            "UPDATE tasks SET lane_id=NULL,board_position=0,updated_at=?2 WHERE lane_id=?1",
            params![id, timestamp()],
        )
        .map_err(sql_write_error)?;
    transaction
        .execute("DELETE FROM task_lanes WHERE id=?1", [id])
        .map_err(sql_write_error)?;
    transaction
        .execute(
            "WITH ordered AS (
                SELECT id,row_number() OVER (ORDER BY position,id)-1 AS rn FROM task_lanes
             ) UPDATE task_lanes SET position=(SELECT rn FROM ordered WHERE ordered.id=task_lanes.id)",
            [],
        )
        .map_err(sql_write_error)?;
    transaction.commit().map_err(sql_write_error)?;
    snapshot(connection)
}

fn reorder_lanes_value(
    connection: &Connection,
    ordered_ids: Vec<String>,
) -> Result<Vec<TaskLane>, CommandError> {
    let transaction = connection.domain_write().map_err(CommandError::database)?;
    let existing = list_lanes(&transaction)?;
    let existing_ids: HashSet<String> = existing.into_iter().map(|lane| lane.id).collect();
    let ordered_set: HashSet<String> = ordered_ids.iter().cloned().collect();
    if ordered_ids.len() != ordered_set.len() || ordered_set != existing_ids {
        return Err(CommandError::validation(
            "orderedIds",
            "泳道排序数据不完整。",
        ));
    }
    let now = timestamp();
    for (position, id) in ordered_ids.iter().enumerate() {
        transaction
            .execute(
                "UPDATE task_lanes SET position=?2,updated_at=?3 WHERE id=?1",
                params![id, position as i64, now],
            )
            .map_err(sql_write_error)?;
    }
    transaction.commit().map_err(sql_write_error)?;
    list_lanes(connection)
}

fn set_lane_setting(
    connection: &Connection,
    key: &str,
    id: &str,
) -> Result<TaskWorkspaceSnapshot, CommandError> {
    let transaction = connection.domain_write().map_err(CommandError::database)?;
    require_lane(&transaction, id)?;
    write_setting(&transaction, key, &id.to_owned())?;
    transaction.commit().map_err(sql_write_error)?;
    snapshot(connection)
}

fn duplicate_name(
    connection: &Connection,
    table: &str,
    name: &str,
    excluding_id: Option<&str>,
) -> Result<bool, CommandError> {
    let sql = format!(
        "SELECT EXISTS(SELECT 1 FROM {table}
         WHERE lower(trim(name))=lower(trim(?1)) AND (?2 IS NULL OR id<>?2))"
    );
    connection
        .query_row(&sql, params![name, excluding_id], |row| row.get(0))
        .map_err(CommandError::database)
}

fn tag_by_id(connection: &Connection, id: &str) -> Result<Option<TaskTag>, CommandError> {
    connection
        .query_row(
            "SELECT id,name,color,archived_at,created_at,updated_at FROM task_tags WHERE id=?1",
            [id],
            read_tag,
        )
        .optional()
        .map_err(CommandError::database)
}

fn create_tag_value(connection: &Connection, draft: TaskTagDraft) -> Result<TaskTag, CommandError> {
    let name = normalize_name(&draft.name, "name", "请输入标签名称。")?;
    let color = normalize_color(&draft.color)?;
    if duplicate_name(connection, "task_tags", &name, None)? {
        return Err(CommandError::validation("name", "标签名称已存在。"));
    }
    let id = Uuid::new_v4().hyphenated().to_string();
    let now = timestamp();
    connection
        .execute(
            "INSERT INTO task_tags(id,name,color,archived_at,created_at,updated_at)
             VALUES (?1,?2,?3,NULL,?4,?4)",
            params![id, name, color, now],
        )
        .map_err(sql_write_error)?;
    tag_by_id(connection, &id)?.ok_or_else(|| CommandError::conflict("标签保存失败，请重试。"))
}

fn update_tag_value(
    connection: &Connection,
    id: &str,
    draft: TaskTagDraft,
) -> Result<TaskTag, CommandError> {
    let name = normalize_name(&draft.name, "name", "请输入标签名称。")?;
    let color = normalize_color(&draft.color)?;
    if duplicate_name(connection, "task_tags", &name, Some(id))? {
        return Err(CommandError::validation("name", "标签名称已存在。"));
    }
    let affected = connection
        .execute(
            "UPDATE task_tags SET name=?2,color=?3,updated_at=?4 WHERE id=?1",
            params![id, name, color, timestamp()],
        )
        .map_err(sql_write_error)?;
    if affected != 1 {
        return Err(CommandError::not_found("未找到该标签。"));
    }
    tag_by_id(connection, id)?.ok_or_else(|| CommandError::not_found("未找到该标签。"))
}

fn archive_tag_value(
    connection: &Connection,
    id: &str,
    archived: bool,
) -> Result<TaskTag, CommandError> {
    let affected = connection
        .execute(
            "UPDATE task_tags SET archived_at=?2,updated_at=?3 WHERE id=?1",
            params![id, archived.then(timestamp), timestamp()],
        )
        .map_err(sql_write_error)?;
    if affected != 1 {
        return Err(CommandError::not_found("未找到该标签。"));
    }
    tag_by_id(connection, id)?.ok_or_else(|| CommandError::not_found("未找到该标签。"))
}

#[tauri::command]
pub fn get_task_workspace_snapshot(
    db: State<'_, AppDb>,
) -> Result<TaskWorkspaceSnapshot, CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    snapshot(&connection)
}

#[tauri::command]
pub fn create_task(db: State<'_, AppDb>, draft: TaskDraft) -> Result<Task, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    let task = create(&mut connection, draft)?;
    drop(connection);
    crate::status_island::invalidate_registered()?;
    Ok(task)
}

#[tauri::command]
pub fn update_task(
    db: State<'_, AppDb>,
    id: String,
    draft: TaskDraft,
) -> Result<Task, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    let task = update(&mut connection, &id, draft)?;
    drop(connection);
    crate::status_island::invalidate_registered()?;
    Ok(task)
}

#[tauri::command]
pub fn delete_task(db: State<'_, AppDb>, id: String) -> Result<(), CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    delete(&mut connection, &id)?;
    drop(connection);
    crate::status_island::invalidate_registered()
}

#[tauri::command]
pub fn set_task_completed(
    db: State<'_, AppDb>,
    id: String,
    completed: bool,
) -> Result<Task, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    let task = set_completed_value(&mut connection, &id, completed)?;
    drop(connection);
    crate::status_island::invalidate_registered()?;
    Ok(task)
}

#[tauri::command]
pub fn move_task_to_lane(
    db: State<'_, AppDb>,
    id: String,
    lane_id: String,
    target_index: usize,
) -> Result<Task, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    let task = move_to_lane(&mut connection, &id, &lane_id, target_index)?;
    drop(connection);
    crate::status_island::invalidate_registered()?;
    Ok(task)
}

#[tauri::command]
pub fn move_task_to_priority(
    db: State<'_, AppDb>,
    id: String,
    priority: Option<String>,
) -> Result<Task, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    let task = update_priority(&mut connection, &id, priority)?;
    drop(connection);
    crate::status_island::invalidate_registered()?;
    Ok(task)
}

#[tauri::command]
pub fn move_task_to_date(
    db: State<'_, AppDb>,
    id: String,
    due_date: Option<String>,
) -> Result<Task, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    let task = update_date(&mut connection, &id, due_date)?;
    drop(connection);
    crate::status_island::invalidate_registered()?;
    Ok(task)
}

#[tauri::command]
pub fn create_task_lane(
    db: State<'_, AppDb>,
    draft: TaskLaneDraft,
) -> Result<TaskLane, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    create_lane_value(&mut connection, draft)
}

#[tauri::command]
pub fn update_task_lane(
    db: State<'_, AppDb>,
    id: String,
    draft: TaskLaneDraft,
) -> Result<TaskLane, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    update_lane_value(&mut connection, &id, draft)
}

#[tauri::command]
pub fn delete_task_lane(
    db: State<'_, AppDb>,
    id: String,
) -> Result<TaskWorkspaceSnapshot, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    let snapshot = delete_lane_value(&mut connection, &id)?;
    drop(connection);
    crate::status_island::invalidate_registered()?;
    Ok(snapshot)
}

#[tauri::command]
pub fn reorder_task_lanes(
    db: State<'_, AppDb>,
    ordered_ids: Vec<String>,
) -> Result<Vec<TaskLane>, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    reorder_lanes_value(&mut connection, ordered_ids)
}

#[tauri::command]
pub fn set_default_task_lane(
    db: State<'_, AppDb>,
    id: String,
) -> Result<TaskWorkspaceSnapshot, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    set_lane_setting(&mut connection, DEFAULT_LANE_KEY, &id)
}

#[tauri::command]
pub fn create_task_tag(db: State<'_, AppDb>, draft: TaskTagDraft) -> Result<TaskTag, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    create_tag_value(&mut connection, draft)
}

#[tauri::command]
pub fn update_task_tag(
    db: State<'_, AppDb>,
    id: String,
    draft: TaskTagDraft,
) -> Result<TaskTag, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    update_tag_value(&mut connection, &id, draft)
}

#[tauri::command]
pub fn archive_task_tag(
    db: State<'_, AppDb>,
    id: String,
    archived: bool,
) -> Result<TaskTag, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    archive_tag_value(&mut connection, &id, archived)
}

#[tauri::command]
pub fn delete_task_tag(db: State<'_, AppDb>, id: String) -> Result<(), CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    let affected = connection
        .execute("DELETE FROM task_tags WHERE id=?1", [id])
        .map_err(sql_write_error)?;
    if affected == 1 {
        Ok(())
    } else {
        Err(CommandError::not_found("未找到该标签。"))
    }
}

#[tauri::command]
pub fn set_task_view_preferences(
    db: State<'_, AppDb>,
    preferences: Value,
) -> Result<TaskWorkspaceSnapshot, CommandError> {
    if !preferences.is_object() {
        return Err(CommandError::validation(
            "preferences",
            "任务视图设置格式无效。",
        ));
    }
    let connection = db.0.lock().map_err(CommandError::database)?;
    let transaction = connection.domain_write().map_err(CommandError::database)?;
    write_setting(&transaction, VIEW_PREFERENCES_KEY, &preferences)?;
    transaction.commit().map_err(sql_write_error)?;
    snapshot(&connection)
}

#[cfg(test)]
mod tests {
    use super::{create, create_tag_value, snapshot};
    use crate::db::migrate;
    use crate::models::{TaskDraft, TaskStepDraft, TaskTagDraft};
    use rusqlite::Connection;

    fn bare_database() -> Connection {
        let mut connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        migrate(&mut connection).unwrap();
        connection
    }

    fn database() -> Connection {
        let connection = bare_database();
        crate::db::seed_test_lanes(&connection);
        connection
    }

    fn open_lane_order(connection: &Connection, lane: &str) -> Vec<String> {
        let mut tasks: Vec<_> = snapshot(connection).unwrap().tasks.into_iter()
            .filter(|task| task.lane_id.as_deref() == Some(lane) && !task.completed)
            .collect();
        tasks.sort_by_key(|task| task.board_position);
        tasks.into_iter().map(|task| task.title).collect()
    }

    fn draft() -> TaskDraft {
        TaskDraft {
            title: "  发布 Nowly  ".into(),
            description: "检查发布内容".into(),
            priority: Some("important_urgent".into()),
            due_date: Some("2026-08-26".into()),
            completed: false,
            lane_id: Some("kanban-lane-todo".into()),
            tag_ids: Vec::new(),
            linked_event_id: None,
            steps: None,
        }
    }

    fn step(id: Option<&str>, title: &str, completed: bool) -> TaskStepDraft {
        TaskStepDraft { id: id.map(str::to_owned), title: title.into(), completed }
    }

    fn stored(connection: &Connection, id: &str) -> crate::models::Task {
        snapshot(connection).unwrap().tasks.into_iter().find(|task| task.id == id).unwrap()
    }

    #[test]
    fn create_stores_trimmed_steps_in_order_with_fresh_ids() {
        let connection = database();
        let task = create(&connection, TaskDraft {
            steps: Some(vec![step(Some("client-id"), "  起草  ", false), step(None, "评审", true)]),
            ..draft()
        }).unwrap();
        let shape: Vec<_> = task.steps.iter().map(|s| (s.title.as_str(), s.completed)).collect();
        assert_eq!(shape, [("起草", false), ("评审", true)]);
        assert_ne!(task.steps[0].id, "client-id");
        assert_ne!(task.steps[0].id, task.steps[1].id);
        assert_eq!(stored(&connection, &task.id).steps, task.steps);
    }

    #[test]
    fn update_reorders_keeps_owned_ids_and_drops_removed_steps() {
        let connection = database();
        let task = create(&connection, TaskDraft {
            steps: Some(vec![step(None, "一", false), step(None, "二", false), step(None, "三", false)]),
            ..draft()
        }).unwrap();
        let (one, two, three) = (task.steps[0].id.clone(), task.steps[1].id.clone(), task.steps[2].id.clone());
        let updated = super::update(&connection, &task.id, TaskDraft {
            steps: Some(vec![step(Some(&three), "三", true), step(None, "四", false), step(Some(&one), "一", false)]),
            ..draft()
        }).unwrap();
        assert_eq!(updated.steps[0].id, three);
        assert!(updated.steps[0].completed);
        assert_eq!(updated.steps[1].title, "四");
        assert!(![&one, &two, &three].contains(&&updated.steps[1].id));
        assert_eq!(updated.steps[2].id, one);
        let kept: bool = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM task_steps WHERE id=?1)", [&two], |row| row.get(0),
        ).unwrap();
        assert!(!kept);
    }

    #[test]
    fn update_without_steps_keeps_them_and_unchanged_steps_keep_timestamps() {
        let connection = database();
        let task = create(&connection, TaskDraft {
            steps: Some(vec![step(None, "一", false), step(None, "二", true)]),
            ..draft()
        }).unwrap();
        connection.execute("UPDATE task_steps SET updated_at='before'", []).unwrap();
        let renamed = super::update(&connection, &task.id, TaskDraft { title: "改名".into(), ..draft() }).unwrap();
        assert_eq!(renamed.steps, task.steps);
        let same = task.steps.iter().map(|s| step(Some(&s.id), &s.title, s.completed)).collect();
        super::update(&connection, &task.id, TaskDraft { steps: Some(same), ..draft() }).unwrap();
        let stamps: Vec<String> = connection.prepare("SELECT updated_at FROM task_steps ORDER BY position")
            .unwrap().query_map([], |row| row.get(0)).unwrap()
            .collect::<rusqlite::Result<_>>().unwrap();
        assert_eq!(stamps, ["before", "before"]);
    }

    #[test]
    fn foreign_and_repeated_step_ids_become_new_steps() {
        let connection = database();
        let other = create(&connection, TaskDraft {
            steps: Some(vec![step(None, "别人的", false)]), ..draft()
        }).unwrap();
        let task = create(&connection, TaskDraft {
            steps: Some(vec![step(None, "自己的", false)]), ..draft()
        }).unwrap();
        let (own, foreign) = (task.steps[0].id.clone(), other.steps[0].id.clone());
        let updated = super::update(&connection, &task.id, TaskDraft {
            steps: Some(vec![step(Some(&own), "一", false), step(Some(&own), "二", false), step(Some(&foreign), "三", false)]),
            ..draft()
        }).unwrap();
        assert_eq!(updated.steps[0].id, own);
        assert_ne!(updated.steps[1].id, own);
        assert_ne!(updated.steps[2].id, foreign);
        assert_eq!(stored(&connection, &other.id).steps, other.steps);
    }

    #[test]
    fn blank_step_title_is_rejected_before_writing() {
        let connection = database();
        let error = create(&connection, TaskDraft {
            steps: Some(vec![step(None, "一", false), step(None, "   ", false)]), ..draft()
        }).unwrap_err();
        assert_eq!(error.field.as_deref(), Some("steps"));
        assert_eq!(error.message, "请输入步骤内容。");
        assert!(snapshot(&connection).unwrap().tasks.is_empty());
    }

    #[test]
    fn deleting_a_task_removes_its_steps() {
        let connection = database();
        let task = create(&connection, TaskDraft {
            steps: Some(vec![step(None, "一", false)]), ..draft()
        }).unwrap();
        super::delete(&connection, &task.id).unwrap();
        let count: i64 = connection.query_row("SELECT COUNT(*) FROM task_steps", [], |row| row.get(0)).unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn fresh_workspace_has_no_lanes() {
        let connection = bare_database();
        let workspace = snapshot(&connection).unwrap();
        assert_eq!(workspace.default_lane_id, None);
        assert!(workspace.lanes.is_empty());
        assert!(workspace.tasks.is_empty());
    }

    #[test]
    fn create_keeps_the_chosen_quadrant() {
        let connection = database();
        let task = create(&connection, draft()).unwrap();
        assert_eq!(task.title, "发布 Nowly");
        assert_eq!(task.priority, "important_urgent");
        assert_eq!(task.due_date.as_deref(), Some("2026-08-26"));
    }

    #[test]
    fn missing_quadrant_defaults_to_not_important_not_urgent() {
        let connection = database();
        let task = create(&connection, TaskDraft { priority: None, ..draft() }).unwrap();
        assert_eq!(task.priority, super::DEFAULT_PRIORITY);
        let moved = super::update_priority(&connection, &task.id, Some("important_urgent".into())).unwrap();
        assert_eq!(moved.priority, "important_urgent");
        let cleared = super::update_priority(&connection, &task.id, None).unwrap();
        assert_eq!(cleared.priority, super::DEFAULT_PRIORITY);
    }

    #[test]
    fn unknown_quadrant_is_rejected() {
        let connection = database();
        let error = create(&connection, TaskDraft { priority: Some("later".into()), ..draft() }).unwrap_err();
        assert_eq!(error.field.as_deref(), Some("priority"));
    }

    #[test]
    fn completing_records_time_and_reopening_returns_to_the_lane_top() {
        let connection = database();
        create(&connection, TaskDraft { title: "一".into(), ..draft() }).unwrap();
        let first = create(&connection, TaskDraft { title: "二".into(), ..draft() }).unwrap();
        let done = super::set_completed_value(&connection, &first.id, true).unwrap();
        assert!(done.completed);
        assert!(done.completed_at.is_some());
        assert_eq!(done.lane_id.as_deref(), Some("kanban-lane-todo"));
        create(&connection, TaskDraft { title: "三".into(), ..draft() }).unwrap();
        let again = super::set_completed_value(&connection, &first.id, true).unwrap();
        assert_eq!(again.completed_at, done.completed_at);
        let reopened = super::set_completed_value(&connection, &first.id, false).unwrap();
        assert!(!reopened.completed);
        assert_eq!(reopened.completed_at, None);
        assert_eq!(reopened.lane_id.as_deref(), Some("kanban-lane-todo"));
        assert_eq!(open_lane_order(&connection, "kanban-lane-todo"), ["二", "一", "三"]);
    }

    #[test]
    fn moving_into_a_lane_reopens_and_counts_only_open_cards() {
        let connection = database();
        let a = create(&connection, TaskDraft { title: "A".into(), ..draft() }).unwrap();
        let done = create(&connection, TaskDraft { title: "完成".into(), completed: true, ..draft() }).unwrap();
        create(&connection, TaskDraft { title: "B".into(), ..draft() }).unwrap();
        assert!(done.completed_at.is_some());
        let off_board = create(&connection, TaskDraft { title: "C".into(), lane_id: None, ..draft() }).unwrap();
        super::move_to_lane(&connection, &off_board.id, "kanban-lane-todo", 1).unwrap();
        assert_eq!(open_lane_order(&connection, "kanban-lane-todo"), ["A", "C", "B"]);
        let moved = super::move_to_lane(&connection, &done.id, "kanban-lane-doing", 0).unwrap();
        assert!(!moved.completed);
        assert_eq!(moved.completed_at, None);
        assert_eq!(stored(&connection, &a.id).board_position, 0);
    }

    #[test]
    fn editing_keeps_the_original_completion_time() {
        let connection = database();
        let task = create(&connection, TaskDraft { completed: true, ..draft() }).unwrap();
        connection.execute("UPDATE tasks SET completed_at='earlier'", []).unwrap();
        let edited = super::update(&connection, &task.id, TaskDraft { title: "改名".into(), completed: true, ..draft() }).unwrap();
        assert_eq!(edited.completed_at.as_deref(), Some("earlier"));
        let reopened = super::update(&connection, &task.id, TaskDraft { completed: false, ..draft() }).unwrap();
        assert_eq!(reopened.completed_at, None);
    }

    #[test]
    fn deleting_a_lane_sends_its_tasks_off_the_board() {
        let connection = database();
        let task = create(&connection, TaskDraft { completed: true, ..draft() }).unwrap();
        let after = super::delete_lane_value(&connection, "kanban-lane-todo").unwrap();
        let stored = after.tasks.iter().find(|t| t.id == task.id).unwrap();
        assert_eq!(stored.lane_id, None);
        assert!(stored.completed);
        assert_eq!(after.default_lane_id.as_deref(), Some("kanban-lane-doing"));
        super::delete_lane_value(&connection, "kanban-lane-doing").unwrap();
        let last = super::delete_lane_value(&connection, "kanban-lane-done").unwrap();
        assert!(last.lanes.is_empty());
        assert_eq!(last.default_lane_id, None);
        assert_eq!(last.tasks.len(), 1);
    }
    #[test]
    fn tasks_without_a_lane_stay_off_the_board() {
        let connection = database();
        let on_board = create(&connection, draft()).unwrap();
        let off_board = create(&connection, TaskDraft { lane_id: None, ..draft() }).unwrap();
        assert_eq!(off_board.lane_id, None);
        assert_eq!(off_board.board_position, 0);
        let edited = super::update(&connection, &off_board.id, TaskDraft {
            title: "改名".into(), lane_id: None, ..draft()
        }).unwrap();
        assert_eq!(edited.lane_id, None);
        let placed = super::move_to_lane(&connection, &off_board.id, "kanban-lane-todo", 0).unwrap();
        assert_eq!(placed.lane_id.as_deref(), Some("kanban-lane-todo"));
        assert_eq!(placed.board_position, 0);
        assert_eq!(stored(&connection, &on_board.id).board_position, 1);
        let removed = super::update(&connection, &off_board.id, TaskDraft { lane_id: None, ..draft() }).unwrap();
        assert_eq!(removed.lane_id, None);
        assert_eq!(stored(&connection, &on_board.id).board_position, 0);
        super::delete(&connection, &removed.id).unwrap();
        assert_eq!(snapshot(&connection).unwrap().tasks.len(), 1);
    }

    #[test]
    fn tag_names_are_case_insensitively_unique() {
        let mut connection = database();
        create_tag_value(
            &mut connection,
            TaskTagDraft {
                name: "发布".into(),
                color: "#4FC9DA".into(),
            },
        )
        .unwrap();
        let error = create_tag_value(
            &mut connection,
            TaskTagDraft {
                name: " 发布 ".into(),
                color: "#B8D935".into(),
            },
        )
        .unwrap_err();
        assert_eq!(error.field.as_deref(), Some("name"));
    }
}
