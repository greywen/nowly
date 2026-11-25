//! One request from `nowly-cli`, answered without any pipe or window, so the
//! rules can be tested on a plain database.
use super::{config, protocol::VERSION, skill_md};
use crate::{
    assistant::{actions, commands, skills, store, types::*},
    db::AppDb,
    error::CommandError,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant},
};

/// How long a queried record stays open to changes from the same client.
const SEEN_FOR: Duration = Duration::from_secs(10 * 60);
/// A waiting `propose` or `status` gives up after the plan's own five-minute
/// expiry plus a margin, so a CLI never hangs forever.
const WAIT_FOR: Duration = Duration::from_secs(6 * 60);
const POLL: Duration = Duration::from_millis(250);

/// What the handler needs from the running app.
pub trait Host: Send + Sync {
    fn db(&self) -> &AppDb;
    /// Queues the plan's confirmation card on the Nowly Bar.
    fn present(&self, plan: Plan);
    /// Tells open windows which records a plan changed.
    fn notify(&self, plan: &Plan);
}

/// Records each client has queried. Like the built-in assistant, an agent may
/// only change what it has read, so it cannot act on a guessed id.
#[derive(Default)]
pub struct Bridge {
    seen: Mutex<HashMap<String, HashMap<String, Instant>>>,
}

impl Bridge {
    fn remember(&self, client: &str, keys: impl IntoIterator<Item = String>) {
        let Ok(mut seen) = self.seen.lock() else { return };
        let now = Instant::now();
        let entry = seen.entry(client.to_owned()).or_default();
        entry.retain(|_, at| now.duration_since(*at) < SEEN_FOR);
        for key in keys {
            entry.insert(key, now);
        }
    }

    fn has_seen(&self, client: &str, key: &str) -> bool {
        self.seen
            .lock()
            .ok()
            .and_then(|seen| seen.get(client).and_then(|keys| keys.get(key)).copied())
            .is_some_and(|at| at.elapsed() < SEEN_FOR)
    }
}

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", rename_all_fields = "camelCase", deny_unknown_fields)]
enum Op {
    Hello,
    Query {
        query: Query,
    },
    Propose {
        revision: i64,
        actions: Vec<Action>,
        #[serde(default)]
        wait: bool,
    },
    Status {
        plan_id: String,
        #[serde(default)]
        wait: bool,
    },
    Undo {
        plan_id: String,
    },
    Schema {
        #[serde(default)]
        skill: Option<String>,
    },
    SkillMd,
}

fn failure(code: &str, message: impl Into<String>) -> Value {
    json!({ "ok": false, "error": { "code": code, "message": message.into() } })
}

fn success(result: impl serde::Serialize) -> Value {
    json!({ "ok": true, "result": result })
}

/// The label the Bar shows, e.g. "Codex". Agents name themselves; the label is
/// only for the user's eyes and for grouping each client's queries.
fn client_label(value: Option<&Value>) -> String {
    let raw = value.and_then(Value::as_str).unwrap_or_default();
    let clean: String = raw.chars().filter(|c| !c.is_control()).take(32).collect();
    match clean.trim() {
        "" => "Agent".into(),
        label => label.into(),
    }
}

/// Answers one request line with one response value.
pub fn handle(bridge: &Bridge, host: &dyn Host, line: &str) -> Value {
    let Ok(Value::Object(mut fields)) = serde_json::from_str::<Value>(line) else {
        return failure("bad_request", "请求必须是一个 JSON 对象。");
    };
    if fields.remove("version").and_then(|v| v.as_u64()) != Some(u64::from(VERSION)) {
        return failure(
            "version",
            format!("nowly 命令行与 Nowly 应用的协议版本不一致（应用为 {VERSION}），请更新 Nowly。"),
        );
    }
    let client = client_label(fields.remove("client").as_ref());
    let op = match serde_json::from_value::<Op>(Value::Object(fields)) {
        Ok(op) => op,
        Err(error) => return failure("bad_request", format!("请求格式无效：{error}")),
    };
    match run(bridge, host, &client, op) {
        Ok(value) => value,
        Err(error) => json!({ "ok": false, "error": error }),
    }
}

