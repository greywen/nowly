use crate::models::AppSettings;
use rusqlite::{Connection, OptionalExtension, TransactionBehavior};
use serde::de::DeserializeOwned;

fn read_value<T: DeserializeOwned>(
    connection: &Connection,
    key: &str,
) -> Result<Option<T>, rusqlite::Error> {
    let value: Option<String> = connection
        .query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| {
            row.get(0)
        })
        .optional()?;
    let Some(value) = value else {
        return Ok(None);
    };
    serde_json::from_str(&value).map(Some).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error))
    })
}

// Read a key, falling back to a default when the row is missing. Settings rows
// are seeded by migration, but an older or partially-migrated database can be
// missing a key. Defaulting here keeps a single missing row from failing the
// whole read (and, after a write, rejecting the entire save).
fn read_value_or<T: DeserializeOwned>(
    connection: &Connection,
    key: &str,
    default: T,
) -> Result<T, rusqlite::Error> {
    Ok(read_value(connection, key)?.unwrap_or(default))
}

pub fn read_app_settings(connection: &Connection) -> Result<AppSettings, rusqlite::Error> {
    Ok(AppSettings {
        wallpaper_enabled: read_value_or(connection, "wallpaper_enabled", false)?,
        launch_at_login: read_value_or(connection, "launch_at_login", false)?,
        target_monitor_id: read_value(connection, "target_monitor_id")?.flatten(),
        density: read_value_or(connection, "density", "balanced".to_string())?,
        week_start: read_value_or(connection, "week_start", "monday".to_string())?,
        date_format: read_value_or(connection, "date_format", "localized".to_string())?,
        show_weekends: read_value_or(connection, "show_weekends", true)?,
        icon_style: read_value_or(
            connection,
            "icon_style",
            crate::models::default_icon_style(),
        )?,
        hide_topbar_in_wallpaper: read_value_or(connection, "hide_topbar_in_wallpaper", true)?,
        notification_mode: read_value_or(
            connection,
            "notification_mode",
            crate::models::default_notification_mode(),
        )?,
        quick_panel_enabled: read_value_or(connection, "quick_panel_enabled", true)?,
        quick_panel_shortcut: read_value_or(
            connection,
            "quick_panel_shortcut",
            "Ctrl+Space".to_owned(),
        )?,
        screenshot_shortcut: read_value_or(connection, "screenshot_shortcut", crate::models::default_screenshot_shortcut())?,
        screenshot_history_shortcut: read_value_or(connection, "screenshot_history_shortcut", crate::models::default_screenshot_history_shortcut())?,
        bar_buttons: read_value_or(connection, "bar_buttons", Vec::new())?,
        recent_colors: read_value_or(connection, "recent_colors", Vec::new())?,
    })
}

pub(crate) fn validate(settings: &AppSettings) -> Result<(), rusqlite::Error> {
    let screenshot = crate::screenshot_shortcuts::normalize(&settings.screenshot_shortcut)
        .map_err(|_| rusqlite::Error::InvalidParameterName("screenshotShortcut".into()))?;
    let history = crate::screenshot_shortcuts::normalize(&settings.screenshot_history_shortcut)
        .map_err(|_| rusqlite::Error::InvalidParameterName("screenshotHistoryShortcut".into()))?;
    if screenshot == history { return Err(rusqlite::Error::InvalidParameterName("screenshotHistoryShortcut".into())); }
    if !matches!(
        settings.density.as_str(),
        "compact" | "balanced" | "comfortable"
    ) {
        return Err(rusqlite::Error::InvalidParameterName("density".into()));
    }
    if settings.quick_panel_shortcut.trim().is_empty() || settings.quick_panel_shortcut.len() > 80 {
        return Err(rusqlite::Error::InvalidParameterName(
            "quickPanelShortcut".into(),
        ));
    }
    if !matches!(settings.week_start.as_str(), "monday" | "sunday") {
        return Err(rusqlite::Error::InvalidParameterName("weekStart".into()));
    }
    if !matches!(settings.date_format.as_str(), "localized" | "iso") {
        return Err(rusqlite::Error::InvalidParameterName("dateFormat".into()));
    }
    if !matches!(
        settings.notification_mode.as_str(),
        "persistent" | "notification"
    ) {
        return Err(rusqlite::Error::InvalidParameterName(
            "notificationMode".into(),
        ));
    }
    if !matches!(
        settings.icon_style.as_str(),
        "duotone" | "solid" | "outline"
    ) {
        return Err(rusqlite::Error::InvalidParameterName("iconStyle".into()));
    }
    // The bar's geometry is derived from this length, so an over-long or
    // duplicated list would widen the shell past the host window. Reject it here
    // rather than clamping silently, so a malformed save is visible.
    if settings.bar_buttons.len() > crate::quick_panel::BAR_BUTTON_SLOTS {
        return Err(rusqlite::Error::InvalidParameterName("barButtons".into()));
    }
    for (index, id) in settings.bar_buttons.iter().enumerate() {
        if !crate::quick_panel::is_known_bar_app(id) {
            return Err(rusqlite::Error::InvalidParameterName("barButtons".into()));
        }
        if settings.bar_buttons[..index].contains(id) {
            return Err(rusqlite::Error::InvalidParameterName("barButtons".into()));
        }
    }
    Ok(())
}

