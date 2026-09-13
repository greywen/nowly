//! IPC boundary. The sandbox receives none of these tools; only the main
//! application can manage credentials or explicitly confirm a stored plan.
use super::{
    provider::{self, Config, Request},
    store,
    types::*,
};
use crate::{db::AppDb, error::CommandError};
use std::{
    collections::BTreeMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager, State, WebviewWindow};

#[derive(Default)]
pub struct Requests(pub Mutex<RequestRegistry>);
#[derive(Default)]
pub struct RequestRegistry {
    running: BTreeMap<String, Arc<AtomicBool>>,
    cancelled: BTreeMap<String, Instant>,
}
fn register(requests: &mut RequestRegistry, id: &str) -> Result<Arc<AtomicBool>, CommandError> {
    requests
        .cancelled
        .retain(|_, at| at.elapsed() < Duration::from_secs(300));
    if requests.running.contains_key(id) || requests.cancelled.contains_key(id) {
        return Err(CommandError::conflict("请求已取消或正在处理中。"));
    }
    if requests
        .running
        .values()
        .any(|flag| !flag.load(Ordering::SeqCst))
    {
        return Err(CommandError::conflict(
            "已有请求正在处理，请先停止或稍后重试。",
        ));
    }
    if requests.running.len() >= 32 {
        return Err(CommandError::conflict("取消的请求仍在结束，请稍后重试。"));
    }
    let flag = Arc::new(AtomicBool::new(false));
    requests.running.insert(id.into(), flag.clone());
    Ok(flag)
}
/// Releases the registry entry even if the worker panics; a leaked entry would
/// otherwise make every later request fail with "already running" until restart.
fn release(requests: &mut RequestRegistry, id: &str) {
    requests.running.remove(id);
}
struct RunningGuard {
    app: AppHandle,
    id: String,
}
impl Drop for RunningGuard {
    fn drop(&mut self) {
        if let Ok(mut requests) = self.app.state::<Requests>().0.lock() {
            release(&mut requests, &self.id);
        }
    }
}
fn cancel_request(requests: &mut RequestRegistry, id: String) {
    if let Some(flag) = requests.running.get(&id) {
        flag.store(true, Ordering::SeqCst);
    }
    requests
        .cancelled
        .retain(|_, at| at.elapsed() < Duration::from_secs(300));
    if requests.cancelled.len() >= 1024 {
        if let Some(oldest) = requests
            .cancelled
            .iter()
            .min_by_key(|(_, at)| *at)
            .map(|(id, _)| id.clone())
        {
            requests.cancelled.remove(&oldest);
        }
    }
    requests.cancelled.insert(id, Instant::now());
}
fn main_only(window: &WebviewWindow) -> Result<(), CommandError> {
    if !matches!(window.label(), "main" | "quick-panel") {
        return Err(CommandError::validation(
            "assistant",
            "此操作只允许在 Nowly 窗口中执行。",
        ));
    }
    Ok(())
}
#[tauri::command]
pub fn assistant_get_config(
    window: WebviewWindow,
    db: State<'_, AppDb>,
) -> Result<Config, CommandError> {
    main_only(&window)?;
    provider::get_config(&*db.0.lock().map_err(CommandError::database)?)
}
#[tauri::command]
pub async fn assistant_save_config(
    window: WebviewWindow,
    app: AppHandle,
    config: Config,
    api_key: Option<String>,
    clear_key: bool,
) -> Result<Config, CommandError> {
    main_only(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        provider::save_detected_with(
            &app.state::<AppDb>().0,
            config,
            api_key,
            clear_key,
            super::rig_transport::probe,
        )
    })
    .await
    .map_err(|_| CommandError::validation("assistant", "连接检测未完成；原设置未更改，请重试。"))?
}
#[tauri::command]
pub async fn assistant_interpret(
    window: WebviewWindow,
    app: AppHandle,
    request: Request,
) -> Result<Reply, CommandError> {
    main_only(&window)?;
    if uuid::Uuid::parse_str(&request.request_id).is_err() {
        return Err(CommandError::validation("requestId", "请求标识无效。"));
    }
    let flag = {
        let state = app.state::<Requests>();
        let mut requests = state.0.lock().map_err(CommandError::database)?;
        register(&mut requests, &request.request_id)?
    };
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = RunningGuard {
            app: app.clone(),
            id: request.request_id.clone(),
        };
        provider::run_with(
            &app.state::<AppDb>().0,
            &request,
            &flag,
            provider::send_http,
        )
    })
    .await
    .map_err(CommandError::system)?
}
#[tauri::command]
pub fn assistant_cancel_request(
    window: WebviewWindow,
    state: State<'_, Requests>,
    request_id: String,
) -> Result<(), CommandError> {
    main_only(&window)?;
    if uuid::Uuid::parse_str(&request_id).is_err() {
        return Err(CommandError::validation("requestId", "请求标识无效。"));
    }
    let mut requests = state.0.lock().map_err(CommandError::database)?;
    cancel_request(&mut requests, request_id);
    Ok(())
}
#[tauri::command]
pub fn assistant_revise(
    window: WebviewWindow,
    db: State<'_, AppDb>,
    plan_id: String,
    actions: Vec<Action>,
) -> Result<Plan, CommandError> {
    main_only(&window)?;
    let db = db.0.lock().map_err(CommandError::database)?;
    revise(&db, plan_id, actions)
}
pub(crate) fn revise(
    db: &rusqlite::Connection,
    plan_id: String,
    actions: Vec<Action>,
) -> Result<Plan, CommandError> {
    let old = store::get(&db, &plan_id)?;
    // Retire predecessor even if new fields fail validation. It must never
    // remain executable after the UI has changed its visible content.
    store::cancel(&db, &plan_id)?;
    store::require_live_preview(db, &plan_id)?;
    if old.status != "pending" && old.status != "cancelled" {
        return Err(CommandError::conflict("计划已过期或执行，请重新生成。"));
    }
    if actions.len() > old.actions.len() {
        return Err(CommandError::validation(
            "actions",
            "修改预览不能增加未授权目标。",
        ));
    }
    let identity = |a: &Action| -> String {
        match a {
            Action::CreateEvent { .. } => "createEvent".into(),
            Action::CreateTask { .. } => "createTask".into(),
            Action::UpdateEvent { target, .. } => {
                format!("update:{}", super::actions::event_key(target))
            }
            Action::DeleteEvent { target } => {
                format!("delete:{}", super::actions::event_key(target))
            }
            Action::UpdateTask { id, .. } => format!("update:tasks:{id}"),
            Action::DeleteTask { id } => format!("delete:tasks:{id}"),
        }
    };
    if actions
        .iter()
        .any(|a| !old.actions.iter().any(|old| identity(old) == identity(a)))
    {
        return Err(CommandError::validation(
            "actions",
            "修改预览不能替换为其他目标或操作。",
        ));
    }
    let permissions = provider::get_config(&db)?.permissions;
    store::prepare(&db, actions, old.revision, &permissions)
}
#[tauri::command]
pub fn assistant_cancel_plan(
    window: WebviewWindow,
    db: State<'_, AppDb>,
    plan_id: String,
) -> Result<(), CommandError> {
    main_only(&window)?;
    store::cancel(&*db.0.lock().map_err(CommandError::database)?, &plan_id)
}
#[tauri::command]
pub fn assistant_execute(
    window: WebviewWindow,
    db: State<'_, AppDb>,
    plan_id: String,
) -> Result<Plan, CommandError> {
    main_only(&window)?;
    let db = db.0.lock().map_err(CommandError::database)?;
    let plan = store::execute(&db, &plan_id, &provider::get_config(&db)?.permissions)?;
    drop(db);
    crate::status_island::invalidate_registered()?;
    Ok(plan)
}
#[tauri::command]
pub fn assistant_undo(
    window: WebviewWindow,
    db: State<'_, AppDb>,
    plan_id: String,
) -> Result<Plan, CommandError> {
    main_only(&window)?;
    let db = db.0.lock().map_err(CommandError::database)?;
    let plan = store::undo(&db, &plan_id, &provider::get_config(&db)?.permissions)?;
    drop(db);
    crate::status_island::invalidate_registered()?;
    Ok(plan)
}
#[tauri::command]
pub fn assistant_history(
    window: WebviewWindow,
    db: State<'_, AppDb>,
) -> Result<Vec<Plan>, CommandError> {
    main_only(&window)?;
    store::history(&*db.0.lock().map_err(CommandError::database)?)
}
#[tauri::command]
pub fn assistant_status(
    window: WebviewWindow,
    db: State<'_, AppDb>,
    plan_id: String,
) -> Result<Plan, CommandError> {
    main_only(&window)?;
    store::get(&*db.0.lock().map_err(CommandError::database)?, &plan_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn late_cancellations_do_not_permanently_block_fresh_requests() {
        let mut registry = Default::default();
        for _ in 0..40 {
            cancel_request(&mut registry, uuid::Uuid::new_v4().to_string());
        }
        assert!(register(&mut registry, &uuid::Uuid::new_v4().to_string()).is_ok());
    }
    #[test]
    fn pre_cancel_and_parallel_requests_fail_closed() {
        let mut registry = Default::default();
        let id = uuid::Uuid::new_v4().to_string();
        cancel_request(&mut registry, id.clone());
        assert!(register(&mut registry, &id).is_err());
        let id = uuid::Uuid::new_v4().to_string();
        let flag = register(&mut registry, &id).unwrap();
        assert!(register(&mut registry, &uuid::Uuid::new_v4().to_string()).is_err());
        cancel_request(&mut registry, id);
        assert!(flag.load(Ordering::SeqCst));
    }
    #[test]
    fn releasing_a_finished_worker_unblocks_the_next_request() {
        let mut registry = RequestRegistry::default();
        let first = uuid::Uuid::new_v4().to_string();
        register(&mut registry, &first).unwrap();
        assert!(register(&mut registry, &uuid::Uuid::new_v4().to_string()).is_err());
        // A worker that panics must still reach this, or the feature stays
        // locked until the process restarts.
        release(&mut registry, &first);
        assert!(register(&mut registry, &uuid::Uuid::new_v4().to_string()).is_ok());
    }
}
