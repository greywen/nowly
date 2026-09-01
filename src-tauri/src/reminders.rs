use crate::error::CommandError;
use crate::events::list_in_range;
use crate::events::MAX_REMINDER_MINUTES;
use crate::models::{Event, EventRange};
use crate::timezone;
use chrono::{Duration, NaiveDateTime};
use chrono_tz::Tz;
use rusqlite::{params, Connection};

const LOCAL_MINUTE_FORMAT: &str = "%Y-%m-%dT%H:%M";

/// 提醒触发后仍允许补发的宽限窗口（分钟）。
///
/// App 常驻时，提醒在 `fire_time` 到点即触发；App 曾关闭再打开时，只要日程尚未
/// 开始（或刚开始不超过该宽限），错过的提醒仍会补发一次。日程已开始超过该宽限即视为
/// 过期，不再打扰。去重表保证同一提醒至多触发一次。
pub const GRACE_MINUTES: i64 = 5;

/// 一次到期的提醒，展开自某个具体日程实例。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DueReminder {
    /// 去重键的第一段：单次日程为行 id，重复实例为其系列 id（同一行 id）。
    pub event_id: String,
    /// 去重键的第二段：该实例原本应发生的时刻。单次日程即其 `start_at`。
    pub occurrence_start_at: String,
    /// 提前提醒的分钟数偏移量。
    pub offset_minutes: i64,
    pub title: String,
    pub start_at: String,
    pub all_day: bool,
}

/// 要发送给系统的一条通知。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReminderNotification {
    pub event_id: String,
    pub occurrence_start_at: String,
    pub offset_minutes: i64,
    pub title: String,
    pub body: String,
}

/// A notification is reserved in `poll_due` before the OS call so concurrent
/// polls cannot duplicate it. If submitting the toast fails, remove that
/// reservation so the next poll can retry while the reminder is still valid.
pub fn release_dispatch(
    connection: &Connection,
    notification: &ReminderNotification,
) -> Result<(), CommandError> {
    connection
        .execute(
            "DELETE FROM reminder_dispatches
             WHERE event_id=?1 AND occurrence_start_at=?2 AND offset_minutes=?3",
            params![
                notification.event_id,
                notification.occurrence_start_at,
                notification.offset_minutes
            ],
        )
        .map_err(CommandError::database)?;
    Ok(())
}

/// 该实例在去重表里的身份键：`event_id` 与 `occurrence_start_at`。
fn dispatch_identity(event: &Event) -> (String, String) {
    (
        event.series_id.clone().unwrap_or_else(|| event.id.clone()),
        event
            .occurrence_start_at
            .clone()
            .unwrap_or_else(|| event.start_at.clone()),
    )
}

/// 把一条事件实例的显示钟面（`start_at`，已是设备时区钟面）在设备时区下换算成 UTC 瞬时点。
/// 事件自身是否带时区不影响这里——`start_at` 已由读取路径统一成设备钟面。
fn instant_of(start_at: &str, device: Tz) -> Option<chrono::DateTime<chrono::Utc>> {
    let wall = NaiveDateTime::parse_from_str(start_at, LOCAL_MINUTE_FORMAT).ok()?;
    Some(timezone::wall_to_utc(wall, device))
}

