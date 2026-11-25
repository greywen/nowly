use super::{store, types::*};
use rusqlite::Connection;
use serde_json::json;

fn db() -> Connection {
    let mut db = Connection::open_in_memory().unwrap();
    db.execute_batch("PRAGMA foreign_keys=ON").unwrap();
    crate::db::migrate(&mut db).unwrap();
    crate::db::seed_test_lanes(&db);
    db
}
fn permissions() -> Permissions {
    Permissions {
        calendar: true,
        tasks: true,
        external: false,
        notes: false,
        ..Default::default()
    }
}
fn create(title: &str) -> Action {
    Action::CreateEvent {
        draft: json!({"title":title,"startAt":"2026-09-09T08:00","endAt":"2026-09-09T09:00","reminders":[0]}),
    }
}
fn prepare(db: &Connection, actions: Vec<Action>) -> Plan {
    store::prepare(db, actions, store::revision(db).unwrap(), &permissions()).unwrap()
}
fn count(db: &Connection) -> i64 {
    db.query_row(
        "SELECT count(*) FROM events WHERE title LIKE 'AI-%'",
        [],
        |r| r.get(0),
    )
    .unwrap()
}
#[test]
fn prepare_does_not_write_and_execute_is_idempotent() {
    let db = db();
    let p = prepare(&db, vec![create("AI-meeting")]);
    assert_eq!(count(&db), 0);
    assert_eq!(p.changes[0].after["reminders"], json!([0]));
    store::execute(&db, &p.id, &permissions()).unwrap();
    store::execute(&db, &p.id, &permissions()).unwrap();
    assert_eq!(count(&db), 1);
    store::undo(&db, &p.id, &permissions()).unwrap();
    assert_eq!(count(&db), 0);
}
#[test]
fn stale_plan_rejects_phantoms_and_aba() {
    let db = db();
    let p = prepare(&db, vec![create("AI-first")]);
    let other = prepare(&db, vec![create("AI-other")]);
    store::execute(&db, &other.id, &permissions()).unwrap();
    store::undo(&db, &other.id, &permissions()).unwrap();
    assert!(store::execute(&db, &p.id, &permissions()).is_err());
    assert_eq!(count(&db), 0);
}
#[test]
fn batch_failure_rolls_back_preview() {
    let db = db();
    let invalid = Action::CreateEvent {
        draft: json!({"title":"AI-bad","startAt":"invalid"}),
    };
    assert!(store::prepare(
        &db,
        vec![create("AI-good"), invalid],
        store::revision(&db).unwrap(),
        &permissions()
    )
    .is_err());
    assert_eq!(count(&db), 0);
}
#[test]
fn undo_rejects_later_edit_but_preserves_unrelated_data() {
    let db = db();
    let p = prepare(&db, vec![create("AI-first")]);
    store::execute(&db, &p.id, &permissions()).unwrap();
    let other = prepare(&db, vec![create("AI-other")]);
    store::execute(&db, &other.id, &permissions()).unwrap();
    store::undo(&db, &p.id, &permissions()).unwrap();
    assert_eq!(count(&db), 1);
    db.execute(
        "UPDATE events SET title='AI-manual' WHERE title='AI-other'",
        [],
    )
    .unwrap();
    assert!(store::undo(&db, &other.id, &permissions()).is_err());
    assert_eq!(count(&db), 1);
}
#[test]
fn expired_restarted_disabled_and_over_limit_plans_fail_closed() {
    let db = db();
    let p = prepare(&db, vec![create("AI-expired")]);
    db.execute(
        "UPDATE assistant_plans SET expires_at=0 WHERE id=?1",
        [&p.id],
    )
    .unwrap();
    assert!(store::execute(&db, &p.id, &permissions()).is_err());
    let p = prepare(&db, vec![create("AI-restart")]);
    db.execute(
        "UPDATE assistant_plans SET session_id='old-process' WHERE id=?1",
        [&p.id],
    )
    .unwrap();
    assert!(store::execute(&db, &p.id, &permissions()).is_err());
    let p = prepare(&db, vec![create("AI-disabled")]);
    assert!(store::execute(&db, &p.id, &Permissions::default()).is_err());
    assert!(store::prepare(
        &db,
        vec![create("AI-many"); 21],
        store::revision(&db).unwrap(),
        &permissions()
    )
    .is_err());
    assert_eq!(count(&db), 0);
}
#[test]
fn unsupported_fields_and_remote_identity_are_not_executable() {
    let db = db();
    let invalid = Action::CreateEvent {
        draft: json!({"title":"AI-bad","startAt":"2026-09-09T08:00","recurrence":{"freq":"weekly"}}),
    };
    assert!(store::prepare(
        &db,
        vec![invalid],
        store::revision(&db).unwrap(),
        &permissions()
    )
    .is_err());
    assert!(
        serde_json::from_value::<Action>(json!({"kind":"deleteRemoteEvent","id":"remote"}))
            .is_err()
    );
    let invalid = Action::DeleteEvent {
        target: crate::models::EventTarget {
            id: "external:123".into(),
            occurrence_start_at: None,
        },
    };
    assert!(store::prepare(
        &db,
        vec![invalid],
        store::revision(&db).unwrap(),
        &permissions()
    )
    .is_err());
}

