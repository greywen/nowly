use crate::error::CommandError;
use chrono::{NaiveDateTime, Weekday};
use serde::{Deserialize, Serialize};

/// 单个系列允许生成的实例总数上限。超过即视为校验错误，
/// 既防止无意义的巨型系列，也让 `final_at` 的计算保持有界。
pub const MAX_SERIES_OCCURRENCES: usize = 10_000;

/// 单次展开允许返回的槽位上限。正常日历窗口远低于此值，
/// 该上限仅用于防御超大窗口导致的内存耗尽。
pub const MAX_WINDOW_OCCURRENCES: usize = 1_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Freq {
    Daily,
    Weekly,
    Monthly,
    Yearly,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum RecurrenceEnd {
    Never,
    Until { date: String },
    Count { count: u32 },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Recurrence {
    pub freq: Freq,
    pub interval: u32,
    pub by_day: Vec<String>,
    pub end: RecurrenceEnd,
}

/// 展开所需的全部输入。`final_at` 已把 `Until` 与 `Count` 归一为同一个绝对上界，
/// 因此展开逻辑不需要知道用户当初选的是哪种结束条件。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Series {
    pub freq: Freq,
    pub interval: u32,
    pub by_day: Vec<Weekday>,
    pub dtstart: NaiveDateTime,
    pub final_at: Option<NaiveDateTime>,
}

pub fn freq_from_str(value: &str) -> Result<Freq, CommandError> {
    match value {
        "daily" => Ok(Freq::Daily),
        "weekly" => Ok(Freq::Weekly),
        "monthly" => Ok(Freq::Monthly),
        "yearly" => Ok(Freq::Yearly),
        _ => Err(CommandError::validation("recurrence", "重复频率无效。")),
    }
}

pub fn freq_to_str(freq: Freq) -> &'static str {
    match freq {
        Freq::Daily => "daily",
        Freq::Weekly => "weekly",
        Freq::Monthly => "monthly",
        Freq::Yearly => "yearly",
    }
}

const WEEKDAY_CODES: [(&str, Weekday); 7] = [
    ("MO", Weekday::Mon),
    ("TU", Weekday::Tue),
    ("WE", Weekday::Wed),
    ("TH", Weekday::Thu),
    ("FR", Weekday::Fri),
    ("SA", Weekday::Sat),
    ("SU", Weekday::Sun),
];

pub fn weekday_from_code(code: &str) -> Result<Weekday, CommandError> {
    WEEKDAY_CODES
        .iter()
        .find(|(name, _)| *name == code)
        .map(|(_, day)| *day)
        .ok_or_else(|| CommandError::validation("recurrence", "重复的星期取值无效。"))
}

pub fn weekday_to_code(day: Weekday) -> &'static str {
    WEEKDAY_CODES
        .iter()
        .find(|(_, value)| *value == day)
        .map(|(name, _)| *name)
        .unwrap_or("MO")
}

pub fn parse_by_day(value: &str) -> Result<Vec<Weekday>, CommandError> {
    if value.is_empty() {
        return Ok(Vec::new());
    }
    value.split(',').map(weekday_from_code).collect()
}

/// 始终按周一至周日排序并去重，使存储形态唯一，便于「规则是否变化」的相等比较。
pub fn format_by_day(days: &[Weekday]) -> String {
    let mut sorted: Vec<Weekday> = days.to_vec();
    sorted.sort_by_key(|day| day.num_days_from_monday());
    sorted.dedup();
    sorted
        .iter()
        .map(|day| weekday_to_code(*day))
        .collect::<Vec<_>>()
        .join(",")
}

pub fn end_from_columns(until: Option<String>, count: Option<u32>) -> RecurrenceEnd {
    match (until, count) {
        (Some(date), _) => RecurrenceEnd::Until { date },
        (None, Some(count)) => RecurrenceEnd::Count { count },
        (None, None) => RecurrenceEnd::Never,
    }
}

pub fn end_to_columns(end: &RecurrenceEnd) -> (Option<String>, Option<u32>) {
    match end {
        RecurrenceEnd::Never => (None, None),
        RecurrenceEnd::Until { date } => (Some(date.clone()), None),
        RecurrenceEnd::Count { count } => (None, Some(*count)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_weekday_list_from_storage() {
        assert_eq!(
            parse_by_day("MO,WE,FR").expect("valid list"),
            vec![Weekday::Mon, Weekday::Wed, Weekday::Fri]
        );
        assert_eq!(parse_by_day("").expect("empty list"), Vec::<Weekday>::new());
        assert!(parse_by_day("XX").is_err());
    }

    #[test]
    fn serializes_weekday_list_in_week_order() {
        let days = vec![Weekday::Fri, Weekday::Mon];
        assert_eq!(format_by_day(&days), "MO,FR");
    }

    #[test]
    fn round_trips_recurrence_end_through_columns() {
        assert_eq!(end_from_columns(None, None), RecurrenceEnd::Never);
        assert_eq!(
            end_from_columns(Some("2026-12-31".into()), None),
            RecurrenceEnd::Until {
                date: "2026-12-31".into()
            }
        );
        assert_eq!(
            end_from_columns(None, Some(10)),
            RecurrenceEnd::Count { count: 10 }
        );
    }
}
