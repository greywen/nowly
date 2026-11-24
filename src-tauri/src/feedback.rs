use crate::error::CommandError;

// Feedback / wishlist entry.
//
// Rather than creating GitHub issues programmatically (which is unreliable in
// some regions and would require an embedded token in a public binary), the
// dialog simply shows how to reach the project: the GitHub repository and a
// contact email, plus a suggested format. This layer only needs to open those
// external targets — an https link or a mailto address — in the user's default
// handler when they click them.

// Open an external target in the user's default handler. Only https and mailto
// are allowed so this can never be coerced into launching a local file or an
// arbitrary protocol handler.
fn is_allowed_target(target: &str) -> bool {
    target.starts_with("https://") || target.starts_with("mailto:")
}

#[tauri::command]
pub fn open_external(target: String) -> Result<(), CommandError> {
    if !is_allowed_target(&target) {
        return Err(CommandError::validation(
            "target",
            "仅允许打开 https 链接或邮件地址。",
        ));
    }
    open_target(&target)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreOpenResult {
    opened_in_browser: bool,
}

#[tauri::command]
pub async fn open_store_page() -> Result<StoreOpenResult, CommandError> {
    tauri::async_runtime::spawn_blocking(|| {
        let product_id = crate::package::update_product_id().map_err(CommandError::system)?;
        let website = crate::package_policy::store_url(Some(&product_id))
            .ok_or_else(|| CommandError::system("invalid Store product ID"))?;
        let target = format!("ms-windows-store://pdp/?ProductId={product_id}");
        match open_target(&target) {
            Ok(()) => Ok(StoreOpenResult {
                opened_in_browser: false,
            }),
            Err(error) => {
                eprintln!("Store activation failed; trying product website: {error:?}");
                open_target(&website)?;
                Ok(StoreOpenResult {
                    opened_in_browser: true,
                })
            }
        }
    })
    .await
    .map_err(CommandError::system)?
}

#[cfg(windows)]
pub(crate) fn open_target(target: &str) -> Result<(), CommandError> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    fn to_wide(value: &str) -> Vec<u16> {
        std::ffi::OsStr::new(value)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    let operation = to_wide("open");
    let file = to_wide(target);
    // SAFETY: both pointers reference null-terminated UTF-16 buffers that
    // outlive the call. ShellExecuteW does not retain them past return.
    let result = unsafe {
        ShellExecuteW(
            None,
            PCWSTR(operation.as_ptr()),
            PCWSTR(file.as_ptr()),
            PCWSTR::null(),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };
    // ShellExecuteW returns a value greater than 32 on success.
    if result.0 as usize > 32 {
        Ok(())
    } else {
        Err(CommandError::system("ShellExecuteW failed to open target"))
    }
}

#[cfg(not(windows))]
pub(crate) fn open_target(_target: &str) -> Result<(), CommandError> {
    Err(CommandError::system(
        "opening external targets is only supported on Windows",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_https_and_mailto() {
        assert!(is_allowed_target("https://github.com/greywen/nowly"));
        assert!(is_allowed_target("mailto:gray.wen@outlook.com"));
    }

    #[test]
    fn rejects_other_schemes() {
        assert!(!is_allowed_target("http://example.com"));
        assert!(!is_allowed_target("file:///etc/passwd"));
        assert!(!is_allowed_target("javascript:alert(1)"));
        assert!(!is_allowed_target("ftp://example.com"));
    }
}
