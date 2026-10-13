use super::schedule::next_occurrence;
use super::types::{Alarm, AlarmDraft, AlarmRepeat, ClockMode, TimeSettings, WorldClock};
use crate::error::CommandError;
use chrono::{DateTime, NaiveDate, SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::HashSet;

pub fn default_time_settings() -> TimeSettings {
    TimeSettings {
        clocks: vec![WorldClock {
            id: "local".to_owned(),
            time_zone: "local".to_owned(),
            label: String::new(),
            mode: ClockMode::Digital,
            hour_cycle: "h23".to_owned(),
            show_seconds: false,
            show_label: false,
            show_date: false,
            show_difference: false,
            layout: "horizontal".to_owned(),
            font_mode: "auto".to_owned(),
            font_size: 96,
        }],
    }
}

pub fn get_time_settings(connection: &Connection) -> Result<TimeSettings, CommandError> {
    let value: Option<String> = connection
        .query_row("SELECT value FROM time_settings WHERE id=1", [], |row| {
            row.get(0)
        })
        .optional()
        .map_err(CommandError::database)?;
    let Some(value) = value else {
        return Ok(default_time_settings());
    };
    let settings = serde_json::from_str::<TimeSettings>(&value).map_err(CommandError::database)?;
    validate_settings(&settings)?;
    Ok(settings)
}

pub fn save_time_settings(
    connection: &mut Connection,
    settings: TimeSettings,
) -> Result<TimeSettings, CommandError> {
    validate_settings(&settings)?;
    let value = serde_json::to_string(&settings).map_err(CommandError::system)?;
    let transaction = connection.transaction().map_err(CommandError::database)?;
    transaction
        .execute(
            "INSERT INTO time_settings(id,value,updated_at)
             VALUES (1,?1,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
             ON CONFLICT(id) DO UPDATE SET
                value=excluded.value,
                updated_at=excluded.updated_at",
            [value],
        )
        .map_err(CommandError::database)?;
    transaction.commit().map_err(CommandError::database)?;
    Ok(settings)
}

pub fn list_alarms(
    connection: &Connection,
    now: DateTime<Utc>,
) -> Result<Vec<Alarm>, CommandError> {
    let mut statement = connection
        .prepare(
            "SELECT id,title,hour,minute,repeat,enabled,created_at,updated_at
             FROM alarms
             ORDER BY hour ASC, minute ASC, created_at ASC, id ASC",
        )
        .map_err(CommandError::database)?;
    let alarms = statement
        .query_map([], read_alarm)
        .map_err(CommandError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(CommandError::database)?;
    Ok(with_next_occurrences(alarms, now))
}

pub fn create_alarm(
    connection: &mut Connection,
    draft: AlarmDraft,
    now: DateTime<Utc>,
) -> Result<Alarm, CommandError> {
    let draft = validate_alarm_draft(draft, now)?;
    let id = uuid::Uuid::new_v4().hyphenated().to_string();
    let timestamp = format_utc(now);
    let repeat = serde_json::to_string(&draft.repeat).map_err(CommandError::system)?;
    let transaction = connection.transaction().map_err(CommandError::database)?;
    transaction
        .execute(
            "INSERT INTO alarms(id,title,hour,minute,repeat,enabled,effective_from_utc,created_at,updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?7,?7)",
            params![
                id,
                draft.title,
                draft.hour,
                draft.minute,
                repeat,
                if draft.enabled { 1 } else { 0 },
                timestamp
            ],
        )
        .map_err(CommandError::database)?;
    transaction.commit().map_err(CommandError::database)?;
    get_alarm(connection, &id, now)
}

pub fn update_alarm(
    connection: &mut Connection,
    id: &str,
    draft: AlarmDraft,
    now: DateTime<Utc>,
) -> Result<Alarm, CommandError> {
    ensure_alarm_exists(connection, id)?;
    let draft = validate_alarm_draft(draft, now)?;
    let timestamp = format_utc(now);
    let repeat = serde_json::to_string(&draft.repeat).map_err(CommandError::system)?;
    let transaction = connection.transaction().map_err(CommandError::database)?;
    transaction
        .execute(
            "UPDATE alarms
             SET title=?2,hour=?3,minute=?4,repeat=?5,enabled=?6,
                 effective_from_utc=?7,updated_at=?7
             WHERE id=?1",
            params![
                id,
                draft.title,
                draft.hour,
                draft.minute,
                repeat,
                if draft.enabled { 1 } else { 0 },
                timestamp
            ],
        )
        .map_err(CommandError::database)?;
    if !draft.enabled {
        transaction
            .execute(
                "DELETE FROM alarm_notices WHERE alarm_id=?1 AND acknowledged_at_utc IS NULL",
                [id],
            )
            .map_err(CommandError::database)?;
    }
    transaction.commit().map_err(CommandError::database)?;
    get_alarm(connection, id, now)
}

pub fn delete_alarm(connection: &mut Connection, id: &str) -> Result<(), CommandError> {
    let transaction = connection.transaction().map_err(CommandError::database)?;
    let affected = transaction
        .execute("DELETE FROM alarms WHERE id=?1", [id])
        .map_err(CommandError::database)?;
    if affected == 0 {
        return Err(CommandError::not_found("Alarm not found."));
    }
    transaction
        .execute(
            "DELETE FROM alarm_notices WHERE alarm_id=?1 AND acknowledged_at_utc IS NULL",
            [id],
        )
        .map_err(CommandError::database)?;
    transaction.commit().map_err(CommandError::database)?;
    Ok(())
}

pub(crate) fn read_enabled_alarms(
    connection: &Connection,
) -> Result<Vec<(Alarm, DateTime<Utc>)>, CommandError> {
    let mut statement = connection
        .prepare(
            "SELECT id,title,hour,minute,repeat,enabled,created_at,updated_at,effective_from_utc
             FROM alarms WHERE enabled=1 ORDER BY id",
        )
        .map_err(CommandError::database)?;
    let rows = statement
        .query_map([], |row| {
            let alarm = read_alarm(row)?;
            let effective_from: String = row.get(8)?;
            Ok((alarm, parse_utc_sql(&effective_from)?))
        })
        .map_err(CommandError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(CommandError::database)?;
    Ok(rows)
}

pub(crate) fn disable_once_alarm(
    transaction: &rusqlite::Transaction<'_>,
    id: &str,
    now: DateTime<Utc>,
) -> Result<(), CommandError> {
    transaction
        .execute(
            "UPDATE alarms SET enabled=0, updated_at=?2 WHERE id=?1",
            params![id, format_utc(now)],
        )
        .map_err(CommandError::database)?;
    Ok(())
}

pub(crate) fn parse_utc_sql(value: &str) -> rusqlite::Result<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .map(|dt| dt.with_timezone(&Utc))
        .map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                0,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })
}

pub(crate) fn format_utc(value: DateTime<Utc>) -> String {
    value.to_rfc3339_opts(SecondsFormat::Secs, true)
}

fn validate_settings(settings: &TimeSettings) -> Result<(), CommandError> {
    if settings.clocks.is_empty() {
        return Err(CommandError::validation(
            "clocks",
            "At least one clock is required.",
        ));
    }
    let mut ids = HashSet::new();
    for clock in &settings.clocks {
        if clock.id.trim().is_empty() || !ids.insert(clock.id.as_str()) {
            return Err(CommandError::validation(
                "clocks",
                "Clock ids must be unique.",
            ));
        }
        if clock.time_zone != "local" && clock.time_zone.parse::<chrono_tz::Tz>().is_err() {
            return Err(CommandError::validation(
                "timeZone",
                "Please choose a valid time zone.",
            ));
        }
        if !matches!(clock.layout.as_str(), "horizontal" | "stacked" | "date") {
            return Err(CommandError::validation("layout", "Invalid clock layout."));
        }
        if !matches!(clock.font_mode.as_str(), "auto" | "manual")
            || !(32..=160).contains(&clock.font_size)
        {
            return Err(CommandError::validation(
                "fontSize",
                "Clock font size must be between 32 and 160.",
            ));
        }
        if !matches!(clock.hour_cycle.as_str(), "h12" | "h23") {
            return Err(CommandError::validation("hourCycle", "Invalid hour cycle."));
        }
    }
    Ok(())
}

fn validate_alarm_draft(
    mut draft: AlarmDraft,
    now: DateTime<Utc>,
) -> Result<AlarmDraft, CommandError> {
    draft.title = draft.title.trim().to_owned();
    if draft.title.is_empty() {
        return Err(CommandError::validation(
            "title",
            "Please enter an alarm title.",
        ));
    }
    if draft.hour > 23 {
        return Err(CommandError::validation(
            "hour",
            "Hour must be between 0 and 23.",
        ));
    }
    if draft.minute > 59 {
        return Err(CommandError::validation(
            "minute",
            "Minute must be between 0 and 59.",
        ));
    }
    match &mut draft.repeat {
        AlarmRepeat::Once { date } => {
            let day = NaiveDate::parse_from_str(date, "%Y-%m-%d").map_err(|_| {
                CommandError::validation("repeat", "Once alarms need a valid date.")
            })?;
            let wall = day
                .and_hms_opt(draft.hour.into(), draft.minute.into(), 0)
                .ok_or_else(|| CommandError::validation("repeat", "Alarm time is invalid."))?;
            let due = crate::timezone::wall_to_utc(wall, crate::timezone::device_tz());
            if due <= now {
                return Err(CommandError::validation(
                    "repeat",
                    "Once alarms must be in the future.",
                ));
            }
        }
        AlarmRepeat::Weekly { weekdays } => {
            weekdays.sort_unstable();
            weekdays.dedup();
            if weekdays.is_empty() {
                return Err(CommandError::validation(
                    "repeat.weekdays",
                    "Choose at least one weekday.",
                ));
            }
            if weekdays.iter().any(|day| !(1..=7).contains(day)) {
                return Err(CommandError::validation(
                    "repeat.weekdays",
                    "Weekdays must use ISO values 1 through 7.",
                ));
            }
        }
    }
    Ok(draft)
}

fn read_alarm(row: &rusqlite::Row<'_>) -> rusqlite::Result<Alarm> {
    let repeat_raw: String = row.get(4)?;
    let repeat = serde_json::from_str::<AlarmRepeat>(&repeat_raw).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(4, rusqlite::types::Type::Text, Box::new(error))
    })?;
    Ok(Alarm {
        id: row.get(0)?,
        title: row.get(1)?,
        hour: row.get::<_, i64>(2)? as u8,
        minute: row.get::<_, i64>(3)? as u8,
        repeat,
        enabled: row.get::<_, i64>(5)? == 1,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
        next_occurrence: None,
    })
}

fn get_alarm(connection: &Connection, id: &str, now: DateTime<Utc>) -> Result<Alarm, CommandError> {
    let alarm = connection
        .query_row(
            "SELECT id,title,hour,minute,repeat,enabled,created_at,updated_at
             FROM alarms WHERE id=?1",
            [id],
            read_alarm,
        )
        .optional()
        .map_err(CommandError::database)?
        .ok_or_else(|| CommandError::not_found("Alarm not found."))?;
    Ok(with_next_occurrences(vec![alarm], now).remove(0))
}

fn ensure_alarm_exists(connection: &Connection, id: &str) -> Result<(), CommandError> {
    let exists: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM alarms WHERE id=?1)",
            [id],
            |row| row.get(0),
        )
        .map_err(CommandError::database)?;
    if exists {
        Ok(())
    } else {
        Err(CommandError::not_found("Alarm not found."))
    }
}

fn with_next_occurrences(mut alarms: Vec<Alarm>, now: DateTime<Utc>) -> Vec<Alarm> {
    let zone = crate::timezone::device_tz();
    for alarm in &mut alarms {
        alarm.next_occurrence = if alarm.enabled {
            next_occurrence(alarm, now, zone).map(format_utc)
        } else {
            None
        };
    }
    alarms
}
