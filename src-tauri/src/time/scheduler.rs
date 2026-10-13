use super::types::AlarmNotice;
use crate::error::CommandError;
use chrono::{DateTime, Duration, Utc};
use rusqlite::{params, Connection, OptionalExtension};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SchedulerOutcome {
    pub changed: bool,
}

pub fn poll(
    connection: &mut Connection,
    now: DateTime<Utc>,
) -> Result<SchedulerOutcome, CommandError> {
    poll_in_zone(connection, now, crate::timezone::device_tz())
}

pub(crate) fn poll_in_zone(
    connection: &mut Connection,
    now: DateTime<Utc>,
    zone: chrono_tz::Tz,
) -> Result<SchedulerOutcome, CommandError> {
    let previous = read_checkpoint(connection)?;
    let now_text = super::store::format_utc(now);
    let Some(previous) = previous else {
        connection
            .execute(
                "INSERT INTO alarm_scheduler_state(id,checkpoint_utc,updated_at)
                 VALUES (1,?1,?1)
                 ON CONFLICT(id) DO UPDATE SET checkpoint_utc=excluded.checkpoint_utc, updated_at=excluded.updated_at",
                [&now_text],
            )
            .map_err(CommandError::database)?;
        return Ok(SchedulerOutcome { changed: true });
    };
    if now <= previous {
        return Ok(SchedulerOutcome { changed: false });
    }

    let alarms = super::store::read_enabled_alarms(connection)?;
    let recovery = now - previous > Duration::seconds(5);
    let transaction = connection.transaction().map_err(CommandError::database)?;
    let mut changed = false;
    let mut missed_count = 0_i64;
    let mut range_start: Option<DateTime<Utc>> = None;
    let mut range_end: Option<DateTime<Utc>> = None;
    let mut titles: Vec<String> = Vec::new();

    for (alarm, effective_from) in alarms {
        let from = std::cmp::max(previous, effective_from);
        if recovery {
            let Some((count, first, last)) =
                super::schedule::occurrence_summary_in_window(&alarm, from, now, zone)
            else {
                continue;
            };
            changed = true;
            missed_count += count;
            if !titles.iter().any(|title| title == &alarm.title) {
                titles.push(alarm.title.clone());
            }
            range_start = Some(range_start.map_or(first, |current| current.min(first)));
            range_end = Some(range_end.map_or(last, |current| current.max(last)));
            if matches!(alarm.repeat, super::types::AlarmRepeat::Once { .. }) {
                super::store::disable_once_alarm(&transaction, &alarm.id, now)?;
            }
        } else {
            let occurrences = super::schedule::occurrence_in_window(&alarm, from, now, zone, 512);
            if occurrences.is_empty() {
                if let Some((count, first, last)) =
                    super::schedule::occurrence_summary_in_window(&alarm, from, now, zone)
                {
                    changed = true;
                    missed_count += count;
                    if !titles.iter().any(|title| title == &alarm.title) {
                        titles.push(alarm.title.clone());
                    }
                    range_start = Some(range_start.map_or(first, |current| current.min(first)));
                    range_end = Some(range_end.map_or(last, |current| current.max(last)));
                    if matches!(alarm.repeat, super::types::AlarmRepeat::Once { .. }) {
                        super::store::disable_once_alarm(&transaction, &alarm.id, now)?;
                    }
                }
                continue;
            }
            changed = true;
            for due in occurrences {
                let key = super::schedule::instance_key(&alarm, due, zone);
                let notice_id = format!("alarm:{key}");
                transaction
                    .execute(
                        "INSERT OR IGNORE INTO alarm_notices
                            (id,kind,alarm_id,instance_key,title,due_at_utc,range_start_utc,range_end_utc,count,created_at_utc)
                         VALUES (?1,'alarm',?2,?3,?4,?5,?5,?5,1,?6)",
                        params![
                            notice_id,
                            alarm.id,
                            key,
                            alarm.title,
                            super::store::format_utc(due),
                            now_text
                        ],
                    )
                    .map_err(CommandError::database)?;
                if matches!(alarm.repeat, super::types::AlarmRepeat::Once { .. }) {
                    super::store::disable_once_alarm(&transaction, &alarm.id, now)?;
                }
            }
        }
    }

    if missed_count > 0 {
        let start = range_start.unwrap_or(previous);
        let end = range_end.unwrap_or(now);
        let title = if titles.len() == 1 {
            format!("Missed alarm: {}", titles[0])
        } else {
            format!("Missed {missed_count} alarms")
        };
        let summary_id = format!("missedSummary:{}:{}", previous.timestamp(), now.timestamp());
        transaction
            .execute(
                "INSERT OR IGNORE INTO alarm_notices
                    (id,kind,alarm_id,instance_key,title,due_at_utc,range_start_utc,range_end_utc,count,created_at_utc)
                 VALUES (?1,'missedSummary',NULL,?1,?2,?3,?4,?5,?6,?3)",
                params![
                    summary_id,
                    title,
                    now_text,
                    super::store::format_utc(start),
                    super::store::format_utc(end),
                    missed_count
                ],
            )
            .map_err(CommandError::database)?;
    }

    transaction
        .execute(
            "INSERT INTO alarm_scheduler_state(id,checkpoint_utc,updated_at)
             VALUES (1,?1,?1)
             ON CONFLICT(id) DO UPDATE SET checkpoint_utc=excluded.checkpoint_utc, updated_at=excluded.updated_at",
            [&now_text],
        )
        .map_err(CommandError::database)?;
    transaction.commit().map_err(CommandError::database)?;
    Ok(SchedulerOutcome { changed })
}

