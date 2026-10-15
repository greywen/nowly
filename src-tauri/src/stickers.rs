use crate::db::AppDb;
use crate::error::CommandError;
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    io::{Cursor, Write},
    path::{Path, PathBuf},
};
use tauri::Manager;
use uuid::Uuid;

pub const MAX_IMAGE_BYTES: usize = 10 * 1024 * 1024;
const MAX_DIMENSION: u32 = 4096;
const MAX_PIXELS: u64 = 16_000_000;
const MAX_REVISION: i64 = 9_007_199_254_740_991;
/// Must match `STICKER_OVERSCAN` in `src/stickers/sticker-model.ts`.
const STICKER_OVERSCAN: f64 = 4000.;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StickerBoard {
    pub version: u32,
    pub revision: i64,
    pub objects: Vec<StickerObject>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StickerObject {
    pub id: String,
    pub locked: bool,
    #[serde(flatten)]
    pub geometry: StickerGeometry,
    #[serde(flatten)]
    pub content: StickerContent,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StickerGeometry {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub rotation: f64,
    pub opacity: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum StickerContent {
    Image {
        asset_id: String,
        style: ImageStyle,
    },
    Text {
        text: String,
        font_size: u32,
        color: String,
        bold: bool,
        italic: bool,
        underline: bool,
        align: TextAlign,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ImageStyle {
    Original,
    Rounded,
    Circle,
    Photo,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum TextAlign {
    Left,
    Center,
    Right,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StickerAsset {
    pub id: String,
    pub file_name: String,
    pub mime: String,
    pub byte_size: usize,
    pub width: u32,
    pub height: u32,
}

pub fn migrate(transaction: &Transaction<'_>) -> rusqlite::Result<()> {
    transaction.execute_batch(
        "CREATE TABLE sticker_boards (
            id TEXT PRIMARY KEY CHECK(id='stickers'),
            schema_version INTEGER NOT NULL CHECK(schema_version=1),
            revision INTEGER NOT NULL CHECK(revision>=0),
            objects_json TEXT NOT NULL,
            updated_at TEXT NOT NULL
         );
         CREATE TABLE sticker_assets (
            id TEXT PRIMARY KEY,
            file_name TEXT NOT NULL,
            mime TEXT NOT NULL,
            byte_size INTEGER NOT NULL,
            width INTEGER NOT NULL,
            height INTEGER NOT NULL,
            rel_path TEXT NOT NULL
         );
         CREATE TABLE sticker_asset_refs (
            board_id TEXT NOT NULL REFERENCES sticker_boards(id) ON DELETE CASCADE,
            object_id TEXT NOT NULL,
            asset_id TEXT NOT NULL REFERENCES sticker_assets(id) ON DELETE RESTRICT,
            PRIMARY KEY(board_id,object_id)
         );
         CREATE INDEX sticker_asset_refs_asset ON sticker_asset_refs(asset_id);",
    )
}

fn validate_asset_id(id: &str) -> Result<(), CommandError> {
    if Uuid::parse_str(id).is_ok_and(|uuid| uuid.simple().to_string() == id) {
        Ok(())
    } else {
        Err(CommandError::validation(
            "assetId",
            "Invalid sticker image identifier.",
        ))
    }
}

fn validate_board(board: &StickerBoard) -> Result<(), CommandError> {
    if board.version != 1 || !(0..=MAX_REVISION).contains(&board.revision) {
        return Err(CommandError::validation(
            "board",
            "Invalid sticker board version or revision.",
        ));
    }
    if board.objects.len() > 50 {
        return Err(CommandError::validation(
            "objects",
            "A sticker board supports at most 50 objects.",
        ));
    }
    let mut ids = HashSet::new();
    for object in &board.objects {
        if object.id.is_empty()
            || object.id.chars().count() > 128
            || object.id.chars().any(char::is_control)
            || !ids.insert(&object.id)
        {
            return Err(CommandError::validation(
                "id",
                "Sticker object identifiers must be unique and nonempty.",
            ));
        }
        let g = &object.geometry;
        if ![g.x, g.y, g.width, g.height, g.rotation, g.opacity]
            .iter()
            .all(|n| n.is_finite())
            || g.width <= 0.
            || g.height <= 0.
            || !(-180. ..=180.).contains(&g.rotation)
            || !(0. ..=100.).contains(&g.opacity)
        {
            return Err(CommandError::validation(
                "geometry",
                "Invalid sticker geometry, rotation or opacity.",
            ));
        }
        let angle = g.rotation.to_radians();
        let half_width = (g.width * angle.cos().abs() + g.height * angle.sin().abs()) / 2.;
        let half_height = (g.width * angle.sin().abs() + g.height * angle.cos().abs()) / 2.;
        let (cx, cy) = (g.x + g.width / 2., g.y + g.height / 2.);
        // Match frontend floating-point tolerance at exact quarter-turn boundaries.
        // Objects may extend past the 800x600 stage into the visible module, up to STICKER_OVERSCAN per side.
        if cx - half_width < -STICKER_OVERSCAN - 1e-7
            || cy - half_height < -STICKER_OVERSCAN - 1e-7
            || cx + half_width > 800. + STICKER_OVERSCAN + 1e-7
            || cy + half_height > 600. + STICKER_OVERSCAN + 1e-7
        {
            return Err(CommandError::validation(
                "geometry",
                "The rotated sticker is too far outside the sticker canvas.",
            ));
        }
        match &object.content {
            StickerContent::Image { asset_id, .. } => validate_asset_id(asset_id)?,
            StickerContent::Text {
                text,
                font_size,
                color,
                ..
            } => {
                if text.chars().count() > 2000 {
                    return Err(CommandError::validation(
                        "text",
                        "Sticker text supports at most 2000 Unicode characters.",
                    ));
                }
                if !(12..=160).contains(font_size) {
                    return Err(CommandError::validation(
                        "fontSize",
                        "Font size must be an integer from 12 to 160.",
                    ));
                }
                if color.len() != 7
                    || !color.starts_with('#')
                    || !color.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
                {
                    return Err(CommandError::validation(
                        "color",
                        "Use a six-digit hexadecimal color.",
                    ));
                }
            }
        }
    }
    Ok(())
}

fn image_error() -> CommandError {
    CommandError::validation("bytes", "Use a valid static PNG, JPEG or WebP image, at most 10 MiB, 4096 pixels per side and 16000000 pixels total.")
}

fn validate_dimensions(width: u32, height: u32) -> Result<(), CommandError> {
    if width == 0
        || height == 0
        || width > MAX_DIMENSION
        || height > MAX_DIMENSION
        || u64::from(width) * u64::from(height) > MAX_PIXELS
    {
        Err(image_error())
    } else {
        Ok(())
    }
}

fn reject_animation(bytes: &[u8], format: image::ImageFormat) -> Result<(), CommandError> {
    let (mut offset, little_endian) = match format {
        image::ImageFormat::Png => (8usize, false),
        image::ImageFormat::WebP => (12usize, true),
        _ => return Ok(()),
    };
    while offset + 8 <= bytes.len() {
        let (kind, length) = if little_endian {
            (
                &bytes[offset..offset + 4],
                u32::from_le_bytes(bytes[offset + 4..offset + 8].try_into().unwrap()) as usize,
            )
        } else {
            (
                &bytes[offset + 4..offset + 8],
                u32::from_be_bytes(bytes[offset..offset + 4].try_into().unwrap()) as usize,
            )
        };
        let end = offset
            .checked_add(8)
            .and_then(|start| start.checked_add(length))
            .ok_or_else(image_error)?;
        if end > bytes.len() {
            return Err(image_error());
        }
        if kind == b"acTL"
            || kind == b"fcTL"
            || kind == b"fdAT"
            || kind == b"ANIM"
            || kind == b"ANMF"
            || (kind == b"VP8X" && length > 0 && bytes[offset + 8] & 2 != 0)
        {
            return Err(CommandError::validation(
                "bytes",
                "Animated sticker images are not supported.",
            ));
        }
        offset = end
            .checked_add(if little_endian { length % 2 } else { 4 })
            .ok_or_else(image_error)?;
        if offset > bytes.len() {
            return Err(image_error());
        }
    }
    Ok(())
}

fn validate_image(bytes: &[u8]) -> Result<(&'static str, u32, u32), CommandError> {
    if bytes.is_empty() || bytes.len() > MAX_IMAGE_BYTES {
        return Err(image_error());
    }
    let format = image::guess_format(bytes).map_err(|_| image_error())?;
    let mime = match format {
        image::ImageFormat::Png => "image/png",
        image::ImageFormat::Jpeg => "image/jpeg",
        image::ImageFormat::WebP => "image/webp",
        _ => return Err(image_error()),
    };
    reject_animation(bytes, format)?;
    let reader = image::ImageReader::with_format(Cursor::new(bytes), format);
    let (width, height) = reader.into_dimensions().map_err(|_| image_error())?;
    validate_dimensions(width, height)?;
    let mut reader = image::ImageReader::with_format(Cursor::new(bytes), format);
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(MAX_DIMENSION);
    limits.max_image_height = Some(MAX_DIMENSION);
    limits.max_alloc = Some(128 * 1024 * 1024);
    reader.limits(limits);
    reader.decode().map_err(|_| image_error())?;
    Ok((mime, width, height))
}

pub fn stickers_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("stickers")
}

fn read_board(connection: &Connection) -> Result<StickerBoard, CommandError> {
    let row = connection
        .query_row(
            "SELECT schema_version,revision,objects_json FROM sticker_boards WHERE id='stickers'",
            [],
            |row| {
                Ok((
                    row.get::<_, u32>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()
        .map_err(CommandError::database)?;
    let board = match row {
        None => StickerBoard {
            version: 1,
            revision: 0,
            objects: vec![],
        },
        Some((version, revision, json)) => StickerBoard {
            version,
            revision,
            objects: serde_json::from_str(&json).map_err(CommandError::database)?,
        },
    };
    validate_board(&board).map_err(|_| {
        CommandError::reported("The stored sticker board is invalid. It has not been replaced.")
    })?;
    Ok(board)
}

fn assert_asset_exists(connection: &Connection, dir: &Path, id: &str) -> Result<(), CommandError> {
    validate_asset_id(id)?;
    let exists: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sticker_assets WHERE id=?1)",
            [id],
            |row| row.get(0),
        )
        .map_err(CommandError::database)?;
    if !exists || !dir.join(id).try_exists().map_err(CommandError::system)? {
        Err(CommandError::not_found("A sticker image is missing."))
    } else {
        Ok(())
    }
}

fn save_board(
    connection: &mut Connection,
    dir: &Path,
    mut board: StickerBoard,
) -> Result<StickerBoard, CommandError> {
    validate_board(&board)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(CommandError::database)?;
    let current = read_board(&transaction)?;
    if current.revision != board.revision {
        return Err(CommandError::conflict(
            "The sticker board changed. Reload it before saving.",
        ));
    }
    for object in &board.objects {
        if let StickerContent::Image { asset_id, .. } = &object.content {
            assert_asset_exists(&transaction, dir, asset_id)?;
        }
    }
    if board.revision == MAX_REVISION {
        return Err(CommandError::validation(
            "revision",
            "The sticker board revision limit has been reached.",
        ));
    }
    board.revision += 1;
    transaction.execute("INSERT INTO sticker_boards VALUES ('stickers',1,?1,?2,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,objects_json=excluded.objects_json,updated_at=excluded.updated_at",
        params![board.revision,serde_json::to_string(&board.objects).map_err(CommandError::system)?]).map_err(CommandError::database)?;
    transaction
        .execute(
            "DELETE FROM sticker_asset_refs WHERE board_id='stickers'",
            [],
        )
        .map_err(CommandError::database)?;
    for object in &board.objects {
        if let StickerContent::Image { asset_id, .. } = &object.content {
            transaction
                .execute(
                    "INSERT INTO sticker_asset_refs VALUES ('stickers',?1,?2)",
                    params![object.id, asset_id],
                )
                .map_err(CommandError::database)?;
        }
    }
    transaction.commit().map_err(CommandError::database)?;
    Ok(board)
}

#[cfg(test)]
fn upload_image(
    connection: &Connection,
    dir: &Path,
    name: &str,
    bytes: &[u8],
) -> Result<StickerAsset, CommandError> {
    let (mime, width, height) = validate_image(bytes)?;
    store_image(connection, dir, name, bytes, mime, width, height)
}

fn store_image(
    connection: &Connection,
    dir: &Path,
    name: &str,
    bytes: &[u8],
    mime: &str,
    width: u32,
    height: u32,
) -> Result<StickerAsset, CommandError> {
    let file_name: String = name
        .rsplit(['\\', '/'])
        .next()
        .unwrap_or("")
        .trim()
        .chars()
        .filter(|c| !c.is_control())
        .take(255)
        .collect();
    if file_name.is_empty() || file_name == "." || file_name == ".." {
        return Err(CommandError::validation(
            "fileName",
            "Enter an image file name.",
        ));
    }
    std::fs::create_dir_all(dir).map_err(CommandError::system)?;
    let asset = StickerAsset {
        id: Uuid::new_v4().simple().to_string(),
        file_name,
        mime: mime.into(),
        byte_size: bytes.len(),
        width,
        height,
    };
    let path = dir.join(&asset.id);
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(CommandError::system)?;
    let result = file
        .write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(CommandError::system);
    drop(file);
    let result = result.and_then(|_| {
        connection
            .execute(
                "INSERT INTO sticker_assets VALUES (?1,?2,?3,?4,?5,?6,?1)",
                params![
                    asset.id,
                    asset.file_name,
                    asset.mime,
                    asset.byte_size,
                    asset.width,
                    asset.height
                ],
            )
            .map(|_| ())
            .map_err(CommandError::database)
    });
    if let Err(error) = result {
        if let Err(cleanup) = std::fs::remove_file(&path) {
            eprintln!("sticker upload rollback cleanup failed: {cleanup}");
            return Err(CommandError::reported(
                "The image upload failed, and its incomplete file could not be removed.",
            ));
        }
        return Err(error);
    }
    Ok(asset)
}

fn discard_images(
    connection: &mut Connection,
    dir: &Path,
    ids: &[String],
) -> Result<(), CommandError> {
    for id in ids {
        validate_asset_id(id)?;
    }
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(CommandError::database)?;
    for id in ids.iter().collect::<HashSet<_>>() {
        let referenced: bool = transaction
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sticker_asset_refs WHERE asset_id=?1)",
                [id],
                |row| row.get(0),
            )
            .map_err(CommandError::database)?;
        if referenced {
            continue;
        }
        match std::fs::remove_file(dir.join(id)) {
            Ok(()) => (),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
            Err(error) => return Err(CommandError::system(error)),
        }
        transaction
            .execute("DELETE FROM sticker_assets WHERE id=?1", [id])
            .map_err(CommandError::database)?;
    }
    transaction.commit().map_err(CommandError::database)?;
    Ok(())
}

pub fn collect_startup_garbage(
    connection: &mut Connection,
    dir: &Path,
) -> Result<(), CommandError> {
    std::fs::create_dir_all(dir).map_err(CommandError::system)?;
    let mut ids: HashSet<String> = {
        let mut statement = connection.prepare("SELECT id FROM sticker_assets WHERE NOT EXISTS(SELECT 1 FROM sticker_asset_refs WHERE asset_id=sticker_assets.id)").map_err(CommandError::database)?;
        let rows = statement
            .query_map([], |row| row.get(0))
            .map_err(CommandError::database)?;
        rows.collect::<rusqlite::Result<_>>()
            .map_err(CommandError::database)?
    };
    for entry in std::fs::read_dir(dir).map_err(CommandError::system)? {
        let entry = entry.map_err(CommandError::system)?;
        if let Some(id) = entry.file_name().to_str() {
            if validate_asset_id(id).is_ok() {
                ids.insert(id.to_owned());
            }
        }
    }
    for id in ids {
        if let Err(error) = discard_images(connection, dir, &[id]) {
            eprintln!(
                "sticker startup orphan cleanup failed; retained for retry: {}",
                error.message
            );
        }
    }
    Ok(())
}

#[cfg(test)]
fn read_image(connection: &Connection, dir: &Path, id: &str) -> Result<Vec<u8>, CommandError> {
    assert_asset_exists(connection, dir, id)?;
    read_image_file(dir, id)
}

fn read_image_file(dir: &Path, id: &str) -> Result<Vec<u8>, CommandError> {
    validate_asset_id(id)?;
    let mut file = std::fs::File::open(dir.join(id)).map_err(CommandError::system)?;
    let mut bytes = Vec::new();
    std::io::Read::read_to_end(
        &mut std::io::Read::take(&mut file, (MAX_IMAGE_BYTES + 1) as u64),
        &mut bytes,
    )
    .map_err(CommandError::system)?;
    validate_image(&bytes)?;
    Ok(bytes)
}

#[tauri::command]
pub async fn get_sticker_board(app: tauri::AppHandle) -> Result<StickerBoard, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppDb>();
        let connection = state.0.lock().map_err(CommandError::system)?;
        read_board(&connection)
    })
    .await
    .map_err(CommandError::system)?
}

#[tauri::command]
pub async fn save_sticker_board(
    app: tauri::AppHandle,
    board: StickerBoard,
) -> Result<StickerBoard, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = stickers_dir(&app.path().app_data_dir().map_err(CommandError::system)?);
        let state = app.state::<AppDb>();
        let mut connection = state.0.lock().map_err(CommandError::system)?;
        save_board(&mut connection, &dir, board)
    })
    .await
    .map_err(CommandError::system)?
}

