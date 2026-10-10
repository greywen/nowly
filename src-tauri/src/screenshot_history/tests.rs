use super::store::*;

#[test]
fn screenshot_history_missing_setup_returns_error_without_panicking() {
    let app = tauri::test::mock_builder()
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    assert!(super::commands::history_state(app.handle()).is_err());
}
use crate::screen_capture::{encode::encode_export, output::EncodedImage};
use image::{Rgba, RgbaImage};
use rusqlite::Connection;
use std::path::PathBuf;
pub(super) struct Fixture {
    pub(super) root: PathBuf,
    pub(super) db: std::sync::Mutex<Connection>,
    pub(super) store: HistoryStore,
}
impl Fixture {
    pub(super) fn new() -> Self {
        let root = std::env::current_dir()
            .unwrap()
            .join(".history-tests")
            .join(uuid::Uuid::new_v4().to_string());
        let mut db = Connection::open_in_memory().unwrap();
        let tx = db.transaction().unwrap();
        super::migrate(&tx).unwrap();
        tx.commit().unwrap();
        let store = HistoryStore::new(root.join("pictures"), root.join("cache"));
        Self {
            root,
            db: std::sync::Mutex::new(db),
            store,
        }
    }
    pub(super) fn image() -> EncodedImage {
        encode_export(RgbaImage::from_pixel(640, 160, Rgba([12, 34, 56, 255]))).unwrap()
    }
    pub(super) fn archive(&self, session: u64, image: &EncodedImage) -> String {
        self.store.archive(&self.db, session, 1, image).unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}
#[test]
fn screenshot_history_archives_and_deduplicates_only_live_process_session() {
    let f = Fixture::new();
    let image = Fixture::image();
    let a = f.archive(1, &image);
    assert_eq!(a, f.archive(1, &image));
    assert_ne!(a, f.archive(2, &image));
    let reopened = HistoryStore::new(f.root.join("pictures"), f.root.join("cache"));
    assert_ne!(a, reopened.archive(&f.db, 1, 1, &image).unwrap());
    let page = f.store.list(&f.db, None).unwrap();
    assert_eq!(page.items.len(), 3);
    assert!(page.items.iter().all(|i| i.available));
}
#[test]
fn screenshot_history_collision_never_overwrites_and_pending_partial_is_removed() {
    let f = Fixture::new();
    let id = f.archive(1, &Fixture::image());
    let entry = f.store.list(&f.db, None).unwrap().items.remove(0);
    let path = f.store.archive_dir().join(&entry.file_name);
    let before = std::fs::read(&path).unwrap();
    let target = f.store.archive_dir().join("collision.png");
    std::fs::write(&target, b"private").unwrap();
    assert!(std::fs::hard_link(&path, &target).is_err());
    assert_eq!(std::fs::read(&target).unwrap(), b"private");
    assert_eq!(std::fs::read(&path).unwrap(), before);
    f.db.lock()
        .unwrap()
        .execute(
            "UPDATE screenshot_history SET state='pending' WHERE id=?1",
            [&id],
        )
        .unwrap();
    std::fs::remove_file(&path).unwrap();
    std::fs::write(
        f.store.archive_dir().join(format!("{id}.pending")),
        b"partial",
    )
    .unwrap();
    f.store.recover(&f.db).unwrap();
    assert!(f.store.list(&f.db, None).unwrap().items.is_empty());
    assert!(!f.store.archive_dir().join(format!("{id}.pending")).exists());
    assert!(target.exists());
}
#[test]
fn screenshot_history_rejects_symlink_cache_and_uncontrolled_basename() {
    let f = Fixture::new();
    let id = f.archive(1, &Fixture::image());
    f.db.lock()
        .unwrap()
        .execute(
            "UPDATE screenshot_history SET file_name='private.png' WHERE id=?1",
            [&id],
        )
        .unwrap();
    std::fs::write(f.store.archive_dir().join("private.png"), b"private").unwrap();
    assert!(f.store.delete(&f.db, &id).is_err());
    assert!(f.store.archive_dir().join("private.png").exists());
}
#[test]
fn screenshot_history_regenerates_corrupt_thumbnail_cache() {
    let f = Fixture::new();
    let id = f.archive(1, &Fixture::image());
    f.store.thumbnail(&f.db, &id).unwrap();
    std::fs::write(f.root.join("cache").join(format!("{id}.png")), b"partial").unwrap();
    let thumb = f.store.thumbnail(&f.db, &id).unwrap();
    assert!(image::load_from_memory(&thumb).is_ok());
}
#[cfg(windows)]
#[test]
fn screenshot_history_rejects_directory_junction() {
    let f = Fixture::new();
    let id = f.archive(1, &Fixture::image());
    let private = f.root.join("private");
    std::fs::create_dir_all(&private).unwrap();
    std::fs::write(private.join("private.png"), b"private").unwrap();
    let archive = f.store.archive_dir();
    let original = f.root.join("original");
    std::fs::rename(archive, &original).unwrap();
    let status = std::process::Command::new("cmd.exe")
        .args(["/c", "mklink", "/J"])
        .arg(archive)
        .arg(&private)
        .output()
        .unwrap();
    assert!(status.status.success());
    assert!(f.store.read_image(&f.db, &id).is_err());
    assert!(f.store.delete(&f.db, &id).is_err());
    assert!(private.join("private.png").exists());
    std::fs::remove_dir(archive).unwrap();
}
#[test]
fn screenshot_history_changed_pixels_create_new_archive() {
    let f = Fixture::new();
    let a = f.archive(1, &Fixture::image());
    let b = f.archive(
        1,
        &encode_export(RgbaImage::from_pixel(2, 2, Rgba([1, 2, 3, 255]))).unwrap(),
    );
    assert_ne!(a, b);
}
#[test]
fn screenshot_history_paginated_missing_files_and_delete_cache() {
    let f = Fixture::new();
    for id in 1..=33 {
        f.archive(id, &Fixture::image());
    }
    let first = f.store.list(&f.db, None).unwrap();
    assert_eq!(first.items.len(), 30);
    let second = f.store.list(&f.db, first.next_cursor.as_deref()).unwrap();
    assert_eq!(second.items.len(), 3);
    let id = &first.items[0].id;
    let thumb = f.store.thumbnail(&f.db, id).unwrap();
    let image = image::load_from_memory(&thumb).unwrap();
    assert_eq!(image.width(), 320);
    assert_eq!(image.height(), 80);
    std::fs::remove_file(f.store.archive_dir().join(&first.items[0].file_name)).unwrap();
    assert!(!f.store.list(&f.db, None).unwrap().items[0].available);
    f.store.delete(&f.db, id).unwrap();
    assert!(f.store.thumbnail(&f.db, id).is_err());
    assert!(f.store.read_image(&f.db, id).is_err());
}
#[test]
fn screenshot_history_rejects_untrusted_identifiers_and_filenames() {
    let f = Fixture::new();
    assert!(f.store.read_image(&f.db, "../secret").is_err());
    let id = f.archive(1, &Fixture::image());
    f.db.lock()
        .unwrap()
        .execute(
            "UPDATE screenshot_history SET file_name='../private.png' WHERE id=?1",
            [&id],
        )
        .unwrap();
    assert!(f.store.delete(&f.db, &id).is_err());
    assert!(f.store.read_image(&f.db, &id).is_err());
    assert!(f.store.list(&f.db, Some("bad-cursor")).is_err());
}
#[test]
fn screenshot_history_recovers_pending_and_deleting() {
    let f = Fixture::new();
    let a = f.archive(1, &Fixture::image());
    let b = f.archive(2, &Fixture::image());
    f.db.lock()
        .unwrap()
        .execute(
            "UPDATE screenshot_history SET state='pending' WHERE id=?1",
            [&a],
        )
        .unwrap();
    f.db.lock()
        .unwrap()
        .execute(
            "UPDATE screenshot_history SET state='deleting' WHERE id=?1",
            [&b],
        )
        .unwrap();
    f.store.recover(&f.db).unwrap();
    assert_eq!(f.store.list(&f.db, None).unwrap().items.len(), 1);
    assert!(f.store.read_image(&f.db, &a).is_ok());
    assert!(f.store.read_image(&f.db, &b).is_err());
}