#[test]
fn actual_linked_patch_requires_both_domain_permissions() {
    let db = db();
    let p = prepare(&db, vec![create("AI-linked")]);
    let e = store::execute(&db, &p.id, &permissions()).unwrap();
    let event_id = e.changes[0].after["id"].as_str().unwrap();
    let task = crate::task_workspace::create(
        &db,
        serde_json::from_value(json!({
            "title":"linked task","laneId":"kanban-lane-todo","linkedEventId":event_id
        }))
        .unwrap(),
    )
    .unwrap();
    let only_tasks = Permissions {
        tasks: true,
        calendar: false,
        external: false,
        notes: false,
        ..Default::default()
    };
    assert!(store::prepare(
        &db,
        vec![Action::DeleteTask {
            id: task.id.clone()
        }],
        store::revision(&db).unwrap(),
        &only_tasks
    )
    .is_err());
    let only_events = Permissions {
        tasks: false,
        calendar: true,
        external: false,
        notes: false,
        ..Default::default()
    };
    assert!(store::prepare(
        &db,
        vec![Action::DeleteEvent {
            target: crate::models::EventTarget {
                id: event_id.into(),
                occurrence_start_at: None
            }
        }],
        store::revision(&db).unwrap(),
        &only_events
    )
    .is_err());
}

#[test]
fn undo_checks_changed_lane_settings_and_new_lane_members() {
    let db = db();
    let task = crate::task_workspace::create(
        &db,
        serde_json::from_value(json!({
            "title":"to delete","laneId":"kanban-lane-todo"
        }))
        .unwrap(),
    )
    .unwrap();
    let p = prepare(&db, vec![Action::DeleteTask { id: task.id }]);
    store::execute(&db, &p.id, &permissions()).unwrap();
    crate::task_workspace::create(
        &db,
        serde_json::from_value(json!({"title":"new last task","laneId":"kanban-lane-todo"}))
            .unwrap(),
    )
    .unwrap();
    assert!(store::undo(&db, &p.id, &permissions()).is_err());
    let p = prepare(
        &db,
        vec![Action::CreateTask {
            draft: json!({"title":"another","completed":true,"laneId":"kanban-lane-todo"}),
        }],
    );
    store::execute(&db, &p.id, &permissions()).unwrap();
    db.execute(
        "UPDATE settings SET value='\"kanban-lane-done\"' WHERE key='default_task_lane_id'",
        [],
    )
    .unwrap();
    assert!(store::undo(&db, &p.id, &permissions()).is_err());
}

#[test]
fn idempotent_receipt_survives_permission_revocation() {
    let db = db();
    let p = prepare(&db, vec![create("AI-receipt")]);
    store::execute(&db, &p.id, &permissions()).unwrap();
    assert_eq!(
        store::execute(&db, &p.id, &Permissions::default())
            .unwrap()
            .status,
        "committed"
    );
}

#[test]
fn clearing_priority_files_task_under_default_quadrant() {
    let db = db();
    let task = crate::task_workspace::create(
        &db,
        serde_json::from_value(json!({
            "title":"unclassify","laneId":"kanban-lane-todo","priority":"important_urgent"
        }))
        .unwrap(),
    )
    .unwrap();
    let p = prepare(
        &db,
        vec![Action::UpdateTask {
            id: task.id,
            patch: json!({"priority":null}),
        }],
    );
    assert_eq!(p.changes[0].after["priority"], json!("not_important_not_urgent"));
}

#[test]
fn preview_exposes_lane_options_and_overlap_warning() {
    let db = db();
    let first = prepare(&db, vec![create("AI-overlap")]);
    store::execute(&db, &first.id, &permissions()).unwrap();
    let second = prepare(&db, vec![create("AI-second")]);
    assert!(second.warnings.iter().any(|w| w.contains("时间重叠")));
    let task = prepare(
        &db,
        vec![Action::CreateTask {
            draft: json!({"title":"AI-task"}),
        }],
    );
    let serialized = serde_json::to_value(&task).unwrap();
    assert!(serialized["options"]["lanes"]
        .as_array()
        .is_some_and(|lanes| !lanes.is_empty()));
}

