pub mod commands;
pub mod protocol;
pub mod store;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod recovery_tests;
use tauri::{Emitter, Manager};
pub struct HistoryState(pub store::HistoryStore);
/// AppDb must be managed and migrations completed first. No alternate archive location.
pub fn setup<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<(), crate::error::CommandError> {
    let pictures = app
        .path()
        .picture_dir()
        .map_err(|_| crate::error::CommandError::reported("无法定位系统图片文件夹。"))?;
    let cache = app
        .path()
        .app_cache_dir()
        .map_err(|_| crate::error::CommandError::reported("无法定位缩略图缓存。"))?;
    let store = store::HistoryStore::new(
        pictures.join("Nowly").join("Screenshots"),
        cache.join("screenshot-thumbnails"),
    );
    // Failed deletion remains retryable; individual failures must not prevent startup.
    if store.recover(&app.state::<crate::db::AppDb>().0).is_err() {
        eprintln!("screenshot history recovery incomplete");
    }
    app.manage(HistoryState(store));
    let _ = app.emit("screenshot-history-changed", ());
    Ok(())
}
pub(crate) fn archive<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    session: u64,
    version: u64,
    image: &crate::screen_capture::output::EncodedImage,
) -> Result<String, crate::error::CommandError> {
    let state = app
        .try_state::<HistoryState>()
        .ok_or_else(|| crate::error::CommandError::reported("截图历史尚不可用，请重试。"))?;
    let id = state
        .0
        .archive(&app.state::<crate::db::AppDb>().0, session, version, image)
        .map_err(|_| {
            crate::error::CommandError::reported("无法保存截图，选区和标注已保留，请重试。")
        })?;
    let _ = app.emit("screenshot-history-changed", ());
    Ok(id)
}

pub fn migrate(tx: &rusqlite::Transaction<'_>) -> rusqlite::Result<()> {
    tx.execute_batch("CREATE TABLE screenshot_history(id TEXT PRIMARY KEY, capture_session_id INTEGER NOT NULL, document_version INTEGER NOT NULL, export_fingerprint TEXT NOT NULL, file_name TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, byte_size INTEGER NOT NULL, state TEXT NOT NULL CHECK(state IN ('pending','ready','deleting'))); CREATE INDEX screenshot_history_page ON screenshot_history(state,created_at DESC,id DESC);")
}
