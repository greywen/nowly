#[test]
fn screen_capture_archives_before_copy_and_saves_without_dialog() {
    let source = include_str!("../screen_capture.rs");
    let copy = source
        .split("pub fn copy_capture_to_clipboard(")
        .nth(1)
        .unwrap()
        .split("pub fn save_capture_to_file(")
        .next()
        .unwrap();
    assert!(
        copy.contains("history::archive"),
        "copy must archive final PNG first"
    );
    assert!(copy.find("history::archive").unwrap() < copy.find("run_clipboard").unwrap());
    let save = source
        .split("pub fn save_capture_to_file(")
        .nth(1)
        .unwrap()
        .split("fn build_export_request(")
        .next()
        .unwrap();
    assert!(save.contains("history::archive"));
    assert!(!save.contains("choose_png_path"));
    assert!(copy.contains("archived_copy_error"));
    assert!(source.contains("图片已保存，但复制失败"));
}
