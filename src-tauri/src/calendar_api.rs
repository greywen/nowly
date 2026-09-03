//! OAuth 日历 API 拉取与归一化。
//!
//! 把 Google Calendar API / Microsoft Graph 的事件拉下来，服务端已展开重复事件，
//! 逐个归一化成 `ics_parser::ExternalInstance`，复用与 ICS 订阅完全相同的落库与
//! 显示管线（`subscription_sync::replace_external_events` + `to_display_wall`）。
//!
//! 时间一律归一到 UTC 存储：带时刻事件 `start_tz="UTC"`、`start_wall` 为 UTC 钟面、
//! `start_utc` 为 UTC 缓存；显示时 `to_display_wall` 再换算成设备时区。全天事件
//! 走浮动钟面（`start_tz=None`），与 ICS 全天一致。

use crate::error::CommandError;
use crate::ics_parser::ExternalInstance;
use crate::models::RemoteCalendar;
use chrono::{DateTime, Duration, NaiveDate, NaiveDateTime, Utc};
use serde::Deserialize;

/// 拉取窗口：当前时刻前后各约 190 天，覆盖前端 ±6 个月的展开窗口。
fn fetch_window() -> (DateTime<Utc>, DateTime<Utc>) {
    let now = Utc::now();
    (now - Duration::days(190), now + Duration::days(190))
}

