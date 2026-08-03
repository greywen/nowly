use crate::models::AppSettings;
use rusqlite::{Connection, OptionalExtension, TransactionBehavior};
use serde::de::DeserializeOwned;

fn read_value<T: DeserializeOwned>(
    connection: &Connection,
    key: &str,
) -> Result<T, rusqlite::Error> {
    let value: Option<String> = connection
        .query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| {
            row.get(0)
        })
        .optional()?;
    let value = value.ok_or(rusqlite::Error::QueryReturnedNoRows)?;
    serde_json::from_str(&value).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error))
    })
}

pub fn read_app_settings(connection: &Connection) -> Result<AppSettings, rusqlite::Error> {
    Ok(AppSettings {
        wallpaper_enabled: read_value(connection, "wallpaper_enabled")?,
        launch_at_login: read_value(connection, "launch_at_login")?,
        target_monitor_id: read_value(connection, "target_monitor_id")?,
        density: read_value(connection, "density")?,
        week_start: read_value(connection, "week_start")?,
        date_format: read_value(connection, "date_format")?,
        show_weekends: read_value(connection, "show_weekends")?,
        calendar_enabled: read_value(connection, "calendar_enabled")?,
        matrix_enabled: read_value(connection, "matrix_enabled")?,
        notes_enabled: read_value(connection, "notes_enabled")?,
    })
}

pub(crate) fn validate(settings: &AppSettings) -> Result<(), rusqlite::Error> {
    if !matches!(settings.density.as_str(), "balanced" | "comfortable") {
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
        ("calendar_enabled", serde_json::to_string(&settings.calendar_enabled)),
        ("matrix_enabled", serde_json::to_string(&settings.matrix_enabled)),
        ("notes_enabled", serde_json::to_string(&settings.notes_enabled)),
    ];
    for (key, value) in values {
        let value = value.map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
        transaction.execute(
            "UPDATE settings SET value = ?2, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE key = ?1",
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
        assert!(settings.calendar_enabled);
        assert!(settings.matrix_enabled);
        assert!(settings.notes_enabled);
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
            calendar_enabled: false,
            matrix_enabled: true,
            notes_enabled: false,
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
}
