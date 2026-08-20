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

/// 返回该系列落在 `[window_start, window_end_exclusive)` 内的槽位起始时刻，升序。
///
/// 上界 `final_at` 按**闭区间**判定：归一化已把 `count = N` 换算成第 N 个槽位的时刻，
/// 用半开区间会丢掉最后一次实例。窗口右端点则按 R4 半开。
/// 游标的下界只有日期粒度，因此同日更早时刻的槽位在此再过滤一次。
pub fn expand(
    series: &Series,
    window_start: NaiveDateTime,
    window_end_exclusive: NaiveDateTime,
) -> Vec<NaiveDateTime> {
    let mut out = Vec::new();
    if window_start >= window_end_exclusive {
        return out;
    }
    // 无限系列下游标永不返回 None，截断必须发生在收集过程中。
    for value in OccurrenceCursor::new(series, Some(window_start.date())) {
        if let Some(final_at) = series.final_at {
            if value > final_at {
                break;
            }
        }
        if value >= window_end_exclusive {
            break;
        }
        if value >= window_start {
            out.push(value);
            if out.len() >= MAX_WINDOW_OCCURRENCES {
                break;
            }
        }
    }
    out
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

    /// 参考实现专用的月份平移，刻意与生产侧 `add_months` 用不同的算式表达，
    /// 以免两边共享同一个差一错误。
    fn naive_shift_month(date: NaiveDate, months: i64) -> Option<NaiveDate> {
        let shifted = i64::from(date.month()) - 1 + months;
        let year = i64::from(date.year()) + shifted.div_euclid(12);
        let month = shifted.rem_euclid(12) + 1;
        NaiveDate::from_ymd_opt(
            i32::try_from(year).ok()?,
            u32::try_from(month).ok()?,
            date.day(),
        )
    }

    fn naive_shift_year(date: NaiveDate, years: i64) -> Option<NaiveDate> {
        NaiveDate::from_ymd_opt(
            i32::try_from(i64::from(date.year()) + years).ok()?,
            date.month(),
            date.day(),
        )
    }

    /// 朴素参考实现：自 `dtstart` 起逐个周期推进到窗口，不做任何跳跃定位，
    /// 也不复用 `OccurrenceCursor` 或生产侧的日期推进助手——复用了差分就退化成
    /// 自己跟自己比。仅用于交叉验证生产实现，永远不要在产品代码中使用。
    fn naive_expand(
        series: &Series,
        window_start: NaiveDateTime,
        window_end: NaiveDateTime,
    ) -> Vec<NaiveDateTime> {
        let mut out = Vec::new();
        if window_start >= window_end {
            return out;
        }
        let start_date = series.dtstart.date();
        let time = series.dtstart.time();
        let interval = i64::from(series.interval.max(1));
        let mut offsets: Vec<i64> = series
            .by_day
            .iter()
            .map(|day| i64::from(day.num_days_from_monday()))
            .collect();
        offsets.sort_unstable();
        offsets.dedup();
        if offsets.is_empty() {
            offsets.push(i64::from(start_date.weekday().num_days_from_monday()));
        }
        let week_anchor =
            start_date - Duration::days(i64::from(start_date.weekday().num_days_from_monday()));

        let mut done = false;
        for period in 0..(MAX_SERIES_OCCURRENCES as i64) {
            let dates: Vec<NaiveDate> = match series.freq {
                Freq::Daily => start_date
                    .checked_add_signed(Duration::days(period * interval))
                    .into_iter()
                    .collect(),
                Freq::Weekly => offsets
                    .iter()
                    .filter_map(|offset| {
                        week_anchor
                            .checked_add_signed(Duration::days(period * interval * 7 + offset))
                    })
                    .collect(),
                Freq::Monthly => naive_shift_month(start_date, period * interval)
                    .into_iter()
                    .collect(),
                Freq::Yearly => naive_shift_year(start_date, period * interval)
                    .into_iter()
                    .collect(),
            };
            for date in dates {
                if date < start_date {
                    continue;
                }
                let value = date.and_time(time);
                if let Some(final_at) = series.final_at {
                    if value > final_at {
                        done = true;
                        break;
                    }
                }
                if value >= window_end {
                    done = true;
                    break;
                }
                if value >= window_start {
                    out.push(value);
                    if out.len() >= MAX_WINDOW_OCCURRENCES {
                        done = true;
                        break;
                    }
                }
            }
            if done {
                break;
            }
        }
        out
    }

    const DIFF_STARTS: [&str; 4] = [
        "2020-01-31T09:00",
        "2024-02-29T18:30",
        "2026-08-03T10:00",
        "2026-12-31T23:00",
    ];
    const DIFF_WINDOWS: [(&str, &str); 8] = [
        ("2026-08-01T00:00", "2026-09-01T00:00"),
        ("2026-01-01T00:00", "2027-01-01T00:00"),
        ("2020-01-01T00:00", "2020-02-01T00:00"),
        ("2030-06-01T00:00", "2030-06-08T00:00"),
        // 起点恰好压在某些系列的槽位时刻上
        ("2026-08-03T10:00", "2026-08-31T10:00"),
        // 起点落在两个槽位之间（同日、比槽位时刻早/晚各覆盖一次）
        ("2026-08-03T12:00", "2026-08-10T09:30"),
        // 起点早于全部 dtstart
        ("2019-01-01T00:00", "2020-02-15T12:00"),
        // 起点晚于带结束条件系列的 final_at
        ("2028-01-01T00:00", "2028-03-01T00:00"),
    ];

    fn assert_expand_matches_naive(s: &Series) -> usize {
        let mut checked = 0;
        for (ws, we) in DIFF_WINDOWS {
            let expected = naive_expand(s, dt(ws), dt(we));
            let actual = expand(s, dt(ws), dt(we));
            assert_eq!(actual, expected, "shape={s:?} window={ws}..{we}");
            checked += 1;
        }
        checked
    }

    #[test]
    fn expand_matches_the_naive_reference_across_many_shapes() {
        let freqs = [Freq::Daily, Freq::Weekly, Freq::Monthly, Freq::Yearly];
        let intervals = [1u32, 2, 3, 7];
        let day_sets = ["MO", "MO,FR", "TU,WE,TH", "SA,SU"];
        let ends = [
            None,
            Some("2027-06-30T23:59"),
            Some("2026-08-15T00:00"),
            // 以下三个刻意压在各 dtstart 的槽位时刻上，用来暴露闭区间/半开区间之差。
            Some("2026-08-10T10:00"),
            Some("2026-03-31T09:00"),
            Some("2032-02-29T18:30"),
        ];

        let mut checked = 0;
        for start in DIFF_STARTS {
            for freq in freqs {
                for interval in intervals {
                    for days in day_sets {
                        for end in ends {
                            let s = Series {
                                freq,
                                interval,
                                by_day: parse_by_day(days).expect("valid days"),
                                dtstart: dt(start),
                                final_at: end.map(dt),
                            };
                            checked += assert_expand_matches_naive(&s);
                        }
                    }
                }
            }
        }
        assert!(checked >= 1000, "差分覆盖不足：{checked}");
    }

    #[test]
    fn expand_matches_the_naive_reference_for_overflow_shapes() {
        // R2：monthly + 31 日、yearly + 2 月 29 日的跳过语义，在跳跃与朴素两侧必须一致。
        let mut checked = 0;
        for (freq, start) in [
            (Freq::Monthly, "2020-01-31T09:00"),
            (Freq::Monthly, "2026-08-31T07:15"),
            (Freq::Yearly, "2024-02-29T18:30"),
            (Freq::Yearly, "2020-02-29T00:00"),
        ] {
            for interval in [1u32, 2, 3, 4, 5, 7, 12] {
                for end in [None, Some("2035-01-01T00:00"), Some("2032-02-29T18:30")] {
                    let s = Series {
                        freq,
                        interval,
                        by_day: Vec::new(),
                        dtstart: dt(start),
                        final_at: end.map(dt),
                    };
                    checked += assert_expand_matches_naive(&s);
                }
            }
        }
        assert!(checked >= 100, "溢出差分覆盖不足：{checked}");
    }

    #[test]
    fn expand_treats_the_window_as_half_open() {
        let s = series(Freq::Daily, 1, "", "2026-08-03T10:00");
        let result = expand(&s, dt("2026-08-03T10:00"), dt("2026-08-05T10:00"));
        assert_eq!(result, vec![dt("2026-08-03T10:00"), dt("2026-08-04T10:00")]);
    }

    #[test]
    fn expand_stops_at_final_at() {
        let mut s = series(Freq::Daily, 1, "", "2026-08-03T10:00");
        s.final_at = Some(dt("2026-08-04T10:00"));
        let result = expand(&s, dt("2026-08-01T00:00"), dt("2026-09-01T00:00"));
        assert_eq!(result, vec![dt("2026-08-03T10:00"), dt("2026-08-04T10:00")]);
    }

    #[test]
    fn expand_returns_exactly_count_slots() {
        // 归一化把 count = 5 换算成第 5 个槽位的时刻写入 final_at，
        // 上界为闭区间时才恰好还剩 5 个；写成半开会丢掉最后一次。
        let mut s = series(Freq::Weekly, 2, "MO,FR", "2026-08-03T10:00");
        let expected: Vec<NaiveDateTime> =
            naive_expand(&s, dt("2026-08-03T10:00"), dt("2030-01-01T00:00"))
                .into_iter()
                .take(5)
                .collect();
        assert_eq!(expected.len(), 5);
        s.final_at = Some(expected[4]);
        assert_eq!(
            expand(&s, dt("2020-01-01T00:00"), dt("2030-01-01T00:00")),
            expected
        );
    }

    #[test]
    fn expand_excludes_the_last_slot_when_it_equals_the_window_end() {
        let mut s = series(Freq::Daily, 1, "", "2026-08-03T10:00");
        s.final_at = Some(dt("2026-08-05T10:00"));
        assert_eq!(
            expand(&s, dt("2026-08-01T00:00"), dt("2026-08-05T10:00")),
            vec![dt("2026-08-03T10:00"), dt("2026-08-04T10:00")]
        );
        assert_eq!(
            expand(&s, dt("2026-08-01T00:00"), dt("2026-08-05T10:01")).len(),
            3
        );
    }

    #[test]
    fn expand_drops_same_day_slots_earlier_than_the_window_start() {
        // 游标下界是日期粒度，会吐出 08-05T10:00；时刻级过滤必须把它挡掉。
        let s = series(Freq::Daily, 1, "", "2026-08-03T10:00");
        let result = expand(&s, dt("2026-08-05T12:00"), dt("2026-08-07T12:00"));
        assert_eq!(result, vec![dt("2026-08-06T10:00"), dt("2026-08-07T10:00")]);
    }

    #[test]
    fn expand_returns_nothing_for_an_empty_window() {
        let s = series(Freq::Daily, 1, "", "2026-08-03T10:00");
        assert!(expand(&s, dt("2026-08-05T10:00"), dt("2026-08-05T10:00")).is_empty());
        assert!(expand(&s, dt("2026-08-06T10:00"), dt("2026-08-05T10:00")).is_empty());
    }

    #[test]
    fn expand_truncates_at_the_window_cap() {
        let s = series(Freq::Daily, 1, "", "2000-01-01T10:00");
        let result = expand(&s, dt("2000-01-01T00:00"), dt("2100-01-01T00:00"));
        assert_eq!(result.len(), MAX_WINDOW_OCCURRENCES);
    }
}
