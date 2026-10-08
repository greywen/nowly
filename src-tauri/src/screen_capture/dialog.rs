//! The native Save As dialog.
//!
//! §8.2 requires the system dialog rather than an in-app file picker, so the user
//! gets the shell's own navigation, overwrite prompt and permission handling. That
//! means `IFileSaveDialog`, which is COM.
//!
//! This module is a thin shim on purpose: everything that can be decided without a
//! dialog lives in `save.rs` and is tested there. What remains here cannot be unit
//! tested, because it blocks on user input.

#![cfg(windows)]

use std::path::PathBuf;

use windows::core::{Interface, HSTRING, PCWSTR};
use windows::Win32::Foundation::HWND;
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
    COINIT_APARTMENTTHREADED,
};
use windows::Win32::UI::Shell::Common::COMDLG_FILTERSPEC;
use windows::Win32::UI::Shell::{FileSaveDialog, IFileSaveDialog, SIGDN_FILESYSPATH};

/// Shows the dialog and returns the chosen path, or `None` if the user cancelled.
///
/// `owner` makes the dialog modal to the capture window, so it cannot end up behind
/// it while the overlay is topmost.
pub(crate) fn choose_png_path(
    owner: HWND,
    suggested_name: &str,
) -> Result<Option<PathBuf>, String> {
    // The dialog needs an apartment-threaded COM context. `CoInitializeEx` returning
    // `RPC_E_CHANGED_MODE` means the thread is already initialised differently, which
    // is not something to paper over: the dialog would misbehave.
    let initialised = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
    if initialised.is_err() {
        return Err(format!("COM initialisation failed: {initialised:?}"));
    }
    // Balanced on every exit path below via this guard.
    let _com = ComGuard;

    unsafe {
        let dialog: IFileSaveDialog = CoCreateInstance(&FileSaveDialog, None, CLSCTX_INPROC_SERVER)
            .map_err(|error| format!("the dialog could not be created: {error}"))?;

        let png = HSTRING::from("PNG 图片");
        let pattern = HSTRING::from("*.png");
        let filters = [COMDLG_FILTERSPEC {
            pszName: PCWSTR(png.as_ptr()),
            pszSpec: PCWSTR(pattern.as_ptr()),
        }];
        dialog
            .SetFileTypes(&filters)
            .map_err(|error| format!("the file type could not be set: {error}"))?;
        // So a name typed without an extension still saves a .png.
        dialog
            .SetDefaultExtension(&HSTRING::from("png"))
            .map_err(|error| format!("the default extension could not be set: {error}"))?;
        dialog
            .SetFileName(&HSTRING::from(suggested_name))
            .map_err(|error| format!("the file name could not be set: {error}"))?;

        // A cancel is a normal outcome, not an error: the shell reports it as
        // ERROR_CANCELLED wrapped in an HRESULT.
        if dialog.Show(Some(owner)).is_err() {
            return Ok(None);
        }

        let item = dialog
            .GetResult()
            .map_err(|error| format!("the chosen file could not be read: {error}"))?;
        let raw = item
            .GetDisplayName(SIGDN_FILESYSPATH)
            .map_err(|error| format!("the chosen path could not be read: {error}"))?;
        let path = raw
            .to_string()
            .map_err(|error| format!("the chosen path is not valid text: {error}"))?;
        // The shell allocated this string, so it has to be freed through CoTaskMemFree.
        windows::Win32::System::Com::CoTaskMemFree(Some(raw.0 as *const _));

        Ok(Some(PathBuf::from(path)))
    }
}

/// Uninitialises COM when the dialog call returns, however it returns.
struct ComGuard;

impl Drop for ComGuard {
    fn drop(&mut self) {
        unsafe { CoUninitialize() };
    }
}

/// Keeps `Interface` in use on the import list even though the cast is implicit.
#[allow(dead_code)]
fn _interface_in_use(dialog: &IFileSaveDialog) -> *mut std::ffi::c_void {
    dialog.as_raw()
}
