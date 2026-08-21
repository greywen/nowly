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

/// 解析钟面时间字符串（`%Y-%m-%dT%H:%M`）。失败时字段名记为 `startAt`，
/// 便于校验错误直接对应到前端字段。
pub fn parse_wall(value: &str) -> Result<NaiveDateTime, CommandError> {
    NaiveDateTime::parse_from_str(value, WALL_FORMAT)
        .map_err(|_| CommandError::validation("startAt", "钟面时间格式无效。"))
}

/// 把某具名时区下的钟面时间换算成 UTC 瞬时点。
/// DST 重叠（钟面出现两次）取第一次出现（earlier）；
/// DST 断层（钟面不存在）取断层后的第一个有效瞬时点（later）。
pub fn wall_to_utc(wall: NaiveDateTime, tz: Tz) -> DateTime<Utc> {
    match tz.from_local_datetime(&wall) {
        LocalResult::Single(dt) => dt.with_timezone(&Utc),
        LocalResult::Ambiguous(earlier, _later) => earlier.with_timezone(&Utc),
        LocalResult::None => {
            // 断层：该钟面在本地不存在。逐分钟前探，找到断层后第一个有效钟面，
            // 返回它对应的瞬时点。DST 断层至多数小时，3 小时窗口足以覆盖。
            let mut probe = wall;
            for _ in 0..(3 * 60) {
                probe += Duration::minutes(1);
                match tz.from_local_datetime(&probe) {
                    LocalResult::Single(dt) => return dt.with_timezone(&Utc),
                    LocalResult::Ambiguous(dt, _) => return dt.with_timezone(&Utc),
                    LocalResult::None => {}
                }
            }
            // 真实时区不会走到这里；兜底按 UTC 解释，保证函数全域有返回值。
            Utc.from_utc_datetime(&wall)
        }
    }
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

    #[test]
    fn parses_wall_clock_strings() {
        let wall = parse_wall("2026-08-03T10:00").unwrap();
        assert_eq!(wall.format(WALL_FORMAT).to_string(), "2026-08-03T10:00");
    }

    #[test]
    fn rejects_malformed_wall_clock() {
        assert_eq!(
            parse_wall("nope").unwrap_err().field.as_deref(),
            Some("startAt")
        );
    }

    #[test]
    fn converts_wall_to_utc_normally() {
        // 上海不实行夏令时，UTC+8 恒定：10:00 → 02:00Z。
        let utc = wall_to_utc(parse_wall("2026-08-03T10:00").unwrap(), Tz::Asia__Shanghai);
        assert_eq!(utc.format(UTC_FORMAT).to_string(), "2026-08-03T02:00Z");
    }

    #[test]
    fn spring_forward_gap_takes_the_instant_after_the_gap() {
        // 纽约 2026-03-08，02:00 跳到 03:00，02:30 不存在。
        // 断层后第一个有效钟面是 03:00 EDT(UTC-4) = 07:00Z。
        let utc = wall_to_utc(
            parse_wall("2026-03-08T02:30").unwrap(),
            Tz::America__New_York,
        );
        assert_eq!(utc.format(UTC_FORMAT).to_string(), "2026-03-08T07:00Z");
    }

    #[test]
    fn fall_back_overlap_takes_the_earlier_instant() {
        // 纽约 2026-11-01，01:30 出现两次。第一次是 EDT(UTC-4) = 05:30Z。
        let utc = wall_to_utc(
            parse_wall("2026-11-01T01:30").unwrap(),
            Tz::America__New_York,
        );
        assert_eq!(utc.format(UTC_FORMAT).to_string(), "2026-11-01T05:30Z");
    }
}
