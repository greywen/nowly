//! 日历订阅（Spec C）存储层：订阅 CRUD、草稿校验、URL 规范化。
//! 订阅表与本地 events 表隔离；本模块只管订阅记录本身，
//! 拉取/解析/展开由 Part 2/3 的 ics_parser / subscription_sync 承担。

use crate::db::AppDb;
use crate::error::CommandError;
use crate::models::{CalendarSubscription, EventRange, ExternalEvent, SubscriptionDraft};
use rusqlite::{params, Connection, Row};
use tauri::State;
use uuid::Uuid;

/// 订阅源数量上限。
pub const MAX_SUBSCRIPTIONS: i64 = 3;

/// 把订阅 URL 规范化：`webcal://` 前缀换成 `https://`，其余原样。
/// 返回规范化后的串；非 https（且非 webcal）一律拒绝。
pub fn normalize_ics_url(raw: &str) -> Result<String, CommandError> {
    let trimmed = raw.trim();
    let https = if let Some(rest) = trimmed.strip_prefix("webcal://") {
        format!("https://{rest}")
    } else {
        trimmed.to_owned()
    };
    if !https.starts_with("https://") {
        return Err(CommandError::validation(
            "url",
            "订阅地址必须是 https:// 或 webcal:// 链接。",
        ));
    }
    Ok(https)
}

/// 校验并规范化订阅草稿，返回规范化 URL。
fn validate_draft(draft: &SubscriptionDraft) -> Result<String, CommandError> {
    let name = draft.name.trim();
    if name.is_empty() {
        return Err(CommandError::validation("name", "订阅名称不能为空。"));
    }
    if name.chars().count() > 100 {
        return Err(CommandError::validation("name", "订阅名称过长。"));
    }
    if !(1..=30).contains(&draft.refresh_interval_minutes) {
        return Err(CommandError::validation(
            "refreshIntervalMinutes",
            "刷新间隔需在 1 到 30 分钟之间。",
        ));
    }
    normalize_ics_url(&draft.url)
}

const SUBSCRIPTION_COLUMNS: &str = "id,name,url,color,refresh_interval_minutes,\
    last_synced_at,last_status,last_error,created_at,updated_at,last_attempted_at";

fn read_subscription(row: &Row<'_>) -> rusqlite::Result<CalendarSubscription> {
    Ok(CalendarSubscription {
        id: row.get(0)?,
        name: row.get(1)?,
        url: row.get(2)?,
        color: row.get(3)?,
        refresh_interval_minutes: row.get(4)?,
        last_synced_at: row.get(5)?,
        last_status: row.get(6)?,
        last_error: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
        last_attempted_at: row.get(10)?,
    })
}

fn now_utc() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

/// 列出全部订阅，按创建时间升序。
pub fn list(connection: &Connection) -> Result<Vec<CalendarSubscription>, CommandError> {
    let sql = format!(
        "SELECT {SUBSCRIPTION_COLUMNS} FROM calendar_subscriptions ORDER BY created_at ASC"
    );
    let mut statement = connection.prepare(&sql).map_err(CommandError::database)?;
    let rows = statement
        .query_map([], read_subscription)
        .map_err(CommandError::database)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(CommandError::database)?);
    }
    Ok(out)
}

fn fetch_one(connection: &Connection, id: &str) -> Result<CalendarSubscription, CommandError> {
    let sql = format!("SELECT {SUBSCRIPTION_COLUMNS} FROM calendar_subscriptions WHERE id = ?1");
    connection
        .query_row(&sql, params![id], read_subscription)
        .map_err(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => CommandError::validation("id", "订阅不存在。"),
            other => CommandError::database(other),
        })
}

/// 新建订阅。超过 `MAX_SUBSCRIPTIONS` 拒绝。返回新建记录。
pub fn create(
    connection: &mut Connection,
    draft: SubscriptionDraft,
) -> Result<CalendarSubscription, CommandError> {
    let url = validate_draft(&draft)?;
    let count: i64 = connection
        .query_row("SELECT COUNT(*) FROM calendar_subscriptions", [], |row| {
            row.get(0)
        })
        .map_err(CommandError::database)?;
    if count >= MAX_SUBSCRIPTIONS {
        return Err(CommandError::validation("url", "最多只能添加 3 个订阅源。"));
    }
    let id = Uuid::new_v4().to_string();
    let now = now_utc();
    connection
        .execute(
            "INSERT INTO calendar_subscriptions
                (id,name,url,color,refresh_interval_minutes,created_at,updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?6)",
            params![
                id,
                draft.name.trim(),
                url,
                draft.color,
                draft.refresh_interval_minutes,
                now
            ],
        )
        .map_err(CommandError::database)?;
    fetch_one(connection, &id)
}

