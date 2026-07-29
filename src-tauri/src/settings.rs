use crate::models::AppSettings;
use rusqlite::{Connection, OptionalExtension};
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
