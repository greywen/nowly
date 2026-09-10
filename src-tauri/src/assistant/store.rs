//! Immutable plans and scoped inverse patches. Never restore a whole database.
use super::{actions, types::*};
use crate::{error::CommandError, write_scope::WriteScope};
use rusqlite::{params, params_from_iter, types::Value as SqlValue, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::OnceLock,
};

type Row = BTreeMap<String, Value>;
type Snapshot = BTreeMap<String, BTreeMap<String, Row>>;
const TABLES: &[&str] = &[
    "events",
    "tasks",
    "event_exceptions",
    "task_tag_links",
    "task_collaborator_links",
    "task_view_memberships",
];
const SNAPSHOT_TABLES: &[&str] = &[
    "events",
    "tasks",
    "event_exceptions",
    "task_tag_links",
    "task_collaborator_links",
    "task_view_memberships",
    "task_lanes",
    "task_tags",
    "task_collaborators",
    "settings",
];
const WATCHED: &[&str] = &[
    "events",
    "tasks",
    "event_exceptions",
    "task_tag_links",
    "task_collaborator_links",
    "task_view_memberships",
    "task_lanes",
    "task_tags",
    "task_collaborators",
    "settings",
];
// `settings` is rewritten wholesale by unrelated UI actions (picking a colour
// touches `recent_colors`), so only the keys a plan actually depends on count.
const WATCHED_SETTINGS: &[&str] = &[
    "task_view_linking_enabled",
    "default_task_lane_id",
    "completion_task_lane_id",
];
const RETENTION_MS: i64 = 7 * 24 * 60 * 60 * 1000;

pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}
pub fn prune(db: &Connection) -> Result<(), CommandError> {
    db.execute(
        "DELETE FROM assistant_plans WHERE created_at<?1",
        [now_ms() - RETENTION_MS],
    )
    .map_err(CommandError::database)?;
    Ok(())
}
fn session() -> &'static str {
    static ID: OnceLock<String> = OnceLock::new();
    ID.get_or_init(|| uuid::Uuid::new_v4().to_string())
}
fn invalid(message: &str) -> CommandError {
    CommandError::validation("assistant", message)
}
fn encode<T: Serialize>(value: &T) -> Result<String, CommandError> {
    serde_json::to_string(value).map_err(CommandError::system)
}
fn decode<T: serde::de::DeserializeOwned>(text: &str) -> Result<T, CommandError> {
    serde_json::from_str(text).map_err(|_| invalid("操作记录格式无效，未执行变更。"))
}

pub fn migrate(db: &Connection) -> rusqlite::Result<()> {
    db.execute_batch(
        "CREATE TABLE assistant_clock(id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL);
         INSERT INTO assistant_clock VALUES(1,0);
         CREATE TABLE assistant_config(id INTEGER PRIMARY KEY CHECK(id=1), config TEXT NOT NULL, secret BLOB);
         CREATE TABLE assistant_plans(
           id TEXT PRIMARY KEY, session_id TEXT NOT NULL, status TEXT NOT NULL,
           created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revision INTEGER NOT NULL,
           plan TEXT NOT NULL, patch TEXT NOT NULL, undo_guard TEXT NOT NULL
         );
         CREATE INDEX assistant_plans_created ON assistant_plans(created_at);"
    )?;
    install_triggers(db)
}

fn watched_settings_list() -> String {
    WATCHED_SETTINGS
        .iter()
        .map(|key| format!("'{key}'"))
        .collect::<Vec<_>>()
        .join(",")
}

