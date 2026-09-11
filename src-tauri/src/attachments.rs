//! Local file store for rich text attachments.
//!
//! Files live on disk under `<app-data>/attachments/`; the `attachments` table
//! records each file's location and metadata. Rich text content refers to them
//! as `attachment:<id>` inside stored Markdown, so the Markdown stays portable
//! and the database stays the authority on where bytes actually are.
//!
//! Ownership is deliberately *not* tracked. A note, event and task can all
//! reference the same file, and content is edited as free text, so a foreign key
//! would be wrong. Instead `collect_garbage` scans the content columns for
//! `attachment:` references and deletes files nothing points at any more.
//!
//! Path safety: an id is only ever accepted if it matches `<32 hex>[.<ext>]`,
//! and paths are always rebuilt by joining that id onto the attachments dir. No
//! caller-supplied path reaches the filesystem, so `../` traversal is
//! impossible by construction rather than by filtering.

use crate::db::AppDb;
use crate::error::CommandError;
use chrono::{SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension, Row, Transaction};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::Manager;
use tauri::State;
use uuid::Uuid;

/// Per-file ceiling, matching the reference compose editor's 1MB limit. Keeps a
/// local-first SQLite database and its backups from being dwarfed by media.
pub const MAX_ATTACHMENT_BYTES: usize = 1024 * 1024;

/// Content columns scanned when reclaiming unreferenced files. `external_events`
/// is intentionally absent: it holds read-only synced data that can never carry
/// an attachment.
const CONTENT_COLUMNS: &[(&str, &str)] = &[
    ("notes", "content"),
    ("events", "note"),
    ("tasks", "description"),
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    /// `<32 hex>[.<ext>]`, used verbatim in Markdown as `attachment:<id>`.
    pub id: String,
    /// Original name as chosen by the user, for display and download.
    pub file_name: String,
    /// Location on disk, relative to the app data directory.
    pub rel_path: String,
    pub byte_size: i64,
    pub mime: String,
    pub created_at: String,
}

pub fn migrate(transaction: &Transaction<'_>) -> rusqlite::Result<()> {
    transaction.execute_batch(
        "CREATE TABLE IF NOT EXISTS attachments (
            id TEXT PRIMARY KEY,
            file_name TEXT NOT NULL,
            rel_path TEXT NOT NULL,
            byte_size INTEGER NOT NULL,
            mime TEXT NOT NULL,
            created_at TEXT NOT NULL
         );",
    )
}

fn timestamp() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn read_attachment_row(row: &Row<'_>) -> rusqlite::Result<Attachment> {
    Ok(Attachment {
        id: row.get(0)?,
        file_name: row.get(1)?,
        rel_path: row.get(2)?,
        byte_size: row.get(3)?,
        mime: row.get(4)?,
        created_at: row.get(5)?,
    })
}

/// Accept an id only in the exact form this module generates. This is the single
/// gate that makes path construction safe, so it rejects anything containing a
/// separator, `..`, or unexpected characters.
pub fn is_valid_id(id: &str) -> bool {
    let (stem, extension) = match id.split_once('.') {
        Some((stem, extension)) => (stem, Some(extension)),
        None => (id, None),
    };
    if stem.len() != 32 || !stem.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return false;
    }
    match extension {
        None => true,
        Some(extension) => {
            !extension.is_empty()
                && extension.len() <= 16
                && extension
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
        }
    }
}

/// Lowercase, sanitised extension of a user-supplied file name, if usable.
fn extension_of(file_name: &str) -> Option<String> {
    let extension = Path::new(file_name)
        .extension()?
        .to_str()?
        .to_ascii_lowercase();
    let usable = !extension.is_empty()
        && extension.len() <= 16
        && extension
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit());
    usable.then_some(extension)
}

/// Best-effort content type from the extension. Kept as a small local table
/// rather than a dependency; unknown types fall back to a generic binary type
/// so the browser never sniffs something surprising out of them.
fn mime_for(extension: Option<&str>) -> &'static str {
    match extension {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("bmp") => "image/bmp",
        Some("pdf") => "application/pdf",
        Some("txt" | "md") => "text/plain",
        Some("csv") => "text/csv",
        Some("json") => "application/json",
        Some("zip") => "application/zip",
        Some("doc" | "docx") => "application/msword",
        Some("xls" | "xlsx") => "application/vnd.ms-excel",
        _ => "application/octet-stream",
    }
}

