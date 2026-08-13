use crate::db::AppDb;
use crate::error::CommandError;
use crate::models::{
    KanbanCard, KanbanCardDraft, KanbanCollaborator, KanbanCollaboratorDraft, KanbanLane,
    KanbanLaneDraft, KanbanPriority, KanbanPriorityDraft, KanbanSnapshot, KanbanTag, KanbanTagDraft,
};
use chrono::{NaiveDate, SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension, Row, Transaction, TransactionBehavior};
use tauri::State;
use uuid::Uuid;

fn timestamp() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn require_color(color: &str) -> Result<String, CommandError> {
    crate::color::normalize_hex(color)
        .ok_or_else(|| CommandError::validation("color", "请选择有效颜色。"))
}

fn normalize_name(name: &str, message: &'static str) -> Result<String, CommandError> {
    let trimmed = name.trim().to_owned();
    if trimmed.is_empty() {
        Err(CommandError::validation("name", message))
    } else {
        Ok(trimmed)
    }
}

fn sql_write_error(error: rusqlite::Error) -> CommandError {
    match &error {
        rusqlite::Error::SqliteFailure(details, _)
            if details.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            eprintln!("kanban constraint failed: {error}");
            CommandError::conflict("看板数据已变化，请重试。")
        }
        _ => CommandError::database(error),
    }
}

// --- Snapshot ---------------------------------------------------------------

fn read_lane(row: &Row<'_>) -> rusqlite::Result<KanbanLane> {
    Ok(KanbanLane {
        id: row.get(0)?,
        name: row.get(1)?,
        color: row.get(2)?,
        position: row.get(3)?,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
    })
}

fn read_priority(row: &Row<'_>) -> rusqlite::Result<KanbanPriority> {
    Ok(KanbanPriority {
        id: row.get(0)?,
        name: row.get(1)?,
        color: row.get(2)?,
        position: row.get(3)?,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
    })
}

fn read_tag(row: &Row<'_>) -> rusqlite::Result<KanbanTag> {
    Ok(KanbanTag {
        id: row.get(0)?,
        name: row.get(1)?,
        color: row.get(2)?,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
    })
}

fn read_collaborator(row: &Row<'_>) -> rusqlite::Result<KanbanCollaborator> {
    Ok(KanbanCollaborator {
        id: row.get(0)?,
        name: row.get(1)?,
        created_at: row.get(2)?,
        updated_at: row.get(3)?,
    })
}

pub fn snapshot(connection: &Connection) -> Result<KanbanSnapshot, CommandError> {
    let lanes = connection
        .prepare("SELECT id,name,color,position,created_at,updated_at FROM kanban_lanes ORDER BY position ASC,id ASC")
        .map_err(CommandError::database)?
        .query_map([], read_lane)
        .map_err(CommandError::database)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(CommandError::database)?;

    let priorities = connection
        .prepare("SELECT id,name,color,position,created_at,updated_at FROM kanban_priorities ORDER BY position ASC,id ASC")
        .map_err(CommandError::database)?
        .query_map([], read_priority)
        .map_err(CommandError::database)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(CommandError::database)?;

    let tags = connection
        .prepare("SELECT id,name,color,created_at,updated_at FROM kanban_tags ORDER BY name ASC,id ASC")
        .map_err(CommandError::database)?
        .query_map([], read_tag)
        .map_err(CommandError::database)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(CommandError::database)?;

    let collaborators = connection
        .prepare("SELECT id,name,created_at,updated_at FROM kanban_collaborators ORDER BY name ASC,id ASC")
        .map_err(CommandError::database)?
        .query_map([], read_collaborator)
        .map_err(CommandError::database)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(CommandError::database)?;

    let cards = load_cards(connection)?;

    Ok(KanbanSnapshot {
        lanes,
        cards,
        priorities,
        tags,
        collaborators,
    })
}

