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
        recent_colors: read_value_or(connection, "recent_colors", Vec::new())?,
    })
}

pub(crate) fn validate(settings: &AppSettings) -> Result<(), rusqlite::Error> {
    if !matches!(settings.density.as_str(), "compact" | "balanced" | "comfortable") {
        return Err(rusqlite::Error::InvalidParameterName("density".into()));
    }
    if !matches!(settings.week_start.as_str(), "monday" | "sunday") {
        return Err(rusqlite::Error::InvalidParameterName("weekStart".into()));
    }
    if !matches!(settings.date_format.as_str(), "localized" | "iso") {
        return Err(rusqlite::Error::InvalidParameterName("dateFormat".into()));
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
        ("wallpaper_enabled", serde_json::to_string(&settings.wallpaper_enabled)),
        ("launch_at_login", serde_json::to_string(&settings.launch_at_login)),
        ("target_monitor_id", serde_json::to_string(&settings.target_monitor_id)),
        ("density", serde_json::to_string(&settings.density)),
        ("week_start", serde_json::to_string(&settings.week_start)),
        ("date_format", serde_json::to_string(&settings.date_format)),
        ("show_weekends", serde_json::to_string(&settings.show_weekends)),
        ("recent_colors", serde_json::to_string(&settings.recent_colors)),
    ];
    for (key, value) in values {
        let value = value.map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
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
    transaction.commit()?;
    read_app_settings(connection)
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

        assert!(!settings.wallpaper_enabled);
        assert!(!settings.launch_at_login);
        assert_eq!(settings.target_monitor_id, None);
        assert_eq!(settings.density, "balanced");
        assert_eq!(settings.week_start, "monday");
        assert_eq!(settings.date_format, "localized");
        assert!(settings.show_weekends);
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
            .execute("DELETE FROM settings WHERE key IN ('week_start','date_format','show_weekends')", [])
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
            .execute("DELETE FROM settings WHERE key IN ('week_start','date_format','show_weekends')", [])
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
}
