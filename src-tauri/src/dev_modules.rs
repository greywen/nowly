use crate::error::CommandError;
use serde::Serialize;
use std::path::Path;
use tauri::Manager;

// A work-in-progress module file discovered under the app's `dev-modules/`
// directory. This is the desktop counterpart to channel B's compile-time glob:
// there, Vite inlines `dev-modules/*.js` from the repo at build time; here, the
// installed app reads the user's real `%APPDATA%/nowly/dev-modules/` at runtime
// so the in-app workbench (channel A) can preview drafts an AI tool wrote to a
// path that is stable across machines. See docs/custom-modules/preview.md.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevModule {
    // Just the file name, e.g. "my-module.js". The frontend uses it as the
    // stable key and display label; the full path stays on the backend.
    pub name: String,
    pub source: String,
}

// Read every `*.js` file directly under `dir`, sorted by file name so the
// workbench list is stable across reloads. A missing directory is not an error:
// a fresh install simply has no drafts yet, so we return an empty list. Pure
// (takes the directory as an argument) so it can be unit-tested without Tauri.
pub fn read_dev_modules(dir: &Path) -> Result<Vec<DevModule>, CommandError> {
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let entries = std::fs::read_dir(dir).map_err(CommandError::system)?;
    let mut modules = Vec::new();
    for entry in entries {
        let entry = entry.map_err(CommandError::system)?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        // Only `.js` drafts; ignore editor swap files, `.map`, dotfiles, etc.
        if path.extension().and_then(|ext| ext.to_str()) != Some("js") {
            continue;
        }
        let name = match path.file_name().and_then(|name| name.to_str()) {
            Some(name) => name.to_owned(),
            None => continue,
        };
        let source = std::fs::read_to_string(&path).map_err(CommandError::system)?;
        modules.push(DevModule { name, source });
    }
    modules.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(modules)
}

#[tauri::command]
pub fn list_dev_modules(app: tauri::AppHandle) -> Result<Vec<DevModule>, CommandError> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(CommandError::system)?
        .join("dev-modules");
    read_dev_modules(&dir)
}

#[cfg(test)]
mod tests {
    use super::{read_dev_modules, DevModule};

    fn temp_dir(suffix: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("nowly-dev-modules-{suffix}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn missing_directory_is_empty_not_an_error() {
        let dir = std::env::temp_dir().join("nowly-dev-modules-does-not-exist");
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(read_dev_modules(&dir).unwrap(), Vec::new());
    }

    #[test]
    fn reads_js_files_sorted_by_name() {
        let dir = temp_dir("sorted");
        std::fs::write(dir.join("b.js"), "// b").unwrap();
        std::fs::write(dir.join("a.js"), "// a").unwrap();
        let modules = read_dev_modules(&dir).unwrap();
        assert_eq!(
            modules,
            vec![
                DevModule { name: "a.js".into(), source: "// a".into() },
                DevModule { name: "b.js".into(), source: "// b".into() },
            ]
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn ignores_non_js_files_and_subdirectories() {
        let dir = temp_dir("filter");
        std::fs::write(dir.join("keep.js"), "keep").unwrap();
        std::fs::write(dir.join("notes.txt"), "skip").unwrap();
        std::fs::write(dir.join("module.js.map"), "skip").unwrap();
        std::fs::create_dir_all(dir.join("nested")).unwrap();
        std::fs::write(dir.join("nested").join("inner.js"), "skip").unwrap();
        let names: Vec<String> = read_dev_modules(&dir)
            .unwrap()
            .into_iter()
            .map(|m| m.name)
            .collect();
        assert_eq!(names, vec!["keep.js"]);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