fn load_cards(connection: &Connection) -> Result<Vec<KanbanCard>, CommandError> {
    let mut cards = connection
        .prepare(
            "SELECT id,lane_id,title,description,due_date,priority_id,position,created_at,updated_at
             FROM kanban_cards ORDER BY lane_id ASC,position ASC,id ASC",
        )
        .map_err(CommandError::database)?
        .query_map([], |row| {
            Ok(KanbanCard {
                id: row.get(0)?,
                lane_id: row.get(1)?,
                title: row.get(2)?,
                description: row.get(3)?,
                due_date: row.get(4)?,
                priority_id: row.get(5)?,
                position: row.get(6)?,
                tag_ids: Vec::new(),
                collaborator_ids: Vec::new(),
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        })
        .map_err(CommandError::database)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(CommandError::database)?;

    for card in &mut cards {
        card.tag_ids = connection
            .prepare("SELECT tag_id FROM kanban_card_tags WHERE card_id=?1 ORDER BY tag_id ASC")
            .map_err(CommandError::database)?
            .query_map([&card.id], |row| row.get::<_, String>(0))
            .map_err(CommandError::database)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(CommandError::database)?;
        card.collaborator_ids = connection
            .prepare("SELECT collaborator_id FROM kanban_card_collaborators WHERE card_id=?1 ORDER BY collaborator_id ASC")
            .map_err(CommandError::database)?
            .query_map([&card.id], |row| row.get::<_, String>(0))
            .map_err(CommandError::database)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(CommandError::database)?;
    }
    Ok(cards)
}

// --- Lanes ------------------------------------------------------------------

fn next_lane_position(transaction: &Transaction<'_>) -> Result<i64, CommandError> {
    transaction
        .query_row(
            "SELECT COALESCE(MAX(position)+1,0) FROM kanban_lanes",
            [],
            |row| row.get(0),
        )
        .map_err(CommandError::database)
}

fn lane_by_id(connection: &Connection, id: &str) -> Result<Option<KanbanLane>, CommandError> {
    connection
        .query_row(
            "SELECT id,name,color,position,created_at,updated_at FROM kanban_lanes WHERE id=?1",
            [id],
            read_lane,
        )
        .optional()
        .map_err(CommandError::database)
}

pub fn create_lane(
    connection: &mut Connection,
    draft: KanbanLaneDraft,
) -> Result<KanbanLane, CommandError> {
    let name = normalize_name(&draft.name, "请输入泳道名称。")?;
    require_color(&draft.color)?;
    let id = format!("kanban-lane-{}", Uuid::new_v4().hyphenated());
    let now = timestamp();
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(CommandError::database)?;
    let position = next_lane_position(&transaction)?;
    transaction
        .execute(
            "INSERT INTO kanban_lanes(id,name,color,position,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?5)",
            params![id, name, draft.color, position, now],
        )
        .map_err(sql_write_error)?;
    let lane = lane_by_id(&transaction, &id)?
        .ok_or_else(|| CommandError::conflict("泳道保存状态已变化，请重试。"))?;
    transaction.commit().map_err(sql_write_error)?;
    Ok(lane)
}

pub fn update_lane(
    connection: &mut Connection,
    id: &str,
    draft: KanbanLaneDraft,
) -> Result<KanbanLane, CommandError> {
    let name = normalize_name(&draft.name, "请输入泳道名称。")?;
    require_color(&draft.color)?;
    let now = timestamp();
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(CommandError::database)?;
    let affected = transaction
        .execute(
            "UPDATE kanban_lanes SET name=?2,color=?3,updated_at=?4 WHERE id=?1",
            params![id, name, draft.color, now],
        )
        .map_err(sql_write_error)?;
    if affected != 1 {
        return Err(CommandError::not_found("未找到该泳道。"));
    }
    let lane = lane_by_id(&transaction, id)?
        .ok_or_else(|| CommandError::not_found("未找到该泳道。"))?;
    transaction.commit().map_err(sql_write_error)?;
    Ok(lane)
}

pub fn delete_lane(connection: &mut Connection, id: &str) -> Result<(), CommandError> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(CommandError::database)?;
    // Cards and their tag / collaborator links cascade via foreign keys.
    let affected = transaction
        .execute("DELETE FROM kanban_lanes WHERE id=?1", [id])
        .map_err(sql_write_error)?;
    if affected != 1 {
        return Err(CommandError::not_found("未找到该泳道。"));
    }
    renumber_lanes(&transaction)?;
    transaction.commit().map_err(sql_write_error)
}

fn renumber_lanes(transaction: &Transaction<'_>) -> Result<(), CommandError> {
    let ids = transaction
        .prepare("SELECT id FROM kanban_lanes ORDER BY position ASC,id ASC")
        .map_err(CommandError::database)?
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(CommandError::database)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(CommandError::database)?;
    for (index, id) in ids.iter().enumerate() {
        transaction
            .execute(
                "UPDATE kanban_lanes SET position=?2 WHERE id=?1",
                params![id, index as i64],
            )
            .map_err(sql_write_error)?;
    }
    Ok(())
}

pub fn reorder_lanes(
    connection: &mut Connection,
    ordered_ids: &[String],
) -> Result<Vec<KanbanLane>, CommandError> {
    let now = timestamp();
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(CommandError::database)?;
    let existing = transaction
        .prepare("SELECT id FROM kanban_lanes")
        .map_err(CommandError::database)?
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(CommandError::database)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(CommandError::database)?;
    require_same_set(&existing, ordered_ids, "泳道顺序无效。")?;
    for (index, id) in ordered_ids.iter().enumerate() {
        transaction
            .execute(
                "UPDATE kanban_lanes SET position=?2,updated_at=?3 WHERE id=?1",
                params![id, index as i64, now],
            )
            .map_err(sql_write_error)?;
    }
    let lanes = transaction
        .prepare("SELECT id,name,color,position,created_at,updated_at FROM kanban_lanes ORDER BY position ASC,id ASC")
        .map_err(CommandError::database)?
        .query_map([], read_lane)
        .map_err(CommandError::database)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(CommandError::database)?;
    transaction.commit().map_err(sql_write_error)?;
    Ok(lanes)
}

fn require_same_set(
    existing: &[String],
    provided: &[String],
    message: &'static str,
) -> Result<(), CommandError> {
    if existing.len() != provided.len() {
        return Err(CommandError::validation("order", message));
    }
    let mut a = existing.to_vec();
    let mut b = provided.to_vec();
    a.sort();
    b.sort();
    b.dedup();
    if a.len() != b.len() || a != b {
        return Err(CommandError::validation("order", message));
    }
    Ok(())
}

// --- Cards ------------------------------------------------------------------

fn require_lane(transaction: &Transaction<'_>, lane_id: &str) -> Result<(), CommandError> {
    let exists: bool = transaction
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM kanban_lanes WHERE id=?1)",
            [lane_id],
            |row| row.get(0),
        )
        .map_err(CommandError::database)?;
    if exists {
        Ok(())
    } else {
        Err(CommandError::validation("laneId", "未找到该泳道。"))
    }
}

fn validate_card_relations(
    transaction: &Transaction<'_>,
    draft: &KanbanCardDraft,
) -> Result<(), CommandError> {
    if let Some(priority_id) = draft.priority_id.as_deref() {
        let exists: bool = transaction
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM kanban_priorities WHERE id=?1)",
                [priority_id],
                |row| row.get(0),
            )
            .map_err(CommandError::database)?;
        if !exists {
            return Err(CommandError::validation("priorityId", "未找到该优先级。"));
        }
    }
    for tag_id in &draft.tag_ids {
        let exists: bool = transaction
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM kanban_tags WHERE id=?1)",
                [tag_id],
                |row| row.get(0),
            )
            .map_err(CommandError::database)?;
        if !exists {
            return Err(CommandError::validation("tagIds", "未找到该标签。"));
        }
    }
    for collaborator_id in &draft.collaborator_ids {
        let exists: bool = transaction
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM kanban_collaborators WHERE id=?1)",
                [collaborator_id],
                |row| row.get(0),
            )
            .map_err(CommandError::database)?;
        if !exists {
            return Err(CommandError::validation(
                "collaboratorIds",
                "未找到该协作人。",
            ));
        }
    }
    Ok(())
}

fn normalize_card(mut draft: KanbanCardDraft) -> Result<KanbanCardDraft, CommandError> {
    draft.title = draft.title.trim().to_owned();
    if draft.title.is_empty() {
        return Err(CommandError::validation("title", "请输入任务标题。"));
    }
    draft.description = match draft.description {
        Some(text) => {
            let trimmed = text.trim().to_owned();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        }
        None => None,
    };
    if let Some(due_date) = draft.due_date.as_deref() {
        if NaiveDate::parse_from_str(due_date, "%Y-%m-%d").is_err() {
            return Err(CommandError::validation("dueDate", "截止日期格式无效。"));
        }
    }
    // Deduplicate multi-select relations so the join tables stay clean.
    draft.tag_ids.sort();
    draft.tag_ids.dedup();
    draft.collaborator_ids.sort();
    draft.collaborator_ids.dedup();
    Ok(draft)
}

