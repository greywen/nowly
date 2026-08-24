//! 最小 iCalendar（RFC 5545）解析器：把 .ics 文本解析为 VEvent，并用 Spec A 的
//! rrule_engine 在窗口内展开成只读外部实例。只覆盖 Apple/Google/Outlook/Teams
//! 导出订阅里实际出现的属性；时区/DST/RRULE 一律委托 timezone + rrule_engine。
//! 纯函数、无网络、无数据库。

use crate::rrule_engine::{self, SeriesSpec};
use crate::timezone;
use chrono::{Duration, NaiveDate, NaiveDateTime};

/// 整个订阅源单次同步允许展开的实例总数上限。每条 RRULE 已受
/// `rrule_engine::MAX_WINDOW_OCCURRENCES` 约束，此上限再从整源角度封顶，
/// 防止一个塞满带重复规则 VEVENT 的 .ics 把库撑爆。
pub const MAX_SOURCE_INSTANCES: usize = 10_000;

/// 单次同步允许解析的 VEVENT 块数量上限。
pub const MAX_SOURCE_VEVENTS: usize = 5_000;

/// 把常见的 Windows 时区名映射到 IANA 名。Outlook 导出的 .ics 常用 Windows
/// 时区标识（如 "China Standard Time"），而 `chrono-tz` 只认 IANA 名。此表只覆盖
/// 最常见的一批；命中即用映射结果，未命中再交由调用方按 IANA 解析。
fn windows_tz_to_iana(name: &str) -> Option<&'static str> {
    let mapped = match name.trim() {
        "China Standard Time" => "Asia/Shanghai",
        "Taipei Standard Time" => "Asia/Taipei",
        "Tokyo Standard Time" => "Asia/Tokyo",
        "Korea Standard Time" => "Asia/Seoul",
        "Singapore Standard Time" => "Asia/Singapore",
        "India Standard Time" => "Asia/Kolkata",
        "SE Asia Standard Time" => "Asia/Bangkok",
        "W. Europe Standard Time" => "Europe/Berlin",
        "Central Europe Standard Time" => "Europe/Budapest",
        "Central European Standard Time" => "Europe/Warsaw",
        "Romance Standard Time" => "Europe/Paris",
        "GMT Standard Time" => "Europe/London",
        "Greenwich Standard Time" => "Atlantic/Reykjavik",
        "Russian Standard Time" => "Europe/Moscow",
        "E. Australia Standard Time" => "Australia/Brisbane",
        "AUS Eastern Standard Time" => "Australia/Sydney",
        "Eastern Standard Time" => "America/New_York",
        "Central Standard Time" => "America/Chicago",
        "Mountain Standard Time" => "America/Denver",
        "Pacific Standard Time" => "America/Los_Angeles",
        "UTC" => "UTC",
        _ => return None,
    };
    Some(mapped)
}

/// 把 TZID 参数解析成一个 Nowly 内部时区名（IANA 或 "UTC"）。先按 IANA 直接解析，
/// 失败再尝试 Windows→IANA 映射。都不认识返回 None（调用方退化为浮动）。
fn resolve_tzid(name: &str) -> Option<String> {
    if timezone::parse_tz(name).is_ok() {
        return Some(name.to_owned());
    }
    let mapped = windows_tz_to_iana(name)?;
    if timezone::parse_tz(mapped).is_ok() {
        Some(mapped.to_owned())
    } else {
        None
    }
}

/// 把折行反折：以空格/制表符开头的物理行拼回上一行。返回逻辑行列表。
fn unfold_lines(text: &str) -> Vec<String> {
    let mut logical: Vec<String> = Vec::new();
    for raw in text.split('\n') {
        let line = raw.strip_suffix('\r').unwrap_or(raw);
        if let Some(rest) = line.strip_prefix(' ').or_else(|| line.strip_prefix('\t')) {
            if let Some(last) = logical.last_mut() {
                last.push_str(rest);
                continue;
            }
        }
        logical.push(line.to_owned());
    }
    logical
}

