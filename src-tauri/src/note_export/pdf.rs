//! An isolated, hidden print surface; never navigate the user's main window.
use crate::error::CommandError;

pub const MAX_HTML_BYTES: usize = 64 * 1024 * 1024;

fn cleanup_directory(path: &std::path::Path, timeout: std::time::Duration) -> std::io::Result<()> {
    let started = std::time::Instant::now();
    loop {
        match std::fs::remove_dir_all(path) {
            Ok(()) => return Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound && !path.exists() => {
                return Ok(())
            }
            Err(error) => {
                let remaining = timeout.saturating_sub(started.elapsed());
                if remaining.is_zero() {
                    return Err(error);
                }
                std::thread::sleep(remaining.min(std::time::Duration::from_millis(100)));
            }
        }
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::{os::windows::fs::OpenOptionsExt, time::Duration};

    #[test]
    fn cleanup_retries_until_the_print_handle_is_released() {
        let directory =
            std::env::temp_dir().join(format!("nowly-export-lock-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&directory).unwrap();
        let file = std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .share_mode(0)
            .open(directory.join("document.pdf"))
            .unwrap();
        let release = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(150));
            drop(file);
        });
        let result = cleanup_directory(&directory, Duration::from_secs(2));
        release.join().unwrap();
        let _ = std::fs::remove_dir_all(&directory);
        assert!(result.is_ok(), "{result:?}");
    }

    #[test]
    fn cleanup_reports_a_persistent_lock_and_can_be_retried() {
        let directory =
            std::env::temp_dir().join(format!("nowly-export-lock-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&directory).unwrap();
        let file = std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .share_mode(0)
            .open(directory.join("document.pdf"))
            .unwrap();
        assert!(cleanup_directory(&directory, Duration::ZERO).is_err());
        drop(file);
        assert!(cleanup_directory(&directory, Duration::from_secs(1)).is_ok());
        assert!(!directory.exists());
        assert!(cleanup_directory(&directory, Duration::ZERO).is_ok());
    }
}

#[cfg(windows)]
pub fn render(app: &tauri::AppHandle, html: &str) -> Result<Vec<u8>, CommandError> {
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    };
    use std::time::Duration;
    use tauri::{webview::PageLoadEvent, Manager, WebviewUrl, WebviewWindowBuilder};
    if html.is_empty() || html.len() > MAX_HTML_BYTES {
        return Err(CommandError::validation(
            "export",
            "PDF content is empty or too large.",
        ));
    }
    let directory = app
        .path()
        .app_cache_dir()
        .map_err(CommandError::system)?
        .join(format!("note-export-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&directory).map_err(CommandError::system)?;
    struct TempDirectory(Option<std::path::PathBuf>);
    impl Drop for TempDirectory {
        fn drop(&mut self) {
            if let Some(path) = self.0.take() {
                if let Err(error) = cleanup_directory(&path, Duration::from_secs(5)) {
                    eprintln!("PDF export temporary-file cleanup failed: {error}");
                }
            }
        }
    }
    let mut temporary = TempDirectory(Some(directory.clone()));
    let source = directory.join("document.html");
    let output = directory.join("document.pdf");
    // The native boundary enforces CSP before any caller-provided markup. A
    // caller cannot relax this policy with a second CSP inside its document.
    let locked = format!("<!doctype html><meta charset=\"utf-8\"><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'\">{html}");
    std::fs::write(&source, locked.as_bytes()).map_err(CommandError::system)?;
    let url = tauri::Url::from_file_path(&source)
        .map_err(|_| CommandError::system("Invalid print document path"))?;
    let allowed = url.clone();
    let loaded = url.clone();
    let (tx, rx) = mpsc::channel::<Result<(), String>>();
    let started = Arc::new(AtomicBool::new(false));
    let print_output = output.clone();
    let window = WebviewWindowBuilder::new(
        app,
        format!("note-export-{}", uuid::Uuid::new_v4()),
        WebviewUrl::External(url),
    )
    .title("Nowly PDF export")
    .visible(false)
    .focused(false)
    .skip_taskbar(true)
    .inner_size(794.0, 1123.0)
    .on_navigation(move |target| target == &allowed)
    .on_page_load(move |window, payload| {
        if payload.event() != PageLoadEvent::Finished
            || payload.url() != &loaded
            || started.swap(true, Ordering::SeqCst)
        {
            return;
        }
        let completed = tx.clone();
        let failed = tx.clone();
        let target = print_output.clone();
        if let Err(error) = window.with_webview(move |webview| {
            let error_sender = completed.clone();
            let result = unsafe { start_print(webview, &target, completed) };
            if let Err(error) = result {
                let _ = error_sender.send(Err(error.to_string()));
            }
        }) {
            let _ = failed.send(Err(error.to_string()));
        }
    })
    .build()
    .map_err(CommandError::system)?;
    // Read before giving cleanup ownership to the destruction callback.
    let result = (|| {
        rx.recv_timeout(Duration::from_secs(90))
            .map_err(CommandError::system)?
            .map_err(CommandError::system)?;
        let length = std::fs::metadata(&output)
            .map_err(CommandError::system)?
            .len();
        if length > super::MAX_EXPORT_BYTES as u64 {
            return Err(CommandError::system("PDF exceeds export limit"));
        }
        let bytes = std::fs::read(&output).map_err(CommandError::system)?;
        if !bytes.starts_with(b"%PDF-") {
            return Err(CommandError::system("Invalid generated PDF"));
        }
        Ok(bytes)
    })();
    let pending_cleanup = Arc::new(Mutex::new(None::<std::path::PathBuf>));
    let callback_cleanup = pending_cleanup.clone();
    let (cleanup_tx, cleanup_rx) = mpsc::channel();
    window.on_window_event(move |event| {
        if !matches!(event, tauri::WindowEvent::Destroyed) {
            return;
        }
        let Some(path) = callback_cleanup.lock().unwrap().take() else {
            return;
        };
        let completed = cleanup_tx.clone();
        // The event runs on the UI thread before WebView2 is fully released.
        // Retry off-thread so releasing its file handles can make progress.
        std::thread::spawn(move || {
            let cleaned = cleanup_directory(&path, Duration::from_secs(30));
            if let Err(error) = &cleaned {
                eprintln!("PDF export temporary-file cleanup failed: {error}");
            }
            let _ = completed.send(cleaned);
        });
    });
    *pending_cleanup.lock().unwrap() = temporary.0.take();
    if let Err(error) = window.destroy() {
        // A failed enqueue leaves cleanup with the local guard. If destruction
        // already ran, its worker remains the sole owner instead.
        temporary.0 = pending_cleanup.lock().unwrap().take();
        return Err(CommandError::system(error));
    }
    // destroy() only enqueues an event. Keep callback ownership on timeout, so
    // late destruction still cleans up even after this command returns.
    cleanup_rx
        .recv_timeout(Duration::from_secs(5))
        .map_err(|error| {
            CommandError::system(format!(
                "PDF temporary-file cleanup was not confirmed: {error}"
            ))
        })?
        .map_err(|error| {
            CommandError::system(format!("PDF temporary-file cleanup failed: {error}"))
        })?;
    result
}

#[cfg(windows)]
unsafe fn start_print(
    webview: tauri::webview::PlatformWebview,
    target: &std::path::Path,
    completed: std::sync::mpsc::Sender<Result<(), String>>,
) -> windows::core::Result<()> {
    use webview2_com::{
        Microsoft::Web::WebView2::Win32::{ICoreWebView2Environment6, ICoreWebView2_7},
        PrintToPdfCompletedHandler,
    };
    use windows::core::{Interface, HSTRING};
    let core = webview.controller().CoreWebView2()?;
    // The page has no scripts under CSP; this also prevents later script use.
    core.Settings()?.SetIsScriptEnabled(false)?;
    let environment = webview.environment().cast::<ICoreWebView2Environment6>()?;
    let settings = environment.CreatePrintSettings()?;
    settings.SetShouldPrintBackgrounds(true)?;
    settings.SetShouldPrintHeaderAndFooter(false)?;
    settings.SetPageWidth(8.2677165354)?;
    settings.SetPageHeight(11.6929133858)?;
    let callback = PrintToPdfCompletedHandler::create(Box::new(move |result, successful| {
        let value = result.map_err(|error| error.to_string()).and_then(|_| {
            if successful {
                Ok(())
            } else {
                Err("WebView2 could not print the document".into())
            }
        });
        let _ = completed.send(value);
        Ok(())
    }));
    core.cast::<ICoreWebView2_7>()?.PrintToPdf(
        &HSTRING::from(target.as_os_str()),
        &settings,
        &callback,
    )?;
    Ok(())
}

#[cfg(not(windows))]
pub fn render(_app: &tauri::AppHandle, _html: &str) -> Result<Vec<u8>, CommandError> {
    Err(CommandError::reported("PDF export requires Windows."))
}