/// Drops every assistant revision trigger and recreates the current set, so a
/// database migrated by an older build converges instead of keeping triggers
/// for tables that are no longer watched.
pub fn install_triggers(db: &Connection) -> rusqlite::Result<()> {
    let stale: Vec<String> = db
        .prepare(
            "SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'assistant\\_%' ESCAPE '\\'",
        )?
        .query_map([], |r| r.get(0))?
        .collect::<rusqlite::Result<Vec<String>>>()?;
    for name in stale {
        db.execute_batch(&format!("DROP TRIGGER \"{name}\""))?;
    }
    let keys = watched_settings_list();
    for table in WATCHED {
        for event in ["INSERT", "UPDATE", "DELETE"] {
            let guard = match (*table, event) {
                ("settings", "INSERT") => format!(" WHEN NEW.key IN ({keys})"),
                ("settings", "DELETE") => format!(" WHEN OLD.key IN ({keys})"),
                ("settings", _) => {
                    format!(" WHEN NEW.key IN ({keys}) OR OLD.key IN ({keys})")
                }
                _ => String::new(),
            };
            db.execute_batch(&format!(
                "CREATE TRIGGER assistant_{table}_{event} AFTER {event} ON \"{table}\"{guard}
                 BEGIN UPDATE assistant_clock SET revision=revision+1 WHERE id=1; END;"
            ))?;
        }
    }
    Ok(())
}