/// Strip any directory component from a user-supplied name, so the stored
/// display name can never look like a path.
fn clean_file_name(file_name: &str) -> String {
    let base = file_name
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(file_name)
        .trim();
    if base.is_empty() || base == "." || base == ".." {
        "file".to_owned()
    } else {
        base.chars().take(255).collect()
    }
}

pub fn attachments_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("attachments")
}

fn path_for(dir: &Path, id: &str) -> Result<PathBuf, CommandError> {
    if !is_valid_id(id) {
        return Err(CommandError::validation("id", "附件标识无效。"));
    }
    Ok(dir.join(id))
}

/// Write bytes to the attachments dir and record the row. Returns the metadata
/// the UI needs to render the attachment.
pub fn save(
    connection: &Connection,
    dir: &Path,
    file_name: &str,
    bytes: &[u8],
) -> Result<Attachment, CommandError> {
    if bytes.is_empty() {
        return Err(CommandError::validation("file", "文件内容为空。"));
    }
    if bytes.len() > MAX_ATTACHMENT_BYTES {
        return Err(CommandError::validation(
            "file",
            "文件超过 1 MB 上限，请压缩后重试。",
        ));
    }

    let display_name = clean_file_name(file_name);
    let extension = extension_of(&display_name);
    let id = match &extension {
        Some(extension) => format!("{}.{extension}", Uuid::new_v4().simple()),
        None => Uuid::new_v4().simple().to_string(),
    };
    let relative = format!("attachments/{id}");

    std::fs::create_dir_all(dir).map_err(CommandError::system)?;
    let path = path_for(dir, &id)?;
    std::fs::write(&path, bytes).map_err(CommandError::system)?;

    let record = Attachment {
        id,
        file_name: display_name,
        rel_path: relative,
        byte_size: bytes.len() as i64,
        mime: mime_for(extension.as_deref()).to_owned(),
        created_at: timestamp(),
    };

    let inserted = connection.execute(
        "INSERT INTO attachments(id,file_name,rel_path,byte_size,mime,created_at)
         VALUES (?1,?2,?3,?4,?5,?6)",
        params![
            record.id,
            record.file_name,
            record.rel_path,
            record.byte_size,
            record.mime,
            record.created_at
        ],
    );
    if let Err(error) = inserted {
        // Do not leave a file behind that no row describes.
        let _ = std::fs::remove_file(&path);
        return Err(CommandError::database(error));
    }
    Ok(record)
}

/// Read one attachment's bytes. The row is consulted first so a missing record
/// is reported as not found rather than probing the filesystem.
pub fn read(connection: &Connection, dir: &Path, id: &str) -> Result<Vec<u8>, CommandError> {
    let path = path_for(dir, id)?;
    let exists: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM attachments WHERE id=?1)",
            [id],
            |row| row.get(0),
        )
        .map_err(CommandError::database)?;
    if !exists {
        return Err(CommandError::not_found("未找到该附件。"));
    }
    std::fs::read(&path).map_err(|error| {
        // The row exists but the file does not: report it as missing rather than
        // as a generic system failure, so the UI can show a broken attachment.
        if error.kind() == std::io::ErrorKind::NotFound {
            CommandError::not_found("附件文件已丢失。")
        } else {
            CommandError::system(error)
        }
    })
}

/// Extensions Windows would *execute* rather than open. Handing one of these to
/// the shell turns clicking an attachment into running a program, so they are
/// refused.
///
/// A denylist rather than an allowlist: the point of opening with the default
/// handler is that it works for file types this code has never heard of, and an
/// allowlist would reject `.odt`, `.psd`, `.dwg` and every other format nobody
/// thought to enumerate. The risk being closed off is narrow and well known.
///
/// `extension_of` already restricts stored extensions to lowercase ASCII
/// alphanumerics, so entries needing a dash (`appref-ms`) cannot be stored in the
/// first place and are not listed.
const NON_OPENABLE_EXTENSIONS: &[&str] = &[
    "exe", "com", "scr", "pif", "bat", "cmd", "lnk", "ps1", "psm1", "vbs", "vbe", "js", "jse",
    "wsf", "wsh", "msi", "msp", "cpl", "hta", "reg", "jar", "msc", "sct", "inf", "dll",
];