#[tauri::command]
pub async fn upload_sticker_image(
    app: tauri::AppHandle,
    file_name: String,
    bytes: Vec<u8>,
) -> Result<StickerAsset, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        let (mime, width, height) = validate_image(&bytes)?;
        let dir = stickers_dir(&app.path().app_data_dir().map_err(CommandError::system)?);
        let state = app.state::<AppDb>();
        let connection = state.0.lock().map_err(CommandError::system)?;
        store_image(&connection, &dir, &file_name, &bytes, mime, width, height)
    })
    .await
    .map_err(CommandError::system)?
}

#[tauri::command]
pub async fn read_sticker_image(
    app: tauri::AppHandle,
    id: String,
) -> Result<Vec<u8>, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = stickers_dir(&app.path().app_data_dir().map_err(CommandError::system)?);
        {
            let state = app.state::<AppDb>();
            let connection = state.0.lock().map_err(CommandError::system)?;
            assert_asset_exists(&connection, &dir, &id)?;
        }
        read_image_file(&dir, &id)
    })
    .await
    .map_err(CommandError::system)?
}

#[tauri::command]
pub async fn discard_sticker_images(
    app: tauri::AppHandle,
    ids: Vec<String>,
) -> Result<(), CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = stickers_dir(&app.path().app_data_dir().map_err(CommandError::system)?);
        let state = app.state::<AppDb>();
        let mut connection = state.0.lock().map_err(CommandError::system)?;
        discard_images(&mut connection, &dir, &ids)
    })
    .await
    .map_err(CommandError::system)?
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{DynamicImage, ImageFormat, RgbaImage};
    use std::io::Cursor;
    use uuid::Uuid;

    struct Store {
        connection: Connection,
        dir: std::path::PathBuf,
    }
    impl Store {
        fn new() -> Self {
            let mut connection = Connection::open_in_memory().unwrap();
            crate::db::migrate(&mut connection).unwrap();
            let dir = std::env::current_dir()
                .unwrap()
                .join(format!(".sticker-test-{}", Uuid::new_v4()));
            std::fs::create_dir(&dir).unwrap();
            Self { connection, dir }
        }
    }
    impl Drop for Store {
        fn drop(&mut self) {
            std::fs::remove_dir_all(&self.dir).unwrap();
        }
    }
    fn board() -> StickerBoard {
        StickerBoard {
            version: 1,
            revision: 0,
            objects: vec![StickerObject {
                id: "text-1".into(),
                locked: false,
                geometry: StickerGeometry {
                    x: 100.,
                    y: 100.,
                    width: 100.,
                    height: 80.,
                    rotation: 0.,
                    opacity: 100.,
                },
                content: StickerContent::Text {
                    text: "文字🦀".into(),
                    font_size: 32,
                    color: "#aBc123".into(),
                    bold: false,
                    italic: false,
                    underline: false,
                    align: TextAlign::Left,
                },
            }],
        }
    }
    fn png(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = Cursor::new(Vec::new());
        DynamicImage::ImageRgba8(RgbaImage::new(width, height))
            .write_to(&mut bytes, ImageFormat::Png)
            .unwrap();
        bytes.into_inner()
    }
    #[test]
    fn stickers_validate_geometry_and_limits() {
        assert!(validate_board(&board()).is_ok());
        for value in [f64::NAN, f64::INFINITY, -STICKER_OVERSCAN - 1., 800. + STICKER_OVERSCAN - 99.] {
            let mut b = board();
            b.objects[0].geometry.x = value;
            assert!(validate_board(&b).is_err(), "x={value}");
        }
        // A wide module shows space beside the 4:3 stage, so slightly negative or >800 positions are valid.
        for value in [-1., 801.] {
            let mut b = board();
            b.objects[0].geometry.x = value;
            assert!(validate_board(&b).is_ok(), "x={value}");
        }
        for value in [-181., 181., f64::NAN] {
            let mut b = board();
            b.objects[0].geometry.rotation = value;
            assert!(validate_board(&b).is_err());
        }
        let mut b = board();
        b.objects[0].geometry.x = -STICKER_OVERSCAN;
        b.objects[0].geometry.rotation = 45.;
        assert!(validate_board(&b).is_err());
        b = board();
        b.objects[0].geometry.opacity = 101.;
        assert!(validate_board(&b).is_err());
        b = board();
        b.objects = (0..50)
            .map(|i| {
                let mut o = b.objects[0].clone();
                o.id = format!("object-{i}");
                o
            })
            .collect();
        assert!(validate_board(&b).is_ok());
        b.objects.push(b.objects[0].clone());
        assert!(validate_board(&b).is_err());
        b.objects.truncate(2);
        b.objects[1].id = b.objects[0].id.clone();
        assert!(validate_board(&b).is_err());
        let mut b = board();
        b.objects[0].geometry = StickerGeometry {
            x: f64::MAX,
            y: f64::MAX,
            width: f64::MAX,
            height: f64::MAX,
            rotation: 45.,
            opacity: 100.,
        };
        assert!(validate_board(&b).is_err());
    }
    #[test]
    fn stickers_text_unicode_font_and_color() {
        for (size, count, color, valid) in [
            (12, 2000, "#123abc", true),
            (160, 2000, "#ABCDEF", true),
            (11, 1, "#123456", false),
            (161, 1, "#123456", false),
            (32, 2001, "#123456", false),
            (32, 1, "red", false),
        ] {
            let mut b = board();
            b.objects[0].content = StickerContent::Text {
                text: "🦀".repeat(count),
                font_size: size,
                color: color.into(),
                bold: true,
                italic: true,
                underline: true,
                align: TextAlign::Right,
            };
            assert_eq!(validate_board(&b).is_ok(), valid);
        }
        assert!(serde_json::from_value::<StickerBoard>(serde_json::json!({"version":1,"revision":0,"objects":[{"id":"t","locked":false,"x":0,"y":0,"width":20,"height":20,"rotation":0,"opacity":100,"kind":"text","text":"t","fontSize":12.5,"color":"#123456","bold":false,"italic":false,"underline":false,"align":"left"}]})).is_err());
    }
    #[test]
    fn stickers_images_decode_and_boundaries() {
        assert_eq!(validate_image(&png(1, 1)).unwrap(), ("image/png", 1, 1));
        assert!(validate_image(b"not png").is_err());
        assert!(validate_image(&[]).is_err());
        let mut damaged = png(1, 1);
        damaged.truncate(damaged.len() / 2);
        assert!(validate_image(&damaged).is_err());
        assert!(validate_image(&vec![0; 10 * 1024 * 1024 + 1]).is_err());
        assert!(validate_image(&png(4096, 1)).is_ok());
        assert!(validate_image(&png(4097, 1)).is_err());
        assert!(validate_image(&png(1, 4096)).is_ok());
        assert!(validate_image(&png(1, 4097)).is_err());
        assert!(validate_image(&png(4000, 4000)).is_ok());
        assert!(validate_image(&png(4001, 4000)).is_err());
    }
    #[test]
    fn stickers_revision_resources_cancel_and_shared_cleanup() {
        let mut s = Store::new();
        assert_eq!(
            read_board(&s.connection).unwrap(),
            StickerBoard {
                version: 1,
                revision: 0,
                objects: vec![]
            }
        );
        let asset = upload_image(&s.connection, &s.dir, "fake.jpg", &png(2, 2)).unwrap();
        assert_eq!(asset.mime, "image/png");
        let mut b = board();
        b.objects[0].content = StickerContent::Image {
            asset_id: asset.id.clone(),
            style: ImageStyle::Photo,
        };
        let mut copy = b.objects[0].clone();
        copy.id = "copy".into();
        b.objects.push(copy);
        let saved = save_board(&mut s.connection, &s.dir, b.clone()).unwrap();
        assert_eq!(saved.revision, 1);
        assert_eq!(
            save_board(&mut s.connection, &s.dir, b).unwrap_err().code,
            "conflict"
        );
        discard_images(&mut s.connection, &s.dir, &[asset.id.clone()]).unwrap();
        assert!(s.dir.join(&asset.id).exists());
        let mut b = saved;
        b.objects.remove(0);
        let saved = save_board(&mut s.connection, &s.dir, b).unwrap();
        assert!(s.dir.join(&asset.id).exists());
        let pending = upload_image(&s.connection, &s.dir, "pending.png", &png(1, 1)).unwrap();
        discard_images(&mut s.connection, &s.dir, &[pending.id.clone()]).unwrap();
        assert!(!s.dir.join(&pending.id).exists());
        let mut b = saved;
        b.objects.clear();
        save_board(&mut s.connection, &s.dir, b).unwrap();
        assert!(s.dir.join(&asset.id).exists());
        discard_images(&mut s.connection, &s.dir, &[asset.id.clone()]).unwrap();
        assert!(!s.dir.join(&asset.id).exists());
    }
    #[test]
    fn stickers_formats_animations_and_exact_byte_limit() {
        for (format, mime) in [
            (ImageFormat::Jpeg, "image/jpeg"),
            (ImageFormat::WebP, "image/webp"),
        ] {
            let mut bytes = Cursor::new(Vec::new());
            DynamicImage::new_rgb8(2, 3)
                .write_to(&mut bytes, format)
                .unwrap();
            assert_eq!(validate_image(bytes.get_ref()).unwrap(), (mime, 2, 3));
        }
        let mut bytes = png(1, 1);
        bytes.resize(MAX_IMAGE_BYTES, 0);
        assert!(validate_image(&bytes).is_ok());
        bytes.push(0);
        assert!(validate_image(&bytes).is_err());
        let mut animated = png(1, 1);
        let mut chunk = vec![0, 0, 0, 8];
        chunk.extend_from_slice(b"acTL");
        chunk.extend_from_slice(&[0, 0, 0, 1, 0, 0, 0, 0]);
        let mut crc = !0u32;
        for byte in &chunk[4..] {
            crc ^= *byte as u32;
            for _ in 0..8 {
                crc = (crc >> 1) ^ (0xedb88320 & 0u32.wrapping_sub(crc & 1));
            }
        }
        chunk.extend_from_slice(&(!crc).to_be_bytes());
        animated.splice(33..33, chunk);
        assert!(validate_image(&animated)
            .unwrap_err()
            .message
            .contains("Animated"));
        let mut webp = Cursor::new(Vec::new());
        DynamicImage::new_rgba8(1, 1)
            .write_to(&mut webp, ImageFormat::WebP)
            .unwrap();
        let mut animated = webp.into_inner();
        let mut chunk = b"VP8X".to_vec();
        chunk.extend_from_slice(&10u32.to_le_bytes());
        chunk.extend_from_slice(&[2, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        animated.splice(12..12, chunk);
        let riff_size = animated.len() as u32 - 8;
        animated[4..8].copy_from_slice(&riff_size.to_le_bytes());
        assert!(validate_image(&animated)
            .unwrap_err()
            .message
            .contains("Animated"));
    }
    #[test]
    fn stickers_invalid_resources_and_failed_upload_roll_back() {
        let mut s = Store::new();
        let mut b = board();
        b.objects[0].content = StickerContent::Image {
            asset_id: "../escape".into(),
            style: ImageStyle::Original,
        };
        assert!(save_board(&mut s.connection, &s.dir, b.clone()).is_err());
        b.objects[0].content = StickerContent::Image {
            asset_id: Uuid::new_v4().simple().to_string(),
            style: ImageStyle::Original,
        };
        assert_eq!(
            save_board(&mut s.connection, &s.dir, b).unwrap_err().code,
            "not_found"
        );
        assert_eq!(read_board(&s.connection).unwrap().revision, 0);
        s.connection.execute_batch("CREATE TRIGGER sticker_fail_upload BEFORE INSERT ON sticker_assets BEGIN SELECT RAISE(ABORT,'test'); END;").unwrap();
        assert_eq!(
            upload_image(&s.connection, &s.dir, "a.png", &png(1, 1))
                .unwrap_err()
                .code,
            "database_error"
        );
        assert_eq!(std::fs::read_dir(&s.dir).unwrap().count(), 0);
        assert!(discard_images(&mut s.connection, &s.dir, &["../escape".into()]).is_err());
    }
    #[test]
    fn stickers_failed_reference_write_preserves_prior_board() {
        let mut s = Store::new();
        let saved = save_board(&mut s.connection, &s.dir, board()).unwrap();
        let asset = upload_image(&s.connection, &s.dir, "a.png", &png(1, 1)).unwrap();
        let mut b = saved.clone();
        b.objects[0].content = StickerContent::Image {
            asset_id: asset.id.clone(),
            style: ImageStyle::Rounded,
        };
        s.connection.execute_batch("CREATE TRIGGER sticker_fail_ref BEFORE INSERT ON sticker_asset_refs BEGIN SELECT RAISE(ABORT,'test'); END;").unwrap();
        assert_eq!(
            save_board(&mut s.connection, &s.dir, b).unwrap_err().code,
            "database_error"
        );
        assert_eq!(read_board(&s.connection).unwrap(), saved);
        assert!(s.dir.join(&asset.id).exists());
    }
    #[test]
    fn stickers_wire_contract_is_flattened_camel_case() {
        let value = serde_json::to_value(board()).unwrap();
        let object = &value["objects"][0];
        assert_eq!(object["kind"], "text");
        assert_eq!(object["fontSize"], 32);
        assert_eq!(object["opacity"], 100.);
        assert!(object.get("geometry").is_none());
        assert!(object.get("content").is_none());
        let mut b = board();
        b.objects[0].content = StickerContent::Image {
            asset_id: Uuid::new_v4().simple().to_string(),
            style: ImageStyle::Original,
        };
        let value = serde_json::to_value(&b).unwrap();
        assert!(value["objects"][0]["assetId"].is_string());
        assert_eq!(serde_json::from_value::<StickerBoard>(value).unwrap(), b);
    }
    #[test]
    fn stickers_asset_ids_match_frontend_no_extension_contract() {
        assert!(validate_asset_id("0123456789abcdef0123456789abcdef").is_ok());
        for id in [
            "01234567-89ab-cdef-0123-456789abcdef",
            "0123456789ABCDEF0123456789abcdef",
            "0123456789abcdef0123456789abcdef.png",
            "../escape",
        ] {
            assert!(validate_asset_id(id).is_err());
        }
        let s = Store::new();
        let asset = upload_image(&s.connection, &s.dir, "a.png", &png(1, 1)).unwrap();
        assert_eq!(asset.id.len(), 32);
    }
    #[test]
    fn stickers_revisions_are_safe_javascript_integers() {
        let mut b = board();
        b.revision = 9_007_199_254_740_991;
        assert!(validate_board(&b).is_ok());
        b.revision += 1;
        assert!(validate_board(&b).is_err());
    }
    #[test]
    fn stickers_save_succeeds_when_explicit_cleanup_fails_and_can_retry() {
        let mut s = Store::new();
        let asset = upload_image(&s.connection, &s.dir, "a.png", &png(1, 1)).unwrap();
        let mut b = board();
        b.objects[0].content = StickerContent::Image {
            asset_id: asset.id.clone(),
            style: ImageStyle::Original,
        };
        let mut b = save_board(&mut s.connection, &s.dir, b).unwrap();
        std::fs::remove_file(s.dir.join(&asset.id)).unwrap();
        std::fs::create_dir(s.dir.join(&asset.id)).unwrap();
        b.objects.clear();
        let saved = save_board(&mut s.connection, &s.dir, b).unwrap();
        assert_eq!(saved.revision, 2);
        assert_eq!(read_board(&s.connection).unwrap().revision, 2);
        assert!(read_board(&s.connection).unwrap().objects.is_empty());
        assert!(discard_images(&mut s.connection, &s.dir, &[asset.id.clone()]).is_err());
        std::fs::remove_dir(s.dir.join(&asset.id)).unwrap();
        discard_images(&mut s.connection, &s.dir, &[asset.id.clone()]).unwrap();
        assert_eq!(
            s.connection
                .query_row("SELECT count(*) FROM sticker_assets", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
    #[cfg(windows)]
    #[test]
    fn stickers_startup_retains_locked_orphan_and_retries_without_blocking_launch() {
        use std::os::windows::fs::OpenOptionsExt;
        let mut s = Store::new();
        let locked = upload_image(&s.connection, &s.dir, "locked.png", &png(1, 1)).unwrap();
        let removable = upload_image(&s.connection, &s.dir, "removable.png", &png(1, 1)).unwrap();
        let lock = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(s.dir.join(&locked.id))
            .unwrap();
        assert!(collect_startup_garbage(&mut s.connection, &s.dir).is_ok());
        assert_eq!(
            s.connection
                .query_row(
                    "SELECT count(*) FROM sticker_assets WHERE id=?1",
                    [&locked.id],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
            1
        );
        assert!(!s.dir.join(&removable.id).exists());
        drop(lock);
        assert!(s.dir.join(&locked.id).exists());
        collect_startup_garbage(&mut s.connection, &s.dir).unwrap();
        assert!(!s.dir.join(&locked.id).exists());
        assert_eq!(
            s.connection
                .query_row("SELECT count(*) FROM sticker_assets", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
    #[test]
    fn stickers_reopen_preserves_board_and_reclaims_only_unreferenced_assets() {
        let mut s = Store::new();
        let db_path = s.dir.join("store.sqlite");
        let mut connection = Connection::open(&db_path).unwrap();
        crate::db::migrate(&mut connection).unwrap();
        let asset = upload_image(&connection, &s.dir, "a.png", &png(2, 2)).unwrap();
        let pending = upload_image(&connection, &s.dir, "pending.png", &png(1, 1)).unwrap();
        let orphan = Uuid::new_v4().simple().to_string();
        std::fs::write(s.dir.join(&orphan), b"orphan").unwrap();
        let mut b = board();
        b.objects[0].content = StickerContent::Image {
            asset_id: asset.id.clone(),
            style: ImageStyle::Circle,
        };
        let saved = save_board(&mut connection, &s.dir, b).unwrap();
        drop(connection);
        let mut connection = Connection::open(&db_path).unwrap();
        crate::db::migrate(&mut connection).unwrap();
        collect_startup_garbage(&mut connection, &s.dir).unwrap();
        assert_eq!(read_board(&connection).unwrap(), saved);
        assert_eq!(
            read_image(&connection, &s.dir, &asset.id).unwrap(),
            png(2, 2)
        );
        assert!(!s.dir.join(&pending.id).exists());
        assert!(!s.dir.join(&orphan).exists());
        connection
            .execute("UPDATE sticker_boards SET objects_json='broken'", [])
            .unwrap();
        assert_eq!(read_board(&connection).unwrap_err().code, "database_error");
        drop(connection);
        // Drop the original in-memory handle before Store removes its directory.
        s.connection.execute_batch("PRAGMA shrink_memory").unwrap();
    }
}