fn run(bridge: &Bridge, host: &dyn Host, client: &str, op: Op) -> Result<Value, CommandError> {
    let (agents, week_start) = {
        let db = host.db().0.lock().map_err(CommandError::database)?;
        let week_start = crate::settings::read_app_settings(&db)
            .map(|s| s.week_start)
            .unwrap_or_else(|_| "monday".into());
        (config(&db)?, week_start)
    };
    let disabled = || failure("disabled", "用户尚未在 Nowly 设置中开启外部代理。");
    match op {
        Op::Hello => Ok(success(json!({
            "app": "nowly",
            "version": env!("CARGO_PKG_VERSION"),
            "protocol": VERSION,
            "enabled": agents.enabled,
            "permissions": agents.permissions,
            "now": chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string(),
            "timezone": crate::timezone::device_tz().name(),
            "weekStart": week_start,
        }))),
        Op::Schema { skill } => Ok(match skill {
            None => success(json!({
                "query": skills::query_schema(),
                "skills": skills::SKILLS.iter().map(|s| json!({
                    "id": s.id,
                    "domain": s.domain,
                    "operation": s.operation.as_str(),
                    "summary": s.summary,
                    "allowed": agents.enabled && agents.permissions.allows(s.domain),
                })).collect::<Vec<_>>(),
            })),
            Some(id) => match skills::skill(&id) {
                Some(skill) => success(skill.schema()),
                None => failure("not_found", format!("没有名为 {id} 的技能。")),
            },
        }),
        Op::SkillMd => Ok(success(skill_md::render(&skill_md::command()))),
        _ if !agents.enabled => Ok(disabled()),
        Op::Query { query } => {
            if !skills::readable(&query.domain, &agents.permissions) {
                return Ok(failure("permission", format!("用户没有允许外部代理读取 {}。", query.domain)));
            }
            let result = {
                let db = host.db().0.lock().map_err(CommandError::database)?;
                actions::query(&db, &query, &agents.permissions)?
            };
            bridge.remember(
                client,
                result.records.iter().filter(|r| !r.read_only).map(|r| r.key.clone()),
            );
            Ok(success(result))
        }
        Op::Propose { revision, actions, wait } => {
            if let Some(key) = actions
                .iter()
                .filter_map(Action::target_key)
                .find(|key| !bridge.has_seen(client, key))
            {
                return Ok(failure(
                    "not_queried",
                    format!("要修改的记录 {key} 不在最近 10 分钟的查询结果里，请先用 nowly query 查询它。"),
                ));
            }
            let plan = {
                let db = host.db().0.lock().map_err(CommandError::database)?;
                let mut plan = store::prepare(&db, actions, revision, &agents.permissions)?;
                store::set_origin(&db, &mut plan, Source::External, Some(client.to_owned()))?;
                plan
            };
            host.present(plan.clone());
            if wait {
                settle(host, &plan.id).map(success)
            } else {
                Ok(success(plan))
            }
        }
        Op::Status { plan_id, wait } => {
            own(host, client, &plan_id)?;
            if wait {
                settle(host, &plan_id).map(success)
            } else {
                let db = host.db().0.lock().map_err(CommandError::database)?;
                store::get(&db, &plan_id).map(success)
            }
        }
        Op::Undo { plan_id } => {
            own(host, client, &plan_id)?;
            let plan = commands::undo(host.db(), &plan_id)?;
            host.notify(&plan);
            Ok(success(plan))
        }
    }
}

/// A client can only look at and undo the plans it proposed.
fn own(host: &dyn Host, client: &str, plan_id: &str) -> Result<(), CommandError> {
    let db = host.db().0.lock().map_err(CommandError::database)?;
    let plan = store::get(&db, plan_id)?;
    if plan.source == Source::External && plan.client.as_deref() == Some(client) {
        Ok(())
    } else {
        Err(CommandError::not_found("没有找到这个客户端提交的方案。"))
    }
}