/// 编辑订阅（名称/URL/颜色/间隔）。不改动同步状态字段。
pub fn update(
    connection: &mut Connection,
    id: &str,
    draft: SubscriptionDraft,
) -> Result<CalendarSubscription, CommandError> {
    let url = validate_draft(&draft)?;
    let affected = connection
        .execute(
            "UPDATE calendar_subscriptions
                SET name=?2,url=?3,color=?4,refresh_interval_minutes=?5,updated_at=?6
             WHERE id=?1",
            params![
                id,
                draft.name.trim(),
                url,
                draft.color,
                draft.refresh_interval_minutes,
                now_utc()
            ],
        )
        .map_err(CommandError::database)?;
    if affected == 0 {
        return Err(CommandError::validation("id", "订阅不存在。"));
    }
    fetch_one(connection, id)
}

/// 删除订阅（其 external_events 经外键级联删除）。
pub fn delete(connection: &mut Connection, id: &str) -> Result<(), CommandError> {
    let affected = connection
        .execute(
            "DELETE FROM calendar_subscriptions WHERE id=?1",
            params![id],
        )
        .map_err(CommandError::database)?;
    if affected == 0 {
        return Err(CommandError::validation("id", "订阅不存在。"));
    }
    Ok(())
}

/// 读取与 `[range.start, range.end_at_exclusive)`（设备钟面）重叠的外部事件，
/// 附带来源订阅的固定色。start_at/end_at 已换算成设备显示钟面。
pub fn list_external_in_range(
    connection: &Connection,
    range: &EventRange,
) -> Result<Vec<ExternalEvent>, CommandError> {
    let sql = "SELECT e.id, e.subscription_id, e.title, e.start_at, e.end_at,
                      e.start_tz, e.end_tz, e.all_day, e.location, e.description, s.color
               FROM external_events e
               JOIN calendar_subscriptions s ON s.id = e.subscription_id";
    let mut statement = connection.prepare(sql).map_err(CommandError::database)?;
    let rows = statement
        .query_map([], |row| {
            let start_tz: Option<String> = row.get(5)?;
            let end_tz: Option<String> = row.get(6)?;
            let start_raw: String = row.get(3)?;
            let end_raw: String = row.get(4)?;
            Ok(ExternalEvent {
                id: row.get(0)?,
                subscription_id: row.get(1)?,
                title: row.get(2)?,
                start_at: crate::events::to_display_wall(&start_raw, &start_tz),
                end_at: crate::events::to_display_wall(&end_raw, &end_tz),
                start_tz,
                end_tz,
                all_day: row.get::<_, i64>(7)? == 1,
                location: row.get(8)?,
                description: row.get(9)?,
                color: row.get(10)?,
            })
        })
        .map_err(CommandError::database)?;

    let mut out = Vec::new();
    for row in rows {
        let event = row.map_err(CommandError::database)?;
        // 设备钟面下与范围重叠：event.start < range.end 且 event.end > range.start。
        // 全天/单点用 start 落在范围内近似（end==start 时用 >= start 判断）。
        let overlaps = event.start_at < range.end_at_exclusive
            && (event.end_at > range.start_at
                || event.end_at == event.start_at && event.start_at >= range.start_at);
        if overlaps {
            out.push(event);
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn list_external_events_in_range(
    db: State<'_, AppDb>,
    range: EventRange,
) -> Result<Vec<ExternalEvent>, CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    list_external_in_range(&connection, &range)
}

#[tauri::command]
pub fn list_calendar_subscriptions(
    db: State<'_, AppDb>,
) -> Result<Vec<CalendarSubscription>, CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    list(&connection)
}

#[tauri::command]
pub fn create_calendar_subscription(
    db: State<'_, AppDb>,
    draft: SubscriptionDraft,
) -> Result<CalendarSubscription, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    create(&mut connection, draft)
}

#[tauri::command]
pub fn update_calendar_subscription(
    db: State<'_, AppDb>,
    id: String,
    draft: SubscriptionDraft,
) -> Result<CalendarSubscription, CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    update(&mut connection, &id, draft)
}