/// 抽取所有 VEVENT 块，每块是其内部逻辑行（不含 BEGIN/END:VEVENT）。
fn vevent_blocks(lines: &[String]) -> Vec<Vec<String>> {
    let mut blocks = Vec::new();
    let mut current: Option<Vec<String>> = None;
    for line in lines {
        match line.as_str() {
            "BEGIN:VEVENT" => current = Some(Vec::new()),
            "END:VEVENT" => {
                if let Some(block) = current.take() {
                    blocks.push(block);
                }
            }
            _ => {
                if let Some(block) = current.as_mut() {
                    block.push(line.clone());
                }
            }
        }
    }
    blocks
}

/// 解析后的一条属性行。
struct Property {
    name: String,
    params: Vec<(String, String)>,
    value: String,
}

impl Property {
    /// 取参数值（参数名大小写不敏感）。
    fn param(&self, key: &str) -> Option<&str> {
        self.params
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(key))
            .map(|(_, v)| v.as_str())
    }
}

/// 解析一条属性行为 name / params / value；无 `:` 返回 None。
fn parse_property(line: &str) -> Option<Property> {
    let colon = line.find(':')?;
    let (head, rest) = line.split_at(colon);
    let value = &rest[1..]; // 跳过 ':'
    let mut parts = head.split(';');
    let name = parts.next()?.trim().to_ascii_uppercase();
    if name.is_empty() {
        return None;
    }
    let mut params = Vec::new();
    for part in parts {
        if let Some(eq) = part.find('=') {
            let (key, val) = part.split_at(eq);
            params.push((key.trim().to_owned(), val[1..].to_owned()));
        }
    }
    Some(Property {
        name,
        params,
        value: value.to_owned(),
    })
}

/// 解析出的一个 ICS 日期时间。`wall` 是钟面时间（全天为当日 00:00）；
/// `tz` 为具名时区（UTC 记为 "UTC"），浮动/全天为 None；`all_day` 标记全天。
#[derive(Debug, Clone, PartialEq, Eq)]
struct IcsDateTime {
    wall: NaiveDateTime,
    tz: Option<String>,
    all_day: bool,
}

/// 把 `20260810T100000` 形式的秒级时间戳解析为钟面时间。
fn parse_stamp(value: &str) -> Option<NaiveDateTime> {
    NaiveDateTime::parse_from_str(value, "%Y%m%dT%H%M%S").ok()
}

/// 解析一条 DTSTART/DTEND/RECURRENCE-ID 属性为 IcsDateTime。识别四种形态。
fn parse_ics_datetime(prop: &Property) -> Option<IcsDateTime> {
    let value = prop.value.trim();
    // 全天：VALUE=DATE，值为 8 位日期。
    if prop.param("VALUE") == Some("DATE") || (value.len() == 8 && !value.contains('T')) {
        let date = NaiveDate::parse_from_str(value, "%Y%m%d").ok()?;
        return Some(IcsDateTime {
            wall: date.and_hms_opt(0, 0, 0)?,
            tz: None,
            all_day: true,
        });
    }
    // UTC：尾缀 Z。
    if let Some(stripped) = value.strip_suffix('Z') {
        let wall = parse_stamp(stripped)?;
        return Some(IcsDateTime {
            wall,
            tz: Some("UTC".to_owned()),
            all_day: false,
        });
    }
    let wall = parse_stamp(value)?;
    // 带 TZID：能解析成 IANA 时区（直接或经 Windows→IANA 映射）才保留，
    // 否则退化为浮动。
    let tz = prop.param("TZID").and_then(resolve_tzid);
    Some(IcsDateTime {
        wall,
        tz,
        all_day: false,
    })
}

/// 反转义 ICS TEXT 值：\n \N → 换行，\, → , ，\; → ; ，\\ → \。
fn unescape_text(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut chars = value.chars();
    while let Some(ch) = chars.next() {
        if ch == '\\' {
            match chars.next() {
                Some('n') | Some('N') => out.push('\n'),
                Some(',') => out.push(','),
                Some(';') => out.push(';'),
                Some('\\') => out.push('\\'),
                Some(other) => {
                    out.push('\\');
                    out.push(other);
                }
                None => out.push('\\'),
            }
        } else {
            out.push(ch);
        }
    }
    out
}

