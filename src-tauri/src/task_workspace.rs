use crate::db::AppDb;
use crate::error::CommandError;
use crate::models::{
    Task, TaskCollaborator, TaskCollaboratorDraft, TaskDraft, TaskLane, TaskLaneDraft, TaskTag,
    TaskTagDraft, TaskWorkspaceSnapshot,
};
use chrono::{NaiveDate, SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension, Row, Transaction, TransactionBehavior};
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
const VIEWS: &[&str] = &["kanban", "matrix", "calendar"];
const LINKING_KEY: &str = "task_view_linking_enabled";
const DEFAULT_LANE_KEY: &str = "default_task_lane_id";
const COMPLETION_LANE_KEY: &str = "completion_task_lane_id";
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
    transaction: &Transaction<'_>,
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

fn linking_enabled(connection: &Connection) -> Result<bool, CommandError> {
    read_setting(connection, LINKING_KEY, true)
}

fn default_lane_id(connection: &Connection) -> Result<String, CommandError> {
    read_setting(connection, DEFAULT_LANE_KEY, "kanban-lane-todo".to_owned())
}

fn completion_lane_id(connection: &Connection) -> Result<String, CommandError> {
    read_setting(
        connection,
        COMPLETION_LANE_KEY,
        "kanban-lane-done".to_owned(),
    )
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

fn read_collaborator(row: &Row<'_>) -> rusqlite::Result<TaskCollaborator> {
    Ok(TaskCollaborator {
        id: row.get(0)?,
        name: row.get(1)?,
        archived_at: row.get(2)?,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
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
        lane_id: row.get(6)?,
        board_position: row.get(7)?,
        tag_ids: Vec::new(),
        collaborator_ids: Vec::new(),
        linked_event_id: row.get(8)?,
        views: Vec::new(),
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
    task.collaborator_ids = connection
        .prepare(
            "SELECT collaborator_id FROM task_collaborator_links WHERE task_id=?1 ORDER BY collaborator_id",
        )
        .map_err(CommandError::database)?
        .query_map([&task.id], |row| row.get(0))
        .map_err(CommandError::database)?
        .collect::<rusqlite::Result<Vec<String>>>()
        .map_err(CommandError::database)?;
    task.views = connection
        .prepare(
            "SELECT view FROM task_view_memberships WHERE task_id=?1
             ORDER BY CASE view WHEN 'kanban' THEN 0 WHEN 'matrix' THEN 1 ELSE 2 END",
        )
        .map_err(CommandError::database)?
        .query_map([&task.id], |row| row.get(0))
        .map_err(CommandError::database)?
        .collect::<rusqlite::Result<Vec<String>>>()
        .map_err(CommandError::database)?;
    Ok(())
}

fn task_by_id(connection: &Connection, id: &str) -> Result<Option<Task>, CommandError> {
    let mut task = connection
        .query_row(
            "SELECT id,title,description,priority,due_date,completed,lane_id,board_position,
                    linked_event_id,created_at,updated_at
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
                    linked_event_id,created_at,updated_at
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

fn list_collaborators(connection: &Connection) -> Result<Vec<TaskCollaborator>, CommandError> {
    connection
        .prepare(
            "SELECT id,name,archived_at,created_at,updated_at
             FROM task_collaborators ORDER BY archived_at IS NOT NULL,name COLLATE NOCASE,id",
        )
        .map_err(CommandError::database)?
        .query_map([], read_collaborator)
        .map_err(CommandError::database)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(CommandError::database)
}

pub fn snapshot(connection: &Connection) -> Result<TaskWorkspaceSnapshot, CommandError> {
    Ok(TaskWorkspaceSnapshot {
        tasks: list_tasks(connection)?,
        lanes: list_lanes(connection)?,
        tags: list_tags(connection)?,
        collaborators: list_collaborators(connection)?,
        linking_enabled: linking_enabled(connection)?,
        default_lane_id: default_lane_id(connection)?,
        completion_lane_id: completion_lane_id(connection)?,
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

fn validate_view(view: &str) -> Result<(), CommandError> {
    if VIEWS.contains(&view) {
        Ok(())
    } else {
        Err(CommandError::validation("views", "请选择有效任务视图。"))
    }
}

fn normalize_views(views: &[String]) -> Result<Vec<String>, CommandError> {
    let mut unique = HashSet::new();
    let mut normalized = Vec::new();
    for view in views {
        validate_view(view)?;
        if unique.insert(view.clone()) {
            normalized.push(view.clone());
        }
    }
    if normalized.is_empty() {
        return Err(CommandError::validation(
            "views",
            "任务至少需要显示在一个视图中。",
        ));
    }
    normalized.sort_by_key(|view| {
        VIEWS
            .iter()
            .position(|candidate| candidate == view)
            .unwrap()
    });
    Ok(normalized)
}

fn validate_draft(mut draft: TaskDraft) -> Result<TaskDraft, CommandError> {
    draft.title = draft.title.trim().to_owned();
    if draft.title.is_empty() {
        return Err(CommandError::validation("title", "请输入任务标题。"));
    }
    if let Some(priority) = draft.priority.as_deref() {
        if !PRIORITIES.contains(&priority) {
            return Err(CommandError::validation("priority", "请选择有效优先分类。"));
        }
    }
    if let Some(due_date) = draft.due_date.as_deref() {
        if NaiveDate::parse_from_str(due_date, "%Y-%m-%d").is_err() {
            return Err(CommandError::validation("dueDate", "截止日期格式无效。"));
        }
    }
    if let Some(views) = draft.views.as_mut() {
        *views = normalize_views(views)?;
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

fn require_event(transaction: &Transaction<'_>, event_id: &str) -> Result<(), CommandError> {
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
    transaction: &Transaction<'_>,
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

fn next_position(connection: &Connection, lane_id: &str) -> Result<i64, CommandError> {
    connection
        .query_row(
            "SELECT COALESCE(MAX(board_position)+1,0) FROM tasks WHERE lane_id=?1",
            [lane_id],
            |row| row.get(0),
        )
        .map_err(CommandError::database)
}

fn renumber_lane(transaction: &Transaction<'_>, lane_id: &str) -> Result<(), CommandError> {
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
    transaction: &Transaction<'_>,
    task_id: &str,
    tag_ids: &[String],
    collaborator_ids: &[String],
) -> Result<(), CommandError> {
    require_ids(transaction, "task_tags", "tagIds", tag_ids)?;
    require_ids(
        transaction,
        "task_collaborators",
        "collaboratorIds",
        collaborator_ids,
    )?;
    transaction
        .execute("DELETE FROM task_tag_links WHERE task_id=?1", [task_id])
        .map_err(sql_write_error)?;
    transaction
        .execute(
            "DELETE FROM task_collaborator_links WHERE task_id=?1",
            [task_id],
        )
        .map_err(sql_write_error)?;
    for tag_id in tag_ids.iter().collect::<HashSet<_>>() {
        transaction
            .execute(
                "INSERT INTO task_tag_links(task_id,tag_id) VALUES (?1,?2)",
                params![task_id, tag_id],
            )
            .map_err(sql_write_error)?;
    }
    for collaborator_id in collaborator_ids.iter().collect::<HashSet<_>>() {
        transaction
            .execute(
                "INSERT INTO task_collaborator_links(task_id,collaborator_id) VALUES (?1,?2)",
                params![task_id, collaborator_id],
            )
            .map_err(sql_write_error)?;
    }
    Ok(())
}

fn membership(
    transaction: &Transaction<'_>,
    task_id: &str,
    view: &str,
    present: bool,
) -> Result<(), CommandError> {
    if present {
        transaction
            .execute(
                "INSERT OR IGNORE INTO task_view_memberships(task_id,view,position,created_at)
                 VALUES (?1,?2,NULL,strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
                params![task_id, view],
            )
            .map_err(sql_write_error)?;
    } else {
        transaction
            .execute(
                "DELETE FROM task_view_memberships WHERE task_id=?1 AND view=?2",
                params![task_id, view],
            )
            .map_err(sql_write_error)?;
    }
    Ok(())
}

fn task_structure(
    connection: &Connection,
    task_id: &str,
) -> Result<(Option<String>, Option<String>), CommandError> {
    connection
        .query_row(
            "SELECT priority,due_date FROM tasks WHERE id=?1",
            [task_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(CommandError::database)?
        .ok_or_else(|| CommandError::not_found("未找到该任务。"))
}

fn coordinate_memberships(
    transaction: &Transaction<'_>,
    task_id: &str,
) -> Result<(), CommandError> {
    let (priority, due_date) = task_structure(transaction, task_id)?;
    membership(transaction, task_id, "kanban", true)?;
    membership(transaction, task_id, "matrix", priority.is_some())?;
    membership(transaction, task_id, "calendar", due_date.is_some())?;
    Ok(())
}

fn prune_invalid_memberships(
    transaction: &Transaction<'_>,
    task_id: &str,
) -> Result<(), CommandError> {
    let (priority, due_date) = task_structure(transaction, task_id)?;
    if priority.is_none() {
        membership(transaction, task_id, "matrix", false)?;
    }
    if due_date.is_none() {
        membership(transaction, task_id, "calendar", false)?;
    }
    let count: i64 = transaction
        .query_row(
            "SELECT COUNT(*) FROM task_view_memberships WHERE task_id=?1",
            [task_id],
            |row| row.get(0),
        )
        .map_err(CommandError::database)?;
    if count == 0 {
        membership(transaction, task_id, "kanban", true)?;
    }
    Ok(())
}

fn set_memberships(
    transaction: &Transaction<'_>,
    task_id: &str,
    views: &[String],
) -> Result<(), CommandError> {
    let views = normalize_views(views)?;
    let (priority, due_date) = task_structure(transaction, task_id)?;
    if views.iter().any(|view| view == "matrix") && priority.is_none() {
        return Err(CommandError::validation(
            "views",
            "加入四象限前请先设置优先分类。",
        ));
    }
    if views.iter().any(|view| view == "calendar") && due_date.is_none() {
        return Err(CommandError::validation(
            "views",
            "加入日历前请先设置截止日期。",
        ));
    }
    transaction
        .execute(
            "DELETE FROM task_view_memberships WHERE task_id=?1",
            [task_id],
        )
        .map_err(sql_write_error)?;
    for view in views {
        membership(transaction, task_id, &view, true)?;
    }
    Ok(())
}

fn reconcile_memberships(transaction: &Transaction<'_>, task_id: &str) -> Result<(), CommandError> {
    if linking_enabled(transaction)? {
        coordinate_memberships(transaction, task_id)
    } else {
        prune_invalid_memberships(transaction, task_id)
    }
}

pub fn create(
    connection: &mut Connection,
    origin_view: &str,
    draft: TaskDraft,
) -> Result<Task, CommandError> {
    validate_view(origin_view)?;
    let draft = validate_draft(draft)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(CommandError::database)?;
    require_lane(&transaction, &draft.lane_id)?;
    require_ids(&transaction, "task_tags", "tagIds", &draft.tag_ids)?;
    require_ids(
        &transaction,
        "task_collaborators",
        "collaboratorIds",
        &draft.collaborator_ids,
    )?;
    if let Some(event_id) = draft.linked_event_id.as_deref() {
        require_event(&transaction, event_id)?;
    }
    let completion_lane = completion_lane_id(&transaction)?;
    let target_lane = if draft.completed {
        completion_lane.clone()
    } else {
        draft.lane_id.clone()
    };
    require_lane(&transaction, &target_lane)?;
    let completed = target_lane == completion_lane;
    let position = next_position(&transaction, &target_lane)?;
    let id = Uuid::new_v4().hyphenated().to_string();
    let now = timestamp();
    transaction
        .execute(
            "INSERT INTO tasks(id,title,description,priority,due_date,completed,lane_id,
                               board_position,linked_event_id,created_at,updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,NULL,?9,?9)",
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
    replace_task_links(&transaction, &id, &draft.tag_ids, &draft.collaborator_ids)?;
    if linking_enabled(&transaction)? {
        coordinate_memberships(&transaction, &id)?;
    } else if let Some(views) = draft.views.as_ref() {
        set_memberships(&transaction, &id, views)?;
    } else {
        let mut views = vec!["kanban".to_owned()];
        if origin_view != "kanban" {
            views.push(origin_view.to_owned());
        }
        set_memberships(&transaction, &id, &views)?;
    }
    let task = task_by_id(&transaction, &id)?
        .ok_or_else(|| CommandError::conflict("任务保存状态已变化，请重试。"))?;
    transaction.commit().map_err(sql_write_error)?;
    Ok(task)
}

pub fn update(
    connection: &mut Connection,
    id: &str,
    draft: TaskDraft,
) -> Result<Task, CommandError> {
    let draft = validate_draft(draft)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(CommandError::database)?;
    let existing =
        task_by_id(&transaction, id)?.ok_or_else(|| CommandError::not_found("未找到该任务。"))?;
    require_lane(&transaction, &draft.lane_id)?;
    let completion_lane = completion_lane_id(&transaction)?;
    let target_lane = if draft.completed {
        completion_lane.clone()
    } else if draft.lane_id == completion_lane {
        default_lane_id(&transaction)?
    } else {
        draft.lane_id.clone()
    };
    require_lane(&transaction, &target_lane)?;
    let completed = target_lane == completion_lane;
    let target_position = if target_lane == existing.lane_id {
        existing.board_position
    } else {
        next_position(&transaction, &target_lane)?
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
        renumber_lane(&transaction, &existing.lane_id)?;
        renumber_lane(&transaction, &target_lane)?;
    }
    replace_task_links(&transaction, id, &draft.tag_ids, &draft.collaborator_ids)?;
    if linking_enabled(&transaction)? {
        coordinate_memberships(&transaction, id)?;
    } else if let Some(views) = draft.views.as_ref() {
        set_memberships(&transaction, id, views)?;
    } else {
        prune_invalid_memberships(&transaction, id)?;
    }
    let task =
        task_by_id(&transaction, id)?.ok_or_else(|| CommandError::not_found("未找到该任务。"))?;
    transaction.commit().map_err(sql_write_error)?;
    Ok(task)
}

pub fn delete(connection: &mut Connection, id: &str) -> Result<(), CommandError> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(CommandError::database)?;
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
    renumber_lane(&transaction, &task.lane_id)?;
    transaction.commit().map_err(sql_write_error)
}

fn move_to_lane(
    connection: &mut Connection,
    id: &str,
    target_lane_id: &str,
    target_index: usize,
) -> Result<Task, CommandError> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(CommandError::database)?;
    require_lane(&transaction, target_lane_id)?;
    let task =
        task_by_id(&transaction, id)?.ok_or_else(|| CommandError::not_found("未找到该任务。"))?;
    let mut ids = transaction
        .prepare(
            "SELECT id FROM tasks WHERE lane_id=?1 AND id<>?2
             ORDER BY board_position,created_at,id",
        )
        .map_err(CommandError::database)?
        .query_map(params![target_lane_id, id], |row| row.get::<_, String>(0))
        .map_err(CommandError::database)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(CommandError::database)?;
    ids.insert(target_index.min(ids.len()), id.to_owned());
    let completion_lane = completion_lane_id(&transaction)?;
    let now = timestamp();
    transaction
        .execute(
            "UPDATE tasks SET lane_id=?2,completed=?3,updated_at=?4 WHERE id=?1",
            params![
                id,
                target_lane_id,
                i64::from(target_lane_id == completion_lane),
                now
            ],
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
    if task.lane_id != target_lane_id {
        renumber_lane(&transaction, &task.lane_id)?;
    }
    let moved =
        task_by_id(&transaction, id)?.ok_or_else(|| CommandError::not_found("未找到该任务。"))?;
    transaction.commit().map_err(sql_write_error)?;
    Ok(moved)
}

fn set_completed_value(
    connection: &mut Connection,
    id: &str,
    completed: bool,
) -> Result<Task, CommandError> {
    let lane = {
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(CommandError::database)?;
        if task_by_id(&transaction, id)?.is_none() {
            return Err(CommandError::not_found("未找到该任务。"));
        }
        let lane = if completed {
            completion_lane_id(&transaction)?
        } else {
            default_lane_id(&transaction)?
        };
        transaction.commit().map_err(sql_write_error)?;
        lane
    };
    let index = next_position(connection, &lane)? as usize;
    move_to_lane(connection, id, &lane, index)
}

fn update_priority(
    connection: &mut Connection,
    id: &str,
    priority: Option<String>,
) -> Result<Task, CommandError> {
    if let Some(priority) = priority.as_deref() {
        if !PRIORITIES.contains(&priority) {
            return Err(CommandError::validation("priority", "请选择有效优先分类。"));
        }
    }
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(CommandError::database)?;
    let affected = transaction
        .execute(
            "UPDATE tasks SET priority=?2,updated_at=?3 WHERE id=?1",
            params![id, priority, timestamp()],
        )
        .map_err(sql_write_error)?;
    if affected != 1 {
        return Err(CommandError::not_found("未找到该任务。"));
    }
    reconcile_memberships(&transaction, id)?;
    let task =
        task_by_id(&transaction, id)?.ok_or_else(|| CommandError::not_found("未找到该任务。"))?;
    transaction.commit().map_err(sql_write_error)?;
    Ok(task)
}

fn update_date(
    connection: &mut Connection,
    id: &str,
    due_date: Option<String>,
) -> Result<Task, CommandError> {
    if let Some(due_date) = due_date.as_deref() {
        if NaiveDate::parse_from_str(due_date, "%Y-%m-%d").is_err() {
            return Err(CommandError::validation("dueDate", "截止日期格式无效。"));
        }
    }
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(CommandError::database)?;
    let affected = transaction
        .execute(
            "UPDATE tasks SET due_date=?2,updated_at=?3 WHERE id=?1",
            params![id, due_date, timestamp()],
        )
        .map_err(sql_write_error)?;
    if affected != 1 {
        return Err(CommandError::not_found("未找到该任务。"));
    }
    reconcile_memberships(&transaction, id)?;
    let task =
        task_by_id(&transaction, id)?.ok_or_else(|| CommandError::not_found("未找到该任务。"))?;
    transaction.commit().map_err(sql_write_error)?;
    Ok(task)
}

fn set_task_memberships(
    connection: &mut Connection,
    id: &str,
    views: Vec<String>,
) -> Result<Task, CommandError> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(CommandError::database)?;
    if linking_enabled(&transaction)? {
        return Err(CommandError::conflict(
            "任务视图联动开启时不能手动修改显示视图。",
        ));
    }
    if task_by_id(&transaction, id)?.is_none() {
        return Err(CommandError::not_found("未找到该任务。"));
    }
    set_memberships(&transaction, id, &views)?;
    let task =
        task_by_id(&transaction, id)?.ok_or_else(|| CommandError::not_found("未找到该任务。"))?;
    transaction.commit().map_err(sql_write_error)?;
    Ok(task)
}

fn set_linking(
    connection: &mut Connection,
    enabled: bool,
) -> Result<TaskWorkspaceSnapshot, CommandError> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(CommandError::database)?;
    write_setting(&transaction, LINKING_KEY, &enabled)?;
    if enabled {
        let ids = transaction
            .prepare("SELECT id FROM tasks ORDER BY id")
            .map_err(CommandError::database)?
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(CommandError::database)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(CommandError::database)?;
        for id in ids {
            coordinate_memberships(&transaction, &id)?;
        }
    }
    transaction.commit().map_err(sql_write_error)?;
    snapshot(connection)
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
    connection: &mut Connection,
    draft: TaskLaneDraft,
) -> Result<TaskLane, CommandError> {
    let name = normalize_name(&draft.name, "name", "请输入泳道名称。")?;
    let color = normalize_color(&draft.color)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(CommandError::database)?;
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
    connection: &mut Connection,
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

fn delete_lane_value(
    connection: &mut Connection,
    id: &str,
    replacement_lane_id: Option<String>,
) -> Result<TaskWorkspaceSnapshot, CommandError> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(CommandError::database)?;
    require_lane(&transaction, id)?;
    let default_lane = default_lane_id(&transaction)?;
    let completion_lane = completion_lane_id(&transaction)?;
    let task_count: i64 = transaction
        .query_row("SELECT COUNT(*) FROM tasks WHERE lane_id=?1", [id], |row| {
            row.get(0)
        })
        .map_err(CommandError::database)?;
    let needs_replacement = task_count > 0 || id == default_lane || id == completion_lane;
    let replacement = if needs_replacement {
        let replacement = replacement_lane_id
            .ok_or_else(|| CommandError::validation("replacementLaneId", "请先选择替代泳道。"))?;
        if replacement == id {
            return Err(CommandError::validation(
                "replacementLaneId",
                "替代泳道不能是当前泳道。",
            ));
        }
        require_lane(&transaction, &replacement)?;
        Some(replacement)
    } else {
        replacement_lane_id
    };
    if let Some(replacement) = replacement.as_deref() {
        let offset = next_position(&transaction, replacement)?;
        transaction
            .execute(
                "UPDATE tasks SET lane_id=?2,board_position=board_position+?3,updated_at=?4
                 WHERE lane_id=?1",
                params![id, replacement, offset, timestamp()],
            )
            .map_err(sql_write_error)?;
        if id == default_lane {
            write_setting(&transaction, DEFAULT_LANE_KEY, &replacement.to_owned())?;
        }
        if id == completion_lane {
            write_setting(&transaction, COMPLETION_LANE_KEY, &replacement.to_owned())?;
        }
    }
    transaction
        .execute("DELETE FROM task_lanes WHERE id=?1", [id])
        .map_err(sql_write_error)?;
    let new_completion = completion_lane_id(&transaction)?;
    transaction
        .execute(
            "UPDATE tasks SET completed=CASE WHEN lane_id=?1 THEN 1 ELSE 0 END",
            [new_completion],
        )
        .map_err(sql_write_error)?;
    if let Some(replacement) = replacement.as_deref() {
        renumber_lane(&transaction, replacement)?;
    }
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
    connection: &mut Connection,
    ordered_ids: Vec<String>,
) -> Result<Vec<TaskLane>, CommandError> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(CommandError::database)?;
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
    connection: &mut Connection,
    key: &str,
    id: &str,
) -> Result<TaskWorkspaceSnapshot, CommandError> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(CommandError::database)?;
    require_lane(&transaction, id)?;
    write_setting(&transaction, key, &id.to_owned())?;
    if key == COMPLETION_LANE_KEY {
        transaction
            .execute(
                "UPDATE tasks SET completed=CASE WHEN lane_id=?1 THEN 1 ELSE 0 END,updated_at=?2",
                params![id, timestamp()],
            )
            .map_err(sql_write_error)?;
    }
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

fn create_tag_value(
    connection: &mut Connection,
    draft: TaskTagDraft,
) -> Result<TaskTag, CommandError> {
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
    connection: &mut Connection,
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
    connection: &mut Connection,
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

fn collaborator_by_id(
    connection: &Connection,
    id: &str,
) -> Result<Option<TaskCollaborator>, CommandError> {
    connection
        .query_row(
            "SELECT id,name,archived_at,created_at,updated_at
             FROM task_collaborators WHERE id=?1",
            [id],
            read_collaborator,
        )
        .optional()
        .map_err(CommandError::database)
}

fn create_collaborator_value(
    connection: &mut Connection,
    draft: TaskCollaboratorDraft,
) -> Result<TaskCollaborator, CommandError> {
    let name = normalize_name(&draft.name, "name", "请输入协作人名称。")?;
    if duplicate_name(connection, "task_collaborators", &name, None)? {
        return Err(CommandError::validation("name", "协作人名称已存在。"));
    }
    let id = Uuid::new_v4().hyphenated().to_string();
    let now = timestamp();
    connection
        .execute(
            "INSERT INTO task_collaborators(id,name,archived_at,created_at,updated_at)
             VALUES (?1,?2,NULL,?3,?3)",
            params![id, name, now],
        )
        .map_err(sql_write_error)?;
    collaborator_by_id(connection, &id)?
        .ok_or_else(|| CommandError::conflict("协作人保存失败，请重试。"))
}

fn update_collaborator_value(
    connection: &mut Connection,
    id: &str,
    draft: TaskCollaboratorDraft,
) -> Result<TaskCollaborator, CommandError> {
    let name = normalize_name(&draft.name, "name", "请输入协作人名称。")?;
    if duplicate_name(connection, "task_collaborators", &name, Some(id))? {
        return Err(CommandError::validation("name", "协作人名称已存在。"));
    }
    let affected = connection
        .execute(
            "UPDATE task_collaborators SET name=?2,updated_at=?3 WHERE id=?1",
            params![id, name, timestamp()],
        )
        .map_err(sql_write_error)?;
    if affected != 1 {
        return Err(CommandError::not_found("未找到该协作人。"));
    }
    collaborator_by_id(connection, id)?.ok_or_else(|| CommandError::not_found("未找到该协作人。"))
}

fn archive_collaborator_value(
    connection: &mut Connection,
    id: &str,
    archived: bool,
) -> Result<TaskCollaborator, CommandError> {
    let affected = connection
        .execute(
            "UPDATE task_collaborators SET archived_at=?2,updated_at=?3 WHERE id=?1",
            params![id, archived.then(timestamp), timestamp()],
        )
        .map_err(sql_write_error)?;
    if affected != 1 {
        return Err(CommandError::not_found("未找到该协作人。"));
    }
    collaborator_by_id(connection, id)?.ok_or_else(|| CommandError::not_found("未找到该协作人。"))
}

#[tauri::command]
pub fn get_task_workspace_snapshot(
    db: State<'_, AppDb>,
) -> Result<TaskWorkspaceSnapshot, CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    snapshot(&connection)
}

#[tauri::command]
pub fn create_task(
    db: State<'_, AppDb>,
    origin_view: String,
    draft: TaskDraft,
) -> Result<Task, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    create(&mut connection, &origin_view, draft)
}

#[tauri::command]
pub fn update_task(
    db: State<'_, AppDb>,
    id: String,
    draft: TaskDraft,
) -> Result<Task, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    update(&mut connection, &id, draft)
}

#[tauri::command]
pub fn delete_task(db: State<'_, AppDb>, id: String) -> Result<(), CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    delete(&mut connection, &id)
}

#[tauri::command]
pub fn set_task_completed(
    db: State<'_, AppDb>,
    id: String,
    completed: bool,
) -> Result<Task, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    set_completed_value(&mut connection, &id, completed)
}

#[tauri::command]
pub fn move_task_to_lane(
    db: State<'_, AppDb>,
    id: String,
    lane_id: String,
    target_index: usize,
) -> Result<Task, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    move_to_lane(&mut connection, &id, &lane_id, target_index)
}

#[tauri::command]
pub fn move_task_to_priority(
    db: State<'_, AppDb>,
    id: String,
    priority: Option<String>,
) -> Result<Task, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    update_priority(&mut connection, &id, priority)
}

#[tauri::command]
pub fn move_task_to_date(
    db: State<'_, AppDb>,
    id: String,
    due_date: Option<String>,
) -> Result<Task, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    update_date(&mut connection, &id, due_date)
}

#[tauri::command]
pub fn set_task_view_memberships(
    db: State<'_, AppDb>,
    id: String,
    views: Vec<String>,
) -> Result<Task, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    set_task_memberships(&mut connection, &id, views)
}

#[tauri::command]
pub fn set_task_view_linking(
    db: State<'_, AppDb>,
    enabled: bool,
) -> Result<TaskWorkspaceSnapshot, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    set_linking(&mut connection, enabled)
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
    replacement_lane_id: Option<String>,
) -> Result<TaskWorkspaceSnapshot, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    delete_lane_value(&mut connection, &id, replacement_lane_id)
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
pub fn set_completion_task_lane(
    db: State<'_, AppDb>,
    id: String,
) -> Result<TaskWorkspaceSnapshot, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    set_lane_setting(&mut connection, COMPLETION_LANE_KEY, &id)
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
pub fn create_task_collaborator(
    db: State<'_, AppDb>,
    draft: TaskCollaboratorDraft,
) -> Result<TaskCollaborator, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    create_collaborator_value(&mut connection, draft)
}

#[tauri::command]
pub fn update_task_collaborator(
    db: State<'_, AppDb>,
    id: String,
    draft: TaskCollaboratorDraft,
) -> Result<TaskCollaborator, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    update_collaborator_value(&mut connection, &id, draft)
}

