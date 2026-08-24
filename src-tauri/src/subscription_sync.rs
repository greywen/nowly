//! 订阅同步：拉取 → 解析 → 展开 → 整源替换写库 → 记录状态。
//! 失败保留上次成功数据，只更新状态字段。窗口为当前月前后各 6 个月。

use crate::db::AppDb;
use crate::error::CommandError;
use crate::ics_parser::{self, ExternalInstance};
use crate::subscriptions::normalize_ics_url;
use chrono::{Datelike, Duration, NaiveDate, NaiveDateTime};
use rusqlite::{params, Connection};
use tauri::State;
use uuid::Uuid;

/// 以 `today` 为基准，返回展开窗口 `[start, end)` 的钟面边界：
/// 从 6 个月前的当月 1 号，到 6 个月后的次月 1 号。
fn expansion_window(today: NaiveDate) -> (NaiveDateTime, NaiveDateTime) {
    let base_year = today.year();
    let base_month0 = today.month0() as i32; // 0..=11
    let start_total = base_year * 12 + base_month0 - 6;
    let end_total = base_year * 12 + base_month0 + 7; // +6 月的次月 = +7
    let start = NaiveDate::from_ymd_opt(
        start_total.div_euclid(12),
        (start_total.rem_euclid(12) + 1) as u32,
        1,
    )
    .unwrap()
    .and_hms_opt(0, 0, 0)
    .unwrap();
    let end = NaiveDate::from_ymd_opt(
        end_total.div_euclid(12),
        (end_total.rem_euclid(12) + 1) as u32,
        1,
    )
    .unwrap()
    .and_hms_opt(0, 0, 0)
    .unwrap();
    (start, end)
}