fn card_by_id(connection: &Connection, id: &str) -> Result<Option<KanbanCard>, CommandError> {
    let card = connection
        .query_row(
            "SELECT id,lane_id,title,description,due_date,priority_id,position,created_at,updated_at
             FROM kanban_cards WHERE id=?1",
            [id],
            |row| {
                Ok(KanbanCard {
                    id: row.get(0)?,
                    lane_id: row.get(1)?,
                    title: row.get(2)?,
                    description: row.get(3)?,
                    due_date: row.get(4)?,
                    priority_id: row.get(5)?,
                    position: row.get(6)?,
                    tag_ids: Vec::new(),
                    collaborator_ids: Vec::new(),
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            },
        )
        .optional()
        .map_err(CommandError::database)?;
    let Some(mut card) = card else {
        return Ok(None);
    };
    card.tag_ids = connection
        .prepare("SELECT tag_id FROM kanban_card_tags WHERE card_id=?1 ORDER BY tag_id ASC")
        .map_err(CommandError::database)?
        .query_map([id], |row| row.get::<_, String>(0))
        .map_err(CommandError::database)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(CommandError::database)?;
    card.collaborator_ids = connection
        .prepare("SELECT collaborator_id FROM kanban_card_collaborators WHERE card_id=?1 ORDER BY collaborator_id ASC")
        .map_err(CommandError::database)?
        .query_map([id], |row| row.get::<_, String>(0))
        .map_err(CommandError::database)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(CommandError::database)?;
    Ok(Some(card))
}

fn write_card_links(
    transaction: &Transaction<'_>,
    card_id: &str,
    draft: &KanbanCardDraft,
) -> Result<(), CommandError> {
    transaction
        .execute("DELETE FROM kanban_card_tags WHERE card_id=?1", [card_id])
        .map_err(sql_write_error)?;
    transaction
        .execute(
            "DELETE FROM kanban_card_collaborators WHERE card_id=?1",
            [card_id],
        )
        .map_err(sql_write_error)?;
    for tag_id in &draft.tag_ids {
        transaction
            .execute(
                "INSERT INTO kanban_card_tags(card_id,tag_id) VALUES (?1,?2)",
                params![card_id, tag_id],
            )
            .map_err(sql_write_error)?;
    }
    for collaborator_id in &draft.collaborator_ids {
        transaction
            .execute(
                "INSERT INTO kanban_card_collaborators(card_id,collaborator_id) VALUES (?1,?2)",
                params![card_id, collaborator_id],
            )
            .map_err(sql_write_error)?;
    }
    Ok(())
}

pub fn create_card(
    connection: &mut Connection,
    draft: KanbanCardDraft,
) -> Result<KanbanCard, CommandError> {
    let draft = normalize_card(draft)?;
    let id = format!("kanban-card-{}", Uuid::new_v4().hyphenated());
    let now = timestamp();
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(CommandError::database)?;
    require_lane(&transaction, &draft.lane_id)?;
    validate_card_relations(&transaction, &draft)?;
    let position: i64 = transaction
        .query_row(
            "SELECT COALESCE(MAX(position)+1,0) FROM kanban_cards WHERE lane_id=?1",
            [&draft.lane_id],
            |row| row.get(0),
        )
        .map_err(CommandError::database)?;
    transaction
        .execute(
            "INSERT INTO kanban_cards(id,lane_id,title,description,due_date,priority_id,position,created_at,updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?8)",
            params![id, draft.lane_id, draft.title, draft.description, draft.due_date, draft.priority_id, position, now],
        )
        .map_err(sql_write_error)?;
    write_card_links(&transaction, &id, &draft)?;
    let card = card_by_id(&transaction, &id)?
        .ok_or_else(|| CommandError::conflict("任务保存状态已变化，请重试。"))?;
    transaction.commit().map_err(sql_write_error)?;
    Ok(card)
}

pub fn update_card(
    connection: &mut Connection,
    id: &str,
    draft: KanbanCardDraft,
) -> Result<KanbanCard, CommandError> {
    let draft = normalize_card(draft)?;
    let now = timestamp();
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(CommandError::database)?;
    let exists: bool = transaction
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM kanban_cards WHERE id=?1)",
            [id],
            |row| row.get(0),
        )
        .map_err(CommandError::database)?;
    if !exists {
        return Err(CommandError::not_found("未找到该任务。"));
    }
    validate_card_relations(&transaction, &draft)?;
    // Editing keeps the card in place; lane / position moves go through move.
    let affected = transaction
        .execute(
            "UPDATE kanban_cards SET title=?2,description=?3,due_date=?4,priority_id=?5,updated_at=?6 WHERE id=?1",
            params![id, draft.title, draft.description, draft.due_date, draft.priority_id, now],
        )
        .map_err(sql_write_error)?;
    if affected != 1 {
        return Err(CommandError::not_found("未找到该任务。"));
    }
    write_card_links(&transaction, id, &draft)?;
    let card = card_by_id(&transaction, id)?
        .ok_or_else(|| CommandError::not_found("未找到该任务。"))?;
    transaction.commit().map_err(sql_write_error)?;
    Ok(card)
}

pub fn delete_card(connection: &mut Connection, id: &str) -> Result<(), CommandError> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(CommandError::database)?;
    let lane_id: Option<String> = transaction
        .query_row("SELECT lane_id FROM kanban_cards WHERE id=?1", [id], |row| {
            row.get(0)
        })
        .optional()
        .map_err(CommandError::database)?;
    let Some(lane_id) = lane_id else {
        return Err(CommandError::not_found("未找到该任务。"));
    };
    transaction
        .execute("DELETE FROM kanban_cards WHERE id=?1", [id])
        .map_err(sql_write_error)?;
    renumber_cards(&transaction, &lane_id)?;
    transaction.commit().map_err(sql_write_error)
}

fn renumber_cards(transaction: &Transaction<'_>, lane_id: &str) -> Result<(), CommandError> {
    let ids = transaction
        .prepare("SELECT id FROM kanban_cards WHERE lane_id=?1 ORDER BY position ASC,id ASC")
        .map_err(CommandError::database)?
        .query_map([lane_id], |row| row.get::<_, String>(0))
        .map_err(CommandError::database)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(CommandError::database)?;
    for (index, id) in ids.iter().enumerate() {
        transaction
            .execute(
                "UPDATE kanban_cards SET position=?2 WHERE id=?1",
                params![id, index as i64],
            )
            .map_err(sql_write_error)?;
    }
    Ok(())
}