#[tauri::command]
pub fn archive_task_collaborator(
    db: State<'_, AppDb>,
    id: String,
    archived: bool,
) -> Result<TaskCollaborator, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    archive_collaborator_value(&mut connection, &id, archived)
}

#[tauri::command]
pub fn delete_task_collaborator(db: State<'_, AppDb>, id: String) -> Result<(), CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    let affected = connection
        .execute("DELETE FROM task_collaborators WHERE id=?1", [id])
        .map_err(sql_write_error)?;
    if affected == 1 {
        Ok(())
    } else {
        Err(CommandError::not_found("未找到该协作人。"))
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
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(CommandError::database)?;
    write_setting(&transaction, VIEW_PREFERENCES_KEY, &preferences)?;
    transaction.commit().map_err(sql_write_error)?;
    snapshot(&connection)
}

#[cfg(test)]
mod tests {
    use super::{
        create, create_tag_value, set_linking, set_task_memberships, snapshot, update_priority,
    };
    use crate::db::migrate;
    use crate::models::{TaskDraft, TaskTagDraft};
    use rusqlite::Connection;

    fn database() -> Connection {
        let mut connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        migrate(&mut connection).unwrap();
        connection
    }

    fn draft() -> TaskDraft {
        TaskDraft {
            title: "  发布 Nowly  ".into(),
            description: "检查发布内容".into(),
            priority: Some("important_urgent".into()),
            due_date: Some("2026-08-26".into()),
            completed: false,
            lane_id: "kanban-lane-todo".into(),
            tag_ids: Vec::new(),
            collaborator_ids: Vec::new(),
            linked_event_id: None,
            views: None,
        }
    }

    #[test]
    fn fresh_workspace_has_defaults_and_linking_enabled() {
        let connection = database();
        let workspace = snapshot(&connection).unwrap();
        assert!(workspace.linking_enabled);
        assert_eq!(workspace.default_lane_id, "kanban-lane-todo");
        assert_eq!(workspace.completion_lane_id, "kanban-lane-done");
        assert_eq!(workspace.lanes.len(), 3);
        assert!(workspace.tasks.is_empty());
    }

    #[test]
    fn create_coordinates_all_eligible_views() {
        let mut connection = database();
        let task = create(&mut connection, "kanban", draft()).unwrap();
        assert_eq!(task.title, "发布 Nowly");
        assert_eq!(task.views, vec!["kanban", "matrix", "calendar"]);
        assert_eq!(task.priority.as_deref(), Some("important_urgent"));
        assert_eq!(task.due_date.as_deref(), Some("2026-08-26"));
    }

    #[test]
    fn disabled_linking_freezes_memberships_but_prunes_invalid_structure() {
        let mut connection = database();
        let task = create(&mut connection, "kanban", draft()).unwrap();
        set_linking(&mut connection, false).unwrap();

        let changed = update_priority(&mut connection, &task.id, None).unwrap();
        assert_eq!(changed.views, vec!["kanban", "calendar"]);

        let error = set_task_memberships(
            &mut connection,
            &task.id,
            vec!["kanban".into(), "matrix".into()],
        )
        .unwrap_err();
        assert_eq!(error.field.as_deref(), Some("views"));
    }

    #[test]
    fn reenabling_linking_rebuilds_memberships() {
        let mut connection = database();
        let task = create(&mut connection, "kanban", draft()).unwrap();
        set_linking(&mut connection, false).unwrap();
        set_task_memberships(&mut connection, &task.id, vec!["kanban".into()]).unwrap();
        let workspace = set_linking(&mut connection, true).unwrap();
        let task = workspace
            .tasks
            .iter()
            .find(|item| item.id == task.id)
            .unwrap();
        assert_eq!(task.views, vec!["kanban", "matrix", "calendar"]);
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
