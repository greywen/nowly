use super::types::{Alarm, AlarmRepeat};
use chrono::{DateTime, Datelike, Days, LocalResult, NaiveDate, TimeZone, Utc};
use chrono_tz::Tz;

pub fn next_occurrence(
    alarm: &Alarm,
    after_utc: DateTime<Utc>,
    device_zone: Tz,
) -> Option<DateTime<Utc>> {
    if !alarm.enabled {
        return None;
    }
    match &alarm.repeat {
        AlarmRepeat::Once {} => {
            let due = once_occurrence(alarm, device_zone)?;
            (due > after_utc).then_some(due)
        }
        AlarmRepeat::Weekly { weekdays } => {
            if weekdays.is_empty() {
                return None;
            }
            let local_date = after_utc.with_timezone(&device_zone).date_naive();
            for offset in 0..=370 {
                let date = local_date.checked_add_days(Days::new(offset))?;
                if !weekdays.contains(&(date.weekday().number_from_monday() as u8)) {
                    continue;
                }
                let Some(due) = occurrence_on_date(alarm, date, device_zone) else {
                    continue;
                };
                if due > after_utc {
                    return Some(due);
                }
            }
            None
        }
    }
}

fn once_occurrence(alarm: &Alarm, device_zone: Tz) -> Option<DateTime<Utc>> {
    let anchor = DateTime::parse_from_rfc3339(&alarm.effective_from_utc)
        .ok()?
        .with_timezone(&Utc);
    let mut date = anchor.with_timezone(&device_zone).date_naive();
    loop {
        if let Some(due) = occurrence_on_date(alarm, date, device_zone) {
            if due > anchor {
                return Some(due);
            }
        }
        date = date.checked_add_days(Days::new(1))?;
    }
}

pub(crate) fn occurrence_on_date(
    alarm: &Alarm,
    date: NaiveDate,
    device_zone: Tz,
) -> Option<DateTime<Utc>> {
    let wall = date.and_hms_opt(alarm.hour.into(), alarm.minute.into(), 0)?;
    match device_zone.from_local_datetime(&wall) {
        LocalResult::Single(dt) => Some(dt.with_timezone(&Utc)),
        LocalResult::Ambiguous(earlier, _) => Some(earlier.with_timezone(&Utc)),
        LocalResult::None => None,
    }
}

fn summary_instant_on_date(
    alarm: &Alarm,
    date: NaiveDate,
    device_zone: Tz,
) -> Option<DateTime<Utc>> {
    let wall = date.and_hms_opt(alarm.hour.into(), alarm.minute.into(), 0)?;
    Some(crate::timezone::wall_to_utc(wall, device_zone))
}

pub(crate) fn instance_key(alarm: &Alarm, due_at: DateTime<Utc>, device_zone: Tz) -> String {
    let local = due_at.with_timezone(&device_zone);
    format!(
        "{}:{:04}-{:02}-{:02}T{:02}:{:02}",
        alarm.id,
        local.year(),
        local.month(),
        local.day(),
        alarm.hour,
        alarm.minute
    )
}

pub(crate) fn occurrence_in_window(
    alarm: &Alarm,
    from_exclusive: DateTime<Utc>,
    to_inclusive: DateTime<Utc>,
    device_zone: Tz,
    max: usize,
) -> Vec<DateTime<Utc>> {
    if !alarm.enabled || to_inclusive <= from_exclusive || max == 0 {
        return Vec::new();
    }
    let mut result = Vec::new();
    match &alarm.repeat {
        AlarmRepeat::Once {} => {
            if let Some(due) = once_occurrence(alarm, device_zone) {
                if due > from_exclusive && due <= to_inclusive {
                    result.push(due);
                }
            }
        }
        AlarmRepeat::Weekly { weekdays } => {
            let Some(mut date) = from_exclusive
                .with_timezone(&device_zone)
                .date_naive()
                .checked_sub_days(Days::new(1))
            else {
                return result;
            };
            let Some(end) = to_inclusive
                .with_timezone(&device_zone)
                .date_naive()
                .checked_add_days(Days::new(1))
            else {
                return result;
            };
            while date <= end && result.len() < max {
                if weekdays.contains(&(date.weekday().number_from_monday() as u8)) {
                    if let Some(due) = occurrence_on_date(alarm, date, device_zone) {
                        if due > from_exclusive && due <= to_inclusive {
                            result.push(due);
                        }
                    }
                }
                let Some(next) = date.checked_add_days(Days::new(1)) else {
                    break;
                };
                date = next;
            }
        }
    }
    result.sort_unstable();
    result
}

pub(crate) fn occurrence_summary_in_window(
    alarm: &Alarm,
    from_exclusive: DateTime<Utc>,
    to_inclusive: DateTime<Utc>,
    device_zone: Tz,
) -> Option<(i64, DateTime<Utc>, DateTime<Utc>)> {
    if !alarm.enabled || to_inclusive <= from_exclusive {
        return None;
    }
    let mut count = 0_i64;
    let mut first = None;
    let mut last = None;
    match &alarm.repeat {
        AlarmRepeat::Once {} => {
            let due = once_occurrence(alarm, device_zone)?;
            if due > from_exclusive && due <= to_inclusive {
                count = 1;
                first = Some(due);
                last = Some(due);
            }
        }
        AlarmRepeat::Weekly { weekdays } => {
            let mut date = from_exclusive
                .with_timezone(&device_zone)
                .date_naive()
                .checked_sub_days(Days::new(1))?;
            let end = to_inclusive
                .with_timezone(&device_zone)
                .date_naive()
                .checked_add_days(Days::new(1))?;
            while date <= end {
                if weekdays.contains(&(date.weekday().number_from_monday() as u8)) {
                    if let Some(due) = summary_instant_on_date(alarm, date, device_zone) {
                        if due > from_exclusive && due <= to_inclusive {
                            count += 1;
                            first =
                                Some(first.map_or(due, |current: DateTime<Utc>| current.min(due)));
                            last =
                                Some(last.map_or(due, |current: DateTime<Utc>| current.max(due)));
                        }
                    }
                }
                let Some(next) = date.checked_add_days(Days::new(1)) else {
                    break;
                };
                date = next;
            }
        }
    }
    match (count, first, last) {
        (0, _, _) => None,
        (_, Some(first), Some(last)) => Some((count, first, last)),
        _ => None,
    }
}