pub fn list_alarm_notices(
    connection: &Connection,
    now: DateTime<Utc>,
) -> Result<Vec<AlarmNotice>, CommandError> {
    let now_text = super::store::format_utc(now);
    let mut statement = connection
        .prepare(
            "SELECT id,kind,title,due_at_utc,alarm_id,count,range_start_utc,range_end_utc
             FROM alarm_notices
             WHERE acknowledged_at_utc IS NULL
               AND (snoozed_until_utc IS NULL OR snoozed_until_utc <= ?1)
             ORDER BY due_at_utc ASC, id ASC",
        )
        .map_err(CommandError::database)?;
    let notices = statement
        .query_map([now_text], |row| {
            let kind_raw: String = row.get(1)?;
            let kind = match kind_raw.as_str() {
                "alarm" => super::types::AlarmNoticeKind::Alarm,
                "missedSummary" => super::types::AlarmNoticeKind::MissedSummary,
                _ => {
                    return Err(rusqlite::Error::FromSqlConversionFailure(
                        1,
                        rusqlite::types::Type::Text,
                        "invalid alarm notice kind".into(),
                    ))
                }
            };
            Ok(AlarmNotice {
                id: row.get(0)?,
                kind,
                title: row.get(2)?,
                due_at: row.get(3)?,
                alarm_id: row.get(4)?,
                count: row.get(5)?,
                range_start: row.get(6)?,
                range_end: row.get(7)?,
            })
        })
        .map_err(CommandError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(CommandError::database)?;
    Ok(notices)
}

pub fn acknowledge_notice(
    connection: &mut Connection,
    id: &str,
    now: DateTime<Utc>,
) -> Result<(), CommandError> {
    connection
        .execute(
            "UPDATE alarm_notices
             SET acknowledged_at_utc=COALESCE(acknowledged_at_utc, ?2)
             WHERE id=?1",
            params![id, super::store::format_utc(now)],
        )
        .map_err(CommandError::database)?;
    Ok(())
}

pub fn snooze_notice(
    connection: &mut Connection,
    id: &str,
    now: DateTime<Utc>,
) -> Result<(), CommandError> {
    let snooze_until = super::store::format_utc(now + Duration::minutes(5));
    let now_text = super::store::format_utc(now);
    connection
        .execute(
            "UPDATE alarm_notices
             SET snoozed_until_utc=CASE
                WHEN snoozed_until_utc IS NULL OR snoozed_until_utc <= ?3 THEN ?2
                ELSE snoozed_until_utc
             END
             WHERE id=?1 AND kind='alarm' AND acknowledged_at_utc IS NULL",
            params![id, snooze_until, now_text],
        )
        .map_err(CommandError::database)?;
    Ok(())
}

fn read_checkpoint(connection: &Connection) -> Result<Option<DateTime<Utc>>, CommandError> {
    let raw: Option<String> = connection
        .query_row(
            "SELECT checkpoint_utc FROM alarm_scheduler_state WHERE id=1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(CommandError::database)?;
    raw.map(|value| super::store::parse_utc_sql(&value))
        .transpose()
        .map_err(CommandError::database)
}
