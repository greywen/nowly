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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::timezone::parse_wall;

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
