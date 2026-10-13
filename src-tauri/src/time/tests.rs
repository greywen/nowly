use super::schedule::next_occurrence;
use super::scheduler::{acknowledge_notice, list_alarm_notices, poll, poll_in_zone, snooze_notice};
use super::store::{
    create_alarm, delete_alarm, get_time_settings, list_alarms, save_time_settings, update_alarm,
};
use super::types::{
    Alarm, AlarmDraft, AlarmNoticeKind, AlarmRepeat, ClockMode, TimeSettings, WorldClock,
};
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
        next_occurrence: None,
    }
}

fn draft_once(date: &str, hour: u8, minute: u8) -> AlarmDraft {
    AlarmDraft {
        title: "Flight".into(),
        hour,
        minute,
        repeat: AlarmRepeat::Once { date: date.into() },
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
fn default_time_settings_are_one_local_digital_clock() {
    let connection = db();

    let settings = get_time_settings(&connection).unwrap();

    assert_eq!(settings.clocks.len(), 1);
    assert_eq!(settings.clocks[0].time_zone, "local");
    assert_eq!(settings.clocks[0].mode, ClockMode::Digital);
    assert!(!settings.clocks[0].show_label);
    assert!(!settings.clocks[0].show_date);
    assert!(!settings.clocks[0].show_difference);
}

#[test]
fn legacy_clock_appearance_defaults_and_invalid_font_sizes() {
    let legacy = r#"{"clocks":[{"id":"local","timeZone":"local","label":"","mode":"digital","hourCycle":"h23","showSeconds":false,"showLabel":false,"showDate":false,"showDifference":false}]}"#;
    let mut settings: TimeSettings = serde_json::from_str(legacy).unwrap();
    assert_eq!(settings.clocks[0].layout, "horizontal");
    assert_eq!(settings.clocks[0].font_mode, "auto");
    assert_eq!(settings.clocks[0].font_size, 96);
    let mut connection = db();
    for size in [31, 161] {
        settings.clocks[0].font_size = size;
        assert_eq!(
            save_time_settings(&mut connection, settings.clone())
                .unwrap_err()
                .field
                .as_deref(),
            Some("fontSize")
        );
    }
}

#[test]
fn time_settings_round_trip_and_validate_clocks() {
    let mut connection = db();
    let settings = TimeSettings {
        clocks: vec![WorldClock {
            id: "shanghai".into(),
            time_zone: "Asia/Shanghai".into(),
            label: "Shanghai".into(),
            mode: ClockMode::Mixed,
            hour_cycle: "h23".into(),
            show_seconds: true,
            show_label: true,
            show_date: true,
            show_difference: false,
            layout: "stacked".into(),
            font_mode: "manual".into(),
            font_size: 128,
        }],
    };

    let saved = save_time_settings(&mut connection, settings.clone()).unwrap();
    assert_eq!(saved, settings);
    assert_eq!(get_time_settings(&connection).unwrap(), settings);

    let empty =
        save_time_settings(&mut connection, TimeSettings { clocks: Vec::new() }).unwrap_err();
    assert_eq!(empty.field.as_deref(), Some("clocks"));

    let mut invalid = settings;
    invalid.clocks[0].time_zone = "Mars/Olympus".into();
    let timezone = save_time_settings(&mut connection, invalid).unwrap_err();
    assert_eq!(timezone.field.as_deref(), Some("timeZone"));
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
    let earlier = create_alarm(&mut connection, draft_once("2026-10-12", 8, 30), now).unwrap();

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
fn alarm_validation_rejects_past_once_and_empty_weekdays() {
    let mut connection = db();
    let now = instant("2026-10-11T08:00:00Z");

    let past = create_alarm(&mut connection, draft_once("2026-10-10", 23, 59), now).unwrap_err();
    assert_eq!(past.field.as_deref(), Some("repeat"));

    let empty = create_alarm(&mut connection, draft_weekly(Vec::new(), 7, 0), now).unwrap_err();
    assert_eq!(empty.field.as_deref(), Some("repeat.weekdays"));
}

#[test]
fn next_occurrence_uses_once_and_iso_weekdays_in_the_device_zone() {
    let once = Alarm {
        repeat: AlarmRepeat::Once {
            date: "2026-10-12".into(),
        },
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
    let created =
        create_alarm(&mut connection, draft_once("2026-10-11", 8, 1), created_at).unwrap();
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
    let created =
        create_alarm(&mut connection, draft_once("2026-10-11", 8, 1), created_at).unwrap();
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