/// 在指定设备时区下挑出此刻应触发的提醒。触发判定在 UTC 瞬时点上进行，
/// 使「提前 N 分钟」在 DST 边界两侧精确（跨断层的裸钟面相减会偏移一小时）。
///
/// 对每条提醒偏移量 `offset`，触发时刻 `fire_time = start - offset`。到期条件：
/// `fire_time <= now` 且 `now < 关联窗口上界`。一条提醒从触发时刻起、到事件结束为止都可弹框，
/// 错过准点也能在此期间补弹一次；上界按事件时长自然区分：
/// - 定时事件是一个时间点，上界取 `start + grace`（开始过宽限即视为过期）；
/// - 全天事件铺满一整天，上界取「当天午夜结束」= `start + 1 天`。全天事件锚定 00:00，
///   若上界也取 `start + grace`（≈ 00:05），弹框窗口只有午夜前后十几分钟，App 没恰好在那一刻
///   常驻就永远漏弹；放宽到当天结束，使白天打开 App 仍能补弹当天该提醒一次。
///
/// 两者同遵「触发时刻起、到事件结束止可弹框」这一条原则，只是时长不同导致窗口长短不同。
pub fn due_reminders_utc(
    events: &[Event],
    now_wall: NaiveDateTime,
    grace: Duration,
    device: Tz,
) -> Vec<DueReminder> {
    let now = timezone::wall_to_utc(now_wall, device);
    let mut due = Vec::new();
    for event in events {
        if event.reminders.is_empty() {
            continue;
        }
        let Some(start) = instant_of(&event.start_at, device) else {
            continue;
        };
        // 全天事件弹框窗口放宽到当天结束；定时事件维持紧凑宽限。
        let relevance_end = if event.all_day {
            start + Duration::days(1)
        } else {
            start + grace
        };
        for &offset in &event.reminders {
            if offset < 0 {
                continue;
            }
            let fire_time = start - Duration::minutes(offset);
            if fire_time <= now && now < relevance_end {
                let (event_id, occurrence_start_at) = dispatch_identity(event);
                due.push(DueReminder {
                    event_id,
                    occurrence_start_at,
                    offset_minutes: offset,
                    title: event.title.clone(),
                    start_at: event.start_at.clone(),
                    all_day: event.all_day,
                });
            }
        }
    }
    due
}

/// 取真实设备时区的到期判定入口，供 `poll_due` 使用。
pub fn due_reminders(
    events: &[Event],
    now_wall: NaiveDateTime,
    grace: Duration,
) -> Vec<DueReminder> {
    due_reminders_utc(events, now_wall, grace, timezone::device_tz())
}

/// 组装一条提醒通知的正文，用中文描述日程何时开始。
fn notification_body(now: NaiveDateTime, reminder: &DueReminder) -> String {
    let Ok(start) = NaiveDateTime::parse_from_str(&reminder.start_at, LOCAL_MINUTE_FORMAT) else {
        return "日程即将开始。".to_owned();
    };
    let day = day_phrase(now.date(), start.date());
    if reminder.all_day {
        return format!("{day}（全天）");
    }
    let time = start.format("%H:%M");
    let minutes_until = (start - now).num_minutes();
    if minutes_until <= 0 {
        format!("{day} {time} 现在开始")
    } else if minutes_until < 60 {
        format!("{day} {time} 开始，还有 {minutes_until} 分钟")
    } else {
        format!("{day} {time} 开始")
    }
}

/// 用「今天 / 明天 / M月D日」描述目标日期相对当前日期的位置。
fn day_phrase(today: chrono::NaiveDate, target: chrono::NaiveDate) -> String {
    let delta = (target - today).num_days();
    match delta {
        0 => "今天".to_owned(),
        1 => "明天".to_owned(),
        2 => "后天".to_owned(),
        _ => format!("{}月{}日", target.format("%-m"), target.format("%-d")),
    }
}

