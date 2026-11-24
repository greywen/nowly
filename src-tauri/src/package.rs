//! Windows package identity is detected at runtime, independently of the build channel.
#[cfg(windows)]
pub fn aumid() -> Result<Option<String>, String> {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::{APPMODEL_ERROR_NO_PACKAGE, ERROR_INSUFFICIENT_BUFFER};
    use windows::Win32::Storage::Packaging::Appx::{
        GetCurrentApplicationUserModelId, GetCurrentPackageFullName,
    };
    let mut length = 0;
    let status = unsafe { GetCurrentPackageFullName(&mut length, None) };
    if status == APPMODEL_ERROR_NO_PACKAGE {
        return Ok(None);
    }
    if status != ERROR_INSUFFICIENT_BUFFER {
        return Err(format!("cannot query package identity: {status:?}"));
    }
    length = 0;
    let status = unsafe { GetCurrentApplicationUserModelId(&mut length, None) };
    if status != ERROR_INSUFFICIENT_BUFFER {
        return Err(format!(
            "cannot query packaged application identity: {status:?}"
        ));
    }
    let mut buffer = vec![0u16; length as usize];
    unsafe { GetCurrentApplicationUserModelId(&mut length, Some(PWSTR(buffer.as_mut_ptr()))) }
        .ok()
        .map_err(|e| e.to_string())?;
    Ok(Some(String::from_utf16_lossy(
        &buffer[..length.saturating_sub(1) as usize],
    )))
}

#[cfg(not(windows))]
pub fn aumid() -> Result<Option<String>, String> {
    Ok(None)
}

pub fn store_product_id() -> Result<String, String> {
    let path = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .with_file_name("nowly-store.json");
    let text =
        std::fs::read_to_string(path).map_err(|e| format!("cannot read Store metadata: {e}"))?;
    let value: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let id = value["productId"]
        .as_str()
        .ok_or("missing Store product ID")?;
    if id.is_empty() || !id.bytes().all(|c| c.is_ascii_alphanumeric()) {
        return Err("invalid Store product ID".to_owned());
    }

    Ok(id.to_owned())
}

pub fn update_product_id() -> Result<String, String> {
    if aumid()?.is_some() {
        store_product_id()
    } else {
        Ok(crate::package_policy::STORE_PRODUCT_ID.to_owned())
    }
}

#[cfg(windows)]
pub struct WinrtApartment;

#[cfg(windows)]
impl WinrtApartment {
    pub fn initialize() -> windows::core::Result<Self> {
        use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};
        unsafe { RoInitialize(RO_INIT_MULTITHREADED)? };
        Ok(Self)
    }
}

#[cfg(windows)]
impl Drop for WinrtApartment {
    fn drop(&mut self) {
        unsafe { windows::Win32::System::WinRT::RoUninitialize() };
    }
}

#[cfg(windows)]
pub fn startup_state(enable: Option<bool>) -> Result<bool, String> {
    use windows::core::HSTRING;
    use windows::ApplicationModel::{StartupTask, StartupTaskState};
    let run = || -> windows::core::Result<bool> {
        let task = StartupTask::GetAsync(&HSTRING::from("NowlyStartup"))?.get()?;
        if enable == Some(false) {
            task.Disable()?;
        }
        let state = if enable == Some(true) {
            task.RequestEnableAsync()?.get()?
        } else {
            task.State()?
        };
        if enable == Some(true) && state != StartupTaskState::Enabled {
            return Err(windows::core::Error::new(
                windows::core::HRESULT(0x80070005u32 as i32),
                "Windows has disabled Nowly startup. Enable it in Settings > Apps > Startup.",
            ));
        }
        Ok(state == StartupTaskState::Enabled)
    };
    run().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    #[test]
    fn unpackaged_test_process_has_no_package_identity() {
        assert_eq!(super::aumid().unwrap(), None);
    }
}