/// Resolve an attachment to a path the OS may be asked to open.
///
/// Split out from `open` so the refusals are testable without launching
/// anything: every branch below is a reason not to call the shell at all.
fn path_to_open(connection: &Connection, dir: &Path, id: &str) -> Result<PathBuf, CommandError> {
    let path = path_for(dir, id)?;

    // The extension is the only thing that decides which program the shell picks,
    // so it is what has to be checked. Taken from the stored id, not from the
    // display name in the row: the id is what is actually on disk, and the two
    // can disagree.
    let extension = id.rsplit_once('.').map(|(_, extension)| extension);
    if let Some(extension) = extension {
        if NON_OPENABLE_EXTENSIONS.contains(&extension) {
            return Err(CommandError::validation(
                "id",
                "为了安全，不能直接打开可执行文件。",
            ));
        }
    } else {
        // With no extension the shell has nothing to associate, and would show its
        // own "open with" chooser. Saying so is more useful than that dialog.
        return Err(CommandError::validation(
            "id",
            "该附件没有文件类型，无法确定用什么程序打开。",
        ));
    }

    let exists: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM attachments WHERE id=?1)",
            [id],
            |row| row.get(0),
        )
        .map_err(CommandError::database)?;
    if !exists {
        return Err(CommandError::not_found("未找到该附件。"));
    }
    // Check the file rather than letting the shell fail: a missing file is a
    // broken attachment, which is worth reporting as such.
    if !path.is_file() {
        return Err(CommandError::not_found("附件文件已丢失。"));
    }
    Ok(path)
}

/// Open one attachment in the user's default application for its type.
///
/// The file is opened where it is stored, so an edit saved from that application
/// lands back in the attachment and the note keeps the newer copy. The trade-off
/// is that the application shows the stored name, which is the attachment id
/// rather than the name the user uploaded.
pub fn open(connection: &Connection, dir: &Path, id: &str) -> Result<(), CommandError> {
    let path = path_to_open(connection, dir, id)?;
    if crate::shell::open_with_default_handler(&path) {
        Ok(())
    } else {
        Err(CommandError::system(
            "无法打开附件，系统中可能没有关联的程序。",
        ))
    }
}

/// Metadata for a set of ids, skipping ids that are invalid or unknown so a
/// stale reference in content cannot fail the whole lookup.
pub fn list(connection: &Connection, ids: &[String]) -> Result<Vec<Attachment>, CommandError> {
    let mut found = Vec::new();
    let mut statement = connection
        .prepare("SELECT id,file_name,rel_path,byte_size,mime,created_at FROM attachments WHERE id=?1")
        .map_err(CommandError::database)?;
    for id in ids {
        if !is_valid_id(id) {
            continue;
        }
        let row = statement
            .query_row([id], read_attachment_row)
            .optional()
            .map_err(CommandError::database)?;
        if let Some(record) = row {
            found.push(record);
        }
    }
    Ok(found)
}

/// Collect every `attachment:<id>` reference appearing in rich text content.
pub fn referenced_ids(connection: &Connection) -> Result<std::collections::HashSet<String>, CommandError> {
    let mut referenced = std::collections::HashSet::new();
    for (table, column) in CONTENT_COLUMNS {
        let mut statement = connection
            .prepare(&format!("SELECT {column} FROM {table}"))
            .map_err(CommandError::database)?;
        let rows = statement
            .query_map([], |row| row.get::<_, Option<String>>(0))
            .map_err(CommandError::database)?;
        for row in rows {
            let Some(content) = row.map_err(CommandError::database)? else {
                continue;
            };
            for id in scan_references(&content) {
                referenced.insert(id);
            }
        }
    }
    Ok(referenced)
}

/// Extract attachment ids from one piece of content. Split out so it can be
/// tested directly against the Markdown forms the editor produces.
pub fn scan_references(content: &str) -> Vec<String> {
    const MARKER: &str = "attachment:";
    let mut found = Vec::new();
    let mut rest = content;
    while let Some(index) = rest.find(MARKER) {
        rest = &rest[index + MARKER.len()..];
        let end = rest
            .find(|character: char| !character.is_ascii_alphanumeric() && character != '.')
            .unwrap_or(rest.len());
        let candidate = &rest[..end];
        if is_valid_id(candidate) {
            found.push(candidate.to_owned());
        }
        rest = &rest[end..];
    }
    found
}