/// 把带提醒的订阅事件读成 `Event` 形态，复用本地提醒的到期判定与去重。
/// - `start_at` 取设备显示钟面，供触发时刻按设备时区换算；
/// - `occurrence_start_at` 取来源钟面（跨同步、跨换时区都稳定），作为去重键第二段；
/// - `id` 取 `ext:{订阅}:{uid}`，配合来源钟面构成跨同步稳定的去重身份，
///   使订阅每次整源替换后不会把同一提醒重复弹出。
fn external_reminder_events(connection: &Connection) -> Result<Vec<Event>, CommandError> {
    let sql = "SELECT subscription_id, uid, title, start_at, start_tz, all_day, reminders
               FROM external_events";
    let mut statement = connection.prepare(sql).map_err(CommandError::database)?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, i64>(5)? == 1,
                row.get::<_, String>(6)?,
            ))
        })
        .map_err(CommandError::database)?;
    let mut out = Vec::new();
    for row in rows {
        let (subscription_id, uid, title, source_wall, start_tz, all_day, reminders_raw) =
            row.map_err(CommandError::database)?;
        let reminders: Vec<i64> = serde_json::from_str(&reminders_raw).unwrap_or_default();
        if reminders.is_empty() {
            continue;
        }
        let display_wall = crate::events::to_display_wall(&source_wall, &start_tz);
        let uid_key = uid.unwrap_or_else(|| source_wall.clone());
        out.push(Event {
            id: format!("ext:{subscription_id}:{uid_key}"),
            title,
            start_at: display_wall.clone(),
            end_at: display_wall,
            start_tz: None,
            end_tz: None,
            all_day,
            category: "personal".to_owned(),
            color: String::new(),
            linked_task_id: None,
            note: String::new(),
            reminders,
            created_at: String::new(),
            updated_at: String::new(),
            recurrence: None,
            rrule: None,
            series_id: None,
            // 去重键第二段用来源钟面：跨同步、跨换设备时区都稳定，
            // 而 start_at（设备显示钟面）会随时区变化。
            series_start_at: None,
            occurrence_start_at: Some(source_wall),
            is_overridden: false,
            subscription_id: Some(subscription_id),
        });
    }
    Ok(out)
}

