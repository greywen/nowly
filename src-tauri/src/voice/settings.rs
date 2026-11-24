//! Voice input preferences, stored as one JSON row in `settings`.
use super::{asr::Language, hotkey::HoldSpec};
use crate::error::CommandError;
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

const KEY: &str = "voice_settings";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct VoiceSettings {
    /// Off until the user turns it on: the keyboard hook is only installed
    /// for people who asked for hold-to-talk.
    pub enabled: bool,
    pub hold_key: String,
    /// Input device name; `None` follows the system default.
    pub device: Option<String>,
    pub language: Language,
}

impl Default for VoiceSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            hold_key: super::hotkey::DEFAULT_SPEC.into(),
            device: None,
            language: Language::Auto,
        }
    }
}

impl VoiceSettings {
    pub fn spec(&self) -> HoldSpec {
        HoldSpec::parse(&self.hold_key).unwrap_or_default()
    }
}

pub fn read(connection: &Connection) -> Result<VoiceSettings, CommandError> {
    let value: Option<String> = connection
        .query_row("SELECT value FROM settings WHERE key = ?1", [KEY], |row| row.get(0))
        .optional()
        .map_err(CommandError::database)?;
    // A row written by a newer or damaged build falls back to defaults rather
    // than breaking the settings page.
    Ok(value
        .and_then(|value| serde_json::from_str(&value).ok())
        .unwrap_or_default())
}

/// Normalizes and validates, then stores. `taken` lists the global shortcuts
/// already bound, which a hold key must not reuse.
pub fn write(
    connection: &Connection,
    mut settings: VoiceSettings,
    taken: &[String],
) -> Result<VoiceSettings, CommandError> {
    let spec = HoldSpec::parse(&settings.hold_key)
        .map_err(|message| CommandError::validation("holdKey", &message))?;
    settings.hold_key = spec.canonical();
    if spec.has_key() && taken.iter().any(|key| key == &settings.hold_key) {
        return Err(CommandError::validation("holdKey", "该按键已被其他快捷键使用。"));
    }
    settings.device = settings
        .device
        .map(|d| d.trim().to_owned())
        .filter(|d| !d.is_empty() && d.len() <= 256);
    let value = serde_json::to_string(&settings).map_err(CommandError::system)?;
    connection
        .execute(
            "INSERT INTO settings(key, value, updated_at)
             VALUES (?1, ?2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            (KEY, value),
        )
        .map_err(CommandError::database)?;
    Ok(settings)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> Connection {
        let mut connection = Connection::open_in_memory().unwrap();
        crate::db::migrate(&mut connection).unwrap();
        connection
    }

    #[test]
    fn defaults_round_trip_and_normalize() {
        let connection = db();
        assert_eq!(read(&connection).unwrap(), VoiceSettings::default());
        let saved = write(
            &connection,
            VoiceSettings {
                enabled: true,
                hold_key: "alt+ctrl+v".into(),
                device: Some("  ".into()),
                language: Language::Zh,
            },
            &[],
        )
        .unwrap();
        assert_eq!(saved.hold_key, "Ctrl+Alt+V");
        assert_eq!(saved.device, None);
        assert_eq!(read(&connection).unwrap(), saved);
    }

    #[test]
    fn rejects_invalid_and_taken_keys() {
        let connection = db();
        let with = |key: &str| VoiceSettings { hold_key: key.into(), ..Default::default() };
        let error = write(&connection, with("Ctrl"), &[]).unwrap_err();
        assert_eq!(error.field.as_deref(), Some("holdKey"));
        assert!(write(&connection, with("Ctrl+Shift+A"), &["Ctrl+Shift+A".into()]).is_err());
        // Modifier-only holds never collide with registered shortcuts.
        assert!(write(&connection, with("Ctrl+Win"), &["Ctrl+Super".into()]).is_ok());
        assert_eq!(read(&connection).unwrap().hold_key, "Ctrl+Super");
    }

    #[test]
    fn damaged_row_reads_as_defaults() {
        let connection = db();
        connection
            .execute("INSERT INTO settings(key,value,updated_at) VALUES ('voice_settings','{','x')", [])
            .unwrap();
        assert_eq!(read(&connection).unwrap(), VoiceSettings::default());
    }
}