// Moves a card to `target_lane_id` at `target_index`, renumbering both the
// source and target lanes in one transaction. Reordering within a lane is the
// same operation with an unchanged target lane.
pub fn move_card(
    connection: &mut Connection,
    id: &str,
    target_lane_id: &str,
    target_index: i64,
) -> Result<(), CommandError> {
    let now = timestamp();
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(CommandError::database)?;
    let source_lane_id: Option<String> = transaction
        .query_row("SELECT lane_id FROM kanban_cards WHERE id=?1", [id], |row| {
            row.get(0)
        })
        .optional()
        .map_err(CommandError::database)?;
    let Some(source_lane_id) = source_lane_id else {
        return Err(CommandError::not_found("未找到该任务。"));
    };
    require_lane(&transaction, target_lane_id)?;

    // Detach the card, compact the source lane, then reinsert at the target
    // index by shifting the target lane's positions to make room.
    transaction
        .execute(
            "UPDATE kanban_cards SET position=-1 WHERE id=?1",
            params![id],
        )
        .map_err(sql_write_error)?;
    renumber_cards_excluding(&transaction, &source_lane_id, id)?;

    let target_count: i64 = transaction
        .query_row(
            "SELECT COUNT(*) FROM kanban_cards WHERE lane_id=?1 AND id<>?2",
            params![target_lane_id, id],
            |row| row.get(0),
        )
        .map_err(CommandError::database)?;
    let clamped = target_index.max(0).min(target_count);
    // Open a gap at the clamped index in the target lane.
    transaction
        .execute(
            "UPDATE kanban_cards SET position=position+1 WHERE lane_id=?1 AND id<>?2 AND position>=?3",
            params![target_lane_id, id, clamped],
        )
        .map_err(sql_write_error)?;
    transaction
        .execute(
            "UPDATE kanban_cards SET lane_id=?2,position=?3,updated_at=?4 WHERE id=?1",
            params![id, target_lane_id, clamped, now],
        )
        .map_err(sql_write_error)?;
    renumber_cards(&transaction, &source_lane_id)?;
    renumber_cards(&transaction, target_lane_id)?;
    transaction.commit().map_err(sql_write_error)
}

fn renumber_cards_excluding(
    transaction: &Transaction<'_>,
    lane_id: &str,
    exclude_id: &str,
) -> Result<(), CommandError> {
    let ids = transaction
        .prepare("SELECT id FROM kanban_cards WHERE lane_id=?1 AND id<>?2 ORDER BY position ASC,id ASC")
        .map_err(CommandError::database)?
        .query_map(params![lane_id, exclude_id], |row| row.get::<_, String>(0))
        .map_err(CommandError::database)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(CommandError::database)?;
    for (index, id) in ids.iter().enumerate() {
        transaction
            .execute(
                "UPDATE kanban_cards SET position=?2 WHERE id=?1",
                params![id, index as i64],
            )
            .map_err(sql_write_error)?;
    }
    Ok(())
}

// --- Priorities -------------------------------------------------------------

fn require_unique_priority_name(
    transaction: &Transaction<'_>,
    name: &str,
    exclude_id: Option<&str>,
) -> Result<(), CommandError> {
    let taken: bool = match exclude_id {
        Some(id) => transaction
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM kanban_priorities WHERE name=?1 AND id<>?2)",
                params![name, id],
                |row| row.get(0),
            )
            .map_err(CommandError::database)?,
        None => transaction
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM kanban_priorities WHERE name=?1)",
                [name],
                |row| row.get(0),
            )
            .map_err(CommandError::database)?,
    };
    if taken {
        Err(CommandError::validation("name", "该优先级名称已存在。"))
    } else {
        Ok(())
    }
}

pub fn create_priority(
    connection: &mut Connection,
    draft: KanbanPriorityDraft,
) -> Result<KanbanPriority, CommandError> {
    let name = normalize_name(&draft.name, "请输入优先级名称。")?;
    require_color(&draft.color)?;
    let id = format!("kanban-priority-{}", Uuid::new_v4().hyphenated());
    let now = timestamp();
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(CommandError::database)?;
    require_unique_priority_name(&transaction, &name, None)?;
    let position: i64 = transaction
        .query_row(
            "SELECT COALESCE(MAX(position)+1,0) FROM kanban_priorities",
            [],
            |row| row.get(0),
        )
        .map_err(CommandError::database)?;
    transaction
        .execute(
            "INSERT INTO kanban_priorities(id,name,color,position,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?5)",
            params![id, name, draft.color, position, now],
        )
        .map_err(sql_write_error)?;
    let priority = transaction
        .query_row(
            "SELECT id,name,color,position,created_at,updated_at FROM kanban_priorities WHERE id=?1",
            [&id],
            read_priority,
        )
        .map_err(CommandError::database)?;
    transaction.commit().map_err(sql_write_error)?;
    Ok(priority)
}

pub fn update_priority(
    connection: &mut Connection,
    id: &str,
    draft: KanbanPriorityDraft,
) -> Result<KanbanPriority, CommandError> {
    let name = normalize_name(&draft.name, "请输入优先级名称。")?;
    require_color(&draft.color)?;
    let now = timestamp();
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(CommandError::database)?;
    require_unique_priority_name(&transaction, &name, Some(id))?;
    let affected = transaction
        .execute(
            "UPDATE kanban_priorities SET name=?2,color=?3,updated_at=?4 WHERE id=?1",
            params![id, name, draft.color, now],
        )
        .map_err(sql_write_error)?;
    if affected != 1 {
        return Err(CommandError::not_found("未找到该优先级。"));
    }
    let priority = transaction
        .query_row(
            "SELECT id,name,color,position,created_at,updated_at FROM kanban_priorities WHERE id=?1",
            [id],
            read_priority,
        )
        .map_err(CommandError::database)?;
    transaction.commit().map_err(sql_write_error)?;
    Ok(priority)
}

pub fn delete_priority(connection: &mut Connection, id: &str) -> Result<(), CommandError> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(CommandError::database)?;
    // Cards keep their row; the foreign key nulls priority_id on delete.
    let affected = transaction
        .execute("DELETE FROM kanban_priorities WHERE id=?1", [id])
        .map_err(sql_write_error)?;
    if affected != 1 {
        return Err(CommandError::not_found("未找到该优先级。"));
    }
    let ids = transaction
        .prepare("SELECT id FROM kanban_priorities ORDER BY position ASC,id ASC")
        .map_err(CommandError::database)?
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(CommandError::database)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(CommandError::database)?;
    for (index, priority_id) in ids.iter().enumerate() {
        transaction
            .execute(
                "UPDATE kanban_priorities SET position=?2 WHERE id=?1",
                params![priority_id, index as i64],
            )
            .map_err(sql_write_error)?;
    }
    transaction.commit().map_err(sql_write_error)
}