#[test]
fn actual_commit_failure_rolls_back_all_rows_and_receipt() {
    let db = db();
    let plan = prepare(&db, vec![create("AI-first"), create("AI-fail")]);
    db.execute_batch("CREATE TRIGGER reject_ai BEFORE INSERT ON events WHEN NEW.title='AI-fail' BEGIN SELECT RAISE(ABORT,'fixture failure'); END;").unwrap();
    assert!(store::execute(&db, &plan.id, &permissions()).is_err());
    assert_eq!(count(&db), 0);
    assert_eq!(store::get(&db, &plan.id).unwrap().status, "pending");
}

#[test]
fn cancelled_preview_cannot_be_revised_after_expiry_or_restart() {
    let db = db();
    super::provider::save_config(
        &db,
        super::provider::Config {
            endpoint: "https://fixture.invalid/v1".into(),
            model: "fixture".into(),
            permissions: permissions(),
            has_key: false,
            ..Default::default()
        },
        None,
        false,
    )
    .unwrap();
    for column in ["expires_at=0", "session_id='old-process'"] {
        let p = prepare(&db, vec![create("AI-old")]);
        store::cancel(&db, &p.id).unwrap();
        db.execute(
            &format!("UPDATE assistant_plans SET {column} WHERE id=?1"),
            [&p.id],
        )
        .unwrap();
        assert!(super::commands::revise(&db, p.id, vec![create("AI-new")]).is_err());
    }
}