fn rfc3339(instant: DateTime<Utc>) -> String {
    instant.to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

/// application/x-www-form-urlencoded 编码单个 path/query 组件。
pub(crate) fn url_encode(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for &b in input.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}

// ---- 列出远端日历 ---------------------------------------------------------

/// 列出该账户下可订阅的远端日历，供用户勾选。
pub fn list_calendars(
    provider: &str,
    access_token: &str,
) -> Result<Vec<RemoteCalendar>, CommandError> {
    match provider {
        "google" => list_google_calendars(access_token),
        "microsoft" => list_microsoft_calendars(access_token),
        _ => Err(CommandError::validation("provider", "不支持的日历来源。")),
    }
}

#[derive(Debug, Deserialize)]
struct GoogleCalendarList {
    items: Option<Vec<GoogleCalendarEntry>>,
}

#[derive(Debug, Deserialize)]
struct GoogleCalendarEntry {
    id: String,
    summary: Option<String>,
    #[serde(rename = "backgroundColor")]
    background_color: Option<String>,
    /// Calendar-level defaults live on CalendarListEntry, not events.list.
    #[serde(rename = "defaultReminders")]
    default_reminders: Option<Vec<GoogleReminderOverride>>,
}

fn list_google_calendars(access_token: &str) -> Result<Vec<RemoteCalendar>, CommandError> {
    let url = "https://www.googleapis.com/calendar/v3/users/me/calendarList";
    let (status, body) = crate::net::get_with_bearer(url, access_token)?;
    if !(200..300).contains(&status) {
        return Err(api_error(status));
    }
    let parsed: GoogleCalendarList = serde_json::from_str(&body)
        .map_err(|_| CommandError::validation("url", "无法解析日历列表。"))?;
    Ok(parsed
        .items
        .unwrap_or_default()
        .into_iter()
        .map(|c| RemoteCalendar {
            name: c.summary.unwrap_or_else(|| c.id.clone()),
            id: c.id,
            color: c.background_color,
        })
        .collect())
}

#[derive(Debug, Deserialize)]
struct GraphCalendarList {
    value: Option<Vec<GraphCalendarEntry>>,
}

#[derive(Debug, Deserialize)]
struct GraphCalendarEntry {
    id: String,
    name: Option<String>,
    #[serde(rename = "hexColor")]
    hex_color: Option<String>,
}

fn list_microsoft_calendars(access_token: &str) -> Result<Vec<RemoteCalendar>, CommandError> {
    let url = "https://graph.microsoft.com/v1.0/me/calendars";
    let (status, body) = crate::net::get_with_bearer(url, access_token)?;
    if !(200..300).contains(&status) {
        return Err(api_error(status));
    }
    let parsed: GraphCalendarList = serde_json::from_str(&body)
        .map_err(|_| CommandError::validation("url", "无法解析日历列表。"))?;
    Ok(parsed
        .value
        .unwrap_or_default()
        .into_iter()
        .map(|c| RemoteCalendar {
            name: c.name.unwrap_or_else(|| c.id.clone()),
            id: c.id,
            // Graph 的 hexColor 可能是 "auto" 或空，非法值交给前端/调用方兜底。
            color: c.hex_color.filter(|c| c.starts_with('#')),
        })
        .collect())
}

// ---- 拉取事件 -------------------------------------------------------------

/// 拉取某个远端日历在展开窗口内的事件实例（服务端已展开重复）。
pub fn fetch_events(
    provider: &str,
    access_token: &str,
    remote_calendar_id: &str,
) -> Result<Vec<ExternalInstance>, CommandError> {
    let (min, max) = fetch_window();
    match provider {
        "google" => fetch_google_events(access_token, remote_calendar_id, min, max),
        "microsoft" => fetch_microsoft_events(access_token, remote_calendar_id, min, max),
        _ => Err(CommandError::validation("provider", "不支持的日历来源。")),
    }
}

fn api_error(status: u16) -> CommandError {
    if status == 401 || status == 403 {
        CommandError::validation("oauth", "登录已过期或权限不足，请重新连接账户。")
    } else {
        CommandError::validation("url", format!("日历服务返回错误（{status}）。"))
    }
}

// ---- Google 事件 ----------------------------------------------------------

#[derive(Debug, Deserialize)]
struct GoogleEvents {
    items: Option<Vec<GoogleEvent>>,
}

#[derive(Debug, Deserialize)]
struct GoogleEvent {
    id: Option<String>,
    status: Option<String>,
    summary: Option<String>,
    location: Option<String>,
    description: Option<String>,
    start: Option<GoogleDate>,
    end: Option<GoogleDate>,
    reminders: Option<GoogleReminders>,
}

/// Google 事件的提醒块。`use_default=true` 表示沿用 CalendarListEntry 的默认提醒；
/// `overrides` 是显式设置的每条提醒。
#[derive(Debug, Deserialize)]
struct GoogleReminders {
    #[serde(rename = "useDefault")]
    use_default: Option<bool>,
    overrides: Option<Vec<GoogleReminderOverride>>,
}

#[derive(Debug, Deserialize)]
struct GoogleReminderOverride {
    /// 提前的分钟数（Google 只支持 popup/email，两者都取分钟）。
    minutes: Option<i64>,
}

/// 把一组 override（含默认提醒项）里的分钟数收集出来。
fn override_minutes(overrides: &[GoogleReminderOverride]) -> Vec<i64> {
    overrides.iter().filter_map(|o| o.minutes).collect()
}

/// 从 Google 事件的 reminders 块抽出「提前 N 分钟」列表。有显式 overrides 优先取之；
/// 否则在 useDefault=true 时套用该日历的默认提醒 `defaults`。
fn google_reminder_minutes(reminders: &Option<GoogleReminders>, defaults: &[i64]) -> Vec<i64> {
    let Some(reminders) = reminders else {
        return Vec::new();
    };
    let explicit: Vec<i64> = reminders
        .overrides
        .as_ref()
        .map(|list| override_minutes(list))
        .unwrap_or_default();
    if !explicit.is_empty() {
        return crate::ics_parser::sanitize_reminders(&explicit);
    }
    if reminders.use_default == Some(true) {
        return crate::ics_parser::sanitize_reminders(defaults);
    }
    Vec::new()
}

#[derive(Debug, Deserialize)]
struct GoogleDate {
    /// 带时刻事件：RFC3339，如 "2026-08-10T10:00:00+08:00"。
    #[serde(rename = "dateTime")]
    date_time: Option<String>,
    /// 全天事件：仅日期，如 "2026-08-10"（end.date 为排他日）。
    date: Option<String>,
}

fn fetch_google_events(
    access_token: &str,
    calendar_id: &str,
    min: DateTime<Utc>,
    max: DateTime<Utc>,
) -> Result<Vec<ExternalInstance>, CommandError> {
    // events.list 不包含日历级 defaultReminders；它位于 CalendarListEntry。
    // 先读取对应条目，供 useDefault=true 的事件补齐实际提醒偏移量。
    let defaults_url = format!(
        "https://www.googleapis.com/calendar/v3/users/me/calendarList/{}",
        url_encode(calendar_id),
    );
    let (defaults_status, defaults_body) =
        crate::net::get_with_bearer(&defaults_url, access_token)?;
    if !(200..300).contains(&defaults_status) {
        return Err(api_error(defaults_status));
    }
    let calendar_entry: GoogleCalendarEntry = serde_json::from_str(&defaults_body)
        .map_err(|_| CommandError::validation("url", "无法解析日历默认提醒。"))?;
    let defaults = crate::ics_parser::sanitize_reminders(
        &calendar_entry
            .default_reminders
            .as_ref()
            .map(|list| override_minutes(list))
            .unwrap_or_default(),
    );

    let url = format!(
        "https://www.googleapis.com/calendar/v3/calendars/{}/events\
         ?singleEvents=true&maxResults=2500&timeMin={}&timeMax={}",
        url_encode(calendar_id),
        url_encode(&rfc3339(min)),
        url_encode(&rfc3339(max)),
    );
    let (status, body) = crate::net::get_with_bearer(&url, access_token)?;
    if !(200..300).contains(&status) {
        return Err(api_error(status));
    }
    let parsed: GoogleEvents = serde_json::from_str(&body)
        .map_err(|_| CommandError::validation("url", "无法解析日历事件。"))?;
    let mut out = Vec::new();
    for event in parsed.items.unwrap_or_default() {
        if event.status.as_deref() == Some("cancelled") {
            continue;
        }
        if let Some(instance) = google_event_to_instance(event, &defaults) {
            out.push(instance);
        }
    }
    Ok(out)
}

fn google_event_to_instance(event: GoogleEvent, defaults: &[i64]) -> Option<ExternalInstance> {
    let start = event.start?;
    let end = event.end?;
    let title = event.summary.unwrap_or_else(|| "(无标题)".to_owned());
    let reminders = google_reminder_minutes(&event.reminders, defaults);

    // 全天：start.date / end.date（排他）。
    if let (Some(start_date), Some(end_date)) = (&start.date, &end.date) {
        return Some(all_day_instance(
            event.id,
            title,
            event.location,
            event.description,
            reminders,
            start_date,
            end_date,
        ));
    }
    // 带时刻：RFC3339 → UTC。
    let start_instant = parse_rfc3339(start.date_time.as_deref()?)?;
    let end_instant = end
        .date_time
        .as_deref()
        .and_then(parse_rfc3339)
        .unwrap_or(start_instant);
    Some(timed_instance(
        event.id,
        title,
        event.location,
        event.description,
        reminders,
        start_instant,
        end_instant,
    ))
}

fn parse_rfc3339(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|dt| dt.with_timezone(&Utc))
}

