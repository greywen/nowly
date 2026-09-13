//! Google Calendar / Microsoft Graph 的远端事件写入。
//!
//! 所有命令先从订阅解析账户和远端日历，再检查账户授权是否包含写 scope。
//! API 写入成功后立即重拉该订阅；缓存刷新失败不会把已经成功的远端写入误报为失败。

use crate::db::AppDb;
use crate::error::CommandError;
use crate::models::{CalendarSubscription, EventDraft};
use chrono::{Days, NaiveDateTime, SecondsFormat};
use serde_json::{json, Value};
use tauri::Manager;

const WALL_FORMAT: &str = "%Y-%m-%dT%H:%M";

fn validate_remote_draft(draft: EventDraft) -> Result<EventDraft, CommandError> {
    if draft.recurrence.is_some() {
        return Err(CommandError::validation(
            "recurrence",
            "远端日历暂不支持新建或修改重复规则。",
        ));
    }
    crate::events::validate_and_normalize(draft)
}

fn has_write_scope(provider: &str, scopes: &str) -> bool {
    match provider {
        "google" => scopes
            .split_whitespace()
            .any(|scope| scope == "https://www.googleapis.com/auth/calendar"),
        "microsoft" => scopes.split_whitespace().any(|scope| {
            scope.eq_ignore_ascii_case("https://graph.microsoft.com/Calendars.ReadWrite")
        }),
        _ => false,
    }
}

fn source_and_account(
    db: &AppDb,
    subscription_id: &str,
) -> Result<(CalendarSubscription, String), CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    let source = crate::subscriptions::fetch_one(&connection, subscription_id)?;
    if source.provider == "ics" {
        return Err(CommandError::validation(
            "subscriptionId",
            "ICS 订阅仅支持查看。",
        ));
    }
    let account_id = source
        .account_id
        .clone()
        .ok_or_else(|| CommandError::validation("accountId", "日历账户不存在。"))?;
    let account = crate::token_store::account_tokens(&connection, &account_id)?;
    if account.provider != source.provider || !has_write_scope(&source.provider, &account.scopes) {
        return Err(CommandError::validation(
            "oauth",
            "该账户仅有只读权限，请断开并重新连接以允许编辑日历。",
        ));
    }
    Ok((source, account_id))
}

fn parse_wall(value: &str, field: &str) -> Result<NaiveDateTime, CommandError> {
    NaiveDateTime::parse_from_str(value, WALL_FORMAT)
        .map_err(|_| CommandError::validation(field, "日期或时间格式无效。"))
}

fn utc_datetime(value: &str, field: &str) -> Result<String, CommandError> {
    let wall = parse_wall(value, field)?;
    let instant = crate::timezone::wall_to_utc(wall, crate::timezone::device_tz());
    Ok(instant.to_rfc3339_opts(SecondsFormat::Secs, true))
}

fn exclusive_end_date(draft: &EventDraft) -> Result<String, CommandError> {
    let end = parse_wall(&draft.end_at, "endAt")?;
    let date = end
        .date()
        .checked_add_days(Days::new(1))
        .ok_or_else(|| CommandError::validation("endAt", "结束日期超出范围。"))?;
    Ok(date.format("%Y-%m-%d").to_string())
}

fn google_payload(draft: &EventDraft, include_description: bool) -> Result<Value, CommandError> {
    let (start, end) = if draft.all_day {
        (
            json!({ "date": draft.start_at[..10].to_owned() }),
            json!({ "date": exclusive_end_date(draft)? }),
        )
    } else {
        (
            json!({ "dateTime": utc_datetime(&draft.start_at, "startAt")? }),
            json!({ "dateTime": utc_datetime(&draft.end_at, "endAt")? }),
        )
    };
    let overrides: Vec<Value> = draft
        .reminders
        .iter()
        .map(|minutes| json!({ "method": "popup", "minutes": minutes }))
        .collect();
    let mut value = json!({
        "summary": draft.title,
        "start": start,
        "end": end,
        "reminders": { "useDefault": false, "overrides": overrides }
    });
    if include_description {
        value["description"] = json!(draft.note);
    }
    Ok(value)
}