#[tauri::command]
pub fn delete_calendar_subscription(db: State<'_, AppDb>, id: String) -> Result<(), CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    delete(&mut connection, &id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn draft() -> SubscriptionDraft {
        SubscriptionDraft {
            name: "家庭".into(),
            url: "https://example.com/a.ics".into(),
            color: "#4FC9DA".into(),
            refresh_interval_minutes: 15,
        }
    }

    fn memory_db() -> Connection {
        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch("PRAGMA foreign_keys = ON;")
            .unwrap();
        crate::db::migrate(&mut connection).unwrap();
        connection
    }

    #[test]
    fn webcal_is_rewritten_to_https() {
        assert_eq!(
            normalize_ics_url("webcal://example.com/a.ics").unwrap(),
            "https://example.com/a.ics"
        );
    }

    #[test]
    fn non_https_url_is_rejected() {
        let err = normalize_ics_url("http://example.com/a.ics").unwrap_err();
        assert_eq!(err.field.as_deref(), Some("url"));
    }

    #[test]
    fn draft_validation_rejects_blank_name_and_out_of_range_interval() {
        let mut d = draft();
        d.name = "  ".into();
        assert_eq!(
            validate_draft(&d).unwrap_err().field.as_deref(),
            Some("name")
        );

        let mut d = draft();
        d.refresh_interval_minutes = 0;
        assert_eq!(
            validate_draft(&d).unwrap_err().field.as_deref(),
            Some("refreshIntervalMinutes")
        );

        let mut d = draft();
        d.refresh_interval_minutes = 31;
        assert_eq!(
            validate_draft(&d).unwrap_err().field.as_deref(),
            Some("refreshIntervalMinutes")
        );
    }

    #[test]
    fn draft_validation_returns_normalized_url() {
        let mut d = draft();
        d.url = "webcal://example.com/a.ics".into();
        assert_eq!(validate_draft(&d).unwrap(), "https://example.com/a.ics");
    }

    #[test]
    fn create_list_update_delete_roundtrip() {
        let mut connection = memory_db();
        let created = create(&mut connection, draft()).unwrap();
        assert_eq!(created.name, "家庭");
        assert_eq!(created.last_status, None);

        let listed = list(&connection).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, created.id);

        let mut edit = draft();
        edit.name = "家庭日历".into();
        edit.refresh_interval_minutes = 20;
        let updated = update(&mut connection, &created.id, edit).unwrap();
        assert_eq!(updated.name, "家庭日历");
        assert_eq!(updated.refresh_interval_minutes, 20);

        delete(&mut connection, &created.id).unwrap();
        assert!(list(&connection).unwrap().is_empty());
    }

    #[test]
    fn create_enforces_three_source_cap() {
        let mut connection = memory_db();
        for i in 0..3 {
            let mut d = draft();
            d.name = format!("源{i}");
            create(&mut connection, d).unwrap();
        }
        let err = create(&mut connection, draft()).unwrap_err();
        assert_eq!(err.field.as_deref(), Some("url"));
        assert_eq!(list(&connection).unwrap().len(), 3);
    }

    #[test]
    fn create_stores_normalized_webcal_url() {
        let mut connection = memory_db();
        let mut d = draft();
        d.url = "webcal://example.com/a.ics".into();
        let created = create(&mut connection, d).unwrap();
        assert_eq!(created.url, "https://example.com/a.ics");
    }

    #[test]
    fn update_missing_subscription_errors() {
        let mut connection = memory_db();
        let err = update(&mut connection, "nope", draft()).unwrap_err();
        assert_eq!(err.field.as_deref(), Some("id"));
    }

    fn insert_external(
        connection: &Connection,
        sub: &str,
        id: &str,
        start_at: &str,
        end_at: &str,
        start_tz: Option<&str>,
    ) {
        connection
            .execute(
                "INSERT INTO external_events
                    (id,subscription_id,start_at,end_at,start_tz,end_tz,all_day,title,last_synced_at)
                 VALUES (?1,?2,?3,?4,?5,?5,0,'会议','t')",
                rusqlite::params![id, sub, start_at, end_at, start_tz],
            )
            .unwrap();
    }

    #[test]
    fn list_external_in_range_filters_and_attaches_color() {
        let mut connection = memory_db();
        let s1 = create(&mut connection, draft()).unwrap();
        insert_external(
            &connection,
            &s1.id,
            "a",
            "2026-08-10T10:00",
            "2026-08-10T11:00",
            None,
        );
        insert_external(
            &connection,
            &s1.id,
            "b",
            "2026-09-20T10:00",
            "2026-09-20T11:00",
            None,
        );

        let range = EventRange {
            start_at: "2026-08-01T00:00".into(),
            end_at_exclusive: "2026-09-01T00:00".into(),
        };
        let events = list_external_in_range(&connection, &range).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].id, "a");
        assert_eq!(events[0].color, s1.color);
        assert_eq!(events[0].subscription_id, s1.id);
    }

    #[test]
    fn list_external_in_range_converts_tz_to_device_wall() {
        let mut connection = memory_db();
        let s1 = create(&mut connection, draft()).unwrap();
        insert_external(
            &connection,
            &s1.id,
            "t",
            "2026-08-10T10:00",
            "2026-08-10T11:00",
            Some("Asia/Shanghai"),
        );
        let range = EventRange {
            start_at: "2026-08-01T00:00".into(),
            end_at_exclusive: "2026-09-01T00:00".into(),
        };
        let events = list_external_in_range(&connection, &range).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].start_tz.as_deref(), Some("Asia/Shanghai"));
    }
}
