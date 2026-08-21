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