/// Delete files and rows no content references any more. Returns how many
/// attachments were reclaimed.
///
/// Run this only when no editor can be open (app startup): an attachment that
/// has been uploaded but whose dialog has not been saved yet is not referenced
/// by any content row, and would otherwise be collected out from under the user.
pub fn collect_garbage(connection: &Connection, dir: &Path) -> Result<u32, CommandError> {
    let referenced = referenced_ids(connection)?;
    let mut statement = connection
        .prepare("SELECT id FROM attachments")
        .map_err(CommandError::database)?;
    let ids = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(CommandError::database)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(CommandError::database)?;

    let mut removed = 0;
    for id in ids {
        if referenced.contains(&id) {
            continue;
        }
        if let Ok(path) = path_for(dir, &id) {
            // A missing file is not an error here; the row still needs clearing.
            let _ = std::fs::remove_file(path);
        }
        connection
            .execute("DELETE FROM attachments WHERE id=?1", [&id])
            .map_err(CommandError::database)?;
        removed += 1;
    }
    Ok(removed)
}

fn dir_for(app: &tauri::AppHandle) -> Result<PathBuf, CommandError> {
    let app_data_dir = app.path().app_data_dir().map_err(CommandError::system)?;
    Ok(attachments_dir(&app_data_dir))
}

#[tauri::command]
pub fn save_attachment(
    app: tauri::AppHandle,
    db: State<'_, AppDb>,
    file_name: String,
    bytes: Vec<u8>,
) -> Result<Attachment, CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    save(&connection, &dir_for(&app)?, &file_name, &bytes)
}

#[tauri::command]
pub fn read_attachment(
    app: tauri::AppHandle,
    db: State<'_, AppDb>,
    id: String,
) -> Result<Vec<u8>, CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    read(&connection, &dir_for(&app)?, &id)
}

#[tauri::command]
pub fn list_attachments(
    db: State<'_, AppDb>,
    ids: Vec<String>,
) -> Result<Vec<Attachment>, CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    list(&connection, &ids)
}

#[tauri::command]
pub fn open_attachment(
    app: tauri::AppHandle,
    db: State<'_, AppDb>,
    id: String,
) -> Result<(), CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    open(&connection, &dir_for(&app)?, &id)
}

#[tauri::command]
pub fn collect_attachment_garbage(
    app: tauri::AppHandle,
    db: State<'_, AppDb>,
) -> Result<u32, CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    collect_garbage(&connection, &dir_for(&app)?)
}

#[cfg(test)]
mod tests {
    use super::{
        collect_garbage, is_valid_id, list, path_to_open, read, save, scan_references,
        MAX_ATTACHMENT_BYTES,
    };
    use crate::db::migrate;
    use rusqlite::Connection;
    use std::path::PathBuf;

    fn database() -> Connection {
        let mut connection = Connection::open_in_memory().unwrap();
        migrate(&mut connection).unwrap();
        connection
    }

