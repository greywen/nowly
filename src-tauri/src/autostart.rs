use tauri::Runtime;
#[cfg(not(windows))]
use tauri_plugin_autostart::ManagerExt;

pub fn disable<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<(), tauri_plugin_autostart::Error> {
    #[cfg(windows)]
    {
        disable_value(&app.package_info().name)
            .map_err(|error| tauri_plugin_autostart::Error::Anyhow(error.to_string()))
    }
    #[cfg(not(windows))]
    app.autolaunch().disable()
}

#[cfg(windows)]
fn disable_value(name: &str) -> windows::core::Result<()> {
    use windows::core::{w, PCWSTR};
    use windows::Win32::System::Registry::{RegDeleteKeyValueW, HKEY_CURRENT_USER};

    let name: Vec<u16> = name.encode_utf16().chain(Some(0)).collect();
    let status = unsafe {
        RegDeleteKeyValueW(
            HKEY_CURRENT_USER,
            w!("SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run"),
            PCWSTR(name.as_ptr()),
        )
    };
    deletion_result(status)
}

#[cfg(windows)]
fn deletion_result(status: windows::Win32::Foundation::WIN32_ERROR) -> windows::core::Result<()> {
    use windows::Win32::Foundation::ERROR_FILE_NOT_FOUND;

    // A removed Run key/value already satisfies the requested disabled state.
    // Keep permission and other registry failures visible to the caller.
    if status == ERROR_FILE_NOT_FOUND {
        Ok(())
    } else {
        status.ok()
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use windows::Win32::Foundation::{ERROR_ACCESS_DENIED, ERROR_FILE_NOT_FOUND, ERROR_SUCCESS};

    #[test]
    fn disabling_an_absent_startup_entry_succeeds_repeatedly() {
        let name = format!("Nowly-autostart-test-{}", uuid::Uuid::new_v4());
        assert!(disable_value(&name).is_ok());
        assert!(disable_value(&name).is_ok());
    }

    #[test]
    fn disabling_removes_an_existing_startup_entry() {
        use windows::core::{w, PCWSTR};
        use windows::Win32::System::Registry::{
            RegDeleteKeyValueW, RegSetKeyValueW, HKEY_CURRENT_USER, REG_SZ,
        };

        let name = format!("Nowly-autostart-test-{}", uuid::Uuid::new_v4());
        let wide_name: Vec<u16> = name.encode_utf16().chain(Some(0)).collect();
        let command: Vec<u16> = "nowly-test.exe --background"
            .encode_utf16()
            .chain(Some(0))
            .collect();
        unsafe {
            RegSetKeyValueW(
                HKEY_CURRENT_USER,
                w!("SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run"),
                PCWSTR(wide_name.as_ptr()),
                REG_SZ.0,
                Some(command.as_ptr().cast()),
                (command.len() * std::mem::size_of::<u16>()) as u32,
            )
            .ok()
            .unwrap();
        }
        let result = disable_value(&name);
        let removal_status = unsafe {
            RegDeleteKeyValueW(
                HKEY_CURRENT_USER,
                w!("SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run"),
                PCWSTR(wide_name.as_ptr()),
            )
        };
        assert!(result.is_ok());
        assert_eq!(removal_status, ERROR_FILE_NOT_FOUND);
        assert!(disable_value(&name).is_ok());
    }

    #[test]
    fn missing_startup_key_or_value_is_already_disabled() {
        assert!(deletion_result(ERROR_FILE_NOT_FOUND).is_ok());
    }

    #[test]
    fn successful_deletion_succeeds() {
        assert!(deletion_result(ERROR_SUCCESS).is_ok());
    }

    #[test]
    fn permission_errors_are_not_silenced() {
        assert_eq!(
            deletion_result(ERROR_ACCESS_DENIED).unwrap_err().code(),
            ERROR_ACCESS_DENIED.to_hresult()
        );
    }
}
