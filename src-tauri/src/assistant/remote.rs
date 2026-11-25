//! Executes and undoes plans that write a connected Google or Microsoft
//! calendar. These cannot be simulated or rolled back like local plans: each
//! runs one provider request outside the database lock, claimed by a status
//! transition so two confirmations cannot both send it.
use super::{actions, store, types::*};
use crate::{db::AppDb, error::CommandError};

fn invalid(message: &str) -> CommandError {
    CommandError::validation("assistant", message)
}

fn claim(db: &AppDb, id: &str, from: &str, to: &str) -> Result<Plan, CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    let plan = store::get(&connection, id)?;
    store::require_permissions(&plan.actions, &super::commands::permissions_for(&connection, &plan)?)?;
    if plan.status != from {
        return Err(CommandError::conflict(
            "计划已取消、过期或已处理，请重新生成预览。",
        ));
    }
    store::transition(&connection, id, from, to)?;
    Ok(plan)
}

fn settle(db: &AppDb, plan: &mut Plan, from: &str, to: &str) -> Result<(), CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    store::transition(&connection, &plan.id, from, to)?;
    plan.status = to.into();
    store::rewrite(&connection, plan)
}

fn target(change: &Change) -> Result<(String, Option<String>), CommandError> {
    let subscription = change.after["subscriptionId"]
        .as_str()
        .or_else(|| change.before["subscriptionId"].as_str())
        .ok_or_else(|| invalid("远端日程记录不完整。"))?;
    let remote = change.after["remoteEventId"]
        .as_str()
        .or_else(|| change.before["remoteEventId"].as_str());
    Ok((subscription.into(), remote.map(str::to_owned)))
}

pub fn execute(db: &AppDb, id: &str) -> Result<Plan, CommandError> {
    {
        let connection = db.0.lock().map_err(CommandError::database)?;
        let plan = store::get(&connection, id)?;
        if plan.status == "committed" || plan.status == "undone" {
            return Ok(plan);
        }
    }
    let mut plan = claim(db, id, "pending", "executing")?;
    let change = plan.changes.first().cloned().ok_or_else(|| invalid("计划为空。"))?;
    let (subscription, remote) = target(&change)?;
    let draft = actions::remote_draft(&change.after)?;
    let written = match &plan.actions[0] {
        Action::CreateRemoteEvent { .. } => crate::remote_events::run_write(
            db, &subscription, None, Some(draft), "create", true,
        ),
        Action::UpdateRemoteEvent { .. } => crate::remote_events::run_write(
            db,
            &subscription,
            remote.as_deref(),
            Some(draft),
            "update",
            change.before["note"] != change.after["note"],
        ),
        _ => Err(invalid("不是远端日历操作。")),
    };
    match written {
        Ok(written) => {
            if let (Action::CreateRemoteEvent { .. }, Some(id)) = (&plan.actions[0], written) {
                plan.changes[0].after["remoteEventId"] = id.clone().into();
                plan.changes[0].key = format!("remote:{subscription}:{id}");
            }
            settle(db, &mut plan, "executing", "committed")?;
            Ok(plan)
        }
        Err(error) => {
            // The request may have reached the provider before failing, so a
            // retry could write twice. The user re-issues it after checking.
            settle(db, &mut plan, "executing", "failed")?;
            Err(error)
        }
    }
}

pub fn undo(db: &AppDb, id: &str) -> Result<Plan, CommandError> {
    {
        let connection = db.0.lock().map_err(CommandError::database)?;
        let plan = store::get(&connection, id)?;
        if plan.status == "undone" {
            return Ok(plan);
        }
    }
    let mut plan = claim(db, id, "committed", "undoing")?;
    let change = plan.changes.first().cloned().ok_or_else(|| invalid("计划为空。"))?;
    let (subscription, remote) = target(&change)?;
    let reverted = match &plan.actions[0] {
        Action::CreateRemoteEvent { .. } => match remote.as_deref() {
            Some(remote) => crate::remote_events::run_write(
                db, &subscription, Some(remote), None, "delete", false,
            ),
            None => Err(invalid("服务未返回新日程的标识，请在日历中手动删除。")),
        },
        Action::UpdateRemoteEvent { .. } => crate::remote_events::run_write(
            db,
            &subscription,
            remote.as_deref(),
            Some(actions::remote_draft(&change.before)?),
            "update",
            change.before["note"] != change.after["note"],
        ),
        _ => Err(invalid("不是远端日历操作。")),
    };
    match reverted {
        Ok(_) => {
            settle(db, &mut plan, "undoing", "undone")?;
            Ok(plan)
        }
        Err(error) => {
            settle(db, &mut plan, "undoing", "committed")?;
            Err(error)
        }
    }
}
