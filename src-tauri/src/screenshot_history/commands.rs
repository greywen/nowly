use super::{store::Page, HistoryState};
use crate::{
    db::AppDb,
    error::CommandError,
    screen_capture::{
        clipboard::WindowsClipboard,
        output::{ExportKind, ExportToken, ExportTransaction},
    },
};
use tauri::{Emitter, Manager};
fn trusted(label: &str) -> Result<(), CommandError> {
    if matches!(label, "screenshot-history" | "quick-panel-handle") {
        Ok(())
    } else {
        Err(CommandError::reported("该窗口不能操作截图历史。"))
    }
}
pub(crate) fn history_state<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<tauri::State<'_, HistoryState>, CommandError> {
    app.try_state::<HistoryState>()
        .ok_or_else(|| CommandError::reported("截图历史尚不可用，请重试。"))
}
fn failure(_: String) -> CommandError {
    CommandError::reported("无法操作截图历史，请重试。")
}
#[tauri::command(async)]
pub fn list_screenshot_history(
    app: tauri::AppHandle,
    window: tauri::Window,
    cursor: Option<String>,
) -> Result<Page, CommandError> {
    trusted(window.label())?;
    history_state(&app)?
        .0
        .list(&app.state::<AppDb>().0, cursor.as_deref())
        .map_err(failure)
}
#[tauri::command(async)]
pub fn copy_screenshot_history(
    app: tauri::AppHandle,
    window: tauri::Window,
    id: String,
) -> Result<(), CommandError> {
    trusted(window.label())?;
    let image = history_state(&app)?
        .0
        .read_image(&app.state::<AppDb>().0, &id)
        .map_err(failure)?;
    let owner = window
        .hwnd()
        .map_err(|_| CommandError::reported("无法定位截图历史窗口。"))?;
    let mut clipboard = WindowsClipboard::guarded(owner, || true);
    let token = ExportToken {
        session_id: 0,
        version: 0,
    };
    let start = std::time::Instant::now();
    ExportTransaction::new(ExportKind::Clipboard, token)
        .run_clipboard(&mut clipboard, &image, token, std::thread::sleep, || {
            start.elapsed()
        })
        .map_err(|_| CommandError::reported("复制图片失败，请重试。"))
}
/// Caller must show a confirmation dialog before invoking this command.
#[tauri::command(async)]
pub fn delete_screenshot_history(
    app: tauri::AppHandle,
    window: tauri::Window,
    id: String,
) -> Result<(), CommandError> {
    trusted(window.label())?;
    history_state(&app)?
        .0
        .delete(&app.state::<AppDb>().0, &id)
        .map_err(failure)?;
    let _ = app.emit("screenshot-history-changed", ());
    Ok(())
}
#[tauri::command(async)]
pub fn open_screenshot_folder(
    app: tauri::AppHandle,
    window: tauri::Window,
) -> Result<(), CommandError> {
    trusted(window.label())?;
    let state = history_state(&app)?;
    state.0.ensure_archive_dir().map_err(failure)?;
    std::process::Command::new("explorer.exe")
        .arg(state.0.archive_dir())
        .spawn()
        .map_err(|_| CommandError::reported("无法打开截图文件夹。"))?;
    Ok(())
}