/// 轮询到期提醒：展开当前时间窗口内的日程实例，挑出到期项，写入去重表，
/// 只为首次派发的提醒返回通知。已派发过的提醒不会再次返回。
/// 本地日程与订阅事件（含 VALARM / Google / Microsoft 提醒）一并参与。
pub fn poll_due(
    connection: &Connection,
    now: NaiveDateTime,
) -> Result<Vec<ReminderNotification>, CommandError> {
    let grace = Duration::minutes(GRACE_MINUTES);
    // 到期提醒要求 now - grace < start <= now + 最大提前量，取略宽的窗口以覆盖多日日程。
    let window_start = (now - grace - Duration::days(1))
        .format(LOCAL_MINUTE_FORMAT)
        .to_string();
    let window_end = (now + Duration::minutes(MAX_REMINDER_MINUTES) + Duration::days(1))
        .format(LOCAL_MINUTE_FORMAT)
        .to_string();
    let mut events = list_in_range(
        connection,
        &EventRange {
            start_at: window_start,
            end_at_exclusive: window_end,
        },
    )?;
    // 订阅事件已被同步限制在前后各 6 个月窗口内；到期判定 (due_reminders)
    // 会按 fire_time 过滤，窗口外的自然落选，无需再套时间过滤。
    events.extend(external_reminder_events(connection)?);

    let now_text = now.format("%Y-%m-%dT%H:%M:%S").to_string();
    let mut notifications = Vec::new();
    for reminder in due_reminders(&events, now, grace) {
        let inserted = connection
            .execute(
                "INSERT OR IGNORE INTO reminder_dispatches
                    (event_id, occurrence_start_at, offset_minutes, dispatched_at)
                 VALUES (?1, ?2, ?3, ?4)",
                params![
                    reminder.event_id,
                    reminder.occurrence_start_at,
                    reminder.offset_minutes,
                    now_text
                ],
            )
            .map_err(CommandError::database)?;
        if inserted == 0 {
            // 该提醒此前已派发，跳过，避免重复打扰。
            continue;
        }
        notifications.push(ReminderNotification {
            event_id: reminder.event_id.clone(),
            occurrence_start_at: reminder.occurrence_start_at.clone(),
            offset_minutes: reminder.offset_minutes,
            title: reminder.title.clone(),
            body: notification_body(now, &reminder),
        });
    }
    Ok(notifications)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrate;
    use rusqlite::Connection;

    fn dt(value: &str) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(value, "%Y-%m-%dT%H:%M").unwrap()
    }

    fn event(start_at: &str, reminders: Vec<i64>) -> Event {
        Event {
            id: "e1".into(),
            title: "评审".into(),
            start_at: start_at.into(),
            end_at: start_at.into(),
            start_tz: None,
            end_tz: None,
            all_day: false,
            category: "work".into(),
            color: "#4FC9DA".into(),
            linked_task_id: None,
            note: String::new(),
            reminders,
            created_at: "t".into(),
            updated_at: "t".into(),
            recurrence: None,
            rrule: None,
            series_id: None,
            series_start_at: None,
            occurrence_start_at: None,
            is_overridden: false,
            subscription_id: None,
        }
    }

    #[test]
    fn fires_exactly_when_the_offset_is_reached() {
        let events = vec![event("2026-08-10T10:00", vec![10])];
        let grace = Duration::minutes(GRACE_MINUTES);
        // 提前 11 分钟：还没到点。
        assert!(due_reminders(&events, dt("2026-08-10T09:49"), grace).is_empty());
        // 提前 10 分钟：到点。
        let due = due_reminders(&events, dt("2026-08-10T09:50"), grace);
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].offset_minutes, 10);
        assert_eq!(due[0].occurrence_start_at, "2026-08-10T10:00");
    }

    #[test]
    fn catches_up_a_missed_reminder_while_the_event_is_still_upcoming() {
        let events = vec![event("2026-08-10T10:00", vec![60])];
        // fire_time 是 09:00，此刻 09:30 早已过点，但日程还没开始：仍应补发。
        let due = due_reminders(
            &events,
            dt("2026-08-10T09:30"),
            Duration::minutes(GRACE_MINUTES),
        );
        assert_eq!(due.len(), 1);
    }

    #[test]
    fn skips_a_reminder_once_the_event_has_started_past_the_grace() {
        let events = vec![event("2026-08-10T10:00", vec![10])];
        // 已开始 6 分钟，超过 5 分钟宽限：过期不再打扰。
        assert!(due_reminders(
            &events,
            dt("2026-08-10T10:06"),
            Duration::minutes(GRACE_MINUTES)
        )
        .is_empty());
    }

    #[test]
    fn all_day_reminder_can_fire_through_the_whole_event_day() {
        // 全天事件锚定 00:00，提前 8 分钟 → 触发时刻是前一晚 23:52。
        // App 没在那一刻常驻，当天白天打开仍应补弹（若上界取 00:05 就永远漏弹）。
        let ev = Event {
            all_day: true,
            ..event("2026-08-10T00:00", vec![8])
        };
        let grace = Duration::minutes(GRACE_MINUTES);
        // 前一晚 23:52 准点：到点弹框。
        assert_eq!(
            due_reminders(&[ev.clone()], dt("2026-08-09T23:52"), grace).len(),
            1
        );
        // 当天下午才打开 App：仍在当天，补弹。
        assert_eq!(
            due_reminders(&[ev.clone()], dt("2026-08-10T14:00"), grace).len(),
            1
        );
        // 当天快结束：仍在弹框窗口内。
        assert_eq!(
            due_reminders(&[ev.clone()], dt("2026-08-10T23:59"), grace).len(),
            1
        );
        // 次日：当天已过，不再打扰。
        assert!(due_reminders(&[ev], dt("2026-08-11T00:01"), grace).is_empty());
    }

    #[test]
    fn an_at_start_reminder_fires_within_the_grace() {
        let events = vec![event("2026-08-10T10:00", vec![0])];
        assert_eq!(
            due_reminders(
                &events,
                dt("2026-08-10T10:00"),
                Duration::minutes(GRACE_MINUTES)
            )
            .len(),
            1
        );
        assert_eq!(
            due_reminders(
                &events,
                dt("2026-08-10T10:04"),
                Duration::minutes(GRACE_MINUTES)
            )
            .len(),
            1
        );
    }

    #[test]
    fn timed_reminder_offset_is_exact_across_a_dst_gap() {
        // 设备时区取纽约，2026-03-08 是春跳日（02:00→03:00，02:xx 不存在）。
        // 事件显示钟面 03:15（设备纽约钟面，03:15 EDT = 07:15Z），提前 30 分钟。
        // 触发瞬时点 = 06:45Z；该瞬时点对应纽约钟面 01:45（仍在 EST，UTC-5）。
        // 裸钟面相减会得到落在断层里的 02:45（不存在），从而漏判；按 UTC 瞬时点比较则精确。
        let ev = Event {
            start_at: "2026-03-08T03:15".into(),
            end_at: "2026-03-08T04:15".into(),
            start_tz: Some("America/New_York".into()),
            end_tz: Some("America/New_York".into()),
            reminders: vec![30],
            ..event("2026-03-08T03:15", vec![30])
        };
        let due = due_reminders_utc(
            &[ev],
            dt("2026-03-08T01:45"),
            Duration::minutes(GRACE_MINUTES),
            chrono_tz::Tz::America__New_York,
        );
        assert_eq!(
            due.len(),
            1,
            "触发瞬时点必须按设备时区精确换算，跨 DST 断层不漂移"
        );
    }

    fn database() -> Connection {
        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch("PRAGMA foreign_keys = ON;")
            .unwrap();
        migrate(&mut connection).unwrap();
        connection
    }

    #[test]
    fn poll_dispatches_each_reminder_only_once() {
        let connection = database();
        connection
            .execute(
                "INSERT INTO events(id,title,start_at,end_at,all_day,category,color,note,created_at,updated_at,reminders)
                 VALUES ('e1','评审','2026-08-10T10:00','2026-08-10T11:00',0,'work','#4FC9DA','','t','t','[10]')",
                [],
            )
            .unwrap();

        let first = poll_due(&connection, dt("2026-08-10T09:50")).unwrap();
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].title, "评审");
        // 再次轮询同一时刻：已派发，不再返回。
        let second = poll_due(&connection, dt("2026-08-10T09:51")).unwrap();
        assert!(second.is_empty());
    }

    #[test]
    fn failed_os_submission_can_release_and_retry_a_dispatch() {
        let connection = database();
        connection
            .execute(
                "INSERT INTO events(id,title,start_at,end_at,all_day,category,color,note,created_at,updated_at,reminders)
                 VALUES ('e1','评审','2026-08-10T10:00','2026-08-10T11:00',0,'work','#4FC9DA','','t','t','[10]')",
                [],
            )
            .unwrap();

        let first = poll_due(&connection, dt("2026-08-10T09:50")).unwrap();
        assert_eq!(first.len(), 1);
        release_dispatch(&connection, &first[0]).unwrap();

        let retry = poll_due(&connection, dt("2026-08-10T09:51")).unwrap();
        assert_eq!(retry.len(), 1);
        assert_eq!(retry[0].event_id, "e1");
    }

    #[test]
    fn poll_expands_a_recurring_series_and_fires_per_occurrence() {
        let connection = database();
        // 2026-08-03 是周一，每周一 10:00，提前 10 分钟提醒。
        connection
            .execute(
                "INSERT INTO events(id,title,start_at,end_at,all_day,category,color,note,created_at,updated_at,
                                    rrule,reminders)
                 VALUES ('s1','周会','2026-08-03T10:00','2026-08-03T11:00',0,'work','#4FC9DA','','t','t',
                         'FREQ=WEEKLY;BYDAY=MO','[10]')",
                [],
            )
            .unwrap();

        // 第一周的实例到点。
        let week1 = poll_due(&connection, dt("2026-08-03T09:50")).unwrap();
        assert_eq!(week1.len(), 1);
        // 同一实例不重复。
        assert!(poll_due(&connection, dt("2026-08-03T09:51"))
            .unwrap()
            .is_empty());
        // 下一周的实例是独立的一次派发。
        let week2 = poll_due(&connection, dt("2026-08-10T09:50")).unwrap();
        assert_eq!(week2.len(), 1);
    }

    #[test]
    fn poll_fires_subscription_reminders_once_using_source_wall_dedup() {
        let connection = database();
        connection
            .execute(
                "INSERT INTO calendar_subscriptions
                    (id,name,url,color,refresh_interval_minutes,created_at,updated_at)
                 VALUES ('sub1','工作','https://e.com/a.ics','#4FC9DA',15,'t','t')",
                [],
            )
            .unwrap();
        // UTC 事件：来源钟面 02:00Z，提前 15 分钟。to_display_wall 会换算成设备钟面，
        // due 判定按设备时区精确对齐到同一 UTC 瞬时点。
        connection
            .execute(
                "INSERT INTO external_events
                    (id,subscription_id,uid,start_at,end_at,start_tz,end_tz,
                     start_utc,end_utc,all_day,title,reminders,last_synced_at)
                 VALUES ('row1','sub1','evt-1','2026-08-10T02:00','2026-08-10T03:00',
                         'UTC','UTC','2026-08-10T02:00Z','2026-08-10T03:00Z',0,'评审','[15]','t')",
                [],
            )
            .unwrap();

        // 设备钟面下 start 的提前 15 分钟到点：用 UTC 瞬时点判定，取设备时区。
        let start_wall =
            crate::events::to_display_wall("2026-08-10T02:00", &Some("UTC".to_owned()));
        let start = NaiveDateTime::parse_from_str(&start_wall, LOCAL_MINUTE_FORMAT).unwrap();
        let fire = start - Duration::minutes(15);
        let first = poll_due(&connection, fire).unwrap();
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].title, "评审");
        // 同一时刻再轮询：已派发，不重复。
        assert!(poll_due(&connection, fire).unwrap().is_empty());

        // 模拟整源替换：行 id 变了，但 uid 与来源钟面不变——去重身份稳定，不重复弹。
        connection
            .execute("DELETE FROM external_events WHERE id='row1'", [])
            .unwrap();
        connection
            .execute(
                "INSERT INTO external_events
                    (id,subscription_id,uid,start_at,end_at,start_tz,end_tz,
                     start_utc,end_utc,all_day,title,reminders,last_synced_at)
                 VALUES ('row2','sub1','evt-1','2026-08-10T02:00','2026-08-10T03:00',
                         'UTC','UTC','2026-08-10T02:00Z','2026-08-10T03:00Z',0,'评审','[15]','t')",
                [],
            )
            .unwrap();
        assert!(poll_due(&connection, fire).unwrap().is_empty());
    }

    #[test]
    fn poll_ignores_subscription_events_without_reminders() {
        let connection = database();
        connection
            .execute(
                "INSERT INTO calendar_subscriptions
                    (id,name,url,color,refresh_interval_minutes,created_at,updated_at)
                 VALUES ('sub1','工作','https://e.com/a.ics','#4FC9DA',15,'t','t')",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO external_events
                    (id,subscription_id,uid,start_at,end_at,start_tz,end_tz,
                     start_utc,end_utc,all_day,title,reminders,last_synced_at)
                 VALUES ('row1','sub1','evt-1','2026-08-10T02:00','2026-08-10T03:00',
                         'UTC','UTC','2026-08-10T02:00Z','2026-08-10T03:00Z',0,'评审','[]','t')",
                [],
            )
            .unwrap();
        let start_wall =
            crate::events::to_display_wall("2026-08-10T02:00", &Some("UTC".to_owned()));
        let start = NaiveDateTime::parse_from_str(&start_wall, LOCAL_MINUTE_FORMAT).unwrap();
        assert!(poll_due(&connection, start).unwrap().is_empty());
    }

    #[test]
    fn all_day_reminder_reads_as_all_day_in_the_body() {
        let reminder = DueReminder {
            event_id: "e1".into(),
            occurrence_start_at: "2026-08-10T00:00".into(),
            offset_minutes: 0,
            title: "生日".into(),
            start_at: "2026-08-10T00:00".into(),
            all_day: true,
        };
        assert_eq!(
            notification_body(dt("2026-08-10T00:00"), &reminder),
            "今天（全天）"
        );
    }

    #[test]
    fn timed_body_describes_the_relative_day_and_countdown() {
        let reminder = DueReminder {
            event_id: "e1".into(),
            occurrence_start_at: "2026-08-11T14:00".into(),
            offset_minutes: 30,
            title: "评审".into(),
            start_at: "2026-08-11T14:00".into(),
            all_day: false,
        };
        // now 在前一天：目标是「明天」。
        assert_eq!(
            notification_body(dt("2026-08-10T20:00"), &reminder),
            "明天 14:00 开始"
        );
        // now 同一天且不足一小时：显示倒计时。
        assert_eq!(
            notification_body(dt("2026-08-11T13:30"), &reminder),
            "今天 14:00 开始，还有 30 分钟"
        );
    }
}