// ---- Microsoft 事件 -------------------------------------------------------

#[derive(Debug, Deserialize)]
struct GraphEvents {
    value: Option<Vec<GraphEvent>>,
}

#[derive(Debug, Deserialize)]
struct GraphEvent {
    id: Option<String>,
    subject: Option<String>,
    #[serde(rename = "isAllDay")]
    is_all_day: Option<bool>,
    #[serde(rename = "isCancelled")]
    is_cancelled: Option<bool>,
    #[serde(rename = "bodyPreview")]
    body_preview: Option<String>,
    #[serde(rename = "isReminderOn")]
    is_reminder_on: Option<bool>,
    #[serde(rename = "reminderMinutesBeforeStart")]
    reminder_minutes_before_start: Option<i64>,
    location: Option<GraphLocation>,
    start: Option<GraphDate>,
    end: Option<GraphDate>,
}

/// 从 Graph 事件抽出「提前 N 分钟」列表。Graph 每事件只有单一提醒，
/// 且仅当 isReminderOn 为 true 时生效。
fn graph_reminder_minutes(event: &GraphEvent) -> Vec<i64> {
    if event.is_reminder_on != Some(true) {
        return Vec::new();
    }
    match event.reminder_minutes_before_start {
        Some(minutes) => crate::ics_parser::sanitize_reminders(&[minutes]),
        None => Vec::new(),
    }
}

