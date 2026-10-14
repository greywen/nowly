use super::schedule::next_occurrence;
use super::scheduler::{
    acknowledge_notice, list_alarm_notices, list_expired_alarm_notices, list_ringing_alarm_notices,
    poll, poll_in_zone, read_alarm_notice_lists, reconcile_superseded_alarms, snooze_notice,
};
use super::store::{
    create_alarm, delete_alarm, get_time_settings, list_alarms, save_time_settings, update_alarm,
};
use super::types::{Alarm, AlarmDraft, AlarmNoticeKind, AlarmRepeat, TimeSettings};
use chrono::{DateTime, TimeZone, Utc};
use chrono_tz::Tz;
use rusqlite::Connection;
use serde_json::json;

fn db() -> Connection {
    let mut connection = Connection::open_in_memory().unwrap();
    connection
        .execute_batch("PRAGMA foreign_keys = ON;")
        .unwrap();
    crate::db::migrate(&mut connection).unwrap();
    connection
}

fn instant(value: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(value)
        .unwrap()
        .with_timezone(&Utc)
}

fn weekly_alarm(id: &str, weekdays: Vec<u8>, hour: u8, minute: u8) -> Alarm {
    Alarm {
        id: id.into(),
        title: "Standup".into(),
        hour,
        minute,
        repeat: AlarmRepeat::Weekly { weekdays },
        enabled: true,
        created_at: "2026-10-11T00:00:00Z".into(),
        updated_at: "2026-10-11T00:00:00Z".into(),
        effective_from_utc: "2026-10-11T00:00:00Z".into(),
        next_occurrence: None,
    }
}

fn draft_once(hour: u8, minute: u8) -> AlarmDraft {
    AlarmDraft {
        title: "Flight".into(),
        hour,
        minute,
        repeat: AlarmRepeat::Once {},
        enabled: true,
    }
}

fn draft_weekly(weekdays: Vec<u8>, hour: u8, minute: u8) -> AlarmDraft {
    AlarmDraft {
        title: "Standup".into(),
        hour,
        minute,
        repeat: AlarmRepeat::Weekly { weekdays },
        enabled: true,
    }
}

fn next_due(alarm: &Alarm, after: DateTime<Utc>) -> DateTime<Utc> {
    next_occurrence(alarm, after, crate::timezone::device_tz()).unwrap()
}

#[test]
fn date_free_once_contract_and_stable_candidate() {
    assert!(
        serde_json::from_value::<AlarmRepeat>(json!({"kind":"once", "date":"2099-01-01"})).is_err()
    );
    let alarm: Alarm = serde_json::from_value(json!({
        "id":"once", "title":"Once", "hour":9, "minute":0,
        "repeat":{"kind":"once"}, "enabled":true,
        "createdAt":"2026-10-11T08:00:00Z", "updatedAt":"2026-10-11T08:00:00Z",
        "effectiveFromUtc":"2026-10-11T08:00:00Z"
    }))
    .unwrap();
    let due = instant("2026-10-11T09:00:00Z");
    assert_eq!(
        next_occurrence(&alarm, instant("2026-10-11T08:30:00Z"), Tz::UTC),
        Some(due)
    );
    assert_eq!(next_occurrence(&alarm, due, Tz::UTC), None);
    assert_eq!(
        next_occurrence(&alarm, instant("2026-10-12T08:30:00Z"), Tz::UTC),
        None
    );
    assert_eq!(
        super::schedule::occurrence_in_window(
            &alarm,
            instant("2026-10-11T08:00:00Z"),
            instant("2026-10-15T00:00:00Z"),
            Tz::UTC,
            10
        ),
        vec![due]
    );
    assert_eq!(
        super::schedule::occurrence_summary_in_window(
            &alarm,
            instant("2026-10-11T08:00:00Z"),
            instant("2026-10-15T00:00:00Z"),
            Tz::UTC
        ),
        Some((1, due, due))
    );
}

