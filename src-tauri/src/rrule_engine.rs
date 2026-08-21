//! RRULE 展开引擎：封装 `rrule` crate，把系列规格在一个窗口内展开成实例列表。
//! 完整 RFC 5545 RRULE 与 DST 边界由 `rrule` crate 承担；本模块负责钟面/时区的
//! 桥接与半开窗口过滤。纯函数、无状态，依赖 Part 1 的 `timezone` 模块。
//!
//! 本模块作为地基先于其消费者（Part 3 读写层、Spec C 订阅展开）落地，此刻公开 API 仅被
//! 测试引用，故临时允许 dead_code；Part 3 接入 `expand` 后应移除此豁免。
#![allow(dead_code)]

use crate::error::CommandError;
use crate::timezone;
use chrono::{DateTime, NaiveDateTime, Utc};
use chrono_tz::Tz;
use rrule::RRuleSet;

/// 一次展开得到的实例。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Occurrence {
    /// 系列自身时区（或浮动）下的钟面时间 —— 实例身份键。
    pub wall: NaiveDateTime,
    /// 带时区事件的 UTC 瞬时点；浮动事件为 None。
    pub utc: Option<DateTime<Utc>>,
}

/// 一个系列的展开输入。
#[derive(Debug, Clone)]
pub struct SeriesSpec {
    /// 系列开始的钟面时间（dtstart）。
    pub dtstart_wall: NaiveDateTime,
    /// 系列时区；None 表示浮动事件（无时区）。
    pub tz: Option<Tz>,
    /// RFC 5545 RRULE 串（如 `FREQ=WEEKLY;BYDAY=MO`）；None 表示单次事件。
    pub rrule: Option<String>,
    /// 附加发生时刻（RDATE），系列时区下的钟面时间。
    pub rdate: Vec<NaiveDateTime>,
    /// 排除发生时刻（EXDATE），系列时区下的钟面时间。
    pub exdate: Vec<NaiveDateTime>,
}

/// 单次展开的实例数量上限，防御超大/无限系列。与旧引擎的 MAX_WINDOW_OCCURRENCES 同量级。
pub const MAX_WINDOW_OCCURRENCES: usize = 1_000;

/// rrule crate 解析 DTSTART/RDATE/EXDATE 用的秒级时间戳格式。
const ICS_STAMP: &str = "%Y%m%dT%H%M%S";

fn stamp(wall: NaiveDateTime) -> String {
    wall.format(ICS_STAMP).to_string()
}

/// 把系列规格组合成 rrule crate 能解析的 ICS 文本。
/// 带时区用 `DTSTART;TZID=<zone>:<stamp>`，浮动用 `DTSTART:<stamp>`。
/// RDATE/EXDATE 沿用 DTSTART 的时区语境（与 dtstart 同一钟面框架）。
fn compose_ics(spec: &SeriesSpec) -> String {
    let mut lines: Vec<String> = Vec::new();
    match spec.tz {
        Some(tz) => lines.push(format!("DTSTART;TZID={}:{}", tz.name(), stamp(spec.dtstart_wall))),
        None => lines.push(format!("DTSTART:{}", stamp(spec.dtstart_wall))),
    }
    if let Some(rule) = &spec.rrule {
        lines.push(format!("RRULE:{rule}"));
    }
    if !spec.rdate.is_empty() {
        let stamps: Vec<String> = spec.rdate.iter().map(|w| stamp(*w)).collect();
        lines.push(format!("RDATE:{}", stamps.join(",")));
    }
    if !spec.exdate.is_empty() {
        let stamps: Vec<String> = spec.exdate.iter().map(|w| stamp(*w)).collect();
        lines.push(format!("EXDATE:{}", stamps.join(",")));
    }
    lines.join("\n")
}