#[derive(Debug, Deserialize)]
struct GraphLocation {
    #[serde(rename = "displayName")]
    display_name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GraphDate {
    /// 无偏移钟面，如 "2026-08-10T02:00:00.0000000"。
    #[serde(rename = "dateTime")]
    date_time: Option<String>,
    /// 该钟面所属时区名，默认 "UTC"。
    #[serde(rename = "timeZone")]
    time_zone: Option<String>,
}

fn fetch_microsoft_events(
    access_token: &str,
    calendar_id: &str,
    min: DateTime<Utc>,
    max: DateTime<Utc>,
) -> Result<Vec<ExternalInstance>, CommandError> {
    // calendarView 会服务端展开重复事件。默认返回 UTC 时区的时刻。
    let url = format!(
        "https://graph.microsoft.com/v1.0/me/calendars/{}/calendarView\
         ?startDateTime={}&endDateTime={}&$top=1000\
         &$select=id,subject,isAllDay,isCancelled,bodyPreview,isReminderOn,\
         reminderMinutesBeforeStart,location,start,end",
        url_encode(calendar_id),
        url_encode(&rfc3339(min)),
        url_encode(&rfc3339(max)),
    );
    let (status, body) = crate::net::get_with_bearer(&url, access_token)?;
    if !(200..300).contains(&status) {
        return Err(api_error(status));
    }
    let parsed: GraphEvents = serde_json::from_str(&body)
        .map_err(|_| CommandError::validation("url", "无法解析日历事件。"))?;
    let mut out = Vec::new();
    for event in parsed.value.unwrap_or_default() {
        if event.is_cancelled == Some(true) {
            continue;
        }
        if let Some(instance) = graph_event_to_instance(event) {
            out.push(instance);
        }
    }
    Ok(out)
}

fn graph_event_to_instance(event: GraphEvent) -> Option<ExternalInstance> {
    let reminders = graph_reminder_minutes(&event);
    let start = event.start?;
    let end = event.end?;
    let title = event.subject.unwrap_or_else(|| "(无标题)".to_owned());
    let location = event.location.and_then(|l| l.display_name);
    let all_day = event.is_all_day == Some(true);

    if all_day {
        // Graph 全天 start/end 的 dateTime 形如 "2026-08-10T00:00:00.0000000"，end 排他。
        let start_date = graph_date_only(start.date_time.as_deref()?)?;
        let end_date = end
            .date_time
            .as_deref()
            .and_then(graph_date_only)
            .unwrap_or_else(|| start_date.clone());
        return Some(all_day_instance(
            event.id,
            title,
            location,
            event.body_preview,
            reminders,
            &start_date,
            &end_date,
        ));
    }

    let start_instant = graph_instant(&start)?;
    let end_instant = graph_instant(&end).unwrap_or(start_instant);
    Some(timed_instance(
        event.id,
        title,
        location,
        event.body_preview,
        reminders,
        start_instant,
        end_instant,
    ))
}

/// 把 Graph 的 (dateTime, timeZone) 解析成 UTC 瞬时点。
/// timeZone 为 UTC 或缺省时按 UTC；为可识别的 IANA 名时按该时区换算。
fn graph_instant(date: &GraphDate) -> Option<DateTime<Utc>> {
    let raw = date.date_time.as_deref()?;
    let naive = parse_graph_naive(raw)?;
    let zone = date.time_zone.as_deref().unwrap_or("UTC");
    if zone.eq_ignore_ascii_case("UTC") {
        return Some(DateTime::<Utc>::from_naive_utc_and_offset(naive, Utc));
    }
    match crate::timezone::parse_tz(zone) {
        Ok(tz) => Some(crate::timezone::wall_to_utc(naive, tz)),
        // 无法识别的 Windows 时区名（如 "China Standard Time"）兜底按 UTC。
        Err(_) => Some(DateTime::<Utc>::from_naive_utc_and_offset(naive, Utc)),
    }
}

/// 解析 Graph 的钟面串，容忍带小数秒："2026-08-10T02:00:00.0000000"。
fn parse_graph_naive(raw: &str) -> Option<NaiveDateTime> {
    let trimmed = raw.split('.').next().unwrap_or(raw);
    NaiveDateTime::parse_from_str(trimmed, "%Y-%m-%dT%H:%M:%S").ok()
}

/// 取 Graph 全天事件的日期部分（丢掉时刻）。
fn graph_date_only(raw: &str) -> Option<String> {
    let date_part = raw.split('T').next()?;
    // 校验是合法日期。
    NaiveDate::parse_from_str(date_part, "%Y-%m-%d").ok()?;
    Some(date_part.to_owned())
}

// ---- 归一化到 ExternalInstance -------------------------------------------

fn timed_instance(
    uid: Option<String>,
    title: String,
    location: Option<String>,
    description: Option<String>,
    reminders: Vec<i64>,
    start: DateTime<Utc>,
    end: DateTime<Utc>,
) -> ExternalInstance {
    ExternalInstance {
        uid,
        title,
        location: non_empty(location),
        description: non_empty(description),
        reminders,
        start_wall: crate::timezone::format_wall(start.naive_utc()),
        end_wall: crate::timezone::format_wall(end.naive_utc()),
        start_tz: Some("UTC".to_owned()),
        end_tz: Some("UTC".to_owned()),
        start_utc: Some(crate::timezone::format_utc(start)),
        end_utc: Some(crate::timezone::format_utc(end)),
        all_day: false,
    }
}

fn all_day_instance(
    uid: Option<String>,
    title: String,
    location: Option<String>,
    description: Option<String>,
    reminders: Vec<i64>,
    start_date: &str,
    end_date: &str,
) -> ExternalInstance {
    ExternalInstance {
        uid,
        title,
        location: non_empty(location),
        description: non_empty(description),
        reminders,
        start_wall: format!("{start_date}T00:00"),
        end_wall: format!("{end_date}T00:00"),
        start_tz: None,
        end_tz: None,
        start_utc: None,
        end_utc: None,
        all_day: true,
    }
}

fn non_empty(value: Option<String>) -> Option<String> {
    value.filter(|s| !s.trim().is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn google_timed_event_normalizes_to_utc_wall() {
        let event: GoogleEvent = serde_json::from_str(
            r#"{"id":"g1","summary":"评审","status":"confirmed",
                "start":{"dateTime":"2026-08-10T10:00:00+08:00"},
                "end":{"dateTime":"2026-08-10T11:00:00+08:00"}}"#,
        )
        .unwrap();
        let inst = google_event_to_instance(event, &[]).unwrap();
        assert!(!inst.all_day);
        // +08:00 10:00 → 02:00 UTC。
        assert_eq!(inst.start_wall, "2026-08-10T02:00");
        assert_eq!(inst.end_wall, "2026-08-10T03:00");
        assert_eq!(inst.start_tz.as_deref(), Some("UTC"));
        assert_eq!(inst.start_utc.as_deref(), Some("2026-08-10T02:00Z"));
    }

    #[test]
    fn google_all_day_event_uses_floating_wall() {
        let event: GoogleEvent = serde_json::from_str(
            r#"{"id":"g2","summary":"假期",
                "start":{"date":"2026-08-10"},"end":{"date":"2026-08-11"}}"#,
        )
        .unwrap();
        let inst = google_event_to_instance(event, &[]).unwrap();
        assert!(inst.all_day);
        assert_eq!(inst.start_wall, "2026-08-10T00:00");
        assert_eq!(inst.end_wall, "2026-08-11T00:00");
        assert_eq!(inst.start_tz, None);
        assert_eq!(inst.start_utc, None);
    }