/// Waits until the user (or the Bar's countdown) has decided the plan.
fn settle(host: &dyn Host, plan_id: &str) -> Result<Plan, CommandError> {
    let deadline = Instant::now() + WAIT_FOR;
    loop {
        let plan = {
            let db = host.db().0.lock().map_err(CommandError::database)?;
            store::get(&db, plan_id)?
        };
        let open = matches!(plan.status.as_str(), "pending" | "executing" | "undoing");
        if !open || Instant::now() >= deadline {
            return Ok(plan);
        }
        std::thread::sleep(POLL);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_bridge::{save_config, AgentConfig};
    use rusqlite::Connection;
    use std::sync::Mutex as StdMutex;

    struct TestHost {
        db: AppDb,
        shown: StdMutex<Vec<Plan>>,
    }

    impl Host for TestHost {
        fn db(&self) -> &AppDb {
            &self.db
        }
        fn present(&self, plan: Plan) {
            self.shown.lock().unwrap().push(plan);
        }
        fn notify(&self, _: &Plan) {}
    }

    fn host(enabled: bool) -> TestHost {
        let mut db = Connection::open_in_memory().unwrap();
        db.execute_batch("PRAGMA foreign_keys=ON").unwrap();
        crate::db::migrate(&mut db).unwrap();
        crate::db::seed_test_lanes(&db);
        save_config(
            &db,
            AgentConfig {
                enabled,
                permissions: Permissions { tasks: true, ..Default::default() },
            },
        )
        .unwrap();
        TestHost { db: AppDb(std::sync::Mutex::new(db)), shown: StdMutex::new(vec![]) }
    }

    fn ask(bridge: &Bridge, host: &TestHost, client: &str, request: Value) -> Value {
        let mut request = request;
        request["version"] = json!(VERSION);
        request["client"] = json!(client);
        handle(bridge, host, &request.to_string())
    }

    fn revision(host: &TestHost) -> i64 {
        store::revision(&host.db.0.lock().unwrap()).unwrap()
    }

    fn create_task(title: &str) -> Value {
        json!({"kind":"createTask","draft":{"title":title}})
    }

    fn commit(host: &TestHost, plan_id: &str) {
        commands::execute(&host.db, plan_id).unwrap();
    }

    #[test]
    fn everything_but_hello_and_the_docs_is_refused_while_agents_are_off() {
        let (bridge, host) = (Bridge::default(), host(false));
        let hello = ask(&bridge, &host, "Codex", json!({"op":"hello"}));
        assert_eq!(hello["result"]["enabled"], json!(false));
        assert_eq!(ask(&bridge, &host, "Codex", json!({"op":"skillMd"}))["ok"], json!(true));
        let query = ask(&bridge, &host, "Codex", json!({"op":"query","query":{"domain":"tasks"}}));
        assert_eq!(query["error"]["code"], json!("disabled"));
    }

    #[test]
    fn requests_from_another_protocol_version_are_refused() {
        let (bridge, host) = (Bridge::default(), host(true));
        let reply = handle(&bridge, &host, r#"{"version":0,"op":"hello"}"#);
        assert_eq!(reply["error"]["code"], json!("version"));
        assert_eq!(handle(&bridge, &host, "not json")["error"]["code"], json!("bad_request"));
    }

    #[test]
    fn reads_follow_the_agents_own_permissions() {
        let (bridge, host) = (Bridge::default(), host(true));
        let reply = ask(&bridge, &host, "Codex", json!({"op":"query","query":{"domain":"calendar"}}));
        assert_eq!(reply["error"]["code"], json!("permission"));
    }

    #[test]
    fn a_proposal_waits_on_the_bar_and_is_labelled_with_its_client() {
        let (bridge, host) = (Bridge::default(), host(true));
        let reply = ask(&bridge, &host, "Claude Code", json!({
            "op":"propose","revision":revision(&host),"actions":[create_task("Agent task")]
        }));
        let plan: Plan = serde_json::from_value(reply["result"].clone()).unwrap();
        assert_eq!(plan.status, "pending");
        assert_eq!(plan.source, Source::External);
        assert_eq!(plan.client.as_deref(), Some("Claude Code"));
        assert_eq!(host.shown.lock().unwrap()[0].id, plan.id);
        let stored = store::get(&host.db.0.lock().unwrap(), &plan.id).unwrap();
        assert_eq!(stored.client.as_deref(), Some("Claude Code"));
    }

    #[test]
    fn changes_need_a_recent_query_by_the_same_client() {
        let (bridge, host) = (Bridge::default(), host(true));
        let created = ask(&bridge, &host, "Codex", json!({
            "op":"propose","revision":revision(&host),"actions":[create_task("Existing")]
        }));
        let plan_id = created["result"]["id"].as_str().unwrap().to_owned();
        commit(&host, &plan_id);
        let task_id = {
            let db = host.db.0.lock().unwrap();
            db.query_row("SELECT id FROM tasks WHERE title='Existing'", [], |r| r.get::<_, String>(0)).unwrap()
        };
        let rename = |revision: i64| json!({
            "op":"propose","revision":revision,
            "actions":[{"kind":"updateTask","id":task_id,"patch":{"title":"Renamed"}}]
        });
        let refused = ask(&bridge, &host, "Codex", rename(revision(&host)));
        assert_eq!(refused["error"]["code"], json!("not_queried"));

        let queried = ask(&bridge, &host, "Codex", json!({"op":"query","query":{"domain":"tasks","text":"Existing"}}));
        let read_at = queried["result"]["revision"].as_i64().unwrap();
        let other = ask(&bridge, &host, "WorkBuddy", rename(read_at));
        assert_eq!(other["error"]["code"], json!("not_queried"));
        assert_eq!(ask(&bridge, &host, "Codex", rename(read_at))["ok"], json!(true));
    }

    #[test]
    fn a_stale_revision_is_a_conflict() {
        let (bridge, host) = (Bridge::default(), host(true));
        let reply = ask(&bridge, &host, "Codex", json!({
            "op":"propose","revision":revision(&host) - 1,"actions":[create_task("Late")]
        }));
        assert_eq!(reply["error"]["code"], json!("conflict"));
    }

    #[test]
    fn a_client_sees_and_undoes_only_its_own_plans() {
        let (bridge, host) = (Bridge::default(), host(true));
        let reply = ask(&bridge, &host, "Codex", json!({
            "op":"propose","revision":revision(&host),"actions":[create_task("Mine")]
        }));
        let plan_id = reply["result"]["id"].as_str().unwrap().to_owned();
        commit(&host, &plan_id);
        let foreign = ask(&bridge, &host, "WorkBuddy", json!({"op":"undo","planId":plan_id}));
        assert_eq!(foreign["error"]["code"], json!("not_found"));
        let status = ask(&bridge, &host, "Codex", json!({"op":"status","planId":plan_id,"wait":true}));
        assert_eq!(status["result"]["status"], json!("committed"));
        let undone = ask(&bridge, &host, "Codex", json!({"op":"undo","planId":plan_id}));
        assert_eq!(undone["result"]["status"], json!("undone"));
    }

    #[test]
    fn turning_agents_off_stops_a_waiting_plan_from_running() {
        let (bridge, host) = (Bridge::default(), host(true));
        let reply = ask(&bridge, &host, "Codex", json!({
            "op":"propose","revision":revision(&host),"actions":[create_task("Blocked")]
        }));
        let plan_id = reply["result"]["id"].as_str().unwrap().to_owned();
        save_config(&host.db.0.lock().unwrap(), AgentConfig::default()).unwrap();
        assert!(commands::execute(&host.db, &plan_id).is_err());
    }

    #[test]
    fn the_schema_lists_every_skill_and_which_are_allowed() {
        let (bridge, host) = (Bridge::default(), host(true));
        let reply = ask(&bridge, &host, "Codex", json!({"op":"schema"}));
        let skills = reply["result"]["skills"].as_array().unwrap();
        assert_eq!(skills.len(), skills::SKILLS.len());
        let allowed = |id: &str| skills.iter().find(|s| s["id"] == id).unwrap()["allowed"].clone();
        assert_eq!(allowed("createTask"), json!(true));
        assert_eq!(allowed("createEvent"), json!(false));
        let one = ask(&bridge, &host, "Codex", json!({"op":"schema","skill":"createTask"}));
        assert_eq!(one["result"]["properties"]["kind"]["const"], json!("createTask"));
    }

    #[test]
    fn client_labels_are_trimmed_and_never_empty() {
        assert_eq!(client_label(Some(&json!("  Codex\u{7}  "))), "Codex");
        assert_eq!(client_label(Some(&json!(""))), "Agent");
        assert_eq!(client_label(None), "Agent");
        assert_eq!(client_label(Some(&json!("x".repeat(80)))).len(), 32);
    }
}