#[test]
fn once_uses_next_valid_local_time_after_anchor_across_midnight_and_dst() {
    for (anchor, hour, minute, zone, expected) in [
        (
            "2026-10-31T23:59:00Z",
            0,
            0,
            Tz::UTC,
            "2026-11-01T00:00:00Z",
        ),
        (
            "2026-10-11T09:00:00Z",
            9,
            0,
            Tz::UTC,
            "2026-10-12T09:00:00Z",
        ),
        (
            "2026-10-11T10:00:00Z",
            9,
            0,
            Tz::UTC,
            "2026-10-12T09:00:00Z",
        ),
        (
            "2026-03-08T05:00:00Z",
            2,
            30,
            Tz::America__New_York,
            "2026-03-09T06:30:00Z",
        ),
        (
            "2026-11-01T04:00:00Z",
            1,
            30,
            Tz::America__New_York,
            "2026-11-01T05:30:00Z",
        ),
        (
            "2026-11-01T05:45:00Z",
            1,
            30,
            Tz::America__New_York,
            "2026-11-02T06:30:00Z",
        ),
    ] {
        let alarm = Alarm {
            repeat: AlarmRepeat::Once {},
            effective_from_utc: anchor.into(),
            ..weekly_alarm("once", vec![1], hour, minute)
        };
        let due = instant(expected);
        assert_eq!(
            next_occurrence(&alarm, instant(anchor), zone),
            Some(due),
            "{anchor}"
        );
        assert_eq!(
            super::schedule::occurrence_summary_in_window(&alarm, instant(anchor), due, zone),
            Some((1, due, due))
        );
        assert_eq!(
            super::schedule::occurrence_summary_in_window(
                &alarm,
                due,
                due + chrono::Duration::days(2),
                zone
            ),
            None
        );
        assert_eq!(next_occurrence(&alarm, due, zone), None);
    }
}

#[test]
fn schedule_edits_and_reenable_reset_anchor_but_disabling_does_not() {
    let mut connection = db();
    let now = instant("2026-10-11T08:00:00Z");
    let mut draft = draft_once(9, 0);
    let mut alarm = create_alarm(&mut connection, draft.clone(), now).unwrap();
    for offset in 1..=5 {
        match offset {
            1 => draft.minute = 17,
            2 => {
                draft.repeat = AlarmRepeat::Weekly {
                    weekdays: vec![1, 2],
                }
            }
            3 => draft.repeat = AlarmRepeat::Once {},
            4 => draft.enabled = false,
            5 => draft.enabled = true,
            _ => unreachable!(),
        }
        let previous = alarm.effective_from_utc.clone();
        let edited_at = now + chrono::Duration::hours(offset);
        alarm = update_alarm(&mut connection, &alarm.id, draft.clone(), edited_at).unwrap();
        assert_eq!(
            alarm.effective_from_utc,
            if offset == 4 {
                previous
            } else {
                super::store::format_utc(edited_at)
            }
        );
    }
}

#[test]
fn title_patch_and_retry_preserve_fired_and_snoozed_once_notices() {
    for snoozed in [false, true] {
        let mut connection = db();
        let now = instant("2026-10-11T00:00:00Z");
        let alarm = create_alarm(&mut connection, draft_once(9, 0), now).unwrap();
        let due = next_due(&alarm, now);
        poll(&mut connection, due - chrono::Duration::seconds(1)).unwrap();
        poll(&mut connection, due).unwrap();
        let notice = list_alarm_notices(&connection, due).unwrap().remove(0);
        if snoozed {
            snooze_notice(&mut connection, &notice.id, due).unwrap();
        }
        let notice_state = |connection: &Connection| {
            connection.query_row(
            "SELECT id, acknowledged_at_utc, snoozed_until_utc FROM alarm_notices WHERE id=?1", [&notice.id],
            |row| Ok((row.get::<_,String>(0)?, row.get::<_,Option<String>>(1)?, row.get::<_,Option<String>>(2)?))
        ).unwrap()
        };
        let before = notice_state(&connection);
        for seconds in [1, 2] {
            let patch = super::types::AlarmPatch {
                title: Some("Renamed".into()),
                ..Default::default()
            };
            let saved = update_alarm(
                &mut connection,
                &alarm.id,
                patch,
                due + chrono::Duration::seconds(seconds),
            )
            .unwrap();
            assert!(!saved.enabled);
            assert_eq!(saved.effective_from_utc, alarm.effective_from_utc);
            assert_eq!(notice_state(&connection), before);
        }
        update_alarm(
            &mut connection,
            &alarm.id,
            super::types::AlarmPatch {
                enabled: Some(false),
                ..Default::default()
            },
            due + chrono::Duration::seconds(3),
        )
        .unwrap();
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM alarm_notices WHERE id=?1",
                    [&notice.id],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
            0
        );
    }
}

