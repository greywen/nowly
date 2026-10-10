use crate::screen_capture::output::EncodedImage;
use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: String,
    pub file_name: String,
    pub created_at: String,
    pub width: u32,
    pub height: u32,
    pub byte_size: u64,
    pub available: bool,
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    pub items: Vec<Entry>,
    pub next_cursor: Option<String>,
}
enum DecodeFailure {
    // Filesystem access and resource limits do not establish corrupt content.
    Unavailable,
    Corrupt,
}
impl From<String> for DecodeFailure {
    fn from(_: String) -> Self {
        Self::Unavailable
    }
}
fn decode_failure(error: image::ImageError) -> DecodeFailure {
    match error {
        image::ImageError::Decoding(_) => DecodeFailure::Corrupt,
        _ => DecodeFailure::Unavailable,
    }
}
type Db = Mutex<Connection>;
type Result<T> = std::result::Result<T, String>;
fn err(_: impl std::fmt::Display) -> String {
    "截图历史操作失败。".into()
}
pub struct HistoryStore {
    root: PathBuf,
    cache: PathBuf,
    operation: Mutex<()>,
    retries: Mutex<HashMap<(u64, String), String>>,
}
impl HistoryStore {
    pub fn new(root: PathBuf, cache: PathBuf) -> Self {
        Self {
            root,
            cache,
            operation: Mutex::new(()),
            retries: Mutex::new(HashMap::new()),
        }
    }
    pub fn archive_dir(&self) -> &Path {
        &self.root
    }
    pub fn ensure_archive_dir(&self) -> Result<()> {
        ensure_dir(&self.root)
    }
    pub fn clear_session(&self, session: u64) {
        self.retries
            .lock()
            .unwrap()
            .retain(|(s, _), _| *s != session);
    }
    pub(crate) fn archive(
        &self,
        db: &Db,
        session: u64,
        version: u64,
        image: &EncodedImage,
    ) -> Result<String> {
        let _op = self.operation.lock().unwrap();
        let fingerprint = format!("{:x}", Sha256::digest(&image.png));
        let key = (session, fingerprint.clone());
        if let Some(id) = self.retries.lock().unwrap().get(&key).cloned() {
            if self
                .entry(db, &id, "ready")
                .and_then(|e| self.checked_file(&e.file_name))
                .is_ok_and(|p| p.is_file())
            {
                return Ok(id);
            }
        }
        self.ensure_archive_dir()?;
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now();
        let file_name = format!("Nowly-截图-{}-{}.png", now.format("%Y%m%d-%H%M%S-%3f"), id);
        let target = self.checked_file(&file_name)?;
        let temporary = self.checked_file(&format!("{id}.pending"))?;
        db.lock()
            .unwrap()
            .execute(
                "INSERT INTO screenshot_history VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,'pending')",
                params![
                    id,
                    session,
                    version,
                    fingerprint,
                    file_name,
                    now.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                    image.width,
                    image.height,
                    image.png.len() as u64
                ],
            )
            .map_err(err)?;
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(err)?;
        file.write_all(&image.png).map_err(err)?;
        file.sync_all().map_err(err)?;
        drop(file);
        // A same-volume hard link publishes atomically and never replaces an existing file.
        self.checked_file(&file_name)?;
        fs::hard_link(&temporary, &target).map_err(err)?;
        fs::remove_file(&temporary).map_err(err)?;
        db.lock()
            .unwrap()
            .execute(
                "UPDATE screenshot_history SET state='ready' WHERE id=?1",
                [&id],
            )
            .map_err(err)?;
        self.retries.lock().unwrap().insert(key, id.clone());
        Ok(id)
    }
    fn entry(&self, db: &Db, id: &str, state: &str) -> Result<Entry> {
        validate_id(id)?;
        db.lock().unwrap().query_row("SELECT id,file_name,created_at,width,height,byte_size FROM screenshot_history WHERE id=?1 AND state=?2",params![id,state],row_entry).optional().map_err(err)?.ok_or_else(||"截图记录不存在。".into())
    }
    fn checked_file(&self, name: &str) -> Result<PathBuf> {
        checked_child(&self.root, name)
    }
    pub fn list(&self, db: &Db, cursor: Option<&str>) -> Result<Page> {
        let (time, id) = match cursor {
            Some(c) => {
                let (t, i) = c.split_once('|').ok_or_else(|| err("cursor"))?;
                validate_id(i)?;
                chrono::DateTime::parse_from_rfc3339(t).map_err(err)?;
                (t.to_owned(), i.to_owned())
            }
            None => (String::new(), String::new()),
        };
        let mut items = {
            let db = db.lock().unwrap();
            let mut query=db.prepare("SELECT id,file_name,created_at,width,height,byte_size,state FROM screenshot_history WHERE state IN ('ready','deleting') AND (?1='' OR created_at<?1 OR (created_at=?1 AND id<?2)) ORDER BY created_at DESC,id DESC LIMIT 31").map_err(err)?;
            let rows = query
                .query_map(params![time, id], |r| {
                    let mut entry = row_entry(r)?;
                    entry.available = r.get::<_, String>(6)? == "ready";
                    Ok(entry)
                })
                .map_err(err)?;
            rows.collect::<rusqlite::Result<Vec<_>>>().map_err(err)?
        };
        let more = items.len() > 30;
        items.truncate(30);
        for e in &mut items {
            e.available = e.available && self.checked_file(&e.file_name).is_ok_and(|p| p.is_file());
        }
        let next_cursor = if more {
            items.last().map(|e| format!("{}|{}", e.created_at, e.id))
        } else {
            None
        };
        Ok(Page { items, next_cursor })
    }
    pub(crate) fn read_image(&self, db: &Db, id: &str) -> Result<EncodedImage> {
        let _op = self.operation.lock().unwrap();
        self.read_unlocked(db, id)
    }
    fn read_unlocked(&self, db: &Db, id: &str) -> Result<EncodedImage> {
        let e = self.entry(db, id, "ready")?;
        self.decode_entry(&e)
    }
    fn decode_entry(&self, e: &Entry) -> Result<EncodedImage> {
        self.decode_checked(e).map_err(|_| err("decode"))
    }
    fn decode_checked(&self, e: &Entry) -> std::result::Result<EncodedImage, DecodeFailure> {
        validate_entry(e)?;
        let path = self.checked_file(&e.file_name)?;
        let meta = fs::metadata(&path).map_err(err)?;
        if !meta.is_file() || meta.len() != e.byte_size || meta.len() > 512_000_000 {
            return Err(DecodeFailure::Corrupt);
        }
        let png = fs::read(path).map_err(err)?;
        let mut reader =
            image::ImageReader::with_format(std::io::Cursor::new(&png), image::ImageFormat::Png);
        let mut limits = image::Limits::default();
        limits.max_image_width = Some(65_535);
        limits.max_image_height = Some(65_535);
        limits.max_alloc = Some(512_000_000);
        reader.limits(limits);
        let (w, h) =
            image::ImageReader::with_format(std::io::Cursor::new(&png), image::ImageFormat::Png)
                .into_dimensions()
                .map_err(decode_failure)?;
        crate::screen_capture::validate_output_dimensions(w as u64, h as u64)
            .map_err(|_| err("dimensions"))?;
        if (w, h) != (e.width, e.height) {
            return Err(DecodeFailure::Corrupt);
        }
        let rgba = reader
            .decode()
            .map_err(decode_failure)?
            .to_rgba8()
            .into_raw();
        Ok(EncodedImage {
            png,
            rgba,
            width: w,
            height: h,
        })
    }
    pub fn thumbnail(&self, db: &Db, id: &str) -> Result<Vec<u8>> {
        let _op = self.operation.lock().unwrap();
        let e = self.entry(db, id, "ready")?;
        validate_entry(&e)?;
        self.checked_file(&e.file_name)?;
        if !self.checked_file(&e.file_name)?.is_file() {
            return Err(err("missing"));
        }
        ensure_dir(&self.cache)?;
        let path = checked_child(&self.cache, &format!("{id}.png"))?;
        if path.is_file() {
            let bytes = fs::read(&path).map_err(err)?;
            if bytes.len() < 2_000_000 {
                if let Ok((w, h)) = image::ImageReader::with_format(
                    std::io::Cursor::new(&bytes),
                    image::ImageFormat::Png,
                )
                .into_dimensions()
                {
                    if w > 0
                        && h > 0
                        && w <= 320
                        && h <= 320
                        && image::load_from_memory_with_format(&bytes, image::ImageFormat::Png)
                            .is_ok()
                    {
                        return Ok(bytes);
                    }
                }
            }
            remove_if_missing(&path)?;
        }
        let source = self.decode_entry(&e)?;
        let rgba = image::RgbaImage::from_raw(source.width, source.height, source.rgba)
            .ok_or_else(|| err("pixels"))?;
        let thumb = image::DynamicImage::ImageRgba8(rgba)
            .thumbnail(320, 320)
            .to_rgba8();
        let encoded =
            crate::screen_capture::encode::encode_export(thumb).map_err(|_| err("encode"))?;
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&path)
            .map_err(err)?;
        if let Err(e) = file.write_all(&encoded.png).and_then(|_| file.sync_all()) {
            drop(file);
            let _ = fs::remove_file(path);
            return Err(err(e));
        }
        Ok(encoded.png)
    }
    pub fn delete(&self, db: &Db, id: &str) -> Result<()> {
        let _op = self.operation.lock().unwrap();
        validate_id(id)?;
        let e = {
            let db = db.lock().unwrap();
            db.query_row("SELECT id,file_name,created_at,width,height,byte_size FROM screenshot_history WHERE id=?1",[id],row_entry).optional().map_err(err)?.ok_or_else(||err("missing"))?
        };
        self.checked_file(&e.file_name)?;
        checked_child(&self.cache, &format!("{id}.png"))?;
        db.lock()
            .unwrap()
            .execute(
                "UPDATE screenshot_history SET state='deleting' WHERE id=?1",
                [id],
            )
            .map_err(err)?;
        self.delete_unlocked(db, &e)
    }
    fn delete_unlocked(&self, db: &Db, e: &Entry) -> Result<()> {
        validate_entry(e)?;
        remove_if_missing(&self.checked_file(&e.file_name)?)?;
        remove_if_missing(&checked_child(&self.root, &format!("{}.pending", e.id))?)?;
        remove_if_missing(&checked_child(&self.cache, &format!("{}.png", e.id))?)?;
        db.lock()
            .unwrap()
            .execute("DELETE FROM screenshot_history WHERE id=?1", [&e.id])
            .map_err(err)?;
        self.retries.lock().unwrap().retain(|_, id| id != &e.id);
        Ok(())
    }
    pub fn recover(&self, db: &Db) -> Result<()> {
        let _op = self.operation.lock().unwrap();
        let rows = {
            let db = db.lock().unwrap();
            let mut stmt=db.prepare("SELECT id,file_name,created_at,width,height,byte_size,state FROM screenshot_history WHERE state!='ready'").map_err(err)?;
            let rows = stmt
                .query_map([], |r| Ok((row_entry(r)?, r.get::<_, String>(6)?)))
                .map_err(err)?;
            rows.collect::<rusqlite::Result<Vec<_>>>().map_err(err)?
        };
        let mut failed = false;
        for (e, state) in rows {
            let result = (|| {
                validate_id(&e.id)?;
                if state == "deleting" {
                    return self.delete_unlocked(db, &e);
                }
                let target = self.checked_file(&e.file_name)?;
                let temporary = self.checked_file(&format!("{}.pending", e.id))?;
                match fs::metadata(&target) {
                    Ok(_) => match self.decode_checked(&e) {
                        Ok(_) => {
                            remove_if_missing(&temporary)?;
                            db.lock()
                                .unwrap()
                                .execute(
                                    "UPDATE screenshot_history SET state='ready' WHERE id=?1",
                                    [&e.id],
                                )
                                .map_err(err)?;
                            Ok(())
                        }
                        Err(DecodeFailure::Corrupt) => self.delete_unlocked(db, &e),
                        Err(DecodeFailure::Unavailable) => Err(err("unavailable")),
                    },
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                        self.delete_unlocked(db, &e)
                    }
                    Err(error) => Err(err(error)),
                }
            })();
            if result.is_err() {
                failed = true;
            }
        }
        if failed {
            Err(err("recovery"))
        } else {
            Ok(())
        }
    }
}
fn validate_entry(e: &Entry) -> Result<()> {
    validate_id(&e.id)?;
    let expected = format!("-{}.png", e.id);
    if !e.file_name.starts_with("Nowly-截图-")
        || !e.file_name.ends_with(&expected)
        || e.file_name.contains(['/', '\\', ':'])
    {
        return Err(err("filename"));
    }
    Ok(())
}
fn row_entry(r: &rusqlite::Row<'_>) -> rusqlite::Result<Entry> {
    Ok(Entry {
        id: r.get(0)?,
        file_name: r.get(1)?,
        created_at: r.get(2)?,
        width: r.get(3)?,
        height: r.get(4)?,
        byte_size: r.get(5)?,
        available: false,
    })
}
pub fn validate_id(id: &str) -> Result<()> {
    let uuid = uuid::Uuid::parse_str(id).map_err(err)?;
    if uuid.to_string() != id {
        return Err(err("id"));
    }
    Ok(())
}
fn reject_reparse(path: &Path) -> Result<()> {
    match fs::symlink_metadata(path) {
        Ok(meta) => {
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                if meta.file_attributes() & 0x400 != 0 {
                    return Err(err("reparse"));
                }
            }
            if meta.file_type().is_symlink() {
                return Err(err("symlink"));
            }
            Ok(())
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(err(e)),
    }
}
fn validate_directory(path: &Path) -> Result<()> {
    for ancestor in path.ancestors() {
        reject_reparse(ancestor)?;
    }
    Ok(())
}
fn ensure_dir(path: &Path) -> Result<()> {
    validate_directory(path)?;
    fs::create_dir_all(path).map_err(err)?;
    validate_directory(path)
}
fn checked_child(root: &Path, name: &str) -> Result<PathBuf> {
    if name.is_empty() || name.contains(['/', '\\', ':']) || name == "." || name == ".." {
        return Err(err("filename"));
    }
    validate_directory(root)?;
    let path = root.join(name);
    reject_reparse(&path)?;
    Ok(path)
}
fn remove_if_missing(path: &Path) -> Result<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(err(e)),
    }
}
