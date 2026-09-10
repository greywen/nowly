use super::{store, types::*};
use rusqlite::Connection;
use serde_json::json;

fn db() -> Connection {
    let mut db = Connection::open_in_memory().unwrap();
    db.execute_batch("PRAGMA foreign_keys=ON").unwrap();
    crate::db::migrate(&mut db).unwrap();
    db
}
fn permissions() -> Permissions {
    Permissions {
        calendar: true,
        tasks: true,
        external: false,
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
        "kanban",
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
        "kanban",
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
        "kanban",
        serde_json::from_value(json!({"title":"new last task","laneId":"kanban-lane-todo"}))
            .unwrap(),
    )
    .unwrap();
    assert!(store::undo(&db, &p.id, &permissions()).is_err());
    let p = prepare(
        &db,
        vec![Action::CreateTask {
            draft: json!({"title":"another","completed":true}),
        }],
    );
    store::execute(&db, &p.id, &permissions()).unwrap();
    db.execute(
        "UPDATE settings SET value='\"kanban-lane-todo\"' WHERE key='completion_task_lane_id'",
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
fn clearing_priority_when_linking_disabled_prunes_membership() {
    let db = db();
    let task = crate::task_workspace::create(
        &db,
        "matrix",
        serde_json::from_value(json!({
            "title":"unclassify","laneId":"kanban-lane-todo","priority":"important_urgent"
        }))
        .unwrap(),
    )
    .unwrap();
    db.execute(
        "UPDATE settings SET value='false' WHERE key='task_view_linking_enabled'",
        [],
    )
    .unwrap();
    let p = prepare(
        &db,
        vec![Action::UpdateTask {
            id: task.id,
            patch: json!({"priority":null}),
        }],
    );
    assert!(p.changes[0].after["priority"].is_null());
    assert!(!p.changes[0].after["views"]
        .as_array()
        .unwrap()
        .contains(&json!("matrix")));
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