    #[test]
    fn google_reminder_overrides_become_offsets() {
        let event: GoogleEvent = serde_json::from_str(
            r#"{"id":"g3","summary":"评审",
                "start":{"dateTime":"2026-08-10T10:00:00Z"},
                "end":{"dateTime":"2026-08-10T11:00:00Z"},
                "reminders":{"useDefault":false,
                    "overrides":[{"method":"popup","minutes":15},
                                 {"method":"email","minutes":60}]}}"#,
        )
        .unwrap();
        let inst = google_event_to_instance(event, &[]).unwrap();
        assert_eq!(inst.reminders, vec![15, 60]);
    }

    #[test]
    fn google_use_default_reminders_apply_calendar_defaults() {
        // useDefault=true 且无 overrides：套用传入的日历级默认提醒（如提前 40 分钟）。
        let event: GoogleEvent = serde_json::from_str(
            r#"{"id":"g4","summary":"评审",
                "start":{"dateTime":"2026-08-10T10:00:00Z"},
                "end":{"dateTime":"2026-08-10T11:00:00Z"},
                "reminders":{"useDefault":true}}"#,
        )
        .unwrap();
        let inst = google_event_to_instance(event, &[40]).unwrap();
        assert_eq!(inst.reminders, vec![40]);
    }

    #[test]
    fn google_use_default_without_calendar_defaults_is_none() {
        // useDefault=true 但日历无默认提醒：无提醒。
        let event: GoogleEvent = serde_json::from_str(
            r#"{"id":"g5","summary":"评审",
                "start":{"dateTime":"2026-08-10T10:00:00Z"},
                "end":{"dateTime":"2026-08-10T11:00:00Z"},
                "reminders":{"useDefault":true}}"#,
        )
        .unwrap();
        let inst = google_event_to_instance(event, &[]).unwrap();
        assert!(inst.reminders.is_empty());
    }

    #[test]
    fn google_explicit_overrides_win_over_calendar_defaults() {
        // 有显式 overrides 时忽略日历默认值。
        let event: GoogleEvent = serde_json::from_str(
            r#"{"id":"g6","summary":"评审",
                "start":{"dateTime":"2026-08-10T10:00:00Z"},
                "end":{"dateTime":"2026-08-10T11:00:00Z"},
                "reminders":{"useDefault":false,"overrides":[{"minutes":5}]}}"#,
        )
        .unwrap();
        let inst = google_event_to_instance(event, &[40]).unwrap();
        assert_eq!(inst.reminders, vec![5]);
    }

    #[test]
    fn google_calendar_list_defaults_apply_to_use_default_events() {
        // defaultReminders 来自 CalendarListEntry；events.list 本身不返回该字段。
        let calendar: GoogleCalendarEntry = serde_json::from_str(
            r#"{"id":"primary","summary":"工作",
                "defaultReminders":[{"method":"popup","minutes":40}]}"#,
        )
        .unwrap();
        let defaults = crate::ics_parser::sanitize_reminders(
            &calendar
                .default_reminders
                .as_ref()
                .map(|list| override_minutes(list))
                .unwrap_or_default(),
        );
        let event: GoogleEvent = serde_json::from_str(
            r#"{"id":"g7","summary":"评审",
                "start":{"dateTime":"2026-08-10T10:00:00Z"},
                "end":{"dateTime":"2026-08-10T11:00:00Z"},
                "reminders":{"useDefault":true}}"#,
        )
        .unwrap();
        let inst = google_event_to_instance(event, &defaults).unwrap();
        assert_eq!(inst.reminders, vec![40]);
    }

    #[test]
    fn graph_reminder_becomes_single_offset_when_on() {
        let event: GraphEvent = serde_json::from_str(
            r#"{"id":"m3","subject":"周会","isAllDay":false,"isCancelled":false,
                "isReminderOn":true,"reminderMinutesBeforeStart":30,
                "start":{"dateTime":"2026-08-10T02:00:00.0000000","timeZone":"UTC"},
                "end":{"dateTime":"2026-08-10T03:00:00.0000000","timeZone":"UTC"}}"#,
        )
        .unwrap();
        let inst = graph_event_to_instance(event).unwrap();
        assert_eq!(inst.reminders, vec![30]);
    }

    #[test]
    fn graph_reminder_off_yields_no_offset() {
        let event: GraphEvent = serde_json::from_str(
            r#"{"id":"m4","subject":"周会","isAllDay":false,"isCancelled":false,
                "isReminderOn":false,"reminderMinutesBeforeStart":30,
                "start":{"dateTime":"2026-08-10T02:00:00.0000000","timeZone":"UTC"},
                "end":{"dateTime":"2026-08-10T03:00:00.0000000","timeZone":"UTC"}}"#,
        )
        .unwrap();
        let inst = graph_event_to_instance(event).unwrap();
        assert!(inst.reminders.is_empty());
    }

    #[test]
    fn google_cancelled_event_is_skipped() {
        let events: GoogleEvents = serde_json::from_str(
            r#"{"items":[
                {"id":"g1","status":"cancelled",
                 "start":{"dateTime":"2026-08-10T10:00:00Z"},
                 "end":{"dateTime":"2026-08-10T11:00:00Z"}}
            ]}"#,
        )
        .unwrap();
        let kept: Vec<_> = events
            .items
            .unwrap_or_default()
            .into_iter()
            .filter(|e| e.status.as_deref() != Some("cancelled"))
            .collect();
        assert!(kept.is_empty());
    }

    #[test]
    fn graph_utc_event_normalizes() {
        let event: GraphEvent = serde_json::from_str(
            r#"{"id":"m1","subject":"周会","isAllDay":false,"isCancelled":false,
                "location":{"displayName":"会议室"},
                "start":{"dateTime":"2026-08-10T02:00:00.0000000","timeZone":"UTC"},
                "end":{"dateTime":"2026-08-10T03:00:00.0000000","timeZone":"UTC"}}"#,
        )
        .unwrap();
        let inst = graph_event_to_instance(event).unwrap();
        assert!(!inst.all_day);
        assert_eq!(inst.start_wall, "2026-08-10T02:00");
        assert_eq!(inst.end_wall, "2026-08-10T03:00");
        assert_eq!(inst.location.as_deref(), Some("会议室"));
        assert_eq!(inst.start_utc.as_deref(), Some("2026-08-10T02:00Z"));
    }

    #[test]
    fn graph_named_zone_converts_to_utc() {
        let date = GraphDate {
            date_time: Some("2026-08-10T10:00:00.0000000".to_owned()),
            time_zone: Some("Asia/Shanghai".to_owned()),
        };
        // 上海 10:00 → 02:00 UTC。
        let instant = graph_instant(&date).unwrap();
        assert_eq!(crate::timezone::format_utc(instant), "2026-08-10T02:00Z");
    }

    #[test]
    fn graph_all_day_event_uses_floating_wall() {
        let event: GraphEvent = serde_json::from_str(
            r#"{"id":"m2","subject":"年假","isAllDay":true,"isCancelled":false,
                "start":{"dateTime":"2026-08-10T00:00:00.0000000","timeZone":"UTC"},
                "end":{"dateTime":"2026-08-12T00:00:00.0000000","timeZone":"UTC"}}"#,
        )
        .unwrap();
        let inst = graph_event_to_instance(event).unwrap();
        assert!(inst.all_day);
        assert_eq!(inst.start_wall, "2026-08-10T00:00");
        assert_eq!(inst.end_wall, "2026-08-12T00:00");
        assert_eq!(inst.start_tz, None);
    }

    #[test]
    fn parse_graph_naive_tolerates_fractional_seconds() {
        let naive = parse_graph_naive("2026-08-10T02:00:00.0000000").unwrap();
        assert_eq!(crate::timezone::format_wall(naive), "2026-08-10T02:00");
    }
}
