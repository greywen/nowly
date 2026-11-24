use crate::error::CommandError;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppVersionInfo {
    pub current_version: String,
    pub distribution: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub status: &'static str,
    pub update_available: bool,
}

fn local_version() -> Result<AppVersionInfo, CommandError> {
    if crate::package::aumid()
        .map_err(CommandError::system)?
        .is_some()
    {
        #[cfg(windows)]
        {
            let _apartment =
                crate::package::WinrtApartment::initialize().map_err(CommandError::system)?;
            let version = windows::ApplicationModel::Package::Current()
                .and_then(|package| package.Id())
                .and_then(|id| id.Version())
                .map_err(CommandError::system)?;
            return Ok(AppVersionInfo {
                current_version: format!(
                    "{}.{}.{}.{}",
                    version.Major, version.Minor, version.Build, version.Revision
                ),
                distribution: "msix",
            });
        }
    }
    Ok(AppVersionInfo {
        current_version: env!("CARGO_PKG_VERSION").to_owned(),
        distribution: "unpackaged",
    })
}

#[tauri::command]
pub async fn get_app_version_info() -> Result<AppVersionInfo, CommandError> {
    tauri::async_runtime::spawn_blocking(local_version)
        .await
        .map_err(CommandError::system)?
}

#[cfg(windows)]
async fn store_check(window: tauri::WebviewWindow) -> Result<UpdateInfo, CommandError> {
    use std::time::Duration;
    use windows::core::Interface;
    use windows::ApplicationModel::Package;
    use windows::Services::Store::StoreContext;
    use windows::Win32::UI::Shell::IInitializeWithWindow;

    static QUERY: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    let _query = QUERY.try_lock().map_err(CommandError::system)?;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(15);
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let owner = window.clone();
    window
        .run_on_main_thread(move || {
            if sender.is_closed() {
                return;
            }
            let start = || -> windows::core::Result<_> {
                let family = Package::Current()?.Id()?.FamilyName()?;
                let context = StoreContext::GetDefault()?;
                let hwnd = owner.hwnd().map_err(|error| {
                    windows::core::Error::new(
                        windows::core::HRESULT(0x80004005u32 as i32),
                        error.to_string(),
                    )
                })?;
                unsafe { context.cast::<IInitializeWithWindow>()?.Initialize(hwnd)? };
                Ok((context.GetAppAndOptionalStorePackageUpdatesAsync()?, family))
            };
            if let Err(Ok((operation, _))) = sender.send(start()) {
                if let Err(error) = operation.Cancel() {
                    eprintln!("Store cancellation failed: {error}");
                }
            }
        })
        .map_err(CommandError::system)?;

    let (operation, family) = tokio::time::timeout_at(deadline, receiver)
        .await
        .map_err(CommandError::system)?
        .map_err(CommandError::system)?
        .map_err(CommandError::system)?;
    let updates = match tokio::time::timeout_at(deadline, operation.clone()).await {
        Ok(result) => result.map_err(CommandError::system)?,
        Err(error) => {
            operation.Cancel().map_err(CommandError::system)?;
            return Err(CommandError::system(error));
        }
    };
    let mut available = false;
    for update in updates {
        let package = update.Package().map_err(CommandError::system)?;
        let package_family = package
            .Id()
            .and_then(|id| id.FamilyName())
            .map_err(CommandError::system)?;
        if crate::package_policy::is_main_update(
            &family.to_string(),
            &package_family.to_string(),
            package.IsResourcePackage().map_err(CommandError::system)?,
            package.IsFramework().map_err(CommandError::system)?,
        ) {
            available = true;
            break;
        }
    }
    Ok(UpdateInfo {
        status: if available { "available" } else { "upToDate" },
        update_available: available,
    })
}

#[tauri::command]
pub async fn check_for_update(window: tauri::WebviewWindow) -> Result<UpdateInfo, CommandError> {
    if crate::package::aumid()
        .map_err(CommandError::system)?
        .is_none()
    {
        return Ok(UpdateInfo {
            status: "unsupported",
            update_available: false,
        });
    }
    #[cfg(windows)]
    {
        store_check(window).await
    }
    #[cfg(not(windows))]
    {
        let _ = window;
        Ok(UpdateInfo {
            status: "unsupported",
            update_available: false,
        })
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn unpackaged_version_does_not_require_store_metadata_or_network() {
        let version = super::local_version().unwrap();
        assert_eq!(version.distribution, "unpackaged");
        assert_eq!(version.current_version, env!("CARGO_PKG_VERSION"));
    }
}