/// 一个解析出的 VEVENT。时间为钟面 + 具名时区；rdate/exdate 为系列时区下的钟面。
#[derive(Debug, Clone)]
pub struct VEvent {
    pub uid: Option<String>,
    pub summary: String,
    pub location: Option<String>,
    pub description: Option<String>,
    dtstart: IcsDateTime,
    dtend: Option<IcsDateTime>,
    rrule: Option<String>,
    rdate: Vec<NaiveDateTime>,
    exdate: Vec<NaiveDateTime>,
    /// RECURRENCE-ID 的钟面时间：本 VEVENT 是对某次 occurrence 的覆盖/取消，
    /// 值为被覆盖 occurrence 在系列时区下的原始钟面。普通事件为 None。
    recurrence_id: Option<NaiveDateTime>,
    /// STATUS:CANCELLED 标记该事件（或该次 occurrence）已取消。
    cancelled: bool,
}

/// 解析一个逗号分隔的日期时间列表（RDATE/EXDATE），取每项的钟面。解析失败项跳过。
fn parse_datetime_list(prop: &Property) -> Vec<NaiveDateTime> {
    prop.value
        .split(',')
        .filter_map(|item| {
            let synthetic = Property {
                name: prop.name.clone(),
                params: prop.params.clone(),
                value: item.trim().to_owned(),
            };
            parse_ics_datetime(&synthetic).map(|dt| dt.wall)
        })
        .collect()
}

/// 解析单个 VEVENT 块为 VEvent。缺 DTSTART 无法成事件，返回 None。
fn parse_vevent_block(block: &[String]) -> Option<VEvent> {
    let mut uid = None;
    let mut summary = None;
    let mut location = None;
    let mut description = None;
    let mut dtstart = None;
    let mut dtend = None;
    let mut rrule = None;
    let mut rdate = Vec::new();
    let mut exdate = Vec::new();
    let mut recurrence_id = None;
    let mut cancelled = false;
    for line in block {
        let Some(prop) = parse_property(line) else {
            continue;
        };
        match prop.name.as_str() {
            "UID" => uid = Some(prop.value.clone()),
            "SUMMARY" => summary = Some(unescape_text(&prop.value)),
            "LOCATION" => location = Some(unescape_text(&prop.value)),
            "DESCRIPTION" => description = Some(unescape_text(&prop.value)),
            "DTSTART" => dtstart = parse_ics_datetime(&prop),
            "DTEND" => dtend = parse_ics_datetime(&prop),
            "RRULE" => rrule = Some(prop.value.clone()),
            "RDATE" => rdate.extend(parse_datetime_list(&prop)),
            "EXDATE" => exdate.extend(parse_datetime_list(&prop)),
            "RECURRENCE-ID" => recurrence_id = parse_ics_datetime(&prop).map(|dt| dt.wall),
            "STATUS" => cancelled = prop.value.trim().eq_ignore_ascii_case("CANCELLED"),
            _ => {}
        }
    }
    let dtstart = dtstart?;
    Some(VEvent {
        uid,
        summary: summary.unwrap_or_else(|| "(无标题)".to_owned()),
        location,
        description,
        dtstart,
        dtend,
        rrule,
        rdate,
        exdate,
        recurrence_id,
        cancelled,
    })
}

/// 解析失败的分类，用于区分“合法空日历”与“非法/不兼容内容”。
#[derive(Debug)]
pub struct ParseError {
    pub message: String,
}

/// 解析整个 .ics 文本。验证它确实是一份 VCALENDAR，并区分：
/// - 合法但空的日历（零个 VEVENT）→ Ok(空 Vec)，可安全替换旧数据。
/// - 有 VEVENT 但全部解析失败（如全部缺 DTSTART）→ Err，保留旧数据。
/// - 根本不是 VCALENDAR（如登录页 HTML）→ Err，保留旧数据。
pub fn parse_calendar(text: &str) -> Result<Vec<VEvent>, ParseError> {
    let lines = unfold_lines(text);
    // 必须看起来像一份 iCalendar：服务器返回的 HTML 错误页/登录页
    // 不得被当成“空日历”删掉旧事件。
    let has_calendar = lines
        .iter()
        .any(|l| l.trim().eq_ignore_ascii_case("BEGIN:VCALENDAR"));
    if !has_calendar {
        return Err(ParseError {
            message: "返回内容不是有效的 iCalendar 日历。".to_owned(),
        });
    }
    let blocks = vevent_blocks(&lines);
    let block_count = blocks.len();
    let mut out = Vec::new();
    for block in blocks.iter().take(MAX_SOURCE_VEVENTS) {
        if let Some(event) = parse_vevent_block(block) {
            out.push(event);
        }
    }
    // 有 VEVENT 块但一个都没解析出来：数据损坏，不能用空结果覆盖旧数据。
    if block_count > 0 && out.is_empty() {
        return Err(ParseError {
            message: "日历事件均无法解析。".to_owned(),
        });
    }
    Ok(out)
}

