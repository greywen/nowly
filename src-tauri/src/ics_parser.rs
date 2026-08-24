//! 最小 iCalendar（RFC 5545）解析器：把 .ics 文本解析为 VEvent，并用 Spec A 的
//! rrule_engine 在窗口内展开成只读外部实例。只覆盖 Apple/Google/Outlook/Teams
//! 导出订阅里实际出现的属性；时区/DST/RRULE 一律委托 timezone + rrule_engine。
//! 纯函数、无网络、无数据库。

use crate::rrule_engine::{self, SeriesSpec};
use crate::timezone;
use chrono::{Duration, NaiveDate, NaiveDateTime};

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
    // 带 TZID：能解析成 IANA 时区才保留，否则退化为浮动。
    let tz = prop.param("TZID").and_then(|name| {
        timezone::parse_tz(name).ok().map(|_| name.to_owned())
    });
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

/// 解析整个 .ics 文本为 VEvent 列表。缺 DTSTART 的块跳过。
pub fn parse_vevents(text: &str) -> Vec<VEvent> {
    let lines = unfold_lines(text);
    let mut out = Vec::new();
    for block in vevent_blocks(&lines) {
        let mut uid = None;
        let mut summary = None;
        let mut location = None;
        let mut description = None;
        let mut dtstart = None;
        let mut dtend = None;
        let mut rrule = None;
        let mut rdate = Vec::new();
        let mut exdate = Vec::new();
        for line in &block {
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
                _ => {}
            }
        }
        let Some(dtstart) = dtstart else {
            continue;
        };
        out.push(VEvent {
            uid,
            summary: summary.unwrap_or_else(|| "(无标题)".to_owned()),
            location,
            description,
            dtstart,
            dtend,
            rrule,
            rdate,
            exdate,
        });
    }
    out
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

/// 把一批 VEvent 在 `[window_start, window_end)`（钟面半开窗口）内展开成只读实例。
/// 展开委托 rrule_engine；带时区实例带 UTC 缓存。解析不了 RRULE 的 VEvent 跳过。
pub fn expand_vevents(
    events: &[VEvent],
    window_start: NaiveDateTime,
    window_end: NaiveDateTime,
) -> Vec<ExternalInstance> {
    let mut out = Vec::new();
    for event in events {
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
        let duration = event_duration(event);
        for occ in occurrences {
            let end_wall = occ.wall + duration;
            let (start_tz, end_tz, start_utc, end_utc) = if let Some(zone) = tz {
                let start_utc = timezone::format_utc(occ.utc.unwrap_or_else(|| {
                    timezone::wall_to_utc(occ.wall, zone)
                }));
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
            out.push(ExternalInstance {
                uid: event.uid.clone(),
                title: event.summary.clone(),
                location: event.location.clone(),
                description: event.description.clone(),
                start_wall: timezone::format_wall(occ.wall),
                end_wall: timezone::format_wall(end_wall),
                start_tz,
                end_tz,
                start_utc,
                end_utc,
                all_day: event.dtstart.all_day,
            });
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
    fn unknown_tzid_falls_back_to_floating() {
        // 非 IANA 时区名（如 Windows 的 "China Standard Time"）无法解析，退化为浮动。
        let prop = parse_property("DTSTART;TZID=China Standard Time:20260810T100000").unwrap();
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
}