fn graph_payload(draft: &EventDraft, include_description: bool) -> Result<Value, CommandError> {
    let (start, end) = if draft.all_day {
        let start_date = &draft.start_at[..10];
        let end_date = exclusive_end_date(draft)?;
        (
            json!({ "dateTime": format!("{start_date}T00:00:00"), "timeZone": "UTC" }),
            json!({ "dateTime": format!("{end_date}T00:00:00"), "timeZone": "UTC" }),
        )
    } else {
        let start = utc_datetime(&draft.start_at, "startAt")?;
        let end = utc_datetime(&draft.end_at, "endAt")?;
        (
            json!({ "dateTime": start.trim_end_matches('Z'), "timeZone": "UTC" }),
            json!({ "dateTime": end.trim_end_matches('Z'), "timeZone": "UTC" }),
        )
    };
    let reminder = draft.reminders.iter().min().copied();
    let mut value = json!({
        "subject": draft.title,
        "isAllDay": draft.all_day,
        "start": start,
        "end": end,
        "isReminderOn": reminder.is_some(),
        "reminderMinutesBeforeStart": reminder.unwrap_or(0)
    });
    if include_description {
        value["body"] = json!({ "contentType": "text", "content": draft.note });
    }
    Ok(value)
}

fn payload(
    provider: &str,
    draft: &EventDraft,
    include_description: bool,
) -> Result<Value, CommandError> {
    match provider {
        "google" => google_payload(draft, include_description),
        "microsoft" => graph_payload(draft, include_description),
        _ => Err(CommandError::validation("provider", "不支持的日历来源。")),
    }
}

fn api_error(status: u16) -> CommandError {
    match status {
        401 | 403 => CommandError::validation("oauth", "登录已过期或权限不足，请重新连接账户。"),
        404 => CommandError::not_found("远端日程不存在，可能已在其他设备删除。"),
        _ => CommandError::validation("remote", format!("日历服务写入失败（{status}）。")),
    }
}

fn run_write(
    db: &AppDb,
    subscription_id: &str,
    remote_event_id: Option<&str>,
    draft: Option<EventDraft>,
    operation: &str,
    description_changed: bool,
) -> Result<(), CommandError> {
    let (source, account_id) = source_and_account(db, subscription_id)?;
    let calendar_id = source
        .remote_calendar_id
        .as_deref()
        .ok_or_else(|| CommandError::validation("remoteCalendarId", "远端日历不存在。"))?;
    let access_token = crate::oauth::ensure_valid_access_token(db, &account_id)?;
    let encoded_calendar = crate::calendar_api::url_encode(calendar_id);
    let encoded_event = remote_event_id.map(crate::calendar_api::url_encode);
    let (method, url) = match (source.provider.as_str(), operation) {
        ("google", "create") => (
            "POST",
            format!("https://www.googleapis.com/calendar/v3/calendars/{encoded_calendar}/events"),
        ),
        ("google", "update") => (
            "PATCH",
            format!(
                "https://www.googleapis.com/calendar/v3/calendars/{encoded_calendar}/events/{}",
                encoded_event.as_deref().unwrap_or_default()
            ),
        ),
        ("google", "delete") => (
            "DELETE",
            format!(
                "https://www.googleapis.com/calendar/v3/calendars/{encoded_calendar}/events/{}",
                encoded_event.as_deref().unwrap_or_default()
            ),
        ),
        ("microsoft", "create") => (
            "POST",
            format!("https://graph.microsoft.com/v1.0/me/calendars/{encoded_calendar}/events"),
        ),
        ("microsoft", "update") => (
            "PATCH",
            format!(
                "https://graph.microsoft.com/v1.0/me/calendars/{encoded_calendar}/events/{}",
                encoded_event.as_deref().unwrap_or_default()
            ),
        ),
        ("microsoft", "delete") => (
            "DELETE",
            format!(
                "https://graph.microsoft.com/v1.0/me/calendars/{encoded_calendar}/events/{}",
                encoded_event.as_deref().unwrap_or_default()
            ),
        ),
        _ => return Err(CommandError::validation("provider", "不支持的日历来源。")),
    };
    let body = match draft {
        Some(draft) => {
            let draft = validate_remote_draft(draft)?;
            Some(payload(
                &source.provider,
                &draft,
                operation == "create" || description_changed,
            )?)
        }
        None => None,
    };
    let (status, _) = crate::net::json_with_bearer(method, &url, &access_token, body.as_ref())?;
    if !(200..300).contains(&status) {
        return Err(api_error(status));
    }
    if crate::subscription_sync::sync_one_db(db, &source).is_ok() {
        crate::status_island::invalidate_registered()?;
    }
    Ok(())
}

