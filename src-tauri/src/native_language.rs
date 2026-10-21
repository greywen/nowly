#[cfg(windows)]
fn system_language() -> Option<String> {
    use windows::Win32::Globalization::{
        GetUserDefaultUILanguage, LCIDToLocaleName, LOCALE_ALLOW_NEUTRAL_NAMES,
    };

    let mut buffer = [0u16; 85];
    let length = unsafe {
        let language = GetUserDefaultUILanguage();
        if language == 0 {
            return None;
        }
        LCIDToLocaleName(u32::from(language), Some(&mut buffer), LOCALE_ALLOW_NEUTRAL_NAMES)
    };
    if length <= 1 {
        return None;
    }
    String::from_utf16(&buffer[..length as usize - 1]).ok()
}

#[cfg(not(windows))]
fn system_language() -> Option<String> {
    None
}

fn system_language_script(language: Option<&str>) -> String {
    let value = serde_json::to_string(&language).expect("language is JSON serializable");
    format!("Object.defineProperty(window, '__NOWLY_SYSTEM_LANGUAGE__', {{ value: {value} }});")
}

pub fn plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    // Apply to every app window before the synchronous frontend store initializes.
    // Keep this main-frame-only so custom module iframes are unaffected.
    tauri::plugin::Builder::new("system-language")
        .js_init_script(system_language_script(system_language().as_deref()))
        .build()
}

pub fn quit_label(language: &str) -> &'static str {
    match language {
        "zh" => "退出 Nowly",
        "fr" => "Quitter Nowly",
        "es" => "Salir de Nowly",
        "ar" => "إنهاء Nowly",
        "ja" => "Nowly を終了",
        "ko" => "Nowly 종료",
        "zh-Hant" => "結束 Nowly",
        _ => "Quit Nowly",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quit_action_is_localized_in_all_supported_languages() {
        for (language, expected) in [
            ("zh", "退出 Nowly"),
            ("en", "Quit Nowly"),
            ("fr", "Quitter Nowly"),
            ("es", "Salir de Nowly"),
            ("ar", "إنهاء Nowly"),
            ("ja", "Nowly を終了"),
            ("ko", "Nowly 종료"),
            ("zh-Hant", "結束 Nowly"),
        ] {
            assert_eq!(quit_label(language), expected, "{language}");
        }
    }

    #[test]
    fn unsupported_language_uses_english() {
        assert_eq!(quit_label("unknown"), "Quit Nowly");
    }

    #[test]
    fn startup_script_exposes_the_system_language_before_app_scripts() {
        let script = system_language_script(Some("fr-FR"));
        assert!(script.contains("__NOWLY_SYSTEM_LANGUAGE__"));
        assert!(script.contains("value: \"fr-FR\""));
        assert!(script.contains("Object.defineProperty"));
    }

    #[test]
    fn missing_system_language_is_explicitly_null() {
        assert!(system_language_script(None).contains("value: null"));
    }

    #[test]
    fn startup_script_escapes_language_values() {
        assert!(system_language_script(Some("a\"b")).contains("value: \"a\\\"b\""));
    }

    #[cfg(windows)]
    #[test]
    fn reads_a_nonempty_windows_ui_language() {
        let language = system_language().expect("Windows UI language must be available");
        assert!(!language.is_empty());
        assert!(language.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'));
    }
}