/// 解析整个 .ics 文本为 VEvent 列表（宽松版）。不要求 VCALENDAR 包裹，逐块解析、
/// 失败块跳过。保留给测试与内部复用；生产同步路径用 `parse_calendar`（会区分
/// 非法内容与空日历，避免用空结果误删旧数据）。
#[cfg(test)]
pub fn parse_vevents(text: &str) -> Vec<VEvent> {
    let lines = unfold_lines(text);
    vevent_blocks(&lines)
        .iter()
        .filter_map(|block| parse_vevent_block(block))
        .collect()
}

/// VEvent 在窗口内展开出的一个只读实例。字段对齐 external_events 表列。
#[derive(Debug, Clone)]
pub struct ExternalInstance {
    pub uid: Option<String>,
    pub title: String,
    pub location: Option<String>,
    pub description: Option<String>,
    /// 系列时区（或浮动）下的钟面起点，"%Y-%m-%dT%H:%M"。
    pub start_wall: String,
    pub end_wall: String,
    /// 具名时区（UTC/IANA）；浮动/全天为 None。
    pub start_tz: Option<String>,
    pub end_tz: Option<String>,
    /// 带时区实例的 UTC 缓存，"%Y-%m-%dT%H:%MZ"；浮动/全天为 None。
    pub start_utc: Option<String>,
    pub end_utc: Option<String>,
    pub all_day: bool,
}

/// VEvent 的实例时长。缺 DTEND 时：全天记 1 天，定时记 0。
fn event_duration(event: &VEvent) -> Duration {
    match &event.dtend {
        Some(end) => end.wall - event.dtstart.wall,
        None => {
            if event.dtstart.all_day {
                Duration::days(1)
            } else {
                Duration::zero()
            }
        }
    }
}

/// 用 `event` 的时区与时长，按 `start_wall` 起点造一个只读实例。
fn make_instance(event: &VEvent, start_wall: NaiveDateTime) -> ExternalInstance {
    let tz = event
        .dtstart
        .tz
        .as_deref()
        .and_then(|name| timezone::parse_tz(name).ok());
    let duration = event_duration(event);
    let end_wall = start_wall + duration;
    let (start_tz, end_tz, start_utc, end_utc) = if let Some(zone) = tz {
        let start_utc = timezone::format_utc(timezone::wall_to_utc(start_wall, zone));
        let end_utc = timezone::format_utc(timezone::wall_to_utc(end_wall, zone));
        (
            event.dtstart.tz.clone(),
            event.dtstart.tz.clone(),
            Some(start_utc),
            Some(end_utc),
        )
    } else {
        (None, None, None, None)
    };
    ExternalInstance {
        uid: event.uid.clone(),
        title: event.summary.clone(),
        location: event.location.clone(),
        description: event.description.clone(),
        start_wall: timezone::format_wall(start_wall),
        end_wall: timezone::format_wall(end_wall),
        start_tz,
        end_tz,
        start_utc,
        end_utc,
        all_day: event.dtstart.all_day,
    }
}

