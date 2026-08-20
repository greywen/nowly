use crate::error::CommandError;
use chrono::{Datelike, Duration, NaiveDate, NaiveDateTime, Weekday};
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

/// 连续跳过而不产出实例的周期数上限。月/年频率遇到 2 月 30 日这类
/// 溢出会跳过整个周期，该上限保证跳过序列不会无限延伸。
const MAX_CONSECUTIVE_SKIPS: u32 = 480;

fn weekday_offset(day: Weekday) -> i64 {
    i64::from(day.num_days_from_monday())
}

fn add_months(date: NaiveDate, months: i64) -> Option<NaiveDate> {
    let total = i64::from(date.year()) * 12 + i64::from(date.month0()) + months;
    let year = i32::try_from(total.div_euclid(12)).ok()?;
    let month0 = u32::try_from(total.rem_euclid(12)).ok()?;
    NaiveDate::from_ymd_opt(year, month0 + 1, date.day())
}

fn add_years(date: NaiveDate, years: i64) -> Option<NaiveDate> {
    let year = i32::try_from(i64::from(date.year()) + years).ok()?;
    NaiveDate::from_ymd_opt(year, date.month(), date.day())
}

/// 保守跳跃：先算出目标周期序号再退一格，用一次多余迭代换取边界安全。
fn jump_index(delta: i64, interval: i64) -> i64 {
    if delta <= 0 {
        0
    } else {
        ((delta / interval) - 1).max(0)
    }
}

/// 按时间升序产出该系列的槽位起始时刻。不理会 `final_at` 与任何窗口上界，
/// 截断由调用方负责，使本类型保持单一职责。
pub struct OccurrenceCursor {
    freq: Freq,
    interval: i64,
    dtstart: NaiveDateTime,
    week_anchor: NaiveDate,
    day_offsets: Vec<i64>,
    min_date: NaiveDate,
    period: i64,
    slot: usize,
    exhausted: bool,
}

impl OccurrenceCursor {
    /// `from` 为 `Some` 时产出的首个槽位是日期不早于 `from` 的那一个；为 `None` 时从
    /// 首个槽位开始。下界按**日期**判定，同日更早时刻的槽位仍会产出，调用方若按
    /// 时刻判定窗口需自行再过滤。
    pub fn new(series: &Series, from: Option<NaiveDate>) -> Self {
        let start_date = series.dtstart.date();
        let interval = i64::from(series.interval.max(1));
        let week_anchor = start_date - Duration::days(weekday_offset(start_date.weekday()));
        let mut day_offsets: Vec<i64> = series
            .by_day
            .iter()
            .map(|day| weekday_offset(*day))
            .collect();
        day_offsets.sort_unstable();
        day_offsets.dedup();
        if day_offsets.is_empty() {
            day_offsets.push(weekday_offset(start_date.weekday()));
        }

        let period = match from {
            None => 0,
            Some(target) => match series.freq {
                Freq::Daily => jump_index((target - start_date).num_days(), interval),
                Freq::Weekly => {
                    let target_anchor = target - Duration::days(weekday_offset(target.weekday()));
                    jump_index((target_anchor - week_anchor).num_days() / 7, interval)
                }
                Freq::Monthly => {
                    let months = (i64::from(target.year()) - i64::from(start_date.year())) * 12
                        + (i64::from(target.month0()) - i64::from(start_date.month0()));
                    jump_index(months, interval)
                }
                Freq::Yearly => jump_index(
                    i64::from(target.year()) - i64::from(start_date.year()),
                    interval,
                ),
            },
        };

        Self {
            freq: series.freq,
            interval,
            dtstart: series.dtstart,
            week_anchor,
            day_offsets,
            min_date: from.unwrap_or(start_date).max(start_date),
            period,
            slot: 0,
            exhausted: false,
        }
    }

    fn next_date(&mut self) -> Option<NaiveDate> {
        let start_date = self.dtstart.date();
        let mut skips = 0u32;
        loop {
            let candidate = match self.freq {
                Freq::Daily => {
                    start_date.checked_add_signed(Duration::days(self.period * self.interval))
                }
                Freq::Weekly => {
                    if self.slot >= self.day_offsets.len() {
                        self.slot = 0;
                        self.period += 1;
                        continue;
                    }
                    let offset = self.day_offsets[self.slot];
                    self.slot += 1;
                    self.week_anchor.checked_add_signed(Duration::days(
                        self.period * self.interval * 7 + offset,
                    ))
                }
                Freq::Monthly => add_months(start_date, self.period * self.interval),
                Freq::Yearly => add_years(start_date, self.period * self.interval),
            };

            if !matches!(self.freq, Freq::Weekly) {
                self.period += 1;
            }

            match candidate {
                // 早于下界的候选来自两处：周频率首个分组里早于 dtstart 的星期，
                // 以及保守跳跃刻意多退的那一格。
                Some(date) if date >= self.min_date => return Some(date),
                _ => {
                    skips += 1;
                    if skips > MAX_CONSECUTIVE_SKIPS {
                        return None;
                    }
                }
            }
        }
    }
}