    fn temp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("nowly-attach-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn open_resolves_a_saved_attachment_to_its_stored_path() {
        let connection = database();
        let dir = temp_dir();
        let record = save(&connection, &dir, "季度报告.docx", b"word bytes").unwrap();

        // The file is opened where it is stored, so an edit saved from Word lands
        // back in the attachment instead of in a throwaway copy.
        assert_eq!(
            path_to_open(&connection, &dir, &record.id).unwrap(),
            dir.join(&record.id)
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn open_refuses_executables_rather_than_running_them() {
        let connection = database();
        let dir = temp_dir();
        // `extension_of` accepts any lowercase-alnum extension, so an executable is
        // storable. Handing one to the shell would make clicking an attachment run
        // a program, so opening is refused even though saving is not.
        for name in [
            "setup.exe",
            "run.bat",
            "payload.cmd",
            "link.lnk",
            "script.ps1",
            "x.vbs",
        ] {
            let record = save(&connection, &dir, name, b"x").unwrap();
            let error = path_to_open(&connection, &dir, &record.id).unwrap_err();
            assert_eq!(error.field, Some("id".into()), "{name} should be refused");
            // The bytes stay readable: this blocks launching, not access.
            assert!(read(&connection, &dir, &record.id).is_ok());
        }
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn open_refuses_an_attachment_with_no_extension() {
        let connection = database();
        let dir = temp_dir();
        // Nothing to associate, so the shell would show its own "open with"
        // chooser. Saying why is more useful than that dialog appearing.
        let record = save(&connection, &dir, "README", b"x").unwrap();
        assert!(!record.id.contains('.'));
        assert_eq!(
            path_to_open(&connection, &dir, &record.id)
                .unwrap_err()
                .field,
            Some("id".into())
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn open_reports_unknown_and_missing_attachments_before_calling_the_shell() {
        let connection = database();
        let dir = temp_dir();

        // Well-formed id that was never saved.
        let unknown = format!("{}.docx", "a".repeat(32));
        assert!(path_to_open(&connection, &dir, &unknown).is_err());

        // Row present, file deleted underneath it: a broken attachment rather than
        // a shell failure, so it is caught before the shell is ever called.
        let record = save(&connection, &dir, "a.docx", b"x").unwrap();
        std::fs::remove_file(dir.join(&record.id)).unwrap();
        assert!(path_to_open(&connection, &dir, &record.id).is_err());

        // A malformed id is rejected by the same validation every other command
        // uses, so no traversal reaches the shell.
        assert_eq!(
            path_to_open(&connection, &dir, "../../evil.docx")
                .unwrap_err()
                .field,
            Some("id".into())
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn ids_are_accepted_only_in_the_generated_form() {
        let stem = "0123456789abcdef0123456789abcdef";
        assert!(is_valid_id(stem));
        assert!(is_valid_id(&format!("{stem}.png")));
        // Traversal and separators can never pass, which is what makes joining
        // an id onto the attachments dir safe.
        assert!(!is_valid_id("../secret"));
        assert!(!is_valid_id(&format!("{stem}/../x")));
        assert!(!is_valid_id(&format!("..{stem}")));
        assert!(!is_valid_id(&format!("{stem}.PNG")));
        assert!(!is_valid_id(&format!("{stem}.p g")));
        assert!(!is_valid_id("short.png"));
        assert!(!is_valid_id(""));
        assert!(!is_valid_id(&format!("{stem}.")));
    }

    #[test]
    fn save_writes_the_file_and_records_its_location() {
        let connection = database();
        let dir = temp_dir();
        let record = save(&connection, &dir, "报告.PNG", b"binary").unwrap();

        assert_eq!(record.file_name, "报告.PNG");
        assert_eq!(record.byte_size, 6);
        assert_eq!(record.mime, "image/png");
        assert!(record.id.ends_with(".png"));
        assert_eq!(record.rel_path, format!("attachments/{}", record.id));
        assert_eq!(std::fs::read(dir.join(&record.id)).unwrap(), b"binary");
        assert_eq!(read(&connection, &dir, &record.id).unwrap(), b"binary");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn save_strips_directories_from_the_display_name() {
        let connection = database();
        let dir = temp_dir();
        let record = save(&connection, &dir, "../../etc/passwd.txt", b"x").unwrap();
        assert_eq!(record.file_name, "passwd.txt");
        assert!(record.id.ends_with(".txt"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn save_rejects_empty_and_oversized_files() {
        let connection = database();
        let dir = temp_dir();
        assert_eq!(
            save(&connection, &dir, "a.png", b"").unwrap_err().field,
            Some("file".into())
        );
        let oversized = vec![0u8; MAX_ATTACHMENT_BYTES + 1];
        assert_eq!(
            save(&connection, &dir, "a.png", &oversized)
                .unwrap_err()
                .field,
            Some("file".into())
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn read_reports_invalid_missing_and_lost_attachments_distinctly() {
        let connection = database();
        let dir = temp_dir();
        assert_eq!(
            read(&connection, &dir, "../escape").unwrap_err().code,
            "validation_error"
        );
        assert_eq!(
            read(&connection, &dir, "0123456789abcdef0123456789abcdef")
                .unwrap_err()
                .code,
            "not_found"
        );
        let record = save(&connection, &dir, "a.png", b"x").unwrap();
        std::fs::remove_file(dir.join(&record.id)).unwrap();
        assert_eq!(
            read(&connection, &dir, &record.id).unwrap_err().code,
            "not_found"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn scan_finds_ids_in_the_markdown_forms_the_editor_writes() {
        let stem = "0123456789abcdef0123456789abcdef";
        assert_eq!(
            scan_references(&format!("![图](attachment:{stem}.png)")),
            vec![format!("{stem}.png")]
        );
        assert_eq!(
            scan_references(&format!("[报告](attachment:{stem}.pdf) 和 ![](attachment:{stem}.jpg)")),
            vec![format!("{stem}.pdf"), format!("{stem}.jpg")]
        );
        assert!(scan_references("attachment:../escape").is_empty());
        assert!(scan_references("没有附件").is_empty());
    }

    #[test]
    fn scan_finds_ids_inside_the_delta_json_envelope() {
        // The editor stores Delta JSON, not Markdown. This scanner decides which
        // files get deleted, so a reference it fails to see here is permanent data
        // loss. An id inside JSON is terminated by the closing quote, which is
        // neither alphanumeric nor '.', so the same scan works unchanged — but that
        // has to be proved, not assumed.
        let stem = "0123456789abcdef0123456789abcdef";

        // An image embed, as serializeContent writes it.
        let image = format!(
            r#"{{"v":1,"ops":[{{"insert":{{"image":"attachment:{stem}.png"}},"attributes":{{"alt":"图"}}}},{{"insert":"\n"}}]}}"#
        );
        assert_eq!(scan_references(&image), vec![format!("{stem}.png")]);

        // A file link, which is how non-images are referenced.
        let link = format!(
            r#"{{"v":1,"ops":[{{"insert":"报告.pdf","attributes":{{"link":"attachment:{stem}.pdf"}}}},{{"insert":"\n"}}]}}"#
        );
        assert_eq!(scan_references(&link), vec![format!("{stem}.pdf")]);

        // Several references in one document, deduped in order.
        let many = format!(
            r#"{{"v":1,"ops":[{{"insert":{{"image":"attachment:{stem}.png"}}}},{{"insert":{{"image":"attachment:{stem}.jpg"}}}},{{"insert":{{"image":"attachment:{stem}.png"}}}}]}}"#
        );
        assert_eq!(
            scan_references(&many),
            vec![format!("{stem}.png"), format!("{stem}.jpg"), format!("{stem}.png")]
        );

        // A video embed points at a remote URL and must contribute nothing.
        let video = r#"{"v":1,"ops":[{"insert":{"video":"https://example.com/e/1"}}]}"#;
        assert!(scan_references(video).is_empty());
    }

    #[test]
    fn garbage_collection_keeps_referenced_files_and_reclaims_the_rest() {
        let connection = database();
        let dir = temp_dir();
        let kept_note = save(&connection, &dir, "note.png", b"a").unwrap();
        let kept_event = save(&connection, &dir, "event.png", b"b").unwrap();
        let kept_task = save(&connection, &dir, "task.png", b"c").unwrap();
        let orphan = save(&connection, &dir, "orphan.png", b"d").unwrap();

        connection
            .execute(
                "INSERT INTO notes(id,title,content,color,pinned,style_variant,icon,created_at,updated_at)
                 VALUES ('n1','t',?1,'#E8C444',0,0,'','2026-07-20','2026-07-20')",
                [format!("![](attachment:{})", kept_note.id)],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO events(id,title,start_at,end_at,all_day,category,color,note,created_at,updated_at)
                 VALUES ('e1','t','2026-07-20T00:00:00Z','2026-07-20T01:00:00Z',0,'work','#E8C444',?1,'2026-07-20','2026-07-20')",
                [format!("![](attachment:{})", kept_event.id)],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO task_lanes(id,name,color,position,created_at,updated_at)
                 VALUES ('l1','待办','#E8C444',0,'2026-07-20','2026-07-20')",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO tasks(id,title,description,completed,lane_id,board_position,created_at,updated_at)
                 VALUES ('t1','t',?1,0,'l1',0,'2026-07-20','2026-07-20')",
                [format!("![](attachment:{})", kept_task.id)],
            )
            .unwrap();

        assert_eq!(collect_garbage(&connection, &dir).unwrap(), 1);
        assert!(dir.join(&kept_note.id).exists());
        assert!(dir.join(&kept_event.id).exists());
        assert!(dir.join(&kept_task.id).exists());
        assert!(!dir.join(&orphan.id).exists());
        assert_eq!(list(&connection, &[orphan.id]).unwrap(), vec![]);
        assert_eq!(list(&connection, &[kept_note.id]).unwrap().len(), 1);

        // Idempotent: a second pass has nothing left to reclaim.
        assert_eq!(collect_garbage(&connection, &dir).unwrap(), 0);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn list_skips_unknown_and_invalid_ids() {
        let connection = database();
        let dir = temp_dir();
        let record = save(&connection, &dir, "a.png", b"x").unwrap();
        let found = list(
            &connection,
            &[
                record.id.clone(),
                "../escape".to_owned(),
                "0123456789abcdef0123456789abcdef".to_owned(),
            ],
        )
        .unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].id, record.id);
        std::fs::remove_dir_all(&dir).ok();
    }
}