pub fn revision(db: &Connection) -> Result<i64, CommandError> {
    db.query_row("SELECT revision FROM assistant_clock WHERE id=1", [], |r| {
        r.get(0)
    })
    .map_err(CommandError::database)
}
pub fn require_permissions(actions: &[Action], p: &Permissions) -> Result<(), CommandError> {
    if actions.iter().any(|a| {
        if a.domain() == "calendar" {
            !p.calendar
        } else {
            !p.tasks
        }
    }) {
        return Err(invalid("未授权此类本地数据操作。请在 AI 设置中调整权限。"));
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Patch {
    table: String,
    key: String,
    before: Option<Row>,
    after: Option<Row>,
}

fn keys(db: &Connection, table: &str) -> Result<Vec<String>, CommandError> {
    if !SNAPSHOT_TABLES.contains(&table) {
        return Err(invalid("不允许访问此数据表。"));
    }
    let mut statement = db
        .prepare(&format!("PRAGMA table_info(\"{table}\")"))
        .map_err(CommandError::database)?;
    let mut keys: Vec<(i64, String)> = statement
        .query_map([], |r| Ok((r.get(5)?, r.get(1)?)))
        .map_err(CommandError::database)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(CommandError::database)?;
    keys.retain(|(order, _)| *order > 0);
    keys.sort();
    Ok(keys.into_iter().map(|(_, name)| name).collect())
}

fn snapshot(db: &Connection) -> Result<Snapshot, CommandError> {
    let settings_filter = format!(" WHERE key IN ({})", watched_settings_list());
    let mut result = Snapshot::new();
    for table in SNAPSHOT_TABLES {
        let primary = keys(db, table)?;
        let filter = if *table == "settings" {
            settings_filter.as_str()
        } else {
            ""
        };
        let mut statement = db
            .prepare(&format!("SELECT * FROM \"{table}\"{filter} LIMIT 10001"))
            .map_err(CommandError::database)?;
        let columns: Vec<String> = statement
            .column_names()
            .iter()
            .map(|s| s.to_string())
            .collect();
        let mut rows = statement.query([]).map_err(CommandError::database)?;
        let mut objects = BTreeMap::new();
        while let Some(row) = rows.next().map_err(CommandError::database)? {
            if objects.len() >= 10000 {
                return Err(invalid("当前数据量超出安全预览上限，请使用原有编辑器。"));
            }
            let mut value = Row::new();
            for (i, name) in columns.iter().enumerate() {
                let v: SqlValue = row.get(i).map_err(CommandError::database)?;
                value.insert(
                    name.clone(),
                    match v {
                        SqlValue::Null => Value::Null,
                        SqlValue::Integer(n) => n.into(),
                        SqlValue::Real(n) => serde_json::json!(n),
                        SqlValue::Text(s) => s.into(),
                        SqlValue::Blob(_) => return Err(invalid("业务数据包含不支持的字段。")),
                    },
                );
            }
            let key = encode(&primary.iter().map(|k| &value[k]).collect::<Vec<_>>())?;
            objects.insert(key, value);
        }
        result.insert(table.to_string(), objects);
    }
    Ok(result)
}

fn difference(before: &Snapshot, after: &Snapshot) -> Vec<Patch> {
    let mut patches = vec![];
    for table in TABLES {
        let all: BTreeSet<_> = before[*table].keys().chain(after[*table].keys()).collect();
        for key in all {
            let old = before[*table].get(key);
            let new = after[*table].get(key);
            if old != new {
                patches.push(Patch {
                    table: table.to_string(),
                    key: key.clone(),
                    before: old.cloned(),
                    after: new.cloned(),
                });
            }
        }
    }
    patches
}

// Include every affected aggregate's children, not only rows present in the
// diff. A later added tag/exception must also block undo.
fn affected(snapshot: &Snapshot, patches: &[Patch]) -> Snapshot {
    let mut ids = BTreeSet::new();
    let mut lanes = BTreeSet::new();
    for patch in patches {
        for row in patch.before.iter().chain(patch.after.iter()) {
            for field in [
                "id",
                "task_id",
                "series_id",
                "linked_event_id",
                "linked_task_id",
                "tag_id",
                "collaborator_id",
            ] {
                if let Some(Value::String(id)) = row.get(field) {
                    ids.insert(id.clone());
                }
            }
            if let Some(Value::String(id)) = row.get("lane_id") {
                lanes.insert(id.clone());
            }
        }
    }
    // A newly inserted last task changes lane ordering even when no old row was
    // renumbered. Guard complete affected lanes against these phantom members.
    for row in snapshot["tasks"].values() {
        if row
            .get("lane_id")
            .and_then(Value::as_str)
            .is_some_and(|id| lanes.contains(id))
        {
            if let Some(Value::String(id)) = row.get("id") {
                ids.insert(id.clone());
            }
        }
    }
    for table in ["task_tag_links", "task_collaborator_links"] {
        for row in snapshot[table].values() {
            if row
                .get("task_id")
                .and_then(Value::as_str)
                .is_some_and(|id| ids.contains(id))
            {
                for field in ["tag_id", "collaborator_id"] {
                    if let Some(Value::String(id)) = row.get(field) {
                        ids.insert(id.clone());
                    }
                }
            }
        }
    }
    snapshot
        .iter()
        .map(|(table, rows)| {
            let selected = rows
                .iter()
                .filter(|(_, row)| {
                    if table == "settings" {
                        return !lanes.is_empty();
                    }
                    if table == "task_lanes" {
                        return row
                            .get("id")
                            .and_then(Value::as_str)
                            .is_some_and(|id| lanes.contains(id));
                    }
                    ["id", "task_id", "series_id"].iter().any(|field| {
                        row.get(*field)
                            .and_then(Value::as_str)
                            .is_some_and(|id| ids.contains(id))
                    })
                })
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect();
            (table.clone(), selected)
        })
        .collect()
}

fn sql_value(value: &Value) -> Result<SqlValue, CommandError> {
    Ok(match value {
        Value::Null => SqlValue::Null,
        Value::String(s) => SqlValue::Text(s.clone()),
        Value::Number(n) if n.is_i64() => SqlValue::Integer(n.as_i64().unwrap()),
        Value::Number(n) => SqlValue::Real(n.as_f64().ok_or_else(|| invalid("无效数值。"))?),
        _ => return Err(invalid("无效数据库字段。")),
    })
}

fn apply(db: &Connection, patches: &[Patch]) -> Result<(), CommandError> {
    if patches.iter().any(|p| !TABLES.contains(&p.table.as_str())) {
        return Err(invalid("操作记录包含不可修改的数据表。"));
    }
    db.execute_batch("PRAGMA defer_foreign_keys=ON")
        .map_err(CommandError::database)?;
    // Child deletes precede parent deletes. Updates are UPSERTs, never REPLACE,
    // which would accidentally trigger ON DELETE cascades.
    for patch in patches.iter().rev().filter(|p| p.after.is_none()) {
        let pk = keys(db, &patch.table)?;
        let row = patch
            .before
            .as_ref()
            .ok_or_else(|| invalid("无效删除记录。"))?;
        let where_sql = pk
            .iter()
            .map(|k| format!("\"{k}\"=?"))
            .collect::<Vec<_>>()
            .join(" AND ");
        let params = pk
            .iter()
            .map(|k| sql_value(&row[k]))
            .collect::<Result<Vec<_>, _>>()?;
        db.execute(
            &format!("DELETE FROM \"{}\" WHERE {where_sql}", patch.table),
            params_from_iter(params),
        )
        .map_err(CommandError::database)?;
    }
    for patch in patches.iter().filter(|p| p.after.is_some()) {
        let pk = keys(db, &patch.table)?;
        let row = patch.after.as_ref().unwrap();
        // Columns originate from schema snapshots, not from model SQL.
        let columns: Vec<_> = row.keys().collect();
        let quoted = columns
            .iter()
            .map(|k| format!("\"{k}\""))
            .collect::<Vec<_>>()
            .join(",");
        let placeholders = vec!["?"; columns.len()].join(",");
        let target = pk
            .iter()
            .map(|k| format!("\"{k}\""))
            .collect::<Vec<_>>()
            .join(",");
        let updates = columns
            .iter()
            .filter(|k| !pk.contains(k))
            .map(|k| format!("\"{k}\"=excluded.\"{k}\""))
            .collect::<Vec<_>>()
            .join(",");
        let conflict = if updates.is_empty() {
            "NOTHING".into()
        } else {
            format!("UPDATE SET {updates}")
        };
        let params = columns
            .iter()
            .map(|k| sql_value(&row[*k]))
            .collect::<Result<Vec<_>, _>>()?;
        db.execute(&format!("INSERT INTO \"{}\" ({quoted}) VALUES ({placeholders}) ON CONFLICT ({target}) DO {conflict}",patch.table),
            params_from_iter(params)).map_err(CommandError::database)?;
    }
    Ok(())
}

fn authorize_patch(patches: &[Patch], permissions: &Permissions) -> Result<(), CommandError> {
    for patch in patches {
        let calendar = patch.table == "events" || patch.table == "event_exceptions";
        if (calendar && !permissions.calendar) || (!calendar && !permissions.tasks) {
            return Err(invalid(
                "此操作会连带修改未授权的数据类型，请检查旧关联或调整权限。",
            ));
        }
    }
    Ok(())
}

pub fn prepare(
    db: &Connection,
    actions: Vec<Action>,
    expected: i64,
    permissions: &Permissions,
) -> Result<Plan, CommandError> {
    require_permissions(&actions, permissions)?;
    if actions.is_empty() || actions.len() > 20 {
        return Err(invalid("每份计划必须包含1至20个目标。"));
    }
    if actions.iter().any(|a| a.domain() != actions[0].domain()) {
        return Err(invalid("请分别处理日程和任务，不执行跨模块的半份请求。"));
    }
    let outer = WriteScope::new(db).map_err(CommandError::database)?;
    if revision(&outer)? != expected {
        return Err(CommandError::conflict("数据已变化，请重新查询并生成预览。"));
    }
    let before = snapshot(&outer)?;
    let mut changes = vec![];
    let mut seen = BTreeSet::new();
    for action in &actions {
        let change = actions::perform(&outer, action)?;
        if !seen.insert(change.key.clone()) {
            return Err(invalid("同一目标不能在一份计划中重复出现。"));
        }
        changes.push(change);
    }
    let after = snapshot(&outer)?;
    let patches = difference(&before, &after);
    authorize_patch(&patches, permissions)?;
    let guard = affected(&after, &patches);
    let options = if actions[0].domain() == "tasks" {
        let workspace = crate::task_workspace::snapshot(&outer)?;
        serde_json::json!({"lanes":workspace.lanes.iter().map(|l|serde_json::json!({"id":l.id,"name":l.name})).collect::<Vec<_>>(),
            "completionLaneId":workspace.completion_lane_id,"defaultLaneId":workspace.default_lane_id})
    } else {
        serde_json::json!({})
    };
    let mut overlaps = vec![];
    for change in &changes {
        if let (Some(start), Some(end)) = (
            change.after["startAt"].as_str(),
            change.after["endAt"].as_str(),
        ) {
            let range = crate::models::EventRange {
                start_at: start.into(),
                end_at_exclusive: end.into(),
            };
            let events = crate::events::list_overlapping(&outer, &range)?;
            let count = events
                .iter()
                .filter(|e| {
                    !(e.id == change.after["id"].as_str().unwrap_or("")
                        && e.occurrence_start_at.as_deref()
                            == change.after["occurrenceStartAt"].as_str())
                })
                .count();
            if count > 0 {
                overlaps.push(format!(
                    "「{}」与 {count} 项本地日程时间重叠；不会自动改期。",
                    change.title
                ));
            }
            if permissions.external {
                let external = crate::subscriptions::list_external_in_range(&outer, &range)?;
                if external
                    .iter()
                    .any(|e| e.start_at.as_str() < end && e.end_at.as_str() > start)
                {
                    overlaps.push(format!("「{}」与外部日历时间重叠（只读）。", change.title));
                }
            }
        }
    }
    drop(outer); // Unconditional rollback of every simulated business change.
    let now = now_ms();
    let mut warnings = vec!["仅修改本地数据；确认前不会提交。".into()];
    if actions[0].domain() == "tasks" {
        warnings.push("看板和四象限共用任务；完成状态、所属列和视图会按现有规则联动。".into());
    }
    if changes.iter().any(|c| c.before["seriesId"].is_string()) {
        warnings.push("重复日程只处理所选这一次，不改变其他日期。".into());
    }
    warnings.extend(overlaps);
    if actions[0].domain() == "calendar" && !permissions.external {
        warnings.push("未授权读取外部日历，冲突检查仅覆盖本地日程。".into());
    }
    for patch in patches
        .iter()
        .filter(|p| p.table == "events" || p.table == "tasks")
    {
        let row = patch.after.as_ref().or(patch.before.as_ref()).unwrap();
        let id = row.get("id");
        if changes
            .iter()
            .any(|c| Some(&c.before["id"]) == id || Some(&c.after["id"]) == id)
        {
            continue;
        }
        let title = row.get("title").and_then(Value::as_str).unwrap_or("");
        if patch.table == "events" {
            warnings.push(format!(
                "同时更新关联日程「{title}」的任务关联；不会取消该日程。"
            ));
        } else {
            warnings.push(format!("同时更新关联任务「{title}」的日程关联或看板排序。"));
        }
    }
    for change in &changes {
        if let Some(start) = change.after["startAt"].as_str() {
            if start
                < chrono::Local::now()
                    .format("%Y-%m-%dT%H:%M")
                    .to_string()
                    .as_str()
            {
                warnings.push("方案包含过去的时间；这是补记，不保证补发已错过的提醒。".into());
            }
        }
    }
    let plan = Plan {
        id: uuid::Uuid::new_v4().to_string(),
        status: "pending".into(),
        created_at: now,
        expires_at: now + 300000,
        revision: expected,
        actions,
        changes,
        warnings,
        options,
    };
    db.execute(
        "DELETE FROM assistant_plans WHERE created_at<?1",
        [now - RETENTION_MS],
    )
    .map_err(CommandError::database)?;
    db.execute(
        "INSERT INTO assistant_plans VALUES(?1,?2,'pending',?3,?4,?5,?6,?7,?8)",
        params![
            plan.id,
            session(),
            now,
            plan.expires_at,
            expected,
            encode(&plan)?,
            encode(&patches)?,
            encode(&guard)?
        ],
    )
    .map_err(CommandError::database)?;
    Ok(plan)
}

pub fn add_warning(db: &Connection, plan: &mut Plan, warning: String) -> Result<(), CommandError> {
    plan.warnings.push(warning);
    db.execute(
        "UPDATE assistant_plans SET plan=?1 WHERE id=?2 AND status='pending'",
        params![encode(plan)?, plan.id],
    )
    .map_err(CommandError::database)?;
    Ok(())
}

pub fn get(db: &Connection, id: &str) -> Result<Plan, CommandError> {
    let row: Option<(String,String,i64,String)> = db.query_row(
        "SELECT plan,status,expires_at,session_id FROM assistant_plans WHERE id=?1 AND created_at>=?2",
        params![id,now_ms()-RETENTION_MS], |r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?)))
        .optional().map_err(CommandError::database)?;
    let (json, status, expires, owner) =
        row.ok_or_else(|| CommandError::not_found("操作不存在或已超过7天保留期。"))?;
    let mut plan: Plan = decode(&json)?;
    plan.status = if status == "pending" && (expires <= now_ms() || owner != session()) {
        "expired".into()
    } else {
        status
    };
    Ok(plan)
}
pub fn history(db: &Connection) -> Result<Vec<Plan>, CommandError> {
    let mut stmt = db
        .prepare(
            "SELECT id FROM assistant_plans WHERE created_at>=?1 ORDER BY created_at DESC LIMIT 50",
        )
        .map_err(CommandError::database)?;
    let ids = stmt
        .query_map([now_ms() - RETENTION_MS], |r| r.get::<_, String>(0))
        .map_err(CommandError::database)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(CommandError::database)?;
    ids.iter().map(|id| get(db, id)).collect()
}
pub fn cancel(db: &Connection, id: &str) -> Result<(), CommandError> {
    db.execute(
        "UPDATE assistant_plans SET status='cancelled' WHERE id=?1 AND status='pending'",
        [id],
    )
    .map_err(CommandError::database)?;
    Ok(())
}
pub fn require_live_preview(db: &Connection, id: &str) -> Result<(), CommandError> {
    let (status, expiry, owner): (String, i64, String) = db
        .query_row(
            "SELECT status,expires_at,session_id FROM assistant_plans WHERE id=?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(CommandError::database)?;
    if !matches!(status.as_str(), "pending" | "cancelled")
        || expiry <= now_ms()
        || owner != session()
    {
        return Err(CommandError::conflict(
            "预览已执行、过期或应用已重启，请重新查询生成。",
        ));
    }
    Ok(())
}
fn private(db: &Connection, id: &str) -> Result<(Vec<Patch>, Snapshot), CommandError> {
    let (patch, guard): (String, String) = db
        .query_row(
            "SELECT patch,undo_guard FROM assistant_plans WHERE id=?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(CommandError::database)?;
    Ok((decode(&patch)?, decode(&guard)?))
}
pub fn execute(db: &Connection, id: &str, permissions: &Permissions) -> Result<Plan, CommandError> {
    let outer = WriteScope::new(db).map_err(CommandError::database)?;
    let mut plan = get(&outer, id)?;
    if plan.status == "committed" || plan.status == "undone" {
        return Ok(plan);
    }
    require_permissions(&plan.actions, permissions)?;
    if plan.status != "pending" {
        return Err(CommandError::conflict(
            "计划已取消、过期或应用已重启，请重新生成预览。",
        ));
    }
    if revision(&outer)? != plan.revision {
        return Err(CommandError::conflict(
            "数据或查询范围已变化，请重新生成预览。",
        ));
    }
    let (patch, guard) = private(&outer, id)?;
    authorize_patch(&patch, permissions)?;
    apply(&outer, &patch)?;
    if affected(&snapshot(&outer)?, &patch) != guard {
        return Err(CommandError::conflict(
            "执行结果与预览不一致，已回滚全部变更。",
        ));
    }
    outer
        .execute(
            "UPDATE assistant_plans SET status='committed' WHERE id=?1",
            [id],
        )
        .map_err(CommandError::database)?;
    outer.commit().map_err(CommandError::database)?;
    plan.status = "committed".into();
    Ok(plan)
}
pub fn undo(db: &Connection, id: &str, permissions: &Permissions) -> Result<Plan, CommandError> {
    let outer = WriteScope::new(db).map_err(CommandError::database)?;
    let mut plan = get(&outer, id)?;
    if plan.status == "undone" {
        return Ok(plan);
    }
    require_permissions(&plan.actions, permissions)?;
    if plan.status != "committed" {
        return Err(invalid("只有已成功执行的操作可以撤销。"));
    }
    let (patch, guard) = private(&outer, id)?;
    authorize_patch(&patch, permissions)?;
    if affected(&snapshot(&outer)?, &patch) != guard {
        return Err(CommandError::conflict(
            "相关数据已有后续修改，无法安全撤销；未覆盖当前数据。",
        ));
    }
    let inverse = patch
        .into_iter()
        .map(|p| Patch {
            before: p.after,
            after: p.before,
            ..p
        })
        .collect::<Vec<_>>();
    apply(&outer, &inverse)?;
    outer
        .execute(
            "UPDATE assistant_plans SET status='undone' WHERE id=?1",
            [id],
        )
        .map_err(CommandError::database)?;
    outer.commit().map_err(CommandError::database)?;
    plan.status = "undone".into();
    Ok(plan)
}