#[test]
fn recurrence_occurrence_and_delivered_reminders_survive_safe_undo() {
    let db = db();
    let draft = serde_json::from_value(
        json!({"title":"AI-series","startAt":"2026-09-09T08:00","endAt":"2026-09-09T09:00",
        "allDay":false,"category":"work","color":"#4fc9da","note":"","reminders":[0],
        "recurrence":{"freq":"daily","interval":1,"byDay":[],"end":{"kind":"count","count":3}}}),
    )
    .unwrap();
    let event = crate::events::create(&db, draft).unwrap();
    let range = crate::models::EventRange {
        start_at: "2026-09-09T00:00".into(),
        end_at_exclusive: "2026-09-13T00:00".into(),
    };
    let instances = crate::events::list_in_range(&db, &range).unwrap();
    let target = crate::models::EventTarget {
        id: event.id.clone(),
        occurrence_start_at: instances[1].occurrence_start_at.clone(),
    };
    db.execute(
        "INSERT INTO reminder_dispatches VALUES(?1,?2,0,'2026-09-10T00:00Z')",
        rusqlite::params![event.id, target.occurrence_start_at],
    )
    .unwrap();
    assert!(store::prepare(
        &db,
        vec![Action::UpdateEvent {
            target: target.clone(),
            patch: json!({"allDay":true})
        }],
        store::revision(&db).unwrap(),
        &permissions()
    )
    .is_err());
    assert!(store::prepare(
        &db,
        vec![Action::UpdateEvent {
            target: target.clone(),
            patch: json!({"reminders":[10]})
        }],
        store::revision(&db).unwrap(),
        &permissions()
    )
    .is_err());
    let p = prepare(&db, vec![Action::DeleteEvent { target }]);
    assert_eq!(crate::events::list_in_range(&db, &range).unwrap().len(), 3);
    store::execute(&db, &p.id, &permissions()).unwrap();
    assert_eq!(crate::events::list_in_range(&db, &range).unwrap().len(), 2);
    store::undo(&db, &p.id, &permissions()).unwrap();
    assert_eq!(crate::events::list_in_range(&db, &range).unwrap().len(), 3);
    assert_eq!(
        db.query_row("SELECT count(*) FROM reminder_dispatches", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        1
    );
}

#[test]
fn overlap_detects_enclosing_events_and_sibling_occurrences() {
    let db = db();
    let p = prepare(
        &db,
        vec![Action::CreateEvent {
            draft: json!({"title":"long","startAt":"2026-09-09T08:00","endAt":"2026-09-09T10:00"}),
        }],
    );
    store::execute(&db, &p.id, &permissions()).unwrap();
    let p = prepare(
        &db,
        vec![Action::CreateEvent {
            draft: json!({"title":"inside","startAt":"2026-09-09T09:00","endAt":"2026-09-09T09:30"}),
        }],
    );
    assert!(p.warnings.iter().any(|w| w.contains("时间重叠")));
    let event = crate::events::create(
        &db,
        serde_json::from_value(
            json!({"title":"series","startAt":"2026-09-09T12:00","endAt":"2026-09-09T13:00",
        "allDay":false,"category":"work","color":"#4fc9da","note":"","reminders":[],
        "recurrence":{"freq":"daily","interval":1,"byDay":[],"end":{"kind":"count","count":3}}}),
        )
        .unwrap(),
    )
    .unwrap();
    let target = crate::models::EventTarget {
        id: event.id,
        occurrence_start_at: Some("2026-09-09T12:00".into()),
    };
    let p = prepare(
        &db,
        vec![Action::UpdateEvent {
            target,
            patch: json!({"startAt":"2026-09-10T12:00"}),
        }],
    );
    assert!(p.warnings.iter().any(|w| w.contains("时间重叠")));
}

#[test]
fn foreign_timezone_dst_fold_is_rejected_instead_of_silently_shifting() {
    let db = db();
    let draft=serde_json::from_value(json!({"title":"foreign","startAt":"2026-10-31T01:30","endAt":"2026-10-31T02:30",
        "startTz":"America/New_York","endTz":"America/New_York","allDay":false,"category":"work","color":"#4fc9da","note":"","reminders":[],"recurrence":null})).unwrap();
    let event = crate::events::create(&db, draft).unwrap();
    let instant = chrono::DateTime::parse_from_rfc3339("2026-11-01T06:30:00Z")
        .unwrap()
        .with_timezone(&chrono::Utc);
    let display = crate::timezone::format_wall(crate::timezone::utc_to_wall(
        instant,
        crate::timezone::device_tz(),
    ));
    let result = store::prepare(
        &db,
        vec![Action::UpdateEvent {
            target: crate::models::EventTarget {
                id: event.id,
                occurrence_start_at: None,
            },
            patch: json!({"startAt":display}),
        }],
        store::revision(&db).unwrap(),
        &permissions(),
    );
    assert!(result.is_err());
}

#[test]
fn expired_retention_is_pruned_when_the_assistant_is_opened() {
    let db = db();
    let p = prepare(&db, vec![create("AI-old-record")]);
    db.execute(
        "UPDATE assistant_plans SET created_at=0 WHERE id=?1",
        [p.id],
    )
    .unwrap();
    super::provider::get_config(&db).unwrap();
    assert_eq!(
        db.query_row("SELECT count(*) FROM assistant_plans", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
}

#[test]
fn background_subscription_refresh_does_not_invalidate_a_pending_plan() {
    let db = db();
    let plan = prepare(&db, vec![create("AI-meeting")]);
    // The 60-second refresh thread rewrites both tables wholesale even when
    // nothing changed; the assistant never writes them, so they must not count.
    db.execute(
        "INSERT INTO calendar_subscriptions(id,name,url,color,refresh_interval_minutes,created_at,updated_at)
         VALUES('sub-1','fixture','https://example.com/a.ics','#4fc9da',60,'2026-09-09','2026-09-09')",
        [],
    )
    .unwrap();
    db.execute(
        "INSERT INTO external_events(id,subscription_id,uid,start_at,end_at,all_day,title,last_synced_at)
         VALUES('ext-1','sub-1','uid-1','2026-09-09T08:00','2026-09-09T09:00',0,'external','2026-09-09')",
        [],
    )
    .unwrap();
    db.execute("DELETE FROM external_events", []).unwrap();
    store::execute(&db, &plan.id, &permissions()).unwrap();
    assert_eq!(count(&db), 1);
}

#[test]
fn unrelated_settings_writes_do_not_invalidate_a_pending_plan() {
    let db = db();
    let plan = prepare(&db, vec![create("AI-meeting")]);
    let before = store::revision(&db).unwrap();
    // Picking a colour rewrites `recent_colors`; that must not void a preview.
    db.execute(
        "INSERT INTO settings(key,value) VALUES('recent_colors','[]')
         ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        [],
    )
    .unwrap();
    assert_eq!(store::revision(&db).unwrap(), before);
    store::execute(&db, &plan.id, &permissions()).unwrap();
    assert_eq!(count(&db), 1);

    let plan = prepare(&db, vec![create("AI-second")]);
    db.execute(
        "INSERT INTO settings(key,value) VALUES('default_task_lane_id','lane-9')
         ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        [],
    )
    .unwrap();
    assert!(store::revision(&db).unwrap() > before);
    assert!(store::execute(&db, &plan.id, &permissions()).is_err());
}

fn task_with_steps(db: &Connection, title: &str) -> crate::models::Task {
    crate::task_workspace::create(
        db,
        serde_json::from_value(json!({
            "title": title, "laneId": "kanban-lane-todo",
            "steps": [{"title": "one"}, {"title": "two", "completed": true}]
        }))
        .unwrap(),
    )
    .unwrap()
}

fn stored_task(db: &Connection, id: &str) -> crate::models::Task {
    crate::task_workspace::snapshot(db).unwrap().tasks.into_iter().find(|t| t.id == id).unwrap()
}

#[test]
fn undoing_an_ai_task_delete_restores_its_steps() {
    let db = db();
    let task = task_with_steps(&db, "with steps");
    let p = prepare(&db, vec![Action::DeleteTask { id: task.id.clone() }]);
    store::execute(&db, &p.id, &permissions()).unwrap();
    assert_eq!(db.query_row("SELECT count(*) FROM task_steps", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
    store::undo(&db, &p.id, &permissions()).unwrap();
    assert_eq!(stored_task(&db, &task.id).steps, task.steps);
}

#[test]
fn ai_task_update_keeps_steps() {
    let db = db();
    let task = task_with_steps(&db, "rename me");
    let p = prepare(&db, vec![Action::UpdateTask { id: task.id.clone(), patch: json!({"title": "renamed"}) }]);
    store::execute(&db, &p.id, &permissions()).unwrap();
    let updated = stored_task(&db, &task.id);
    assert_eq!(updated.title, "renamed");
    assert_eq!(updated.steps, task.steps);
}

fn remove_legacy_step_guard(db: &Connection, plan_id: &str) {
    let encoded: String = db
        .query_row(
            "SELECT undo_guard FROM assistant_plans WHERE id=?1",
            [plan_id],
            |row| row.get(0),
        )
        .unwrap();
    let mut guard: serde_json::Value = serde_json::from_str(&encoded).unwrap();
    assert_eq!(guard.as_object_mut().unwrap().remove("task_steps"), Some(json!({})));
    db.execute(
        "UPDATE assistant_plans SET undo_guard=?1 WHERE id=?2",
        rusqlite::params![serde_json::to_string(&guard).unwrap(), plan_id],
    )
    .unwrap();
}

#[test]
fn legacy_task_plan_can_be_undone_without_a_step_guard() {
    let db = db();
    let plan = prepare(&db, vec![Action::CreateTask { draft: json!({"title": "legacy task"}) }]);
    store::execute(&db, &plan.id, &permissions()).unwrap();
    remove_legacy_step_guard(&db, &plan.id);

    assert_eq!(store::undo(&db, &plan.id, &permissions()).unwrap().status, "undone");
    assert!(crate::task_workspace::snapshot(&db).unwrap().tasks.is_empty());
}

#[test]
fn legacy_task_plan_undo_rejects_steps_added_after_upgrade() {
    let db = db();
    let plan = prepare(&db, vec![Action::CreateTask { draft: json!({"title": "legacy task"}) }]);
    store::execute(&db, &plan.id, &permissions()).unwrap();
    remove_legacy_step_guard(&db, &plan.id);
    let task = crate::task_workspace::snapshot(&db).unwrap().tasks.remove(0);
    db.execute(
        "INSERT INTO task_steps (id,task_id,title,completed,position,created_at,updated_at)
         VALUES ('new-step',?1,'keep me',0,0,?2,?2)",
        rusqlite::params![task.id, task.updated_at],
    )
    .unwrap();

    assert_eq!(store::undo(&db, &plan.id, &permissions()).unwrap_err().code, "conflict");
    assert_eq!(stored_task(&db, &task.id).steps[0].title, "keep me");
    assert_eq!(store::get(&db, &plan.id).unwrap().status, "committed");
}

#[test]
fn legacy_event_plan_undo_preserves_unrelated_steps() {
    let db = db();
    let plan = prepare(&db, vec![create("AI-legacy")]);
    store::execute(&db, &plan.id, &permissions()).unwrap();
    remove_legacy_step_guard(&db, &plan.id);
    let task = task_with_steps(&db, "unrelated");

    store::undo(&db, &plan.id, &permissions()).unwrap();
    assert_eq!(count(&db), 0);
    assert_eq!(stored_task(&db, &task.id).steps, task.steps);
}

fn with_notes() -> Permissions {
    Permissions {
        notes: true,
        ..permissions()
    }
}
fn notes(db: &Connection) -> Vec<crate::models::Note> {
    crate::notes::list(db).unwrap()
}

#[test]
fn note_plans_need_note_permission_and_create_execute_and_undo() {
    let db = db();
    let create = Action::CreateNote {
        draft: json!({"content":"周报提纲\n先写进展"}),
    };
    assert!(store::prepare(&db, vec![create.clone()], store::revision(&db).unwrap(), &permissions()).is_err());
    let plan = store::prepare(&db, vec![create], store::revision(&db).unwrap(), &with_notes()).unwrap();
    assert!(notes(&db).is_empty());
    assert_eq!(plan.changes[0].kind, "createNote");
    assert_eq!(plan.changes[0].title, "周报提纲");
    store::execute(&db, &plan.id, &with_notes()).unwrap();
    let created = notes(&db);
    assert_eq!(created.len(), 1);
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&created[0].content).unwrap(),
        json!({"v":1,"ops":[{"insert":"周报提纲"},{"insert":"\n"},{"insert":"先写进展"},{"insert":"\n"}]})
    );
    assert_eq!(created[0].color, "#E8C444");
    assert!(store::undo(&db, &plan.id, &permissions()).is_err());
    store::undo(&db, &plan.id, &with_notes()).unwrap();
    assert!(notes(&db).is_empty());
}

#[test]
fn existing_notes_are_never_rewritten_or_deleted() {
    let db = db();
    let note = crate::notes::create(
        &db,
        crate::models::NoteDraft {
            content: r#"{"v":1,"ops":[{"insert":"旧内容","attributes":{"bold":true}},{"insert":"\n"}]}"#.into(),
            color: "#4F55DA".into(),
            pinned: false,
            icon: "star".into(),
        },
    )
    .unwrap();
    for action in [
        Action::UpdateNote { id: note.id.clone(), patch: json!({"content":"新内容"}) },
        Action::DeleteNote { id: note.id.clone() },
    ] {
        assert!(store::prepare(&db, vec![action], store::revision(&db).unwrap(), &with_notes()).is_err());
    }
    assert_eq!(notes(&db), vec![note]);
}

#[test]
fn new_notes_take_a_named_colour_icon_and_reject_unknown_fields() {
    let db = db();
    for draft in [json!({"content":"x","color":"#000000"}), json!({"content":"  "}), json!({"content":"x","icon":"rocket"})] {
        let action = Action::CreateNote { draft };
        assert!(store::prepare(&db, vec![action], store::revision(&db).unwrap(), &with_notes()).is_err());
    }
    let action = Action::CreateNote {
        draft: json!({"content":"清单\n- [ ] 牛奶","color":"indigo","icon":"star","pinned":true}),
    };
    let plan = store::prepare(&db, vec![action], store::revision(&db).unwrap(), &with_notes()).unwrap();
    store::execute(&db, &plan.id, &with_notes()).unwrap();
    let created = &notes(&db)[0];
    assert!(created.pinned);
    assert_eq!((created.color.as_str(), created.icon.as_str()), ("#4F55DA", "star"));
    assert!(created.content.contains(r#""list":"unchecked""#));
}

#[test]
fn notes_are_queryable_by_their_text_only_with_permission() {
    let db = db();
    for content in ["买牛奶", r#"{"v":1,"ops":[{"insert":"项目复盘要点\n"}]}"#] {
        crate::notes::create(
            &db,
            crate::models::NoteDraft {
                content: content.into(),
                color: "#E8C444".into(),
                pinned: false,
                icon: String::new(),
            },
        )
        .unwrap();
    }
    let query = Query {
        domain: "notes".into(),
        text: "复盘".into(),
        start_date: None,
        end_date: None,
        completed: None,
        priority: None,
        lane_id: None,
        due_before: None,
    };
    assert!(super::actions::query(&db, &query, &permissions()).is_err());
    let result = super::actions::query(&db, &query, &with_notes()).unwrap();
    assert_eq!(result.records.len(), 1);
    assert_eq!(result.records[0].title, "项目复盘要点");
    assert!(result.records[0].key.starts_with("notes:"));
}

#[test]
fn calendar_query_falls_back_to_the_range_when_no_title_matches() {
    let db = db();
    for (title, start, end) in [
        ("开会", "2026-11-26T08:00", "2026-11-26T09:00"),
        ("午餐", "2026-11-26T12:00", "2026-11-26T13:00"),
    ] {
        crate::events::create(
            &db,
            serde_json::from_value(json!({"title":title,"startAt":start,"endAt":end,"allDay":false,
                "category":"","color":"","note":"","reminders":[]}))
            .unwrap(),
        )
        .unwrap();
    }
    let mut q = query("calendar");
    q.start_date = Some("2026-11-26".into());
    q.end_date = Some("2026-11-26".into());
    q.text = "早会".into();
    let result = super::actions::query(&db, &q, &permissions()).unwrap();
    assert_eq!(result.records.len(), 2);
    assert_eq!(result.metadata["textMatched"], false);
    q.text = "开会".into();
    let result = super::actions::query(&db, &q, &permissions()).unwrap();
    assert_eq!(result.records.len(), 1);
    assert_eq!(result.metadata["textMatched"], true);
}
fn query(domain: &str) -> Query {
    Query {
        domain: domain.into(),
        text: String::new(),
        start_date: None,
        end_date: None,
        completed: None,
        priority: None,
        lane_id: None,
        due_before: None,
    }
}

fn tag(db: &Connection, id: &str, archived: bool) {
    db.execute(
        "INSERT INTO task_tags(id,name,color,archived_at,created_at,updated_at) VALUES (?1,?1,'#4FC9DA',?2,'t','t')",
        rusqlite::params![id, archived.then_some("t")],
    )
    .unwrap();
}

#[test]
fn new_tasks_stay_off_the_board_and_take_steps_and_existing_tags() {
    let db = db();
    tag(&db, "tag-a", false);
    tag(&db, "tag-old", true);
    for draft in [
        json!({"title":"x","tagIds":["tag-missing"]}),
        json!({"title":"x","tagIds":["tag-old"]}),
        json!({"title":"x","laneId":"no-such-lane"}),
        json!({"title":"x","priority":"high"}),
    ] {
        assert!(store::prepare(&db, vec![Action::CreateTask { draft }], store::revision(&db).unwrap(), &permissions()).is_err());
    }
    let plan = prepare(&db, vec![Action::CreateTask {
        draft: json!({"title":"launch","tagIds":["tag-a"],"steps":["draft","review"]}),
    }]);
    store::execute(&db, &plan.id, &permissions()).unwrap();
    let task = crate::task_workspace::snapshot(&db).unwrap().tasks.remove(0);
    assert_eq!(task.lane_id, None);
    assert_eq!(task.tag_ids, vec!["tag-a"]);
    assert_eq!(task.steps.iter().map(|s| s.title.as_str()).collect::<Vec<_>>(), ["draft", "review"]);
    assert_eq!(plan.options["tags"][0]["id"], "tag-a");
    let result = super::actions::query(&db, &query("tasks"), &permissions()).unwrap();
    assert_eq!(result.records[0].data["steps"][1]["title"], "review");
    assert_eq!(result.metadata["tags"].as_array().unwrap().len(), 1);
}

#[test]
fn task_updates_edit_steps_by_id_and_keep_the_rest() {
    let db = db();
    let task = task_with_steps(&db, "with steps");
    let (one, two) = (task.steps[0].id.clone(), task.steps[1].id.clone());
    for patch in [
        json!({"updateSteps":[{"id":"unknown","completed":true}]}),
        json!({"removeSteps":["unknown"]}),
        json!({"updateSteps":[{"id":one,"title":"x"}],"removeSteps":[one]}),
        json!({"steps":[]}),
        json!({}),
    ] {
        let action = Action::UpdateTask { id: task.id.clone(), patch };
        assert!(store::prepare(&db, vec![action], store::revision(&db).unwrap(), &permissions()).is_err());
    }
    let plan = prepare(&db, vec![Action::UpdateTask {
        id: task.id.clone(),
        patch: json!({"updateSteps":[{"id":one,"completed":true}],"removeSteps":[two],"addSteps":["three"],"laneId":null}),
    }]);
    store::execute(&db, &plan.id, &permissions()).unwrap();
    let after = stored_task(&db, &task.id);
    assert_eq!(after.lane_id, None);
    assert_eq!(after.steps.len(), 2);
    assert_eq!((after.steps[0].id.as_str(), after.steps[0].completed), (one.as_str(), true));
    assert_eq!(after.steps[1].title, "three");
    store::undo(&db, &plan.id, &permissions()).unwrap();
    assert_eq!(stored_task(&db, &task.id).steps, task.steps);
}

#[test]
fn events_take_an_existing_category_colour_and_may_repeat() {
    let mut db = db();
    let category = crate::categories::create(
        &mut db,
        crate::models::CategoryDraft { name: "Deep work".into(), color: "#B8D935".into() },
    )
    .unwrap();
    let draft = |extra: serde_json::Value| {
        let mut draft = json!({"title":"AI-focus","startAt":"2026-09-07T09:00"});
        draft.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
        Action::CreateEvent { draft }
    };
    for extra in [json!({"category":"work"}), json!({"color":"#000000"})] {
        assert!(store::prepare(&db, vec![draft(extra)], store::revision(&db).unwrap(), &permissions()).is_err());
    }
    let plan = prepare(&db, vec![draft(json!({
        "category": category.id,
        "recurrence": {"freq":"weekly","interval":1,"byDay":["MO"],"end":{"kind":"count","count":3}}
    }))]);
    assert_eq!(plan.options["categories"][0]["name"], "Deep work");
    store::execute(&db, &plan.id, &permissions()).unwrap();
    let event: (String, String, Option<String>) = db
        .query_row("SELECT category,color,rrule FROM events WHERE title='AI-focus'", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .unwrap();
    assert_eq!((event.0.as_str(), event.1.to_uppercase().as_str()), (category.id.as_str(), "#B8D935"));
    assert!(event.2.is_some_and(|rule| rule.contains("FREQ=WEEKLY")));
    // A plain new event has no category, so it has no colour either.
    let plan = prepare(&db, vec![create("AI-plain")]);
    assert_eq!(plan.changes[0].after["category"], "");
    assert_eq!(plan.changes[0].after["color"], "");
}

fn with_alarms() -> Permissions {
    Permissions { alarms: true, ..Default::default() }
}

#[test]
fn alarm_plans_create_and_delete_with_their_pending_notices() {
    let db = db();
    let create = Action::CreateAlarm {
        draft: json!({"title":"Wake","hour":7,"minute":30,"repeat":{"kind":"weekly","weekdays":[1,5]}}),
    };
    assert!(store::prepare(&db, vec![create.clone()], store::revision(&db).unwrap(), &permissions()).is_err());
    let plan = store::prepare(&db, vec![create], store::revision(&db).unwrap(), &with_alarms()).unwrap();
    assert!(crate::time::store::list_alarms(&db, chrono::Utc::now()).unwrap().is_empty());
    store::execute(&db, &plan.id, &with_alarms()).unwrap();
    let alarm = crate::time::store::list_alarms(&db, chrono::Utc::now()).unwrap().remove(0);
    assert_eq!((alarm.hour, alarm.minute), (7, 30));
    db.execute(
        "INSERT INTO alarm_notices(id,kind,alarm_id,instance_key,title,due_at_utc,range_start_utc,range_end_utc,count,created_at_utc)
         VALUES ('n1','alarm',?1,'k','Wake','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z',1,'2026-01-01T00:00:00Z')",
        [&alarm.id],
    )
    .unwrap();
    let records = super::actions::query(&db, &query("alarms"), &with_alarms()).unwrap().records;
    assert_eq!(records[0].data["id"], alarm.id.as_str());
    let delete = store::prepare(&db, vec![Action::DeleteAlarm { id: alarm.id.clone() }], store::revision(&db).unwrap(), &with_alarms()).unwrap();
    store::execute(&db, &delete.id, &with_alarms()).unwrap();
    let notices = |db: &Connection| db.query_row("SELECT count(*) FROM alarm_notices", [], |r| r.get::<_, i64>(0)).unwrap();
    assert_eq!(notices(&db), 0);
    store::undo(&db, &delete.id, &with_alarms()).unwrap();
    assert_eq!(notices(&db), 1);
    assert_eq!(crate::time::store::list_alarms(&db, chrono::Utc::now()).unwrap().len(), 1);
}

#[test]
fn remote_calendar_writes_need_both_permissions_and_a_writable_calendar() {
    let db = db();
    let action = Action::CreateRemoteEvent {
        subscription_id: "missing".into(),
        draft: json!({"title":"x","startAt":"2026-09-09T09:00"}),
    };
    let read_only = Permissions { external: true, ..Default::default() };
    let both = Permissions { external: true, external_write: true, ..Default::default() };
    assert!(store::prepare(&db, vec![action.clone()], store::revision(&db).unwrap(), &read_only).is_err());
    let error = store::prepare(&db, vec![action.clone()], store::revision(&db).unwrap(), &both).unwrap_err();
    assert!(error.message.contains("不可写入"), "{}", error.message);
    assert!(store::prepare(&db, vec![action.clone(), action], store::revision(&db).unwrap(), &both).is_err());
}