/// 把 `[window_start_wall, window_end_excl_wall)`（系列时区钟面半开窗口）内的实例展开。
/// `limit` 为实例数量上限。带时区事件每个实例带 UTC 瞬时点；浮动事件为 None。
pub fn expand(
    spec: &SeriesSpec,
    window_start_wall: NaiveDateTime,
    window_end_excl_wall: NaiveDateTime,
    limit: usize,
) -> Result<Vec<Occurrence>, CommandError> {
    if window_start_wall >= window_end_excl_wall {
        return Ok(Vec::new());
    }
    // 单次事件路径在 Task 4 实现。
    let Some(_) = spec.rrule.as_ref() else {
        return expand_single(spec, window_start_wall, window_end_excl_wall);
    };

    // 窗口两端换算成 UTC 瞬时点，供 rrule 的 after/before 按瞬时点过滤。
    // 带时区：用系列时区把钟面窗口换算成 UTC；浮动：钟面即当作 UTC 瞬时点。
    let (after_utc, before_utc) = window_instants(spec, window_start_wall, window_end_excl_wall);

    let ics = compose_ics(spec);
    let set: RRuleSet = ics
        .parse()
        .map_err(|e| CommandError::validation("recurrence", format!("重复规则无效：{e}")))?;

    // after/before 按瞬时点闭区间过滤；右界的半开由下方钟面 < end 再保证。
    let after = to_rrule_utc(after_utc);
    let before = to_rrule_utc(before_utc);
    let result = set.after(after).before(before).all(limit as u16);

    let mut out = Vec::new();
    for dt in result.dates {
        let wall = dt.naive_local();
        // 半开右界：钟面 >= 窗口末端的实例（after/before 闭区间可能带入）剔除。
        if wall >= window_end_excl_wall {
            continue;
        }
        if wall < window_start_wall {
            continue;
        }
        let utc = if spec.tz.is_some() {
            Some(dt.with_timezone(&Utc))
        } else {
            None
        };
        out.push(Occurrence { wall, utc });
        if out.len() >= limit {
            break;
        }
    }
    Ok(out)
}

/// 把系列时区钟面窗口换算成 UTC 瞬时点对。
fn window_instants(
    spec: &SeriesSpec,
    start_wall: NaiveDateTime,
    end_wall: NaiveDateTime,
) -> (DateTime<Utc>, DateTime<Utc>) {
    match spec.tz {
        Some(tz) => (
            timezone::wall_to_utc(start_wall, tz),
            timezone::wall_to_utc(end_wall, tz),
        ),
        // 浮动：钟面直接当作 UTC 瞬时点（仅用于 after/before 的相对过滤，语义自洽）。
        None => (
            DateTime::<Utc>::from_naive_utc_and_offset(start_wall, Utc),
            DateTime::<Utc>::from_naive_utc_and_offset(end_wall, Utc),
        ),
    }
}

/// 把 UTC 瞬时点转成 rrule crate 的 `DateTime<rrule::Tz>`（UTC 载体，按瞬时点比较）。
fn to_rrule_utc(instant: DateTime<Utc>) -> DateTime<rrule::Tz> {
    instant.with_timezone(&rrule::Tz::UTC)
}