pub fn reorder_priorities(
    connection: &mut Connection,
    ordered_ids: &[String],
) -> Result<Vec<KanbanPriority>, CommandError> {
    let now = timestamp();
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(CommandError::database)?;
    let existing = transaction
        .prepare("SELECT id FROM kanban_priorities")
        .map_err(CommandError::database)?
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(CommandError::database)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(CommandError::database)?;
    require_same_set(&existing, ordered_ids, "优先级顺序无效。")?;
    for (index, id) in ordered_ids.iter().enumerate() {
        transaction
            .execute(
                "UPDATE kanban_priorities SET position=?2,updated_at=?3 WHERE id=?1",
                params![id, index as i64, now],
            )
            .map_err(sql_write_error)?;
    }
    let priorities = transaction
        .prepare("SELECT id,name,color,position,created_at,updated_at FROM kanban_priorities ORDER BY position ASC,id ASC")
        .map_err(CommandError::database)?
        .query_map([], read_priority)
        .map_err(CommandError::database)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(CommandError::database)?;
    transaction.commit().map_err(sql_write_error)?;
    Ok(priorities)
}

// --- Tags -------------------------------------------------------------------

pub fn create_tag(
    connection: &mut Connection,
    draft: KanbanTagDraft,
) -> Result<KanbanTag, CommandError> {
    let name = normalize_name(&draft.name, "请输入标签名称。")?;
    require_color(&draft.color)?;
    let id = format!("kanban-tag-{}", Uuid::new_v4().hyphenated());
    let now = timestamp();
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(CommandError::database)?;
    let taken: bool = transaction
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM kanban_tags WHERE name=?1)",
            [&name],
            |row| row.get(0),
        )
        .map_err(CommandError::database)?;
    if taken {
        return Err(CommandError::validation("name", "该标签名称已存在。"));
    }
    transaction
        .execute(
            "INSERT INTO kanban_tags(id,name,color,created_at,updated_at) VALUES (?1,?2,?3,?4,?4)",
            params![id, name, draft.color, now],
        )
        .map_err(sql_write_error)?;
    let tag = transaction
        .query_row(
            "SELECT id,name,color,created_at,updated_at FROM kanban_tags WHERE id=?1",
            [&id],
            read_tag,
        )
        .map_err(CommandError::database)?;
    transaction.commit().map_err(sql_write_error)?;
    Ok(tag)
}

pub fn update_tag(
    connection: &mut Connection,
    id: &str,
    draft: KanbanTagDraft,
) -> Result<KanbanTag, CommandError> {
    let name = normalize_name(&draft.name, "请输入标签名称。")?;
    require_color(&draft.color)?;
    let now = timestamp();
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(CommandError::database)?;
    let taken: bool = transaction
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM kanban_tags WHERE name=?1 AND id<>?2)",
            params![name, id],
            |row| row.get(0),
        )
        .map_err(CommandError::database)?;
    if taken {
        return Err(CommandError::validation("name", "该标签名称已存在。"));
    }
    let affected = transaction
        .execute(
            "UPDATE kanban_tags SET name=?2,color=?3,updated_at=?4 WHERE id=?1",
            params![id, name, draft.color, now],
        )
        .map_err(sql_write_error)?;
    if affected != 1 {
        return Err(CommandError::not_found("未找到该标签。"));
    }
    let tag = transaction
        .query_row(
            "SELECT id,name,color,created_at,updated_at FROM kanban_tags WHERE id=?1",
            [id],
            read_tag,
        )
        .map_err(CommandError::database)?;
    transaction.commit().map_err(sql_write_error)?;
    Ok(tag)
}

pub fn delete_tag(connection: &mut Connection, id: &str) -> Result<(), CommandError> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(CommandError::database)?;
    // Card links cascade; cards themselves are untouched.
    let affected = transaction
        .execute("DELETE FROM kanban_tags WHERE id=?1", [id])
        .map_err(sql_write_error)?;
    if affected != 1 {
        return Err(CommandError::not_found("未找到该标签。"));
    }
    transaction.commit().map_err(sql_write_error)
}

// --- Collaborators ----------------------------------------------------------

pub fn create_collaborator(
    connection: &mut Connection,
    draft: KanbanCollaboratorDraft,
) -> Result<KanbanCollaborator, CommandError> {
    let name = normalize_name(&draft.name, "请输入协作人姓名。")?;
    let id = format!("kanban-collaborator-{}", Uuid::new_v4().hyphenated());
    let now = timestamp();
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(CommandError::database)?;
    let taken: bool = transaction
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM kanban_collaborators WHERE name=?1)",
            [&name],
            |row| row.get(0),
        )
        .map_err(CommandError::database)?;
    if taken {
        return Err(CommandError::validation("name", "该协作人已存在。"));
    }
    transaction
        .execute(
            "INSERT INTO kanban_collaborators(id,name,created_at,updated_at) VALUES (?1,?2,?3,?3)",
            params![id, name, now],
        )
        .map_err(sql_write_error)?;
    let collaborator = transaction
        .query_row(
            "SELECT id,name,created_at,updated_at FROM kanban_collaborators WHERE id=?1",
            [&id],
            read_collaborator,
        )
        .map_err(CommandError::database)?;
    transaction.commit().map_err(sql_write_error)?;
    Ok(collaborator)
}

pub fn update_collaborator(
    connection: &mut Connection,
    id: &str,
    draft: KanbanCollaboratorDraft,
) -> Result<KanbanCollaborator, CommandError> {
    let name = normalize_name(&draft.name, "请输入协作人姓名。")?;
    let now = timestamp();
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(CommandError::database)?;
    let taken: bool = transaction
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM kanban_collaborators WHERE name=?1 AND id<>?2)",
            params![name, id],
            |row| row.get(0),
        )
        .map_err(CommandError::database)?;
    if taken {
        return Err(CommandError::validation("name", "该协作人已存在。"));
    }
    let affected = transaction
        .execute(
            "UPDATE kanban_collaborators SET name=?2,updated_at=?3 WHERE id=?1",
            params![id, name, now],
        )
        .map_err(sql_write_error)?;
    if affected != 1 {
        return Err(CommandError::not_found("未找到该协作人。"));
    }
    let collaborator = transaction
        .query_row(
            "SELECT id,name,created_at,updated_at FROM kanban_collaborators WHERE id=?1",
            [id],
            read_collaborator,
        )
        .map_err(CommandError::database)?;
    transaction.commit().map_err(sql_write_error)?;
    Ok(collaborator)
}