/// 事务性整源替换：删掉该订阅旧的 external_events，再批量插入新实例。
/// `synced_at` 为本次同步时间戳（RFC3339 UTC），写入每行 last_synced_at。
pub fn replace_external_events(
    connection: &mut Connection,
    subscription_id: &str,
    instances: &[ExternalInstance],
    synced_at: &str,
) -> Result<(), CommandError> {
    let tx = connection.transaction().map_err(CommandError::database)?;
    tx.execute(
        "DELETE FROM external_events WHERE subscription_id = ?1",
        params![subscription_id],
    )
    .map_err(CommandError::database)?;
    for inst in instances {
        tx.execute(
            "INSERT INTO external_events
                (id,subscription_id,uid,start_at,end_at,start_tz,end_tz,
                 start_utc,end_utc,all_day,title,location,description,last_synced_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
            params![
                Uuid::new_v4().to_string(),
                subscription_id,
                inst.uid,
                inst.start_wall,
                inst.end_wall,
                inst.start_tz,
                inst.end_tz,
                inst.start_utc,
                inst.end_utc,
                inst.all_day as i64,
                inst.title,
                inst.location,
                inst.description,
                synced_at
            ],
        )
        .map_err(CommandError::database)?;
    }
    tx.commit().map_err(CommandError::database)?;
    Ok(())
}

/// 记录同步结果。成功：last_status='ok'、last_error=NULL、last_synced_at=now。
/// 失败：last_status='failed'、last_error=错误文案，不改 last_synced_at（保留上次成功时间）。
pub fn mark_synced(
    connection: &Connection,
    subscription_id: &str,
    now: &str,
    result: Result<(), CommandError>,
) -> Result<(), CommandError> {
    match result {
        Ok(()) => connection
            .execute(
                "UPDATE calendar_subscriptions
                    SET last_status='ok', last_error=NULL, last_synced_at=?2, updated_at=?2
                 WHERE id=?1",
                params![subscription_id, now],
            )
            .map(|_| ())
            .map_err(CommandError::database),
        Err(error) => connection
            .execute(
                "UPDATE calendar_subscriptions
                    SET last_status='failed', last_error=?2, updated_at=?3
                 WHERE id=?1",
                params![subscription_id, error.message, now],
            )
            .map(|_| ())
            .map_err(CommandError::database),
    }
}

/// 用可注入的 fetcher 同步一个源（便于测试）。失败时不动 external_events，只记状态。
/// `today` 决定展开窗口；`now` 为同步时间戳。
pub fn sync_one_with<F>(
    connection: &mut Connection,
    subscription_id: &str,
    url: &str,
    today: NaiveDate,
    now: &str,
    fetcher: F,
) -> Result<(), CommandError>
where
    F: FnOnce(&str) -> Result<String, CommandError>,
{
    let outcome = (|| {
        let normalized = normalize_ics_url(url)?;
        let text = fetcher(&normalized)?;
        let events = ics_parser::parse_vevents(&text);
        let (start, end) = expansion_window(today);
        let instances = ics_parser::expand_vevents(&events, start, end);
        replace_external_events(connection, subscription_id, &instances, now)?;
        Ok(())
    })();
    // 无论成功失败都记录状态；写库失败（DB 错误）向上传播。
    mark_synced(connection, subscription_id, now, outcome)
}

/// 生产路径：用真实网络 fetcher 同步一个源。
pub fn sync_one(
    connection: &mut Connection,
    subscription_id: &str,
    url: &str,
) -> Result<(), CommandError> {
    let today = chrono::Local::now().date_naive();
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    sync_one_with(connection, subscription_id, url, today, &now, |u| {
        crate::net::fetch_ics(u)
    })
}

/// 同步全部订阅（后台线程与启动时调用）。逐源独立，单源失败不影响其它源。
pub fn sync_all(connection: &mut Connection) -> Result<(), CommandError> {
    let sources = crate::subscriptions::list(connection)?;
    for source in sources {
        let _ = sync_one(connection, &source.id, &source.url);
    }
    Ok(())
}

/// 判断某源是否到期需刷新。`last_synced_at` 为 UTC RFC3339；`now_utc` 为 UTC 钟面。
/// 从未成功同步（None 或无法解析）一律视为到期。
pub fn due_for_refresh(
    last_synced_at: Option<String>,
    interval_minutes: i64,
    now_utc: NaiveDateTime,
) -> bool {
    let Some(raw) = last_synced_at else {
        return true;
    };
    let Ok(parsed) = chrono::DateTime::parse_from_rfc3339(&raw) else {
        return true;
    };
    let last = parsed.naive_utc();
    now_utc - last >= Duration::minutes(interval_minutes.max(1))
}

/// 刷新所有到期的源（后台线程周期调用）。
pub fn sync_due(connection: &mut Connection) -> Result<(), CommandError> {
    let now_utc = chrono::Utc::now().naive_utc();
    let sources = crate::subscriptions::list(connection)?;
    for source in sources {
        if due_for_refresh(
            source.last_synced_at.clone(),
            source.refresh_interval_minutes,
            now_utc,
        ) {
            let _ = sync_one(connection, &source.id, &source.url);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn refresh_calendar_subscription(
    db: State<'_, AppDb>,
    id: String,
) -> Result<(), CommandError> {
    let mut connection = db.0.lock().map_err(CommandError::database)?;
    let url: String = connection
        .query_row(
            "SELECT url FROM calendar_subscriptions WHERE id=?1",
            params![id],
            |r| r.get(0),
        )
        .map_err(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => CommandError::validation("id", "订阅不存在。"),
            other => CommandError::database(other),
        })?;
    sync_one(&mut connection, &id, &url)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(value: &str) -> NaiveDate {
        NaiveDate::parse_from_str(value, "%Y-%m-%d").unwrap()
    }

    fn ndt(value: &str) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(value, "%Y-%m-%dT%H:%M").unwrap()
    }

    fn memory_db() -> Connection {
        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch("PRAGMA foreign_keys = ON;")
            .unwrap();
        crate::db::migrate(&mut connection).unwrap();
        connection
            .execute(
                "INSERT INTO calendar_subscriptions
                    (id,name,url,color,refresh_interval_minutes,created_at,updated_at)
                 VALUES ('s1','家庭','https://example.com/a.ics','#4FC9DA',15,'t','t')",
                [],
            )
            .unwrap();
        connection
    }

    fn instance(title: &str, start: &str) -> ExternalInstance {
        ExternalInstance {
            uid: Some(format!("uid-{title}")),
            title: title.into(),
            location: None,
            description: None,
            start_wall: start.into(),
            end_wall: start.into(),
            start_tz: None,
            end_tz: None,
            start_utc: None,
            end_utc: None,
            all_day: false,
        }
    }

    #[test]
    fn window_spans_six_months_each_side() {
        let (start, end) = expansion_window(d("2026-08-15"));
        assert_eq!(start, ndt("2026-02-01T00:00"));
        assert_eq!(end, ndt("2027-03-01T00:00"));
    }

    #[test]
    fn window_crosses_year_boundary() {
        let (start, end) = expansion_window(d("2026-01-10"));
        assert_eq!(start, ndt("2025-07-01T00:00"));
        assert_eq!(end, ndt("2026-08-01T00:00"));
    }

    #[test]
    fn replace_source_swaps_all_rows_atomically() {
        let mut connection = memory_db();
        replace_external_events(
            &mut connection,
            "s1",
            &[
                instance("A", "2026-08-10T10:00"),
                instance("B", "2026-08-11T10:00"),
            ],
            "2026-08-01T00:00:00Z",
        )
        .unwrap();
        let count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM external_events WHERE subscription_id='s1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 2);

        // 第二次同步用新数据整源替换。
        replace_external_events(
            &mut connection,
            "s1",
            &[instance("C", "2026-08-12T10:00")],
            "2026-08-02T00:00:00Z",
        )
        .unwrap();
        let titles: Vec<String> = {
            let mut stmt = connection
                .prepare("SELECT title FROM external_events WHERE subscription_id='s1'")
                .unwrap();
            let rows = stmt.query_map([], |r| r.get::<_, String>(0)).unwrap();
            rows.map(|r| r.unwrap()).collect()
        };
        assert_eq!(titles, vec!["C".to_string()]);
    }

    #[test]
    fn mark_ok_sets_status_and_clears_error() {
        let connection = memory_db();
        mark_synced(&connection, "s1", "2026-08-01T00:00:00Z", Ok(())).unwrap();
        let (status, error, synced): (Option<String>, Option<String>, Option<String>) = connection
            .query_row(
                "SELECT last_status,last_error,last_synced_at FROM calendar_subscriptions WHERE id='s1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(status.as_deref(), Some("ok"));
        assert_eq!(error, None);
        assert_eq!(synced.as_deref(), Some("2026-08-01T00:00:00Z"));
    }

    #[test]
    fn mark_failed_sets_status_and_error_without_touching_synced_at() {
        let connection = memory_db();
        // 先成功一次，记录 last_synced_at。
        mark_synced(&connection, "s1", "2026-08-01T00:00:00Z", Ok(())).unwrap();
        // 再失败：状态与错误更新，但 last_synced_at 保留上次成功值。
        mark_synced(
            &connection,
            "s1",
            "2026-08-02T00:00:00Z",
            Err(CommandError::validation("url", "请求失败：超时")),
        )
        .unwrap();
        let (status, error, synced): (Option<String>, Option<String>, Option<String>) = connection
            .query_row(
                "SELECT last_status,last_error,last_synced_at FROM calendar_subscriptions WHERE id='s1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(status.as_deref(), Some("failed"));
        assert_eq!(error.as_deref(), Some("请求失败：超时"));
        assert_eq!(synced.as_deref(), Some("2026-08-01T00:00:00Z"));
    }

    #[test]
    fn sync_with_fetcher_writes_events_and_marks_ok() {
        let mut connection = memory_db();
        let ics = "BEGIN:VEVENT\r\nUID:1\r\nSUMMARY:会议\r\n\
                   DTSTART:20260810T100000Z\r\nDTEND:20260810T110000Z\r\nEND:VEVENT";
        sync_one_with(
            &mut connection,
            "s1",
            "https://example.com/a.ics",
            d("2026-08-15"),
            "2026-08-15T00:00:00Z",
            |_url| Ok(ics.to_string()),
        )
        .unwrap();
        let count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM external_events WHERE subscription_id='s1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
        let status: Option<String> = connection
            .query_row(
                "SELECT last_status FROM calendar_subscriptions WHERE id='s1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(status.as_deref(), Some("ok"));
    }

    #[test]
    fn sync_fetch_failure_preserves_previous_events_and_marks_failed() {
        let mut connection = memory_db();
        // 先成功放入一行。
        replace_external_events(
            &mut connection,
            "s1",
            &[instance("旧", "2026-08-10T10:00")],
            "2026-08-14T00:00:00Z",
        )
        .unwrap();
        // 再让拉取失败。
        sync_one_with(
            &mut connection,
            "s1",
            "https://example.com/a.ics",
            d("2026-08-15"),
            "2026-08-15T00:00:00Z",
            |_url| Err(CommandError::validation("url", "请求失败：超时")),
        )
        .unwrap();
        // 旧数据仍在。
        let titles: Vec<String> = {
            let mut stmt = connection
                .prepare("SELECT title FROM external_events WHERE subscription_id='s1'")
                .unwrap();
            let rows = stmt.query_map([], |r| r.get::<_, String>(0)).unwrap();
            rows.map(|r| r.unwrap()).collect()
        };
        assert_eq!(titles, vec!["旧".to_string()]);
        let status: Option<String> = connection
            .query_row(
                "SELECT last_status FROM calendar_subscriptions WHERE id='s1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(status.as_deref(), Some("failed"));
    }

    #[test]
    fn due_for_refresh_when_never_synced() {
        assert!(due_for_refresh(None, 15, ndt("2026-08-15T10:00")));
    }

    #[test]
    fn due_for_refresh_after_interval_elapsed() {
        // 上次成功于 09:40（UTC），间隔 15 分钟；10:00 已过期。
        let last = "2026-08-15T09:40:00Z";
        assert!(due_for_refresh(
            Some(last.to_string()),
            15,
            ndt("2026-08-15T10:00")
        ));
        // 09:50 尚未过期。
        assert!(!due_for_refresh(
            Some(last.to_string()),
            15,
            ndt("2026-08-15T09:50")
        ));
    }
}