/// 单次事件展开（无 RRULE）：dtstart 加 rdate 减 exdate，过滤到窗口。Task 4 实现。
fn expand_single(
    _spec: &SeriesSpec,
    _start: NaiveDateTime,
    _end: NaiveDateTime,
) -> Result<Vec<Occurrence>, CommandError> {
    Ok(Vec::new())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::timezone::parse_wall;

    fn window(start: &str, end: &str) -> (NaiveDateTime, NaiveDateTime) {
        (parse_wall(start).unwrap(), parse_wall(end).unwrap())
    }

    #[test]
    fn expands_tz_bound_weekly_with_dst_offset_shift() {
        let spec = SeriesSpec {
            dtstart_wall: parse_wall("2026-03-02T10:00").unwrap(),
            tz: Some(Tz::America__New_York),
            rrule: Some("FREQ=WEEKLY;BYDAY=MO".into()),
            rdate: Vec::new(),
            exdate: Vec::new(),
        };
        let (s, e) = window("2026-03-01T00:00", "2026-03-31T00:00");
        let occ = expand(&spec, s, e, MAX_WINDOW_OCCURRENCES).unwrap();
        // 钟面恒为 10:00。
        assert!(occ.iter().all(|o| o.wall.format("%H:%M").to_string() == "10:00"));
        // 3/2 在 DST 前：15:00Z；3/9 在 DST 后：14:00Z。
        let by_date = |d: &str| occ.iter().find(|o| o.wall.format("%Y-%m-%d").to_string() == d).unwrap();
        assert_eq!(timezone::format_utc(by_date("2026-03-02").utc.unwrap()), "2026-03-02T15:00Z");
        assert_eq!(timezone::format_utc(by_date("2026-03-09").utc.unwrap()), "2026-03-09T14:00Z");
    }

    #[test]
    fn window_right_bound_is_half_open() {
        let spec = SeriesSpec {
            dtstart_wall: parse_wall("2026-08-01T10:00").unwrap(),
            tz: Some(Tz::Asia__Shanghai),
            rrule: Some("FREQ=DAILY".into()),
            rdate: Vec::new(),
            exdate: Vec::new(),
        };
        // 窗口 [8/1, 8/3)：应含 8/1、8/2，不含 8/3。
        let (s, e) = window("2026-08-01T00:00", "2026-08-03T00:00");
        let occ = expand(&spec, s, e, MAX_WINDOW_OCCURRENCES).unwrap();
        let dates: Vec<String> = occ.iter().map(|o| o.wall.format("%Y-%m-%d").to_string()).collect();
        assert_eq!(dates, vec!["2026-08-01", "2026-08-02"]);
    }

    #[test]
    fn expands_monthly_ordinal_weekday() {
        // 每月第 3 个周二。
        let spec = SeriesSpec {
            dtstart_wall: parse_wall("2026-01-01T09:00").unwrap(),
            tz: None,
            rrule: Some("FREQ=MONTHLY;BYDAY=TU;BYSETPOS=3".into()),
            rdate: Vec::new(),
            exdate: Vec::new(),
        };
        let (s, e) = window("2026-01-01T00:00", "2026-04-01T00:00");
        let occ = expand(&spec, s, e, MAX_WINDOW_OCCURRENCES).unwrap();
        let dates: Vec<String> = occ.iter().map(|o| o.wall.format("%Y-%m-%d").to_string()).collect();
        assert_eq!(dates, vec!["2026-01-20", "2026-02-17", "2026-03-17"]);
        // 浮动事件无 UTC 瞬时点。
        assert!(occ.iter().all(|o| o.utc.is_none()));
    }

    #[test]
    fn composes_ics_for_a_tz_bound_series() {
        let spec = SeriesSpec {
            dtstart_wall: parse_wall("2026-08-03T10:00").unwrap(),
            tz: Some(Tz::Asia__Shanghai),
            rrule: Some("FREQ=WEEKLY;BYDAY=MO".into()),
            rdate: Vec::new(),
            exdate: Vec::new(),
        };
        let ics = compose_ics(&spec);
        assert_eq!(
            ics,
            "DTSTART;TZID=Asia/Shanghai:20260803T100000\nRRULE:FREQ=WEEKLY;BYDAY=MO"
        );
    }

    #[test]
    fn composes_ics_for_a_floating_series_with_exdate() {
        let spec = SeriesSpec {
            dtstart_wall: parse_wall("2026-01-01T09:00").unwrap(),
            tz: None,
            rrule: Some("FREQ=DAILY;COUNT=3".into()),
            rdate: vec![parse_wall("2026-01-10T09:00").unwrap()],
            exdate: vec![parse_wall("2026-01-02T09:00").unwrap()],
        };
        let ics = compose_ics(&spec);
        assert_eq!(
            ics,
            "DTSTART:20260101T090000\nRRULE:FREQ=DAILY;COUNT=3\nRDATE:20260110T090000\nEXDATE:20260102T090000"
        );
    }
}