pub fn delete_collaborator(connection: &mut Connection, id: &str) -> Result<(), CommandError> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(CommandError::database)?;
    let affected = transaction
        .execute("DELETE FROM kanban_collaborators WHERE id=?1", [id])
        .map_err(sql_write_error)?;
    if affected != 1 {
        return Err(CommandError::not_found("未找到该协作人。"));
    }
    transaction.commit().map_err(sql_write_error)
}

// --- Tauri commands ---------------------------------------------------------

#[tauri::command]
pub fn get_kanban_snapshot(db: State<'_, AppDb>) -> Result<KanbanSnapshot, CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    snapshot(&connection)
}

#[tauri::command]
pub fn create_kanban_lane(
    db: State<'_, AppDb>,
    draft: KanbanLaneDraft,
) -> Result<KanbanLane, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    create_lane(&mut connection, draft)
}

#[tauri::command]
pub fn update_kanban_lane(
    db: State<'_, AppDb>,
    id: String,
    draft: KanbanLaneDraft,
) -> Result<KanbanLane, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    update_lane(&mut connection, &id, draft)
}

#[tauri::command]
pub fn delete_kanban_lane(db: State<'_, AppDb>, id: String) -> Result<(), CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    delete_lane(&mut connection, &id)
}

#[tauri::command]
pub fn reorder_kanban_lanes(
    db: State<'_, AppDb>,
    ordered_ids: Vec<String>,
) -> Result<Vec<KanbanLane>, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    reorder_lanes(&mut connection, &ordered_ids)
}

#[tauri::command]
pub fn create_kanban_card(
    db: State<'_, AppDb>,
    draft: KanbanCardDraft,
) -> Result<KanbanCard, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    create_card(&mut connection, draft)
}

#[tauri::command]
pub fn update_kanban_card(
    db: State<'_, AppDb>,
    id: String,
    draft: KanbanCardDraft,
) -> Result<KanbanCard, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    update_card(&mut connection, &id, draft)
}

#[tauri::command]
pub fn delete_kanban_card(db: State<'_, AppDb>, id: String) -> Result<(), CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    delete_card(&mut connection, &id)
}

#[tauri::command]
pub fn move_kanban_card(
    db: State<'_, AppDb>,
    id: String,
    target_lane_id: String,
    target_index: i64,
) -> Result<(), CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    move_card(&mut connection, &id, &target_lane_id, target_index)
}

#[tauri::command]
pub fn create_kanban_priority(
    db: State<'_, AppDb>,
    draft: KanbanPriorityDraft,
) -> Result<KanbanPriority, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    create_priority(&mut connection, draft)
}

#[tauri::command]
pub fn update_kanban_priority(
    db: State<'_, AppDb>,
    id: String,
    draft: KanbanPriorityDraft,
) -> Result<KanbanPriority, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    update_priority(&mut connection, &id, draft)
}

#[tauri::command]
pub fn delete_kanban_priority(db: State<'_, AppDb>, id: String) -> Result<(), CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    delete_priority(&mut connection, &id)
}

#[tauri::command]
pub fn reorder_kanban_priorities(
    db: State<'_, AppDb>,
    ordered_ids: Vec<String>,
) -> Result<Vec<KanbanPriority>, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    reorder_priorities(&mut connection, &ordered_ids)
}

#[tauri::command]
pub fn create_kanban_tag(
    db: State<'_, AppDb>,
    draft: KanbanTagDraft,
) -> Result<KanbanTag, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    create_tag(&mut connection, draft)
}

#[tauri::command]
pub fn update_kanban_tag(
    db: State<'_, AppDb>,
    id: String,
    draft: KanbanTagDraft,
) -> Result<KanbanTag, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    update_tag(&mut connection, &id, draft)
}

#[tauri::command]
pub fn delete_kanban_tag(db: State<'_, AppDb>, id: String) -> Result<(), CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    delete_tag(&mut connection, &id)
}

#[tauri::command]
pub fn create_kanban_collaborator(
    db: State<'_, AppDb>,
    draft: KanbanCollaboratorDraft,
) -> Result<KanbanCollaborator, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    create_collaborator(&mut connection, draft)
}

#[tauri::command]
pub fn update_kanban_collaborator(
    db: State<'_, AppDb>,
    id: String,
    draft: KanbanCollaboratorDraft,
) -> Result<KanbanCollaborator, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    update_collaborator(&mut connection, &id, draft)
}