impl Iterator for OccurrenceCursor {
    type Item = NaiveDateTime;

    fn next(&mut self) -> Option<Self::Item> {
        if self.exhausted {
            return None;
        }
        match self.next_date() {
            Some(date) => Some(date.and_time(self.dtstart.time())),
            None => {
                self.exhausted = true;
                None
            }
        }
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

    fn dt(value: &str) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(value, "%Y-%m-%dT%H:%M").expect("valid datetime")
    }

    fn series(freq: Freq, interval: u32, by_day: &str, dtstart: &str) -> Series {
        Series {
            freq,
            interval,
            by_day: parse_by_day(by_day).expect("valid days"),
            dtstart: dt(dtstart),
            final_at: None,
        }
    }

    fn take(series: &Series, n: usize) -> Vec<NaiveDateTime> {
        OccurrenceCursor::new(series, None).take(n).collect()
    }

    #[test]
    fn daily_cursor_steps_by_interval() {
        let s = series(Freq::Daily, 3, "", "2026-08-03T10:00");
        assert_eq!(
            take(&s, 3),
            vec![
                dt("2026-08-03T10:00"),
                dt("2026-08-06T10:00"),
                dt("2026-08-09T10:00")
            ]
        );
    }

    #[test]
    fn weekly_cursor_emits_selected_days_in_week_order() {
        let s = series(Freq::Weekly, 2, "MO,FR", "2026-08-03T10:00"); // 2026-08-03 是周一
        assert_eq!(
            take(&s, 4),
            vec![
                dt("2026-08-03T10:00"),
                dt("2026-08-07T10:00"),
                dt("2026-08-17T10:00"),
                dt("2026-08-21T10:00")
            ]
        );
    }

    #[test]
    fn monthly_cursor_skips_months_without_the_day() {
        let s = series(Freq::Monthly, 1, "", "2026-01-31T09:00");
        assert_eq!(
            take(&s, 3),
            vec![
                dt("2026-01-31T09:00"),
                dt("2026-03-31T09:00"),
                dt("2026-05-31T09:00")
            ]
        );
    }

    #[test]
    fn yearly_cursor_skips_non_leap_years() {
        let s = series(Freq::Yearly, 1, "", "2024-02-29T09:00");
        assert_eq!(
            take(&s, 2),
            vec![dt("2024-02-29T09:00"), dt("2028-02-29T09:00")]
        );
    }

    #[test]
    fn cursor_jump_matches_sequential_walk() {
        let s = series(Freq::Daily, 5, "", "2020-01-01T08:00");
        let from = dt("2026-08-01T00:00");
        let jumped: Vec<NaiveDateTime> = OccurrenceCursor::new(&s, Some(from.date()))
            .take(3)
            .collect();
        let walked: Vec<NaiveDateTime> = OccurrenceCursor::new(&s, None)
            .filter(|value| *value >= from)
            .take(3)
            .collect();
        assert_eq!(jumped, walked);
    }

    #[test]
    fn cursor_keeps_the_slot_that_equals_the_window_start() {
        // 2026-03-05 恰好是第 9 个周期（63 天），保守跳跃不得把它跳过去。
        let s = series(Freq::Daily, 7, "", "2026-01-01T09:00");
        let jumped: Vec<NaiveDateTime> =
            OccurrenceCursor::new(&s, Some(dt("2026-03-05T00:00").date()))
                .take(2)
                .collect();
        assert_eq!(jumped, vec![dt("2026-03-05T09:00"), dt("2026-03-12T09:00")]);
    }

    #[test]
    fn cursor_clamps_a_window_start_earlier_than_dtstart() {
        // 2026-08-05 是周三，首个分组里的周一早于 dtstart，同样不得产出。
        let s = series(Freq::Weekly, 3, "MO,WE", "2026-08-05T10:00");
        let jumped: Vec<NaiveDateTime> =
            OccurrenceCursor::new(&s, Some(dt("2020-01-01T00:00").date()))
                .take(3)
                .collect();
        assert_eq!(jumped, take(&s, 3));
        assert_eq!(
            jumped,
            vec![
                dt("2026-08-05T10:00"),
                dt("2026-08-24T10:00"),
                dt("2026-08-26T10:00")
            ]
        );
    }
}
