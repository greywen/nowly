//! IPC for voice input. The Bar may read and dismiss the session; settings
//! and model management are limited to the main window.
use super::{
    capture, model,
    session::{Snapshot, Voice},
    settings::{self, VoiceSettings},
};
use crate::{db::AppDb, error::CommandError};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

pub const MODEL_PROGRESS_EVENT: &str = "voice-model-progress";

/// The cancel flag of the model download in progress, if any.
#[derive(Default)]
pub struct ModelDownload(Mutex<Option<Arc<AtomicBool>>>);

fn require(window: &WebviewWindow, bar_allowed: bool) -> Result<(), CommandError> {
    match window.label() {
        "main" => Ok(()),
        "quick-panel-handle" if bar_allowed => Ok(()),
        _ => Err(CommandError::validation("voice", "此操作只允许在 Nowly 窗口中执行。")),
    }
}

fn app_dir(app: &AppHandle) -> Result<std::path::PathBuf, CommandError> {
    app.path().app_data_dir().map_err(CommandError::system)
}

#[tauri::command]
pub fn voice_state(window: WebviewWindow, voice: State<'_, Voice>) -> Result<Snapshot, CommandError> {
    require(&window, true)?;
    Ok(voice.snapshot())
}

/// Ends the result on the Bar, or stops the request in flight.
#[tauri::command]
pub fn voice_dismiss(window: WebviewWindow, voice: State<'_, Voice>) -> Result<(), CommandError> {
    require(&window, true)?;
    voice.dismiss();
    Ok(())
}

pub const OPEN_SETTINGS_EVENT: &str = "voice-open-settings";

/// An error's way out from the Bar: brings the main window up on the
/// 语音输入 group (`voice`) or the model connection (`model`).
#[tauri::command]
pub fn voice_open_settings(window: WebviewWindow, app: AppHandle, section: String) -> Result<(), CommandError> {
    require(&window, true)?;
    if section != "voice" && section != "model" {
        return Err(CommandError::validation("section", "未知的设置分组。"));
    }
    crate::status_island::show_main_window(&app)?
        .emit(OPEN_SETTINGS_EVENT, section)
        .map_err(CommandError::system)
}

#[tauri::command]
pub fn voice_open_microphone_privacy(window: WebviewWindow) -> Result<(), CommandError> {
    require(&window, true)?;
    crate::feedback::open_target("ms-settings:privacy-microphone")
}

#[tauri::command]
pub fn voice_get_settings(window: WebviewWindow, db: State<'_, AppDb>) -> Result<VoiceSettings, CommandError> {
    require(&window, false)?;
    settings::read(&*db.0.lock().map_err(CommandError::database)?)
}

#[tauri::command]
pub fn voice_save_settings(
    window: WebviewWindow,
    db: State<'_, AppDb>,
    voice: State<'_, Voice>,
    settings: VoiceSettings,
) -> Result<VoiceSettings, CommandError> {
    require(&window, false)?;
    let connection = db.0.lock().map_err(CommandError::database)?;
    let taken: Vec<String> = crate::settings::read_app_settings(&connection)
        .map(|app| crate::screenshot_shortcuts::configured_keys(&app).to_vec())
        .map_err(CommandError::database)?
        .into_iter()
        .filter_map(|key| crate::screenshot_shortcuts::normalize(&key).ok())
        .collect();
    let saved = settings::write(&connection, settings, &taken)?;
    drop(connection);
    voice.apply(saved.clone());
    Ok(saved)
}

#[tauri::command]
pub fn voice_input_devices(window: WebviewWindow) -> Result<Vec<String>, CommandError> {
    require(&window, false)?;
    Ok(capture::input_devices())
}

#[tauri::command]
pub fn voice_model_status(window: WebviewWindow, app: AppHandle) -> Result<model::ModelStatus, CommandError> {
    require(&window, false)?;
    Ok(model::status(&app_dir(&app)?))
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    done: u64,
    total: u64,
}

/// Downloads and verifies the model; progress arrives as
/// `voice-model-progress` events on the main window.
#[tauri::command]
pub async fn voice_model_download(
    window: WebviewWindow,
    app: AppHandle,
) -> Result<model::ModelStatus, CommandError> {
    require(&window, false)?;
    let dir = app_dir(&app)?;
    let cancel = {
        let state = app.state::<ModelDownload>();
        let mut current = state.0.lock().map_err(CommandError::system)?;
        if current.is_some() {
            return Err(CommandError::conflict("语音模型正在下载。"));
        }
        let cancel = Arc::new(AtomicBool::new(false));
        *current = Some(cancel.clone());
        cancel
    };
    let worker_app = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        model::download(&dir, &cancel, &mut |done, total| {
            let _ = worker_app.emit_to("main", MODEL_PROGRESS_EVENT, Progress { done, total });
        })
        .map(|()| model::status(&dir))
    })
    .await;
    if let Ok(mut current) = app.state::<ModelDownload>().0.lock() {
        current.take();
    }
    match result.map_err(CommandError::system)? {
        Ok(status) => Ok(status),
        Err(model::DownloadError::Cancelled) => Err(CommandError::conflict("下载已取消。")),
        Err(model::DownloadError::Failed(message)) => Err(CommandError::validation("model", message)),
    }
}

#[tauri::command]
pub fn voice_model_cancel(window: WebviewWindow, state: State<'_, ModelDownload>) -> Result<(), CommandError> {
    require(&window, false)?;
    if let Some(cancel) = state.0.lock().map_err(CommandError::system)?.as_ref() {
        cancel.store(true, Ordering::SeqCst);
    }
    Ok(())
}

#[tauri::command]
pub fn voice_model_delete(
    window: WebviewWindow,
    app: AppHandle,
    voice: State<'_, Voice>,
) -> Result<model::ModelStatus, CommandError> {
    require(&window, false)?;
    if app.state::<ModelDownload>().0.lock().map_err(CommandError::system)?.is_some() {
        return Err(CommandError::conflict("语音模型正在下载。"));
    }
    voice.unload();
    let dir = app_dir(&app)?;
    model::delete(&dir).map_err(|message| CommandError::validation("model", message))?;
    Ok(model::status(&dir))
}
