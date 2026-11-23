//! Notes export is a read-only operation; no database write is involved.
use crate::error::CommandError;
use std::io::Write;
use std::path::Path;

#[path = "note_export/pdf.rs"]
pub mod pdf;
#[path = "note_export/save.rs"]
mod save;

pub const MAX_EXPORT_BYTES: usize = 256 * 1024 * 1024;

pub fn validate_export(name: &str, bytes: &[u8]) -> Result<(), CommandError> {
    let stem = name
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    let reserved = ["CON", "PRN", "AUX", "NUL"].contains(&stem.as_str())
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && matches!(stem.as_bytes()[3], b'1'..=b'9'));
    let invalid = name.is_empty()
        || name.len() > 512
        || name.starts_with('.')
        || name.ends_with(['.', ' '])
        || reserved
        || name
            .chars()
            .any(|c| c.is_control() || "<>:\"/\\|?*".contains(c));
    let content_valid = match Path::new(name).extension().and_then(|x| x.to_str()) {
        Some("md") => std::str::from_utf8(bytes).is_ok(),
        Some("pdf") => bytes.starts_with(b"%PDF-"),
        Some("zip") => bytes.starts_with(b"PK\x03\x04"),
        _ => false,
    };
    if invalid || !content_valid || bytes.is_empty() || bytes.len() > MAX_EXPORT_BYTES {
        return Err(CommandError::validation("export", "Invalid note export."));
    }
    Ok(())
}

fn identity(path: &Path) -> std::io::Result<Option<(u64, Option<std::time::SystemTime>)>> {
    match std::fs::metadata(path) {
        Ok(meta) if meta.is_file() => Ok(Some((meta.len(), meta.modified().ok()))),
        Ok(_) => Err(std::io::Error::other("Export destination is not a file")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

pub fn write_atomic(target: &Path, bytes: &[u8]) -> Result<(), CommandError> {
    let previous = identity(target).map_err(CommandError::system)?;
    let directory = target
        .parent()
        .ok_or_else(|| CommandError::system("No export directory"))?;
    let temporary = directory.join(format!(".nowly-export-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut file = std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        if identity(target)? != previous {
            return Err(std::io::Error::other("Export destination changed"));
        }
        std::fs::rename(&temporary, target)
    })();
    // This UUID path is created exclusively by this operation, never a user file.
    let _ = std::fs::remove_file(&temporary);
    result.map_err(CommandError::system)
}

fn require_main(label: &str) -> Result<(), CommandError> {
    if label != "main" {
        return Err(CommandError::reported("This window cannot export notes."));
    }
    Ok(())
}

#[tauri::command(async)]
pub fn render_note_pdf(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    html: String,
) -> Result<tauri::ipc::Response, CommandError> {
    require_main(window.label())?;
    pdf::render(&app, &html).map(tauri::ipc::Response::new)
}

#[tauri::command(async)]
pub fn save_note_export(
    window: tauri::WebviewWindow,
    request: tauri::ipc::Request<'_>,
) -> Result<bool, CommandError> {
    require_main(window.label())?;
    let encoded = request
        .headers()
        .get("x-export-name")
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| CommandError::validation("export", "Missing export filename."))?;
    let name = percent_encoding::percent_decode_str(encoded)
        .decode_utf8()
        .map_err(CommandError::system)?
        .into_owned();
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(CommandError::validation(
            "export",
            "Expected binary export data.",
        ));
    };
    validate_export(&name, bytes)?;
    #[cfg(windows)]
    let owner = window.hwnd().map_err(CommandError::system)?.0 as isize;
    #[cfg(not(windows))]
    let owner = 0;
    let target = save::choose_path(name, owner)?;
    let Some(target) = target else {
        return Ok(false);
    };
    write_atomic(&target, bytes)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_portable_document_names_and_matching_signatures() {
        assert!(validate_export("中文笔记.md", "中文".as_bytes()).is_ok());
        assert!(validate_export("中文.pdf", b"%PDF-1.7\n").is_ok());
        assert!(validate_export("Notes.zip", b"PK\x03\x04").is_ok());
        for name in [
            "../x.md", "a\\b.md", "C:x.md", "note.exe", "CON.md", "x.md.", "x\n.md", "",
        ] {
            assert!(validate_export(name, b"text").is_err(), "{name}");
        }
        assert!(validate_export("x.pdf", b"not pdf").is_err());
        assert!(validate_export("x.zip", b"not zip").is_err());
        assert!(validate_export("x.md", &[0xff]).is_err());
    }

    #[test]
    fn only_main_window_may_export() {
        assert!(require_main("main").is_ok());
        for label in ["quick-create", "quick-panel-handle", "note-export-123", ""] {
            assert!(require_main(label).is_err());
        }
    }

    #[test]
    fn writes_and_replaces_only_the_selected_file_without_staging_residue() {
        let dir = std::env::temp_dir().join(format!("nowly-export-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&dir).unwrap();
        let target = dir.join("note.md");
        std::fs::write(&target, "old").unwrap();
        std::fs::write(dir.join("keep.md"), "keep").unwrap();
        write_atomic(&target, "中文新内容".as_bytes()).unwrap();
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "中文新内容");
        assert_eq!(
            std::fs::read_to_string(dir.join("keep.md")).unwrap(),
            "keep"
        );
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 2);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