#[test]
fn atomic_title_patch_preserves_scheduler_disabled_once() {
    let mut connection = db();
    let now = instant("2026-10-11T08:00:00Z");
    let created = create_alarm(&mut connection, draft_once(9, 0), now).unwrap();
    connection
        .execute("UPDATE alarms SET enabled=0 WHERE id=?1", [&created.id])
        .unwrap();
    let patch: super::types::AlarmPatch =
        serde_json::from_value(json!({"title":"Renamed"})).unwrap();
    let saved = update_alarm(
        &mut connection,
        &created.id,
        patch,
        now + chrono::Duration::days(1),
    )
    .unwrap();
    assert_eq!(saved.title, "Renamed");
    assert!(!saved.enabled);
    assert_eq!(saved.effective_from_utc, created.effective_from_utc);
    assert_eq!(
        (saved.hour, saved.minute, saved.repeat),
        (created.hour, created.minute, created.repeat)
    );
}

#[test]
fn title_only_edits_preserve_arming_anchor() {
    let mut connection = db();
    let now = instant("2026-10-11T08:00:00Z");
    let alarm = create_alarm(&mut connection, draft_weekly(vec![1], 9, 0), now).unwrap();
    let mut draft = draft_weekly(vec![1], 9, 0);
    draft.title = "Edited".into();
    update_alarm(
        &mut connection,
        &alarm.id,
        draft,
        now + chrono::Duration::days(1),
    )
    .unwrap();
    let anchor: String = connection
        .query_row(
            "SELECT effective_from_utc FROM alarms WHERE id=?1",
            [&alarm.id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(anchor, "2026-10-11T08:00:00Z");
}

#[test]
fn default_time_settings_are_one_local_digital_clock() {
    let connection = db();

    let settings = get_time_settings(&connection).unwrap();

    assert_eq!(settings.clocks.len(), 1);
    assert_eq!(settings.clocks[0].time_zone, "local");
    assert_eq!(
        serde_json::to_value(settings).unwrap(),
        unified_settings_json()
    );
}

fn unified_settings_json() -> serde_json::Value {
    json!({
        "displayContent": "clocks",
        "appearance": {
            "mode": "digital", "hourCycle": "h23", "showSeconds": false,
            "showLabel": false, "showDate": false, "showDifference": false,
            "layout": "horizontal", "fontMode": "auto", "fontSize": 96
        },
        "focusPreferences": {"defaultMinutes": 25},
        "clocks": [{"id": "local", "timeZone": "local", "label": "本地"}]
    })
}

#[test]
fn legacy_per_clock_settings_are_not_accepted() {
    let legacy = r#"{"clocks":[{"id":"local","timeZone":"local","label":"","mode":"digital","hourCycle":"h23","showSeconds":false,"showLabel":false,"showDate":false,"showDifference":false}]}"#;
    assert!(serde_json::from_str::<TimeSettings>(legacy).is_err());
}

#[test]
fn unified_settings_validate_enums_and_numeric_ranges_without_overwriting() {
    let mut connection = db();
    let original = get_time_settings(&connection).unwrap();
    save_time_settings(&mut connection, original.clone()).unwrap();
    for (pointer, value) in [
        ("/displayContent", json!("alarms")),
        ("/appearance/mode", json!("unknown")),
        ("/appearance/hourCycle", json!("h24")),
        ("/appearance/layout", json!("date")),
        ("/appearance/fontMode", json!("unknown")),
        ("/appearance/fontSize", json!(31)),
        ("/appearance/fontSize", json!(161)),
        ("/focusPreferences/defaultMinutes", json!(0)),
        ("/focusPreferences/defaultMinutes", json!(721)),
    ] {
        let mut invalid = unified_settings_json();
        *invalid.pointer_mut(pointer).unwrap() = value;
        if let Ok(settings) = serde_json::from_value::<TimeSettings>(invalid) {
            assert!(
                save_time_settings(&mut connection, settings).is_err(),
                "{pointer}"
            );
        }
        assert_eq!(get_time_settings(&connection).unwrap(), original);
    }
    for (size, minutes) in [(32, 1), (160, 720)] {
        let mut valid = unified_settings_json();
        valid["appearance"]["fontSize"] = json!(size);
        valid["focusPreferences"]["defaultMinutes"] = json!(minutes);
        let settings = serde_json::from_value(valid).unwrap();
        save_time_settings(&mut connection, settings).unwrap();
    }
}

#[test]
fn corrupt_persisted_unified_settings_are_rejected_on_read() {
    let connection = db();
    let mut invalid = unified_settings_json();
    invalid["focusPreferences"]["defaultMinutes"] = json!(721);
    connection
        .execute(
            "INSERT INTO time_settings VALUES (1,?1,'now')",
            [invalid.to_string()],
        )
        .unwrap();
    assert_eq!(
        get_time_settings(&connection).unwrap_err().field.as_deref(),
        Some("defaultMinutes")
    );
}

#[test]
fn time_settings_round_trip_and_validate_clocks() {
    let mut connection = db();
    let mut value = unified_settings_json();
    value["displayContent"] = json!("focus");
    value["appearance"] = json!({
        "mode": "mixed", "hourCycle": "h12", "showSeconds": true,
        "showLabel": true, "showDate": true, "showDifference": true,
        "layout": "stacked", "fontMode": "manual", "fontSize": 128
    });
    value["focusPreferences"]["defaultMinutes"] = json!(45);
    value["clocks"] = json!([
        {"id": "shanghai", "timeZone": "Asia/Shanghai", "label": "Shanghai"},
        {"id": "local", "timeZone": "local", "label": ""}
    ]);
    let settings: TimeSettings = serde_json::from_value(value).unwrap();

    let saved = save_time_settings(&mut connection, settings.clone()).unwrap();
    assert_eq!(saved, settings);
    assert_eq!(get_time_settings(&connection).unwrap(), settings);

    let mut empty_settings = settings.clone();
    empty_settings.clocks.clear();
    let empty = save_time_settings(&mut connection, empty_settings).unwrap_err();
    assert_eq!(empty.field.as_deref(), Some("clocks"));

    let mut invalid = settings;
    invalid.clocks[0].time_zone = "Mars/Olympus".into();
    let timezone = save_time_settings(&mut connection, invalid).unwrap_err();
    assert_eq!(timezone.field.as_deref(), Some("timeZone"));

    let mut invalid = get_time_settings(&connection).unwrap();
    invalid.clocks[1].id = invalid.clocks[0].id.clone();
    assert!(save_time_settings(&mut connection, invalid).is_err());
}

#[test]
fn alarm_types_keep_the_frontend_camel_case_contract() {
    let alarm = weekly_alarm("a1", vec![1, 3, 5], 7, 30);

    let value = serde_json::to_value(&alarm).unwrap();

    assert_eq!(
        value["repeat"],
        json!({"kind": "weekly", "weekdays": [1, 3, 5]})
    );
    assert!(value.get("created_at").is_none());
    assert_eq!(value["nextOccurrence"], json!(null));
}

#[test]
fn alarm_crud_persists_timestamps_sorts_and_revokes_deleted_notices() {
    let mut connection = db();
    let now = instant("2026-10-11T08:00:00Z");

    let later = create_alarm(&mut connection, draft_weekly(vec![1, 3, 5], 9, 0), now).unwrap();
    let earlier = create_alarm(&mut connection, draft_once(8, 30), now).unwrap();

    let alarms = list_alarms(&connection, now).unwrap();
    assert_eq!(
        alarms
            .iter()
            .map(|alarm| alarm.id.as_str())
            .collect::<Vec<_>>(),
        vec![earlier.id.as_str(), later.id.as_str()]
    );
    assert!(alarms.iter().all(|alarm| alarm.next_occurrence.is_some()));
    assert!(alarms
        .iter()
        .all(|alarm| !alarm.created_at.is_empty() && !alarm.updated_at.is_empty()));

    let updated = update_alarm(
        &mut connection,
        &later.id,
        AlarmDraft {
            enabled: false,
            ..draft_weekly(vec![2], 10, 15)
        },
        now + chrono::Duration::minutes(1),
    )
    .unwrap();
    assert!(!updated.enabled);
    assert_ne!(updated.updated_at, later.updated_at);

    delete_alarm(&mut connection, &earlier.id).unwrap();
    assert_eq!(list_alarms(&connection, now).unwrap().len(), 1);
}

#[test]
fn alarm_validation_accepts_date_free_once_and_rejects_empty_weekdays() {
    let mut connection = db();
    let now = instant("2026-10-11T08:00:00Z");

    create_alarm(&mut connection, draft_once(23, 59), now).unwrap();

    let empty = create_alarm(&mut connection, draft_weekly(Vec::new(), 7, 0), now).unwrap_err();
    assert_eq!(empty.field.as_deref(), Some("repeat.weekdays"));
}

#[test]
fn next_occurrence_uses_once_and_iso_weekdays_in_the_device_zone() {
    let once = Alarm {
        repeat: AlarmRepeat::Once {},
        effective_from_utc: "2026-10-11T23:00:00Z".into(),
        hour: 8,
        minute: 30,
        ..weekly_alarm("once", vec![1], 0, 0)
    };
    assert_eq!(
        next_occurrence(&once, instant("2026-10-11T23:00:00Z"), Tz::Asia__Shanghai)
            .unwrap()
            .to_rfc3339(),
        Utc.with_ymd_and_hms(2026, 10, 12, 0, 30, 0)
            .unwrap()
            .to_rfc3339()
    );

    let weekly = weekly_alarm("w1", vec![3], 9, 0);
    assert_eq!(
        next_occurrence(&weekly, instant("2026-10-12T00:00:00Z"), Tz::Asia__Shanghai)
            .unwrap()
            .to_rfc3339(),
        Utc.with_ymd_and_hms(2026, 10, 14, 1, 0, 0)
            .unwrap()
            .to_rfc3339()
    );
}

#[test]
fn dst_gap_alarm_is_not_dispatched_as_a_normal_alarm_but_counts_as_missed() {
    let alarm = weekly_alarm("gap", vec![7], 2, 30);
    let from = instant("2026-03-08T06:00:00Z");
    let to = instant("2026-03-08T08:00:00Z");

    assert!(
        super::schedule::occurrence_in_window(&alarm, from, to, Tz::America__New_York, 10)
            .is_empty()
    );

    let summary =
        super::schedule::occurrence_summary_in_window(&alarm, from, to, Tz::America__New_York)
            .unwrap();
    assert_eq!(summary.0, 1);
    assert_eq!(
        next_occurrence(&alarm, from, Tz::America__New_York)
            .unwrap()
            .to_rfc3339(),
        instant("2026-03-15T06:30:00Z").to_rfc3339()
    );
}

#[test]
fn normal_polling_records_dst_gap_as_missed_before_advancing_checkpoint() {
    let mut connection = db();
    create_alarm(
        &mut connection,
        draft_weekly(vec![7], 2, 30),
        instant("2026-03-01T00:00:00Z"),
    )
    .unwrap();
    poll_in_zone(
        &mut connection,
        instant("2026-03-08T06:59:58Z"),
        Tz::America__New_York,
    )
    .unwrap();

    poll_in_zone(
        &mut connection,
        instant("2026-03-08T07:00:00Z"),
        Tz::America__New_York,
    )
    .unwrap();

    let notices = list_alarm_notices(&connection, instant("2026-03-08T07:00:00Z")).unwrap();
    assert_eq!(notices.len(), 1);
    assert_eq!(notices[0].kind, AlarmNoticeKind::MissedSummary);
    assert_eq!(notices[0].count, 1);
    assert_eq!(notices[0].range_start, "2026-03-08T07:00:00Z");
    assert_eq!(notices[0].range_end, "2026-03-08T07:00:00Z");
}

#[test]
fn scheduler_first_start_sets_checkpoint_without_backfilling_old_alarms() {
    let mut connection = db();
    create_alarm(
        &mut connection,
        draft_weekly(vec![1, 2, 3, 4, 5, 6, 7], 8, 0),
        instant("2026-10-11T00:00:00Z"),
    )
    .unwrap();

    let outcome = poll(&mut connection, instant("2026-10-11T09:00:00Z")).unwrap();

    assert!(outcome.changed);
    assert!(
        list_alarm_notices(&connection, instant("2026-10-11T09:00:00Z"))
            .unwrap()
            .is_empty()
    );
}

#[test]
fn scheduler_dispatches_due_alarm_once_and_snooze_is_persistent_and_idempotent() {
    let mut connection = db();
    let created_at = instant("2026-10-10T00:00:00Z");
    let created = create_alarm(&mut connection, draft_once(8, 1), created_at).unwrap();
    let due = next_due(&created, created_at);
    let checkpoint = due - chrono::Duration::seconds(1);
    poll(&mut connection, checkpoint).unwrap();

    poll(&mut connection, due).unwrap();
    poll(&mut connection, due + chrono::Duration::seconds(1)).unwrap();
    let notices = list_alarm_notices(&connection, due + chrono::Duration::seconds(1)).unwrap();
    assert_eq!(notices.len(), 1);
    assert_eq!(notices[0].kind, AlarmNoticeKind::Alarm);
    assert_eq!(notices[0].alarm_id.as_deref(), Some(created.id.as_str()));

    snooze_notice(
        &mut connection,
        &notices[0].id,
        due + chrono::Duration::minutes(1),
    )
    .unwrap();
    snooze_notice(
        &mut connection,
        &notices[0].id,
        due + chrono::Duration::minutes(2),
    )
    .unwrap();
    assert!(list_alarm_notices(
        &connection,
        due + chrono::Duration::minutes(5) - chrono::Duration::seconds(1)
    )
    .unwrap()
    .is_empty());
    assert_eq!(
        list_alarm_notices(&connection, due + chrono::Duration::minutes(6))
            .unwrap()
            .len(),
        1
    );

    acknowledge_notice(
        &mut connection,
        &notices[0].id,
        due + chrono::Duration::minutes(6),
    )
    .unwrap();
    acknowledge_notice(
        &mut connection,
        &notices[0].id,
        due + chrono::Duration::minutes(6) + chrono::Duration::seconds(1),
    )
    .unwrap();
    assert!(list_alarm_notices(
        &connection,
        due + chrono::Duration::minutes(6) + chrono::Duration::seconds(2)
    )
    .unwrap()
    .is_empty());
}

#[test]
fn snooze_is_idempotent_while_active_but_can_be_requested_again_after_expiry() {
    let mut connection = db();
    let created_at = instant("2026-10-10T00:00:00Z");
    let created = create_alarm(&mut connection, draft_once(8, 1), created_at).unwrap();
    let due = next_due(&created, created_at);
    poll(&mut connection, due - chrono::Duration::seconds(1)).unwrap();
    poll(&mut connection, due).unwrap();
    let notice = list_alarm_notices(&connection, due).unwrap().remove(0);

    snooze_notice(
        &mut connection,
        &notice.id,
        due + chrono::Duration::minutes(1),
    )
    .unwrap();
    snooze_notice(
        &mut connection,
        &notice.id,
        due + chrono::Duration::minutes(2),
    )
    .unwrap();
    assert_eq!(
        list_alarm_notices(&connection, due + chrono::Duration::minutes(6))
            .unwrap()
            .len(),
        1,
        "duplicate snooze while active must not extend past the first snooze"
    );

    snooze_notice(
        &mut connection,
        &notice.id,
        due + chrono::Duration::minutes(6),
    )
    .unwrap();
    assert!(
        list_alarm_notices(
            &connection,
            due + chrono::Duration::minutes(11) - chrono::Duration::seconds(1)
        )
        .unwrap()
        .is_empty(),
        "new snooze after expiry should hide until the new deadline"
    );
    assert_eq!(
        list_alarm_notices(&connection, due + chrono::Duration::minutes(11))
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn scheduler_recovers_long_gaps_as_one_missed_summary_without_replay() {
    let mut connection = db();
    let created_at = instant("2026-10-10T00:00:00Z");
    let alarm = create_alarm(
        &mut connection,
        draft_weekly(vec![1, 2, 3, 4, 5, 6, 7], 8, 1),
        created_at,
    )
    .unwrap();
    let due = next_due(&alarm, created_at);
    poll(&mut connection, due - chrono::Duration::minutes(10)).unwrap();

    poll(&mut connection, due + chrono::Duration::minutes(9)).unwrap();
    let notices = list_alarm_notices(&connection, due + chrono::Duration::minutes(9)).unwrap();
    assert_eq!(notices.len(), 1);
    assert_eq!(notices[0].kind, AlarmNoticeKind::MissedSummary);
    assert_eq!(notices[0].count, 1);

    poll(
        &mut connection,
        due + chrono::Duration::minutes(9) + chrono::Duration::seconds(1),
    )
    .unwrap();
    assert_eq!(
        list_alarm_notices(
            &connection,
            due + chrono::Duration::minutes(9) + chrono::Duration::seconds(1)
        )
        .unwrap()
        .len(),
        1
    );
}

#[test]
fn scheduler_counts_long_offline_recovery_without_capping_instances() {
    let mut connection = db();
    let created_at = instant("2026-01-01T00:00:00Z");
    let alarm = create_alarm(
        &mut connection,
        draft_weekly(vec![1, 2, 3, 4, 5, 6, 7], 8, 1),
        created_at,
    )
    .unwrap();
    let first_due = next_due(&alarm, created_at);
    poll(&mut connection, first_due - chrono::Duration::minutes(10)).unwrap();

    let recovery_at = first_due + chrono::Duration::days(600);
    poll(&mut connection, recovery_at).unwrap();

    let notices = list_alarm_notices(&connection, recovery_at).unwrap();
    assert_eq!(notices.len(), 1);
    assert_eq!(notices[0].kind, AlarmNoticeKind::MissedSummary);
    assert_eq!(notices[0].count, 601);
}

fn insert_notice(connection: &Connection, id: &str, kind: &str, due: &str, created: &str) {
    connection
        .execute(
            "INSERT INTO alarm_notices
                (id,kind,instance_key,title,due_at_utc,range_start_utc,range_end_utc,count,created_at_utc)
             VALUES (?1,?2,?1,?1,?3,?3,?3,1,?4)",
            rusqlite::params![id, kind, due, created],
        )
        .unwrap();
}

#[test]
fn stacked_pending_alarms_keep_the_latest_active_and_expire_earlier_ones() {
    let mut connection = db();
    insert_notice(
        &connection,
        "alarm:early",
        "alarm",
        "2026-10-14T10:04:50Z",
        "2026-10-14T10:04:50Z",
    );
    insert_notice(
        &connection,
        "alarm:mid",
        "alarm",
        "2026-10-14T10:05:00Z",
        "2026-10-14T10:05:00Z",
    );
    insert_notice(
        &connection,
        "alarm:late",
        "alarm",
        "2026-10-14T10:05:20Z",
        "2026-10-14T10:05:20Z",
    );
    insert_notice(
        &connection,
        "missed:1",
        "missedSummary",
        "2026-10-14T10:05:20Z",
        "2026-10-14T10:05:20Z",
    );
    let now = instant("2026-10-14T10:05:40Z");

    reconcile_superseded_alarms(&mut connection, now).unwrap();

    let active = list_alarm_notices(&connection, now).unwrap();
    assert_eq!(
        active
            .iter()
            .map(|notice| notice.id.as_str())
            .collect::<Vec<_>>(),
        vec!["alarm:late", "missed:1"]
    );
    let expired = list_expired_alarm_notices(&connection, now).unwrap();
    assert_eq!(
        expired
            .iter()
            .map(|notice| notice.id.as_str())
            .collect::<Vec<_>>(),
        vec!["alarm:mid", "alarm:early"]
    );
    assert_eq!(
        list_ringing_alarm_notices(&connection, now)
            .unwrap()
            .iter()
            .map(|notice| notice.id.as_str())
            .collect::<Vec<_>>(),
        vec!["alarm:late"]
    );
}

#[test]
fn reading_alarm_notices_closes_a_stack_without_a_separate_reconcile() {
    let mut connection = db();
    insert_notice(
        &connection,
        "alarm:early",
        "alarm",
        "2026-10-14T10:00:00Z",
        "2026-10-14T10:00:00Z",
    );
    insert_notice(
        &connection,
        "alarm:late",
        "alarm",
        "2026-10-14T10:05:00Z",
        "2026-10-14T10:05:00Z",
    );
    let now = instant("2026-10-14T10:05:10Z");

    let (active, expired) = read_alarm_notice_lists(&mut connection, now).unwrap();

    assert_eq!(
        active
            .iter()
            .map(|notice| notice.id.as_str())
            .collect::<Vec<_>>(),
        vec!["alarm:late"]
    );
    assert_eq!(
        expired
            .iter()
            .map(|notice| notice.id.as_str())
            .collect::<Vec<_>>(),
        vec!["alarm:early"]
    );
}

#[test]
fn reconcile_leaves_a_lone_alarm_pending_after_its_ring_window() {
    let mut connection = db();
    insert_notice(
        &connection,
        "alarm:only",
        "alarm",
        "2026-10-14T10:00:00Z",
        "2026-10-14T10:00:00Z",
    );
    let now = instant("2026-10-14T10:02:00Z");

    reconcile_superseded_alarms(&mut connection, now).unwrap();

    assert_eq!(
        list_alarm_notices(&connection, now).unwrap()[0].id,
        "alarm:only"
    );
    assert!(list_expired_alarm_notices(&connection, now)
        .unwrap()
        .is_empty());
}

#[test]
fn snoozed_alarm_stays_pending_until_it_resumes_beside_a_newer_alarm() {
    let mut connection = db();
    insert_notice(
        &connection,
        "alarm:early",
        "alarm",
        "2026-10-14T10:00:00Z",
        "2026-10-14T10:00:00Z",
    );
    insert_notice(
        &connection,
        "alarm:late",
        "alarm",
        "2026-10-14T10:05:00Z",
        "2026-10-14T10:05:00Z",
    );
    let snoozed_at = instant("2026-10-14T10:00:30Z");
    snooze_notice(&mut connection, "alarm:early", snoozed_at).unwrap();
    let while_snoozed = instant("2026-10-14T10:05:10Z");

    reconcile_superseded_alarms(&mut connection, while_snoozed).unwrap();

    assert!(list_expired_alarm_notices(&connection, while_snoozed)
        .unwrap()
        .is_empty());
    let resumed = instant("2026-10-14T10:05:30Z");
    reconcile_superseded_alarms(&mut connection, resumed).unwrap();
    assert_eq!(
        list_expired_alarm_notices(&connection, resumed).unwrap()[0].id,
        "alarm:early"
    );
    assert_eq!(
        list_alarm_notices(&connection, resumed).unwrap()[0].id,
        "alarm:late"
    );
}

#[test]
fn acknowledging_the_latest_alarm_closes_expired_rows_but_snooze_does_not() {
    let mut connection = db();
    insert_notice(
        &connection,
        "alarm:early",
        "alarm",
        "2026-10-14T10:00:00Z",
        "2026-10-14T10:00:00Z",
    );
    insert_notice(
        &connection,
        "alarm:late",
        "alarm",
        "2026-10-14T10:05:00Z",
        "2026-10-14T10:05:00Z",
    );
    let now = instant("2026-10-14T10:05:10Z");
    reconcile_superseded_alarms(&mut connection, now).unwrap();

    snooze_notice(&mut connection, "alarm:late", now).unwrap();
    assert_eq!(
        list_expired_alarm_notices(&connection, now).unwrap()[0].id,
        "alarm:early"
    );

    let resumed = now + chrono::Duration::minutes(5);
    acknowledge_notice(&mut connection, "alarm:late", resumed).unwrap();
    assert!(list_alarm_notices(&connection, resumed).unwrap().is_empty());
    assert!(list_expired_alarm_notices(&connection, resumed)
        .unwrap()
        .is_empty());
}
