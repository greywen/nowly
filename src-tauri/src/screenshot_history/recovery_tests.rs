use super::tests::Fixture;
#[cfg(windows)]
fn locked(path: &std::path::Path, share: u32) -> std::fs::File {
    use std::os::windows::fs::OpenOptionsExt;
    std::fs::OpenOptions::new()
        .read(true)
        .share_mode(share)
        .open(path)
        .unwrap()
}
#[cfg(windows)]
#[test]
fn screenshot_history_pending_unreadable_png_is_retained_until_retry() {
    let f = Fixture::new();
    let id = f.archive(1, &Fixture::image());
    let entry = f.store.list(&f.db, None).unwrap().items.remove(0);
    let path = f.store.archive_dir().join(entry.file_name);
    f.db.lock()
        .unwrap()
        .execute(
            "UPDATE screenshot_history SET state='pending' WHERE id=?1",
            [&id],
        )
        .unwrap();
    // Deny reads while permitting deletion: recovery must not mistake read failure for corruption.
    let held = locked(&path, 4);
    assert!(f.store.recover(&f.db).is_err());
    let state: String =
        f.db.lock()
            .unwrap()
            .query_row(
                "SELECT state FROM screenshot_history WHERE id=?1",
                [&id],
                |r| r.get(0),
            )
            .unwrap();
    assert_eq!(state, "pending");
    assert!(path.exists());
    drop(held);
    f.store.recover(&f.db).unwrap();
    assert!(f.store.read_image(&f.db, &id).is_ok());
}
#[cfg(windows)]
#[test]
fn screenshot_history_failed_delete_stays_listable_and_can_retry_after_reopen() {
    let f = Fixture::new();
    let id = f.archive(1, &Fixture::image());
    let entry = f.store.list(&f.db, None).unwrap().items.remove(0);
    let path = f.store.archive_dir().join(entry.file_name);
    let held = locked(&path, 1);
    assert!(f.store.delete(&f.db, &id).is_err());
    let reopened = super::store::HistoryStore::new(f.root.join("pictures"), f.root.join("cache"));
    assert!(reopened.recover(&f.db).is_err());
    let page = reopened.list(&f.db, None).unwrap();
    assert_eq!(page.items.len(), 1);
    assert_eq!(page.items[0].id, id);
    assert!(!page.items[0].available);
    assert!(reopened.read_image(&f.db, &id).is_err());
    drop(held);
    reopened.delete(&f.db, &id).unwrap();
    assert!(reopened.list(&f.db, None).unwrap().items.is_empty());
}
#[test]
fn screenshot_history_pending_confirmed_corrupt_png_is_cleaned() {
    let f = Fixture::new();
    let id = f.archive(1, &Fixture::image());
    let entry = f.store.list(&f.db, None).unwrap().items.remove(0);
    let path = f.store.archive_dir().join(entry.file_name);
    std::fs::write(&path, vec![0; entry.byte_size as usize]).unwrap();
    f.db.lock()
        .unwrap()
        .execute(
            "UPDATE screenshot_history SET state='pending' WHERE id=?1",
            [&id],
        )
        .unwrap();
    f.store.recover(&f.db).unwrap();
    assert!(!path.exists());
    assert!(f.store.list(&f.db, None).unwrap().items.is_empty());
}