/// 把一批 VEvent 在 `[window_start, window_end)`（钟面半开窗口）内展开成只读实例。
///
/// 处理 iCalendar 的重复例外：同一 UID 下带 RECURRENCE-ID 的 VEVENT 是对主系列某次
/// occurrence 的覆盖或取消。展开时先按 UID 归组，主系列逐 occurrence 检查是否被覆盖：
/// - 被 CANCELLED 覆盖 → 跳过该次；
/// - 被非取消覆盖 → 用覆盖 VEVENT 的时间/内容替换该次；
/// - 无覆盖 → 正常输出。
/// 未匹配到主系列的孤儿覆盖（非取消）按独立单次事件输出。整源实例数受 `MAX_SOURCE_INSTANCES` 限制。
pub fn expand_vevents(
    events: &[VEvent],
    window_start: NaiveDateTime,
    window_end: NaiveDateTime,
) -> Vec<ExternalInstance> {
    use std::collections::HashMap;

    // 按 UID 收集覆盖（带 RECURRENCE-ID 的 VEVENT），键为被覆盖 occurrence 的原始钟面。
    let mut overrides: HashMap<String, HashMap<NaiveDateTime, &VEvent>> = HashMap::new();
    for event in events {
        if let (Some(uid), Some(rid)) = (event.uid.as_ref(), event.recurrence_id) {
            overrides.entry(uid.clone()).or_default().insert(rid, event);
        }
    }

    let mut out = Vec::new();
    let mut used: HashMap<(String, NaiveDateTime), ()> = HashMap::new();
    for event in events {
        // 覆盖 VEVENT 在下面随主系列处理；此处只展开主系列（无 RECURRENCE-ID）。
        if event.recurrence_id.is_some() {
            continue;
        }
        // 整个系列被取消：不产生任何实例。
        if event.cancelled {
            continue;
        }
        let tz = event
            .dtstart
            .tz
            .as_deref()
            .and_then(|name| timezone::parse_tz(name).ok());
        let spec = SeriesSpec {
            dtstart_wall: event.dtstart.wall,
            tz,
            rrule: event.rrule.clone(),
            rdate: event.rdate.clone(),
            exdate: event.exdate.clone(),
        };
        let Ok(occurrences) = rrule_engine::expand(
            &spec,
            window_start,
            window_end,
            rrule_engine::MAX_WINDOW_OCCURRENCES,
        ) else {
            continue;
        };
        let event_overrides = event.uid.as_ref().and_then(|uid| overrides.get(uid));
        for occ in occurrences {
            if out.len() >= MAX_SOURCE_INSTANCES {
                return out;
            }
            // 该次 occurrence 是否被覆盖？键用系列时区下的原始钟面（= occ.wall）。
            if let Some(over) = event_overrides.and_then(|map| map.get(&occ.wall)) {
                if let Some(uid) = event.uid.as_ref() {
                    used.insert((uid.clone(), occ.wall), ());
                }
                if over.cancelled {
                    continue; // 该次被取消。
                }
                out.push(make_instance(over, over.dtstart.wall));
            } else {
                out.push(make_instance(event, occ.wall));
            }
        }
    }

    // 孤儿覆盖：有 RECURRENCE-ID 但没匹配到主系列的任何 occurrence，且非取消。
    // 落在窗口内则作为独立单次事件输出，避免用户丢失被移动到窗口内的那一次。
    for event in events {
        let (Some(uid), Some(rid)) = (event.uid.as_ref(), event.recurrence_id) else {
            continue;
        };
        if event.cancelled || used.contains_key(&(uid.clone(), rid)) {
            continue;
        }
        if event.dtstart.wall >= window_start && event.dtstart.wall < window_end {
            if out.len() >= MAX_SOURCE_INSTANCES {
                break;
            }
            out.push(make_instance(event, event.dtstart.wall));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ndt(value: &str) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(value, "%Y-%m-%dT%H:%M").unwrap()
    }

    #[test]
    fn unfolds_continuation_lines() {
        let text = "SUMMARY:Hello\r\n World\r\nUID:1";
        let lines = unfold_lines(text);
        assert_eq!(lines, vec!["SUMMARY:HelloWorld".to_string(), "UID:1".to_string()]);
    }

    #[test]
    fn extracts_vevent_blocks_only() {
        let text = "BEGIN:VCALENDAR\nPRODID:x\nBEGIN:VEVENT\nUID:1\nSUMMARY:A\nEND:VEVENT\n\
                    BEGIN:VEVENT\nUID:2\nEND:VEVENT\nEND:VCALENDAR";
        let blocks = vevent_blocks(&unfold_lines(text));
        assert_eq!(blocks.len(), 2);
        assert_eq!(blocks[0], vec!["UID:1".to_string(), "SUMMARY:A".to_string()]);
        assert_eq!(blocks[1], vec!["UID:2".to_string()]);
    }

    #[test]
    fn parses_property_name_params_and_value() {
        let prop = parse_property("DTSTART;TZID=America/New_York;VALUE=DATE-TIME:20260810T100000").unwrap();
        assert_eq!(prop.name, "DTSTART");
        assert_eq!(prop.param("TZID"), Some("America/New_York"));
        assert_eq!(prop.param("VALUE"), Some("DATE-TIME"));
        assert_eq!(prop.value, "20260810T100000");
    }

    #[test]
    fn parses_property_without_params() {
        let prop = parse_property("UID:abc@example.com").unwrap();
        assert_eq!(prop.name, "UID");
        assert_eq!(prop.param("TZID"), None);
        assert_eq!(prop.value, "abc@example.com");
    }

    #[test]
    fn property_name_is_upcased_params_case_insensitive() {
        let prop = parse_property("dtstart;tzid=Asia/Shanghai:20260810T100000").unwrap();
        assert_eq!(prop.name, "DTSTART");
        assert_eq!(prop.param("TZID"), Some("Asia/Shanghai"));
    }

    #[test]
    fn line_without_colon_is_none() {
        assert!(parse_property("GARBAGE").is_none());
    }

    #[test]
    fn parses_utc_datetime_as_utc_zone() {
        let prop = parse_property("DTSTART:20260810T100000Z").unwrap();
        let dt = parse_ics_datetime(&prop).unwrap();
        assert_eq!(dt.wall, ndt("2026-08-10T10:00"));
        assert_eq!(dt.tz.as_deref(), Some("UTC"));
        assert!(!dt.all_day);
    }

    #[test]
    fn parses_tzid_datetime() {
        let prop = parse_property("DTSTART;TZID=America/New_York:20260810T100000").unwrap();
        let dt = parse_ics_datetime(&prop).unwrap();
        assert_eq!(dt.wall, ndt("2026-08-10T10:00"));
        assert_eq!(dt.tz.as_deref(), Some("America/New_York"));
        assert!(!dt.all_day);
    }

    #[test]
    fn parses_all_day_date() {
        let prop = parse_property("DTSTART;VALUE=DATE:20260810").unwrap();
        let dt = parse_ics_datetime(&prop).unwrap();
        assert_eq!(dt.wall, ndt("2026-08-10T00:00"));
        assert_eq!(dt.tz, None);
        assert!(dt.all_day);
    }

    #[test]
    fn parses_floating_datetime() {
        let prop = parse_property("DTSTART:20260810T100000").unwrap();
        let dt = parse_ics_datetime(&prop).unwrap();
        assert_eq!(dt.wall, ndt("2026-08-10T10:00"));
        assert_eq!(dt.tz, None);
        assert!(!dt.all_day);
    }

    #[test]
    fn windows_tzid_maps_to_iana() {
        // Outlook 常用 Windows 时区名；映射到 IANA 后保留为带时区事件。
        let prop = parse_property("DTSTART;TZID=China Standard Time:20260810T100000").unwrap();
        let dt = parse_ics_datetime(&prop).unwrap();
        assert_eq!(dt.wall, ndt("2026-08-10T10:00"));
        assert_eq!(dt.tz.as_deref(), Some("Asia/Shanghai"));
    }

    #[test]
    fn truly_unknown_tzid_falls_back_to_floating() {
        // 既非 IANA 也不在 Windows 映射表里的名字，退化为浮动。
        let prop = parse_property("DTSTART;TZID=Nonexistent Zone:20260810T100000").unwrap();
        let dt = parse_ics_datetime(&prop).unwrap();
        assert_eq!(dt.wall, ndt("2026-08-10T10:00"));
        assert_eq!(dt.tz, None);
    }

    #[test]
    fn invalid_datetime_value_is_none() {
        let prop = parse_property("DTSTART:not-a-date").unwrap();
        assert!(parse_ics_datetime(&prop).is_none());
    }

    #[test]
    fn unescapes_text_values() {
        assert_eq!(unescape_text(r"Line1\nLine2"), "Line1\nLine2");
        assert_eq!(unescape_text(r"a\, b\; c"), "a, b; c");
        assert_eq!(unescape_text(r"path\\to"), r"path\to");
        assert_eq!(unescape_text(r"caps\N"), "caps\n");
        assert_eq!(unescape_text("plain"), "plain");
    }

    fn sample_ics() -> &'static str {
        "BEGIN:VCALENDAR\r\nPRODID:-//Test//EN\r\nBEGIN:VEVENT\r\n\
         UID:evt-1@example.com\r\nSUMMARY:团队周会\r\n\
         LOCATION:会议室 A\r\nDESCRIPTION:议程\\n1. 复盘\r\n\
         DTSTART;TZID=Asia/Shanghai:20260810T100000\r\n\
         DTEND;TZID=Asia/Shanghai:20260810T110000\r\n\
         RRULE:FREQ=WEEKLY;BYDAY=MO\r\n\
         EXDATE;TZID=Asia/Shanghai:20260817T100000\r\nEND:VEVENT\r\nEND:VCALENDAR"
    }

    #[test]
    fn parses_vevent_fields() {
        let events = parse_vevents(sample_ics());
        assert_eq!(events.len(), 1);
        let e = &events[0];
        assert_eq!(e.uid.as_deref(), Some("evt-1@example.com"));
        assert_eq!(e.summary, "团队周会");
        assert_eq!(e.location.as_deref(), Some("会议室 A"));
        assert_eq!(e.description.as_deref(), Some("议程\n1. 复盘"));
        assert_eq!(e.dtstart.wall, ndt("2026-08-10T10:00"));
        assert_eq!(e.dtstart.tz.as_deref(), Some("Asia/Shanghai"));
        assert_eq!(e.dtend.as_ref().unwrap().wall, ndt("2026-08-10T11:00"));
        assert_eq!(e.rrule.as_deref(), Some("FREQ=WEEKLY;BYDAY=MO"));
        assert_eq!(e.exdate, vec![ndt("2026-08-17T10:00")]);
    }

    #[test]
    fn skips_vevent_without_dtstart() {
        let text = "BEGIN:VEVENT\r\nUID:no-start\r\nSUMMARY:x\r\nEND:VEVENT";
        assert!(parse_vevents(text).is_empty());
    }

    #[test]
    fn summary_defaults_when_missing() {
        let text = "BEGIN:VEVENT\r\nUID:1\r\nDTSTART:20260810T100000Z\r\nEND:VEVENT";
        let events = parse_vevents(text);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].summary, "(无标题)");
    }

    fn win(start: &str, end: &str) -> (NaiveDateTime, NaiveDateTime) {
        (ndt(start), ndt(end))
    }

    #[test]
    fn expands_weekly_vevent_within_window() {
        let events = parse_vevents(sample_ics());
        let (s, e) = win("2026-08-01T00:00", "2026-09-01T00:00");
        let instances = expand_vevents(&events, s, e);
        // 8/10、8/24、8/31（8/17 被 EXDATE 排除）——三个周一。
        let starts: Vec<_> = instances.iter().map(|i| i.start_wall.clone()).collect();
        assert_eq!(
            starts,
            vec![
                "2026-08-10T10:00".to_string(),
                "2026-08-24T10:00".to_string(),
                "2026-08-31T10:00".to_string()
            ]
        );
        // 每个实例继承 1 小时时长与来源时区。
        assert_eq!(instances[0].end_wall, "2026-08-10T11:00");
        assert_eq!(instances[0].start_tz.as_deref(), Some("Asia/Shanghai"));
        // 带时区实例有 UTC 缓存（Asia/Shanghai 10:00 = 02:00Z）。
        assert_eq!(instances[0].start_utc.as_deref(), Some("2026-08-10T02:00Z"));
        assert_eq!(instances[0].title, "团队周会");
    }

    #[test]
    fn expands_single_all_day_event() {
        let text = "BEGIN:VEVENT\r\nUID:h\r\nSUMMARY:假期\r\n\
                    DTSTART;VALUE=DATE:20260810\r\nDTEND;VALUE=DATE:20260811\r\nEND:VEVENT";
        let events = parse_vevents(text);
        let (s, e) = win("2026-08-01T00:00", "2026-09-01T00:00");
        let instances = expand_vevents(&events, s, e);
        assert_eq!(instances.len(), 1);
        assert!(instances[0].all_day);
        assert_eq!(instances[0].start_tz, None);
        assert_eq!(instances[0].start_utc, None);
        assert_eq!(instances[0].start_wall, "2026-08-10T00:00");
    }

    #[test]
    fn single_timed_event_without_dtend_has_zero_duration() {
        let text = "BEGIN:VEVENT\r\nUID:p\r\nSUMMARY:点\r\nDTSTART:20260810T100000Z\r\nEND:VEVENT";
        let events = parse_vevents(text);
        let (s, e) = win("2026-08-01T00:00", "2026-09-01T00:00");
        let instances = expand_vevents(&events, s, e);
        assert_eq!(instances.len(), 1);
        assert_eq!(instances[0].start_wall, "2026-08-10T10:00");
        assert_eq!(instances[0].end_wall, "2026-08-10T10:00");
    }

    #[test]
    fn parse_calendar_rejects_non_calendar_content() {
        // 服务器返回 HTML 登录页，不能被当成“空日历”。
        let html = "<!DOCTYPE html><html><body>Sign in</body></html>";
        assert!(parse_calendar(html).is_err());
    }

    #[test]
    fn parse_calendar_allows_a_legitimately_empty_calendar() {
        let text = "BEGIN:VCALENDAR\r\nPRODID:-//Test//EN\r\nEND:VCALENDAR";
        let events = parse_calendar(text).unwrap();
        assert!(events.is_empty());
    }

    #[test]
    fn parse_calendar_errors_when_all_events_fail_to_parse() {
        // 有 VEVENT 块但均缺 DTSTART：视为损坏，不能用空结果覆盖旧数据。
        let text = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:1\r\nEND:VEVENT\r\nEND:VCALENDAR";
        assert!(parse_calendar(text).is_err());
    }

    #[test]
    fn cancelled_master_series_produces_no_instances() {
        let text = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:c1\r\nSUMMARY:已取消\r\n\
                    DTSTART:20260810T100000Z\r\nSTATUS:CANCELLED\r\nEND:VEVENT\r\nEND:VCALENDAR";
        let events = parse_calendar(text).unwrap();
        let (s, e) = win("2026-08-01T00:00", "2026-09-01T00:00");
        assert!(expand_vevents(&events, s, e).is_empty());
    }

    #[test]
    fn recurrence_id_override_replaces_that_occurrence() {
        // 周会每周一 10:00；8/17 那次被改到 14:00。
        let text = "BEGIN:VCALENDAR\r\n\
            BEGIN:VEVENT\r\nUID:s1\r\nSUMMARY:周会\r\n\
            DTSTART:20260810T100000Z\r\nRRULE:FREQ=WEEKLY;BYDAY=MO\r\nEND:VEVENT\r\n\
            BEGIN:VEVENT\r\nUID:s1\r\nSUMMARY:周会（改期）\r\n\
            RECURRENCE-ID:20260817T100000Z\r\nDTSTART:20260817T140000Z\r\n\
            DTEND:20260817T150000Z\r\nEND:VEVENT\r\nEND:VCALENDAR";
        let events = parse_calendar(text).unwrap();
        let (s, e) = win("2026-08-01T00:00", "2026-09-01T00:00");
        let instances = expand_vevents(&events, s, e);
        // 8/17 不再是 10:00，而是被覆盖为 14:00；不得重复。
        let at_0817: Vec<_> = instances
            .iter()
            .filter(|i| i.start_wall.starts_with("2026-08-17"))
            .collect();
        assert_eq!(at_0817.len(), 1);
        assert_eq!(at_0817[0].start_wall, "2026-08-17T14:00");
        assert_eq!(at_0817[0].title, "周会（改期）");
    }

    #[test]
    fn recurrence_id_cancellation_drops_that_occurrence() {
        // 8/17 那次被取消：不出现，其余周一保留。
        let text = "BEGIN:VCALENDAR\r\n\
            BEGIN:VEVENT\r\nUID:s2\r\nSUMMARY:周会\r\n\
            DTSTART:20260810T100000Z\r\nRRULE:FREQ=WEEKLY;BYDAY=MO\r\nEND:VEVENT\r\n\
            BEGIN:VEVENT\r\nUID:s2\r\nRECURRENCE-ID:20260817T100000Z\r\n\
            DTSTART:20260817T100000Z\r\nSTATUS:CANCELLED\r\nEND:VEVENT\r\nEND:VCALENDAR";
        let events = parse_calendar(text).unwrap();
        let (s, e) = win("2026-08-01T00:00", "2026-09-01T00:00");
        let instances = expand_vevents(&events, s, e);
        assert!(!instances.iter().any(|i| i.start_wall.starts_with("2026-08-17")));
        assert!(instances.iter().any(|i| i.start_wall == "2026-08-10T10:00"));
        assert!(instances.iter().any(|i| i.start_wall == "2026-08-24T10:00"));
    }
}
