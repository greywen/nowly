//! Run the production renderer without loading Nowly's database or startup
//! services: cargo run --example note_export_smoke -- input.html output.pdf
//! Add --dialog to exercise the production Save As dialog (cancel writes nothing).
#![allow(dead_code)]
#[path = "../src/error.rs"]
mod error;
#[path = "../src/note_export.rs"]
mod note_export;
#[path = "../src/note_export/save.rs"]
mod save;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    assert!(
        args.len() == 3 || args.len() == 4,
        "Expected input.html output.pdf [--dialog]"
    );
    let use_dialog = args.get(3).is_some_and(|arg| arg == "--dialog");
    let html = std::fs::read_to_string(&args[1]).expect("read input");
    let destination = std::path::PathBuf::from(&args[2]);
    let mut context = tauri::generate_context!();
    context.config_mut().identifier = "com.nowly.export-smoke".into();
    context.config_mut().app.windows.clear();
    tauri::Builder::default()
        .setup(move |app| {
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let result = note_export::pdf::render(&handle, &html).and_then(|bytes| {
                    let target = if use_dialog {
                        save::choose_path(
                            destination
                                .file_name()
                                .unwrap()
                                .to_string_lossy()
                                .into_owned(),
                            0,
                        )?
                    } else {
                        Some(destination.clone())
                    };
                    if let Some(target) = target {
                        note_export::write_atomic(&target, &bytes)?;
                        println!("PDF saved: {}", target.display());
                    } else {
                        println!("Save cancelled; no output written");
                    }
                    Ok(())
                });
                match result {
                    Ok(()) => handle.exit(0),
                    Err(error) => {
                        eprintln!("PDF failed: {error:?}");
                        handle.exit(1);
                    }
                }
            });
            Ok(())
        })
        .build(context)
        .expect("build isolated export harness")
        .run(|_, event| {
            // The renderer destroys its hidden window before Save As opens.
            // Keep this windowless harness alive until the worker explicitly exits.
            if let tauri::RunEvent::ExitRequested {
                code: None, api, ..
            } = event
            {
                api.prevent_exit();
            }
        });
}