pub fn write_app_settings(
    connection: &mut Connection,
    settings: &AppSettings,
) -> Result<AppSettings, rusqlite::Error> {
    validate(settings)?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let values = [
        (
            "wallpaper_enabled",
            serde_json::to_string(&settings.wallpaper_enabled),
        ),
        (
            "launch_at_login",
            serde_json::to_string(&settings.launch_at_login),
        ),
        (
            "target_monitor_id",
            serde_json::to_string(&settings.target_monitor_id),
        ),
        ("density", serde_json::to_string(&settings.density)),
        ("week_start", serde_json::to_string(&settings.week_start)),
        ("date_format", serde_json::to_string(&settings.date_format)),
        (
            "show_weekends",
            serde_json::to_string(&settings.show_weekends),
        ),
        ("icon_style", serde_json::to_string(&settings.icon_style)),
        (
            "hide_topbar_in_wallpaper",
            serde_json::to_string(&settings.hide_topbar_in_wallpaper),
        ),
        (
            "notification_mode",
            serde_json::to_string(&settings.notification_mode),
        ),
        (
            "quick_panel_enabled",
            serde_json::to_string(&settings.quick_panel_enabled),
        ),
        (
            "quick_panel_shortcut",
            serde_json::to_string(&settings.quick_panel_shortcut),
        ),
        ("screenshot_shortcut", serde_json::to_string(&settings.screenshot_shortcut)),
        ("screenshot_history_shortcut", serde_json::to_string(&settings.screenshot_history_shortcut)),
        ("bar_buttons", serde_json::to_string(&settings.bar_buttons)),
        (
            "recent_colors",
            serde_json::to_string(&settings.recent_colors),
        ),
    ];
    for (key, value) in values {
        let value =
            value.map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
        // Upsert so a key that was never seeded (older or partially-migrated
        // database) is created rather than silently skipped by a plain UPDATE,
        // which would otherwise make the trailing read fail and reject the save.
        transaction.execute(
            "INSERT INTO settings(key, value, updated_at)
             VALUES (?1, ?2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            (key, value),
        )?;
    }
    transaction.execute(
        "DELETE FROM settings WHERE key = 'notification_display'",
        [],
    )?;
    let saved = read_app_settings(&transaction)?;
    transaction.commit()?;
    Ok(saved)
}

#[cfg(test)]
mod tests {
    use super::read_app_settings;
    use crate::db::migrate;
    use rusqlite::Connection;

    #[test]
    fn fresh_database_returns_approved_defaults() {
        let mut connection = Connection::open_in_memory().unwrap();
        migrate(&mut connection).unwrap();

        let settings = read_app_settings(&connection).unwrap();

        assert_eq!(settings.screenshot_shortcut, "Ctrl+Alt+A");
        assert_eq!(settings.screenshot_history_shortcut, "Ctrl+Alt+H");
        assert!(!settings.wallpaper_enabled);
        assert!(!settings.launch_at_login);
        assert_eq!(settings.target_monitor_id, None);
        assert_eq!(settings.density, "balanced");
        assert_eq!(settings.week_start, "monday");
        assert_eq!(settings.date_format, "localized");
        assert!(settings.show_weekends);
        assert_eq!(settings.icon_style, "duotone");
        assert!(settings.hide_topbar_in_wallpaper);
        assert_eq!(settings.notification_mode, "persistent");
        // No app buttons until the user configures them, so a fresh install has
        // the historic bar geometry.
        assert!(settings.bar_buttons.is_empty());
    }

    /// The bar's width is derived from this list, so a malformed one is rejected
    /// rather than clamped: a silent clamp would disagree with what the user saved.
    #[test]
    fn malformed_bar_button_lists_are_rejected() {
        let mut connection = Connection::open_in_memory().unwrap();
        migrate(&mut connection).unwrap();
        let before = read_app_settings(&connection).unwrap();

        for invalid_list in [
            // Unknown id: would render a button with no handler.
            vec!["not-an-app".to_string()],
            // Duplicate: one app cannot occupy two slots.
            vec!["screenshot".to_string(), "screenshot".to_string()],
            // Over the slot count: would widen the shell past the host window.
            vec![
                "screenshot".to_string(),
                "a".to_string(),
                "b".to_string(),
                "c".to_string(),
            ],
        ] {
            let mut invalid = before.clone();
            invalid.bar_buttons = invalid_list;
            assert!(super::write_app_settings(&mut connection, &invalid).is_err());
            assert_eq!(read_app_settings(&connection).unwrap(), before);
        }
    }

    #[test]
    fn a_catalogued_bar_button_is_accepted() {
        let mut connection = Connection::open_in_memory().unwrap();
        migrate(&mut connection).unwrap();
        let mut settings = read_app_settings(&connection).unwrap();
        settings.bar_buttons = vec!["screenshot".to_string()];

        let saved = super::write_app_settings(&mut connection, &settings).unwrap();

        assert_eq!(saved.bar_buttons, vec!["screenshot".to_string()]);
        assert_eq!(
            read_app_settings(&connection).unwrap().bar_buttons,
            vec!["screenshot".to_string()]
        );
    }

    #[test]
    fn valid_settings_are_replaced_atomically() {
        let mut connection = Connection::open_in_memory().unwrap();
        migrate(&mut connection).unwrap();
        let settings = crate::models::AppSettings {
            wallpaper_enabled: true,
            launch_at_login: true,
            target_monitor_id: Some("DISPLAY-2".into()),
            density: "comfortable".into(),
            week_start: "sunday".into(),
            date_format: "iso".into(),
            show_weekends: false,
            icon_style: "outline".into(),
            hide_topbar_in_wallpaper: false,
            notification_mode: "notification".into(),
            // Non-default values, like every field above: the assertion below is a
            // round trip, so a field left at its default would pass even if it were
            // never written.
            quick_panel_enabled: false,
            quick_panel_shortcut: "Ctrl+Shift+K".into(),
            screenshot_shortcut: "Ctrl+Shift+A".into(),
            screenshot_history_shortcut: "Ctrl+Shift+H".into(),
            bar_buttons: vec!["screenshot".into()],
            recent_colors: vec![],
        };

        super::write_app_settings(&mut connection, &settings).unwrap();

        assert_eq!(read_app_settings(&connection).unwrap(), settings);
    }

    #[test]
    fn invalid_settings_leave_storage_unchanged() {
        let mut connection = Connection::open_in_memory().unwrap();
        migrate(&mut connection).unwrap();
        let before = read_app_settings(&connection).unwrap();
        let mut invalid = before.clone();
        invalid.density = "tiny".into();

        assert!(super::write_app_settings(&mut connection, &invalid).is_err());
        assert_eq!(read_app_settings(&connection).unwrap(), before);
    }

    #[test]
    fn stored_json_values_override_defaults() {
        let mut connection = Connection::open_in_memory().unwrap();
        migrate(&mut connection).unwrap();
        connection
            .execute(
                "UPDATE settings SET value = 'true' WHERE key = 'wallpaper_enabled'",
                [],
            )
            .unwrap();
        connection
            .execute(
                "UPDATE settings SET value = '\"comfortable\"' WHERE key = 'density'",
                [],
            )
            .unwrap();

        let settings = read_app_settings(&connection).unwrap();

        assert!(settings.wallpaper_enabled);
        assert_eq!(settings.density, "comfortable");
    }

    #[test]
    fn missing_keys_fall_back_to_defaults_instead_of_failing() {
        let mut connection = Connection::open_in_memory().unwrap();
        migrate(&mut connection).unwrap();
        // Simulate an older/partially-migrated database that never seeded the
        // calendar preference rows.
        connection
            .execute(
                "DELETE FROM settings WHERE key IN ('week_start','date_format','show_weekends')",
                [],
            )
            .unwrap();

        let settings = read_app_settings(&connection).unwrap();

        assert_eq!(settings.week_start, "monday");
        assert_eq!(settings.date_format, "localized");
        assert!(settings.show_weekends);
    }

    #[test]
    fn write_creates_missing_keys_and_reads_them_back() {
        let mut connection = Connection::open_in_memory().unwrap();
        migrate(&mut connection).unwrap();
        connection
            .execute(
                "DELETE FROM settings WHERE key IN ('week_start','date_format','show_weekends')",
                [],
            )
            .unwrap();
        let mut settings = read_app_settings(&connection).unwrap();
        settings.week_start = "sunday".into();
        settings.date_format = "iso".into();
        settings.show_weekends = false;

        let saved = super::write_app_settings(&mut connection, &settings).unwrap();

        assert_eq!(saved.week_start, "sunday");
        assert_eq!(saved.date_format, "iso");
        assert!(!saved.show_weekends);
        // And the values persist on a fresh read.
        let reread = read_app_settings(&connection).unwrap();
        assert_eq!(reread, saved);
    }

    #[test]
    fn write_removes_the_obsolete_notification_display_setting() {
        let mut connection = Connection::open_in_memory().unwrap();
        migrate(&mut connection).unwrap();
        connection
            .execute(
                "INSERT INTO settings(key, value, updated_at)
                 VALUES ('notification_display', '\"summary\"', '2026-09-15T00:00:00Z')
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                [],
            )
            .unwrap();
        let settings = read_app_settings(&connection).unwrap();

        super::write_app_settings(&mut connection, &settings).unwrap();

        let remaining: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM settings WHERE key = 'notification_display'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(remaining, 0);
    }
}