#[tauri::command]
pub fn delete_kanban_collaborator(db: State<'_, AppDb>, id: String) -> Result<(), CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    delete_collaborator(&mut connection, &id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrate;

    fn database() -> Connection {
        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch("PRAGMA foreign_keys = ON;")
            .unwrap();
        migrate(&mut connection).unwrap();
        connection
    }

    fn lane_draft(name: &str, color: &str) -> KanbanLaneDraft {
        KanbanLaneDraft {
            name: name.into(),
            color: color.into(),
        }
    }

    fn card_draft(lane_id: &str, title: &str) -> KanbanCardDraft {
        KanbanCardDraft {
            lane_id: lane_id.into(),
            title: title.into(),
            description: None,
            due_date: None,
            priority_id: None,
            tag_ids: Vec::new(),
            collaborator_ids: Vec::new(),
        }
    }

    #[test]
    fn snapshot_returns_default_lanes_sorted_by_position() {
        let connection = database();
        let snapshot = snapshot(&connection).unwrap();
        let names: Vec<&str> = snapshot.lanes.iter().map(|l| l.name.as_str()).collect();
        assert_eq!(names, vec!["待处理", "进行中", "已完成"]);
        assert!(snapshot.cards.is_empty());
    }

    #[test]
    fn create_update_delete_lane_and_renumber() {
        let mut connection = database();
        let lane = create_lane(&mut connection, lane_draft("  评审  ", "#4F55DA")).unwrap();
        assert_eq!(lane.name, "评审");
        assert_eq!(lane.position, 3);
        let updated = update_lane(&mut connection, &lane.id, lane_draft("待评审", "#F06445")).unwrap();
        assert_eq!(updated.name, "待评审");
        assert_eq!(updated.color, "#F06445");
        delete_lane(&mut connection, &lane.id).unwrap();
        let positions: Vec<i64> = snapshot(&connection)
            .unwrap()
            .lanes
            .iter()
            .map(|l| l.position)
            .collect();
        assert_eq!(positions, vec![0, 1, 2]);
    }

    #[test]
    fn lane_validation_rejects_empty_name_and_bad_color() {
        let mut connection = database();
        assert_eq!(
            create_lane(&mut connection, lane_draft("   ", "primary"))
                .unwrap_err()
                .field
                .as_deref(),
            Some("name")
        );
        assert_eq!(
            create_lane(&mut connection, lane_draft("新泳道", "rainbow"))
                .unwrap_err()
                .field
                .as_deref(),
            Some("color")
        );
    }

    #[test]
    fn reorder_lanes_requires_exact_set() {
        let mut connection = database();
        let ids: Vec<String> = snapshot(&connection)
            .unwrap()
            .lanes
            .iter()
            .map(|l| l.id.clone())
            .collect();
        let reversed: Vec<String> = ids.iter().rev().cloned().collect();
        let lanes = reorder_lanes(&mut connection, &reversed).unwrap();
        assert_eq!(lanes[0].id, reversed[0]);
        assert_eq!(lanes[0].position, 0);
        // Missing / duplicate id sets are rejected.
        assert_eq!(
            reorder_lanes(&mut connection, &ids[..2].to_vec())
                .unwrap_err()
                .code,
            "validation_error"
        );
        let dup = vec![ids[0].clone(), ids[0].clone(), ids[1].clone()];
        assert_eq!(
            reorder_lanes(&mut connection, &dup).unwrap_err().code,
            "validation_error"
        );
    }

    #[test]
    fn create_card_appends_and_normalizes() {
        let mut connection = database();
        let lanes = snapshot(&connection).unwrap().lanes;
        let lane_id = &lanes[0].id;
        let a = create_card(
            &mut connection,
            KanbanCardDraft {
                title: "  写文档  ".into(),
                description: Some("   ".into()),
                ..card_draft(lane_id, "")
            },
        )
        .unwrap();
        assert_eq!(a.title, "写文档");
        assert_eq!(a.description, None);
        assert_eq!(a.position, 0);
        let b = create_card(&mut connection, card_draft(lane_id, "第二张")).unwrap();
        assert_eq!(b.position, 1);
    }

    #[test]
    fn card_title_required_and_bad_date_rejected() {
        let mut connection = database();
        let lane_id = snapshot(&connection).unwrap().lanes[0].id.clone();
        assert_eq!(
            create_card(&mut connection, card_draft(&lane_id, "   "))
                .unwrap_err()
                .field
                .as_deref(),
            Some("title")
        );
        assert_eq!(
            create_card(
                &mut connection,
                KanbanCardDraft {
                    due_date: Some("2026-13-40".into()),
                    ..card_draft(&lane_id, "有效标题")
                }
            )
            .unwrap_err()
            .field
            .as_deref(),
            Some("dueDate")
        );
    }

    #[test]
    fn create_card_rejects_unknown_lane_and_relations() {
        let mut connection = database();
        assert_eq!(
            create_card(&mut connection, card_draft("missing-lane", "任务"))
                .unwrap_err()
                .field
                .as_deref(),
            Some("laneId")
        );
        let lane_id = snapshot(&connection).unwrap().lanes[0].id.clone();
        assert_eq!(
            create_card(
                &mut connection,
                KanbanCardDraft {
                    priority_id: Some("missing".into()),
                    ..card_draft(&lane_id, "任务")
                }
            )
            .unwrap_err()
            .field
            .as_deref(),
            Some("priorityId")
        );
    }

    #[test]
    fn card_supports_priority_tags_and_collaborators() {
        let mut connection = database();
        let lane_id = snapshot(&connection).unwrap().lanes[0].id.clone();
        let priority = create_priority(
            &mut connection,
            KanbanPriorityDraft {
                name: "高".into(),
                color: "#F06445".into(),
            },
        )
        .unwrap();
        let tag1 = create_tag(
            &mut connection,
            KanbanTagDraft {
                name: "后端".into(),
                color: "#4F55DA".into(),
            },
        )
        .unwrap();
        let tag2 = create_tag(
            &mut connection,
            KanbanTagDraft {
                name: "紧急".into(),
                color: "#E8C444".into(),
            },
        )
        .unwrap();
        let collab = create_collaborator(
            &mut connection,
            KanbanCollaboratorDraft { name: "小林".into() },
        )
        .unwrap();
        let card = create_card(
            &mut connection,
            KanbanCardDraft {
                priority_id: Some(priority.id.clone()),
                tag_ids: vec![tag2.id.clone(), tag1.id.clone(), tag1.id.clone()],
                collaborator_ids: vec![collab.id.clone()],
                ..card_draft(&lane_id, "带字段的任务")
            },
        )
        .unwrap();
        assert_eq!(card.priority_id.as_deref(), Some(priority.id.as_str()));
        assert_eq!(card.tag_ids.len(), 2);
        assert_eq!(card.collaborator_ids, vec![collab.id.clone()]);
    }

    #[test]
    fn deleting_priority_nulls_card_and_keeps_it() {
        let mut connection = database();
        let lane_id = snapshot(&connection).unwrap().lanes[0].id.clone();
        let priority = create_priority(
            &mut connection,
            KanbanPriorityDraft {
                name: "高".into(),
                color: "#F06445".into(),
            },
        )
        .unwrap();
        let card = create_card(
            &mut connection,
            KanbanCardDraft {
                priority_id: Some(priority.id.clone()),
                ..card_draft(&lane_id, "任务")
            },
        )
        .unwrap();
        delete_priority(&mut connection, &priority.id).unwrap();
        let refreshed = card_by_id(&connection, &card.id).unwrap().unwrap();
        assert_eq!(refreshed.priority_id, None);
    }

    #[test]
    fn deleting_tag_and_collaborator_only_unlinks() {
        let mut connection = database();
        let lane_id = snapshot(&connection).unwrap().lanes[0].id.clone();
        let tag = create_tag(
            &mut connection,
            KanbanTagDraft {
                name: "后端".into(),
                color: "#4F55DA".into(),
            },
        )
        .unwrap();
        let collab = create_collaborator(
            &mut connection,
            KanbanCollaboratorDraft { name: "小林".into() },
        )
        .unwrap();
        let card = create_card(
            &mut connection,
            KanbanCardDraft {
                tag_ids: vec![tag.id.clone()],
                collaborator_ids: vec![collab.id.clone()],
                ..card_draft(&lane_id, "任务")
            },
        )
        .unwrap();
        delete_tag(&mut connection, &tag.id).unwrap();
        delete_collaborator(&mut connection, &collab.id).unwrap();
        let refreshed = card_by_id(&connection, &card.id).unwrap().unwrap();
        assert!(refreshed.tag_ids.is_empty());
        assert!(refreshed.collaborator_ids.is_empty());
    }

    #[test]
    fn deleting_lane_cascades_cards_and_links() {
        let mut connection = database();
        let lane_id = snapshot(&connection).unwrap().lanes[0].id.clone();
        let tag = create_tag(
            &mut connection,
            KanbanTagDraft {
                name: "后端".into(),
                color: "#4F55DA".into(),
            },
        )
        .unwrap();
        create_card(
            &mut connection,
            KanbanCardDraft {
                tag_ids: vec![tag.id.clone()],
                ..card_draft(&lane_id, "任务")
            },
        )
        .unwrap();
        delete_lane(&mut connection, &lane_id).unwrap();
        let snap = snapshot(&connection).unwrap();
        assert!(snap.cards.is_empty());
        let link_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM kanban_card_tags", [], |row| row.get(0))
            .unwrap();
        assert_eq!(link_count, 0);
        // Tag still exists.
        assert_eq!(snap.tags.len(), 1);
    }

    #[test]
    fn move_card_within_lane_reorders() {
        let mut connection = database();
        let lane_id = snapshot(&connection).unwrap().lanes[0].id.clone();
        let a = create_card(&mut connection, card_draft(&lane_id, "A")).unwrap();
        let _b = create_card(&mut connection, card_draft(&lane_id, "B")).unwrap();
        let _c = create_card(&mut connection, card_draft(&lane_id, "C")).unwrap();
        // Move A to the end.
        move_card(&mut connection, &a.id, &lane_id, 2).unwrap();
        let cards: Vec<(String, i64)> = snapshot(&connection)
            .unwrap()
            .cards
            .into_iter()
            .map(|c| (c.title, c.position))
            .collect();
        assert_eq!(
            cards,
            vec![
                ("B".to_string(), 0),
                ("C".to_string(), 1),
                ("A".to_string(), 2)
            ]
        );
    }

    #[test]
    fn move_card_across_lanes_renumbers_both() {
        let mut connection = database();
        let lanes = snapshot(&connection).unwrap().lanes;
        let source = lanes[0].id.clone();
        let target = lanes[1].id.clone();
        let a = create_card(&mut connection, card_draft(&source, "A")).unwrap();
        let _b = create_card(&mut connection, card_draft(&source, "B")).unwrap();
        create_card(&mut connection, card_draft(&target, "X")).unwrap();
        move_card(&mut connection, &a.id, &target, 0).unwrap();
        let snap = snapshot(&connection).unwrap();
        let source_cards: Vec<(String, i64)> = snap
            .cards
            .iter()
            .filter(|c| c.lane_id == source)
            .map(|c| (c.title.clone(), c.position))
            .collect();
        let target_cards: Vec<(String, i64)> = snap
            .cards
            .iter()
            .filter(|c| c.lane_id == target)
            .map(|c| (c.title.clone(), c.position))
            .collect();
        assert_eq!(source_cards, vec![("B".to_string(), 0)]);
        assert_eq!(
            target_cards,
            vec![("A".to_string(), 0), ("X".to_string(), 1)]
        );
    }

    #[test]
    fn update_card_keeps_position_and_lane() {
        let mut connection = database();
        let lane_id = snapshot(&connection).unwrap().lanes[0].id.clone();
        let a = create_card(&mut connection, card_draft(&lane_id, "A")).unwrap();
        let b = create_card(&mut connection, card_draft(&lane_id, "B")).unwrap();
        let updated = update_card(
            &mut connection,
            &b.id,
            KanbanCardDraft {
                title: "B改".into(),
                ..card_draft(&lane_id, "")
            },
        )
        .unwrap();
        assert_eq!(updated.title, "B改");
        assert_eq!(updated.position, b.position);
        assert_eq!(updated.lane_id, a.lane_id);
    }

    #[test]
    fn delete_card_renumbers_remaining() {
        let mut connection = database();
        let lane_id = snapshot(&connection).unwrap().lanes[0].id.clone();
        let a = create_card(&mut connection, card_draft(&lane_id, "A")).unwrap();
        create_card(&mut connection, card_draft(&lane_id, "B")).unwrap();
        create_card(&mut connection, card_draft(&lane_id, "C")).unwrap();
        delete_card(&mut connection, &a.id).unwrap();
        let positions: Vec<i64> = snapshot(&connection)
            .unwrap()
            .cards
            .iter()
            .map(|c| c.position)
            .collect();
        assert_eq!(positions, vec![0, 1]);
    }

    #[test]
    fn priority_name_must_be_unique() {
        let mut connection = database();
        create_priority(
            &mut connection,
            KanbanPriorityDraft {
                name: "高".into(),
                color: "#F06445".into(),
            },
        )
        .unwrap();
        assert_eq!(
            create_priority(
                &mut connection,
                KanbanPriorityDraft {
                    name: " 高 ".into(),
                    color: "#E8C444".into(),
                }
            )
            .unwrap_err()
            .field
            .as_deref(),
            Some("name")
        );
    }

    #[test]
    fn tag_and_collaborator_names_unique() {
        let mut connection = database();
        create_tag(
            &mut connection,
            KanbanTagDraft {
                name: "后端".into(),
                color: "#4F55DA".into(),
            },
        )
        .unwrap();
        assert!(create_tag(
            &mut connection,
            KanbanTagDraft {
                name: "后端".into(),
                color: "#E8C444".into(),
            }
        )
        .is_err());
        create_collaborator(
            &mut connection,
            KanbanCollaboratorDraft { name: "小林".into() },
        )
        .unwrap();
        assert!(create_collaborator(
            &mut connection,
            KanbanCollaboratorDraft { name: "小林".into() }
        )
        .is_err());
    }

    #[test]
    fn reorder_priorities_sets_dense_positions() {
        let mut connection = database();
        let high = create_priority(
            &mut connection,
            KanbanPriorityDraft {
                name: "高".into(),
                color: "#F06445".into(),
            },
        )
        .unwrap();
        let low = create_priority(
            &mut connection,
            KanbanPriorityDraft {
                name: "低".into(),
                color: "#B8D935".into(),
            },
        )
        .unwrap();
        let ordered = vec![low.id.clone(), high.id.clone()];
        let priorities = reorder_priorities(&mut connection, &ordered).unwrap();
        assert_eq!(priorities[0].id, low.id);
        assert_eq!(priorities[0].position, 0);
        assert_eq!(priorities[1].position, 1);
    }

    #[test]
    fn update_card_rejects_missing_card() {
        let mut connection = database();
        let lane_id = snapshot(&connection).unwrap().lanes[0].id.clone();
        assert_eq!(
            update_card(&mut connection, "missing", card_draft(&lane_id, "任务"))
                .unwrap_err()
                .code,
            "not_found"
        );
    }
}
