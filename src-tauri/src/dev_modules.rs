use crate::error::CommandError;
use serde::Serialize;
use std::path::Path;
use tauri::Manager;

// A work-in-progress module file discovered under the app's `dev-modules/`
// directory. This is the desktop counterpart to channel B's compile-time glob:
// there, Vite inlines `dev-modules/*.js` from the repo at build time. Here, the
// in-app workbench (channel A) reads them at runtime. Where it reads depends on
// the build (see `resolve_dev_modules_dir`): a dev build reads the repo's own
// `dev-modules/` so both channels share one folder; an installed app reads the
// user's real app-data `dev-modules/` (Windows: `%APPDATA%/com.nowly.app/
// dev-modules/`), a path that is stable across machines. See
// docs/custom-modules/preview.md.
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

// Decide where `dev-modules/` lives for the current build. Pure (no Tauri, no
// filesystem) so both branches are unit-testable.
//
// - Dev build (`tauri dev`, `is_dev == true`): the repo's own `dev-modules/`,
//   i.e. the parent of `src-tauri` (`manifest_dir`). This makes the in-app
//   workbench (channel A) and the browser preview (channel B) share one folder,
//   so an AI tool writes a draft once and both surfaces see it — no copying.
// - Prod build (installed app, `is_dev == false`): the app-data `dev-modules/`
//   (Windows: `%APPDATA%/com.nowly.app/dev-modules/`). The manifest dir is a
//   build-machine path that does not exist on the user's machine, so it is
//   ignored here.
pub fn resolve_dev_modules_dir(
    app_data_dir: &Path,
    is_dev: bool,
    manifest_dir: &Path,
) -> std::path::PathBuf {
    if is_dev {
        // `manifest_dir` is `<repo>/src-tauri`; its parent is the repo root.
        // Fall back to the manifest dir itself if there is somehow no parent.
        manifest_dir
            .parent()
            .unwrap_or(manifest_dir)
            .join("dev-modules")
    } else {
        app_data_dir.join("dev-modules")
    }
}

// Resolve the `dev-modules/` directory for the running app. Shared by both the
// list command and the path command so they can never disagree on where drafts
// live. `debug_assertions` is on for `tauri dev` and off for `tauri build`, so
// it cleanly distinguishes dev from prod.
fn dev_modules_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, CommandError> {
    let app_data_dir = app.path().app_data_dir().map_err(CommandError::system)?;
    Ok(resolve_dev_modules_dir(
        &app_data_dir,
        cfg!(debug_assertions),
        Path::new(env!("CARGO_MANIFEST_DIR")),
    ))
}

#[tauri::command]
pub fn list_dev_modules(app: tauri::AppHandle) -> Result<Vec<DevModule>, CommandError> {
    read_dev_modules(&dev_modules_dir(&app)?)
}

// Return the absolute path of the active `dev-modules/` directory as a string.
// In a dev build this is the repo's own `dev-modules/`; in a prod build it is
// the app-data one (see `resolve_dev_modules_dir`). The workbench shows it in
// its empty state so the user (or an AI tool) knows exactly where to drop
// drafts. Resolved on the backend rather than hardcoded in the UI because the
// location is OS-specific and mode-specific and must stay correct everywhere.
// Creates the directory if missing so the shown path always exists.
#[tauri::command]
pub fn dev_modules_dir_path(app: tauri::AppHandle) -> Result<String, CommandError> {
    let dir = dev_modules_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(CommandError::system)?;
    Ok(dir.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::{read_dev_modules, resolve_dev_modules_dir, DevModule};
    use std::path::{Path, PathBuf};

    #[test]
    fn dev_build_reads_repo_dev_modules_not_app_data() {
        // In a dev build, drafts live in the repo's own dev-modules/ (the
        // parent of src-tauri), so the in-app workbench (channel A) and the
        // browser preview (channel B) share one folder. app_data_dir must be
        // ignored here.
        let app_data = Path::new("/some/app-data");
        let manifest = Path::new("/home/me/nowly/src-tauri");
        let resolved = resolve_dev_modules_dir(app_data, true, manifest);
        assert_eq!(resolved, PathBuf::from("/home/me/nowly/dev-modules"));
    }

    #[test]
    fn prod_build_reads_app_data_dev_modules_not_repo() {
        // In a production build, drafts live in the installed app's app-data
        // dev-modules/. The manifest dir (a build-machine path) must be ignored.
        let app_data = Path::new("/user/app-data");
        let manifest = Path::new("/home/me/nowly/src-tauri");
        let resolved = resolve_dev_modules_dir(app_data, false, manifest);
        assert_eq!(resolved, PathBuf::from("/user/app-data/dev-modules"));
    }

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
                DevModule {
                    name: "a.js".into(),
                    source: "// a".into()
                },
                DevModule {
                    name: "b.js".into(),
                    source: "// b".into()
                },
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
