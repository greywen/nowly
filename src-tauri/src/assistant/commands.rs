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
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

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
#[derive(Clone, Copy)]
enum AssistantWindowAccess {
    Runtime,
    Settings,
}
fn assistant_window_allowed(label: &str, access: AssistantWindowAccess) -> bool {
    label == "main"
        || (label == "quick-panel-handle" && matches!(access, AssistantWindowAccess::Runtime))
}
fn require_assistant_window(
    window: &WebviewWindow,
    access: AssistantWindowAccess,
) -> Result<(), CommandError> {
    if !assistant_window_allowed(window.label(), access) {
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
    require_assistant_window(&window, AssistantWindowAccess::Runtime)?;
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
    require_assistant_window(&window, AssistantWindowAccess::Settings)?;
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
pub async fn assistant_list_models(
    window: WebviewWindow,
    app: AppHandle,
    endpoint: String,
    api_key: Option<String>,
) -> Result<Vec<String>, CommandError> {
    require_assistant_window(&window, AssistantWindowAccess::Settings)?;
    if endpoint.len() > 2000
        || api_key
            .as_ref()
            .is_some_and(|k| k.len() > 8192 || k.chars().any(char::is_control))
    {
        return Err(CommandError::validation("assistant", "API 地址或 Key 格式无效。"));
    }
    tauri::async_runtime::spawn_blocking(move || {
        // `None` reuses the key saved for this exact endpoint; `Some("")` sends none.
        let key = match api_key {
            Some(key) => key,
            None => provider::saved_key_for(
                &*app.state::<AppDb>().0.lock().map_err(CommandError::database)?,
                &endpoint,
            )?,
        };
        super::models_list::list_with(&endpoint, &key, super::models_list::fetch_http)
    })
    .await
    .map_err(CommandError::system)?
}
#[tauri::command]
pub async fn assistant_interpret(
    window: WebviewWindow,
    app: AppHandle,
    request: Request,
) -> Result<Reply, CommandError> {
    require_assistant_window(&window, AssistantWindowAccess::Runtime)?;
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
    require_assistant_window(&window, AssistantWindowAccess::Runtime)?;
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
    require_assistant_window(&window, AssistantWindowAccess::Runtime)?;
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
    // An edit may change field values only: never the kind of action, the
    // record it targets, or the calendar a remote event goes to.
    let identity = |a: &Action| -> String {
        match a {
            Action::CreateRemoteEvent { subscription_id, .. } => {
                format!("{}:{subscription_id}", a.kind())
            }
            _ => match a.target_key() {
                Some(key) => format!("{}:{key}", a.kind()),
                None => a.kind().into(),
            },
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
    require_assistant_window(&window, AssistantWindowAccess::Runtime)?;
    store::cancel(&*db.0.lock().map_err(CommandError::database)?, &plan_id)
}
/// Shared with `src/quick-create/events.ts`: the main window reloads the
/// named kind of record when it hears this.
const RECORDS_CHANGED_EVENT: &str = "nowly-records-changed";

/// The record kinds a plan touched, once each.
fn changed_kinds(plan: &Plan) -> Vec<&'static str> {
    let mut kinds = Vec::new();
    for change in &plan.changes {
        let kind = if change.kind.ends_with("Event") {
            "event"
        } else if change.kind.ends_with("Task") {
            "task"
        } else if change.kind.ends_with("Note") {
            "note"
        } else if change.kind.ends_with("Alarm") {
            "alarm"
        } else {
            continue;
        };
        if !kinds.contains(&kind) {
            kinds.push(kind);
        }
    }
    kinds
}

/// Refreshes the Bar and the main window after a plan was committed or undone
/// outside the main window.
pub(crate) fn notify_changed(app: &AppHandle, plan: &Plan) -> Result<(), CommandError> {
    for kind in changed_kinds(plan) {
        app.emit(RECORDS_CHANGED_EVENT, serde_json::json!({ "kind": kind }))
            .map_err(CommandError::system)?;
    }
    crate::status_island::invalidate_registered()
}
/// Commits a stored plan. Remote calendar plans make a network request, which
/// runs without holding the database lock.
pub(crate) fn execute(db: &AppDb, plan_id: &str) -> Result<Plan, CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    let plan = store::get(&connection, plan_id)?;
    if store::is_remote(&plan) {
        drop(connection);
        return super::remote::execute(db, plan_id);
    }
    store::execute(&connection, plan_id, &permissions_for(&connection, &plan)?)
}
pub(crate) fn undo(db: &AppDb, plan_id: &str) -> Result<Plan, CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    let plan = store::get(&connection, plan_id)?;
    if store::is_remote(&plan) {
        drop(connection);
        return super::remote::undo(db, plan_id);
    }
    store::undo(&connection, plan_id, &permissions_for(&connection, &plan)?)
}
/// The permissions a plan is held to when it runs: an external agent's plan
/// uses the agents' own grant, which is empty while agents are turned off.
pub(crate) fn permissions_for(connection: &rusqlite::Connection, plan: &Plan) -> Result<Permissions, CommandError> {
    if plan.source == Source::External {
        return crate::agent_bridge::permissions(connection);
    }
    Ok(provider::get_config(connection)?.permissions)
}
#[tauri::command]
pub async fn assistant_execute(
    window: WebviewWindow,
    app: AppHandle,
    plan_id: String,
) -> Result<Plan, CommandError> {
    require_assistant_window(&window, AssistantWindowAccess::Runtime)?;
    tauri::async_runtime::spawn_blocking(move || {
        let plan = execute(&app.state::<AppDb>(), &plan_id)?;
        notify_changed(&app, &plan)?;
        Ok(plan)
    })
    .await
    .map_err(CommandError::system)?
}
#[tauri::command]
pub async fn assistant_undo(
    window: WebviewWindow,
    app: AppHandle,
    plan_id: String,
) -> Result<Plan, CommandError> {
    require_assistant_window(&window, AssistantWindowAccess::Runtime)?;
    tauri::async_runtime::spawn_blocking(move || {
        let plan = undo(&app.state::<AppDb>(), &plan_id)?;
        notify_changed(&app, &plan)?;
        Ok(plan)
    })
    .await
    .map_err(CommandError::system)?
}
#[tauri::command]
pub fn assistant_history(
    window: WebviewWindow,
    db: State<'_, AppDb>,
) -> Result<Vec<Plan>, CommandError> {
    require_assistant_window(&window, AssistantWindowAccess::Runtime)?;
    store::history(&*db.0.lock().map_err(CommandError::database)?)
}
#[tauri::command]
pub fn assistant_status(
    window: WebviewWindow,
    db: State<'_, AppDb>,
    plan_id: String,
) -> Result<Plan, CommandError> {
    require_assistant_window(&window, AssistantWindowAccess::Runtime)?;
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
    #[test]
    fn assistant_window_policy_allows_nowly_bar_runtime_but_not_settings() {
        assert!(assistant_window_allowed(
            "main",
            AssistantWindowAccess::Runtime
        ));
        assert!(assistant_window_allowed(
            "main",
            AssistantWindowAccess::Settings
        ));
        assert!(assistant_window_allowed(
            "quick-panel-handle",
            AssistantWindowAccess::Runtime
        ));
        assert!(!assistant_window_allowed(
            "quick-panel-handle",
            AssistantWindowAccess::Settings
        ));
        assert!(!assistant_window_allowed(
            "status-island-details",
            AssistantWindowAccess::Runtime
        ));
    }
    #[test]
    fn changed_kinds_name_each_touched_record_kind_once() {
        let change = |kind: &str| Change {
            key: String::new(),
            kind: kind.into(),
            title: String::new(),
            before: serde_json::Value::Null,
            after: serde_json::Value::Null,
        };
        let plan = Plan {
            id: "p".into(),
            status: "committed".into(),
            created_at: 0,
            expires_at: 0,
            revision: 0,
            actions: vec![],
            changes: vec![
                change("createEvent"),
                change("deleteEvent"),
                change("updateNote"),
                change("createTask"),
            ],
            warnings: vec![],
            options: serde_json::Value::Null,
            source: Source::Chat,
            client: None,
        };
        assert_eq!(changed_kinds(&plan), vec!["event", "note", "task"]);
    }
}