fn require_remote_id(remote_event_id: &str) -> Result<(), CommandError> {
    if remote_event_id.trim().is_empty() {
        Err(CommandError::validation(
            "remoteEventId",
            "远端日程标识缺失，请刷新日历。",
        ))
    } else {
        Ok(())
    }
}

#[tauri::command]
pub async fn create_remote_event<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    subscription_id: String,
    draft: EventDraft,
) -> Result<(), CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        let db = app.state::<AppDb>();
        run_write(
            db.inner(),
            &subscription_id,
            None,
            Some(draft),
            "create",
            true,
        )
    })
    .await
    .map_err(|_| CommandError::system("远端日程创建任务执行失败。"))?
}

#[tauri::command]
pub async fn update_remote_event<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    subscription_id: String,
    remote_event_id: String,
    draft: EventDraft,
    description_changed: bool,
) -> Result<(), CommandError> {
    require_remote_id(&remote_event_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let db = app.state::<AppDb>();
        run_write(
            db.inner(),
            &subscription_id,
            Some(&remote_event_id),
            Some(draft),
            "update",
            description_changed,
        )
    })
    .await
    .map_err(|_| CommandError::system("远端日程更新任务执行失败。"))?
}

#[tauri::command]
pub async fn delete_remote_event<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    subscription_id: String,
    remote_event_id: String,
) -> Result<(), CommandError> {
    require_remote_id(&remote_event_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let db = app.state::<AppDb>();
        run_write(
            db.inner(),
            &subscription_id,
            Some(&remote_event_id),
            None,
            "delete",
            false,
        )
    })
    .await
    .map_err(|_| CommandError::system("远端日程删除任务执行失败。"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn draft(all_day: bool) -> EventDraft {
        EventDraft {
            title: "评审".into(),
            start_at: "2026-08-10T10:00".into(),
            end_at: "2026-08-10T11:00".into(),
            start_tz: None,
            end_tz: None,
            all_day,
            category: "work".into(),
            color: "#4FC9DA".into(),
            linked_task_id: None,
            note: "确认范围".into(),
            reminders: vec![60, 10],
            recurrence: None,
        }
    }

    #[test]
    fn recognizes_only_write_scopes() {
        assert!(has_write_scope(
            "google",
            "openid https://www.googleapis.com/auth/calendar"
        ));
        assert!(!has_write_scope(
            "google",
            "openid https://www.googleapis.com/auth/calendar.readonly"
        ));
        assert!(has_write_scope(
            "microsoft",
            "openid https://graph.microsoft.com/Calendars.ReadWrite"
        ));
        assert!(!has_write_scope(
            "microsoft",
            "openid https://graph.microsoft.com/Calendars.Read"
        ));
    }

    #[test]
    fn google_all_day_payload_uses_exclusive_end() {
        let mut value = draft(true);
        value.start_at = "2026-08-10T00:00".into();
        value.end_at = "2026-08-12T23:59".into();
        let payload = google_payload(&value, true).unwrap();
        assert_eq!(payload["start"]["date"], "2026-08-10");
        assert_eq!(payload["end"]["date"], "2026-08-13");
        assert_eq!(
            payload["reminders"]["overrides"].as_array().unwrap().len(),
            2
        );
    }

    #[test]
    fn graph_uses_earliest_single_reminder() {
        let payload = graph_payload(&draft(false), true).unwrap();
        assert_eq!(payload["isReminderOn"], true);
        assert_eq!(payload["reminderMinutesBeforeStart"], 10);
        assert_eq!(payload["start"]["timeZone"], "UTC");
    }

    #[test]
    fn update_payload_can_preserve_remote_description() {
        let google = google_payload(&draft(false), false).unwrap();
        let graph = graph_payload(&draft(false), false).unwrap();
        assert!(google.get("description").is_none());
        assert!(graph.get("body").is_none());
    }
}
