//! Lets external agents (Codex, Claude Code, WorkBuddy…) use Nowly's skills
//! through the `nowly` CLI. The CLI talks to this process over a named pipe
//! only the current user can open; every request goes through the same
//! query → plan → confirm → undo path as the built-in assistant, and every plan
//! waits on the Nowly Bar for the user before it runs.
//!
//! Agents are off until the user turns them on, and get their own permissions,
//! separate from the built-in assistant's.

mod handler;
#[cfg(windows)]
mod pipe;
pub mod protocol;
mod skill_md;

use crate::{assistant::types::Permissions, db::AppDb, error::CommandError};
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, WebviewWindow};

pub use handler::{Bridge, Host};

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub permissions: Permissions,
}

pub fn config(db: &Connection) -> Result<AgentConfig, CommandError> {
    let raw: Option<String> = db
        .query_row("SELECT config FROM agent_bridge_config WHERE id=1", [], |r| r.get(0))
        .optional()
        .map_err(CommandError::database)?;
    match raw {
        None => Ok(AgentConfig::default()),
        Some(raw) => serde_json::from_str(&raw)
            .map_err(|_| CommandError::validation("agents", "外部代理设置无效，请重新保存。")),
    }
}

pub fn save_config(db: &Connection, mut config: AgentConfig) -> Result<AgentConfig, CommandError> {
    // Writing a connected calendar builds on reading it.
    if !config.permissions.external {
        config.permissions.external_write = false;
    }
    db.execute(
        "INSERT INTO agent_bridge_config(id,config) VALUES(1,?1)
         ON CONFLICT(id) DO UPDATE SET config=excluded.config",
        [serde_json::to_string(&config).map_err(CommandError::system)?],
    )
    .map_err(CommandError::database)?;
    Ok(config)
}

/// What an agent's plan may touch right now: nothing while agents are off.
pub fn permissions(db: &Connection) -> Result<Permissions, CommandError> {
    let config = config(db)?;
    Ok(if config.enabled { config.permissions } else { Permissions::default() })
}

struct AppHost(AppHandle);

impl Host for AppHost {
    fn db(&self) -> &AppDb {
        self.0.state::<AppDb>().inner()
    }
    fn present(&self, plan: crate::assistant::types::Plan) {
        self.0.state::<crate::voice::session::Voice>().present(plan);
    }
    fn notify(&self, plan: &crate::assistant::types::Plan) {
        let _ = crate::assistant::commands::notify_changed(&self.0, plan);
    }
}

/// Starts the pipe server. It always listens, so the CLI can tell "turned
/// off" apart from "not running"; requests are refused while agents are off.
pub fn start(app: &AppHandle) {
    #[cfg(windows)]
    pipe::serve(std::sync::Arc::new(AppHost(app.clone())), std::sync::Arc::new(Bridge::default()));
    #[cfg(not(windows))]
    let _ = app;
}

fn require_main(window: &WebviewWindow) -> Result<(), CommandError> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err(CommandError::reported("This window cannot manage external agents."))
    }
}

#[tauri::command]
pub fn agent_bridge_get_config(
    window: WebviewWindow,
    db: tauri::State<'_, AppDb>,
) -> Result<AgentConfig, CommandError> {
    require_main(&window)?;
    config(&*db.0.lock().map_err(CommandError::database)?)
}

#[tauri::command]
pub fn agent_bridge_save_config(
    window: WebviewWindow,
    db: tauri::State<'_, AppDb>,
    config: AgentConfig,
) -> Result<AgentConfig, CommandError> {
    require_main(&window)?;
    save_config(&*db.0.lock().map_err(CommandError::database)?, config)
}

#[tauri::command]
pub fn agent_bridge_skill_md(window: WebviewWindow) -> Result<String, CommandError> {
    require_main(&window)?;
    Ok(skill_md::render(&skill_md::command()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> Connection {
        let mut db = Connection::open_in_memory().unwrap();
        crate::db::migrate(&mut db).unwrap();
        db
    }

    #[test]
    fn agents_start_off_and_grant_nothing_until_turned_on() {
        let db = db();
        assert_eq!(config(&db).unwrap(), AgentConfig::default());
        let granted = Permissions { tasks: true, ..Default::default() };
        save_config(&db, AgentConfig { enabled: false, permissions: granted.clone() }).unwrap();
        assert_eq!(permissions(&db).unwrap(), Permissions::default());
        save_config(&db, AgentConfig { enabled: true, permissions: granted.clone() }).unwrap();
        assert_eq!(permissions(&db).unwrap(), granted);
    }

    #[test]
    fn writing_connected_calendars_needs_reading_them() {
        let db = db();
        let saved = save_config(
            &db,
            AgentConfig {
                enabled: true,
                permissions: Permissions { external_write: true, ..Default::default() },
            },
        )
        .unwrap();
        assert!(!saved.permissions.external_write);
    }
}
