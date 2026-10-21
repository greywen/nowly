use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SoundScene {
    Calendar,
    Alarm,
    MissedSummary,
    Focus,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct SoundSettings {
    pub enabled: bool,
    pub volume: u8,
    pub calendar: String,
    pub alarm: String,
    pub missed_summary: String,
    pub focus: String,
}

impl Default for SoundSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            volume: 100,
            calendar: "chime-glass".into(),
            alarm: "bell-rise".into(),
            missed_summary: "tap".into(),
            focus: "resolve".into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_mute_and_volume_do_not_disable_selected_sounds() {
        let settings = SoundSettings {
            enabled: false,
            volume: 0,
            calendar: "none".into(),
            alarm: "beep-soft".into(),
            ..Default::default()
        };
        assert_eq!(settings.selected(SoundScene::Calendar), Some("chime-glass"));
        assert_eq!(settings.selected(SoundScene::Alarm), Some("beep-soft"));
        assert_eq!(SoundSettings::default().volume, 100);
    }
}

impl SoundSettings {
    pub fn normalize(mut self) -> Self {
        self.enabled = true;
        self.volume = 100;
        if self.calendar == "none" { self.calendar = "chime-glass".into(); }
        if self.alarm == "none" { self.alarm = "bell-rise".into(); }
        if self.missed_summary == "none" { self.missed_summary = "tap".into(); }
        if self.focus == "none" { self.focus = "resolve".into(); }
        self
    }

    pub fn validate(&self) -> Result<(), rusqlite::Error> {
        if self.volume > 100
            || !matches!(
                self.calendar.as_str(),
                "none" | "chime-glass" | "chime-wood"
            )
            || !matches!(self.alarm.as_str(), "none" | "bell-rise" | "beep-soft")
            || !matches!(self.missed_summary.as_str(), "none" | "tap" | "low-knock")
            || !matches!(self.focus.as_str(), "none" | "resolve" | "done-blip")
        {
            return Err(rusqlite::Error::InvalidParameterName(
                "soundSettings".into(),
            ));
        }
        Ok(())
    }

    pub fn selected(&self, scene: SoundScene) -> Option<&str> {
        let sound = match scene {
            SoundScene::Calendar => &self.calendar,
            SoundScene::Alarm => &self.alarm,
            SoundScene::MissedSummary => &self.missed_summary,
            SoundScene::Focus => &self.focus,
        };
        Some(if sound == "none" {
            match scene {
                SoundScene::Calendar => "chime-glass",
                SoundScene::Alarm => "bell-rise",
                SoundScene::MissedSummary => "tap",
                SoundScene::Focus => "resolve",
            }
        } else {
            sound
        })
    }
}
