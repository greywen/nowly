//! 时区换算层：钟面时间 ↔ UTC 瞬时点的双向换算，DST 断层/重叠解析，设备时区探测。
//! 纯函数、无状态，是 Spec A 时间模型的地基。

use crate::error::CommandError;
use chrono::{DateTime, Duration, LocalResult, NaiveDateTime, TimeZone, Utc};
use chrono_tz::Tz;

/// 钟面时间的存储格式（分钟精度），与 events 表一致。
pub const WALL_FORMAT: &str = "%Y-%m-%dT%H:%M";
/// UTC 缓存列的存储格式（分钟精度，带 Z 后缀）。
pub const UTC_FORMAT: &str = "%Y-%m-%dT%H:%MZ";

/// 把 IANA 时区名解析成 `chrono_tz::Tz`。未知名字返回校验错误。
pub fn parse_tz(name: &str) -> Result<Tz, CommandError> {
    name.parse::<Tz>()
        .map_err(|_| CommandError::validation("timezone", format!("未知的时区：{name}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_valid_iana_name() {
        assert_eq!(parse_tz("Asia/Shanghai").unwrap(), Tz::Asia__Shanghai);
        assert_eq!(parse_tz("UTC").unwrap(), Tz::UTC);
    }

    #[test]
    fn rejects_an_unknown_name() {
        let err = parse_tz("Mars/Olympus").unwrap_err();
        assert_eq!(err.field.as_deref(), Some("timezone"));
    }
}
