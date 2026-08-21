//! 时区换算层：钟面时间 ↔ UTC 瞬时点的双向换算，DST 断层/重叠解析，设备时区探测。
//! 纯函数、无状态，是 Spec A 时间模型的地基。

use crate::error::CommandError;
use chrono::{DateTime, Duration, LocalResult, NaiveDateTime, TimeZone, Utc};
use chrono_tz::Tz;

/// 钟面时间的存储格式（分钟精度），与 events 表一致。
pub const WALL_FORMAT: &str = "%Y-%m-%dT%H:%M";
/// UTC 缓存列的存储格式（分钟精度，带 Z 后缀）。
pub const UTC_FORMAT: &str = "%Y-%m-%dT%H:%MZ";
