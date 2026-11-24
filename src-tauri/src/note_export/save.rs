use crate::error::CommandError;
use std::path::PathBuf;

/// A dedicated STA keeps the OS dialog off Tauri's event loop and avoids COM
/// apartment conflicts with its worker pool.
#[cfg(windows)]
pub fn choose_path(name: String, owner: isize) -> Result<Option<PathBuf>, CommandError> {
    std::thread::spawn(move || unsafe { dialog(&name, owner) })
        .join()
        .map_err(|_| CommandError::system("Save dialog thread failed"))?
        .map_err(CommandError::system)
}

#[cfg(windows)]
unsafe fn dialog(name: &str, owner: isize) -> windows::core::Result<Option<PathBuf>> {
    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::Foundation::{ERROR_CANCELLED, HWND};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_INPROC_SERVER,
        COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::Shell::{
        Common::COMDLG_FILTERSPEC, FileSaveDialog, IFileSaveDialog, FOS_FORCEFILESYSTEM,
        FOS_NOCHANGEDIR, FOS_OVERWRITEPROMPT, FOS_STRICTFILETYPES, SIGDN_FILESYSPATH,
    };
    CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok()?;
    struct Apartment;
    impl Drop for Apartment {
        fn drop(&mut self) {
            unsafe {
                CoUninitialize();
            }
        }
    }
    let _apartment = Apartment;
    let dialog: IFileSaveDialog = CoCreateInstance(&FileSaveDialog, None, CLSCTX_INPROC_SERVER)?;
    let extension = name.rsplit('.').next().unwrap_or("zip");
    let label = HSTRING::from(match extension {
        "md" => "Markdown",
        _ => "ZIP",
    });
    let pattern = HSTRING::from(format!("*.{extension}"));
    dialog.SetFileTypes(&[COMDLG_FILTERSPEC {
        pszName: PCWSTR(label.as_ptr()),
        pszSpec: PCWSTR(pattern.as_ptr()),
    }])?;
    dialog.SetFileTypeIndex(1)?;
    dialog.SetDefaultExtension(&HSTRING::from(extension))?;
    dialog.SetFileName(&HSTRING::from(name))?;
    dialog.SetOptions(
        dialog.GetOptions()?
            | FOS_FORCEFILESYSTEM
            | FOS_NOCHANGEDIR
            | FOS_OVERWRITEPROMPT
            | FOS_STRICTFILETYPES,
    )?;
    if let Err(error) = dialog.Show(Some(HWND(owner as *mut _))) {
        if error.code() == windows::core::HRESULT::from_win32(ERROR_CANCELLED.0) {
            return Ok(None);
        }
        return Err(error);
    }
    let raw = dialog.GetResult()?.GetDisplayName(SIGDN_FILESYSPATH)?;
    let path = raw.to_string();
    CoTaskMemFree(Some(raw.0.cast()));
    Ok(Some(PathBuf::from(path?)))
}

#[cfg(not(windows))]
pub fn choose_path(_name: String, _owner: isize) -> Result<Option<PathBuf>, CommandError> {
    Err(CommandError::reported("Note export requires Windows."))
}
