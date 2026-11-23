# Execution ledger — 2026-11-23-notes-export.md

- Base: `14a741de66b39a773bc0d34b67e4cbb59d8d9bb5`, branch `codex/notes-export`, managed worktree.
- Original checkout has unrelated user edits; none copied or modified.
- Preflight: converter → service returns HTML/Markdown; service → native renderer returns PDF bytes; service → save returns one artifact. UI snapshots selected notes and blocks duplicate operations.
- Baseline: note/editor focused tests passed, 8 files / 73 tests.
- Ruling: execute inline under the user's instruction to finish; one final reviewer. No separate execution-choice pause.
- Ruling: external images remain explicit links, not automatic network downloads; locally attached images are portable.

## Implementation and review

- Implemented real Quill → semantic HTML/GFM conversion, safe filenames, per-note ZIP folders and local attachment copies, PDF renderer/save commands, draft export, batch selection, static progress and seven locales.
- No export operation saves the editor draft or updates the notes repository.
- No new animation. Export-mode layout uses existing semantic CSS/tokens; the list scrolls independently so selection and footer remain reachable.
- Regression fixes verified with failing tests before fixes: nested checklist indentation, escaped Markdown table pipes (including formula source), code-fence language preservation, unresolved local attachment rejection.
- Fresh reviewer `export_review` found one important issue: asynchronous WebView destruction could race with temporary-directory deletion. Fixed by registering destruction handling before enqueue, transferring cleanup exactly once, reading output first, and retrying off the UI thread. A five-second confirmation timeout never returns successful output; the callback still owns delayed cleanup (up to thirty seconds), with terminal failures logged.
- Actual Windows exclusive-file-lock regression tests failed before the retry implementation and passed afterward, covering delayed unlock, persistent failure, retry and idempotence.
- Re-review approved source changes with no remaining blocking issue; final native verification subsequently passed. Also addressed the minor code-fence-language feedback.
- Commits consolidated into one feature commit after integration verification instead of per-layer intermediate commits. No merge/push.

## Verification evidence (2026-11-23)

- Baseline note/editor tests: 8 files / 73 passed.
- Final focused frontend: `npm test -- src/notes/export src/notes/NotesManagerDialog.test.tsx src/modals/NoteModal.test.tsx src/i18n --maxWorkers=2` — 15 files / 124 passed.
- `npm run build` — passed; existing large-chunk warnings remain.
- Browser acceptance: `$env:PW_PORT='1437'; npx playwright test tests/nowly-note-export.spec.ts --project=1366x768 --workers=1` — 3 passed. Real downloads checked for duplicate-title isolation, unchanged source notes, attachment byte equality and portable links. Layout tested at 1366×768, 1024×600 and 390×844, with screenshots inspected.
- Focused Rust after cleanup fix: `cargo test --manifest-path src-tauri/Cargo.toml --bin nowly note_export -- --nocapture` — 5 passed.
- Native smoke uses `src-tauri/examples/note_export_smoke.rs` with an isolated application identifier, no user database/startup services. It exercises the production WebView2 renderer and atomic writer.
- Native system Save As separately exercised: confirmed save to a Chinese filename and cancellation (`Save cancelled; no output written`). Synthetic sample relocated to the ignored QA directory.
- Final actual PDF after cleanup fix and formatting: `cargo run --manifest-path src-tauri/Cargo.toml --example note_export_smoke -- .superpowers/notes-export/fixture.html .superpowers/notes-export/native.pdf` exited 0. All four Poppler-rendered pages were visually inspected: Chinese/Japanese/Korean, table, code, formula, local image and 100 text lines are legible, without clipping. pypdf assertions confirmed four pages, searchable Chinese heading, line 100 and code. The isolated app cache contains no `note-export-*` directories afterward.
- `cargo check --manifest-path src-tauri/Cargo.toml` passed (existing unrelated dead-code warnings).
- QA artifacts remain ignored in `.superpowers/notes-export/` and `test-results/`, not in the feature commit.

## Full-suite limitations (not an all-green repository)

- Frontend full run: 161 files passed / 2 failed; 1834 tests passed / 3 failed.
  - `src/app/App.test.tsx:230` still queries `便签标题`, absent from the baseline modal. Baseline `NoteModal.test.tsx` explicitly expects no title field.
  - `src/quick-panel/StatusIslandApp.test.tsx:1580,1622` still clicks `AI 助手`, while baseline `BarMenuPanel.tsx` filters the assistant menu entry. The reviewer independently verified these exact baseline conflicts at `14a741d`. No quick-panel files changed.
- Rust full run (before adding the two cleanup regressions): 987 passed / 2 failed / 13 ignored.
  - `attachments::tests::garbage_collection_keeps_referenced_files_and_reclaims_the_rest`: SQL fixture inserts the removed `notes.title` column (`attachments.rs:943`; migration 36 drops it). Both conflicting statements independently confirmed at baseline `14a741d`.
  - `quick_panel::tests::handle_preserves_transparent_chrome_through_runtime_style_and_size_changes`: native test WebView construction fails with Windows error `0x80070057`. Environment/native-fixture failure remains uncorrected; not evidence that all native tests pass.
  - These source files were not modified by export. Existing unused-mut/dead-code warnings remain.
- No installer/release build, original-checkout merge, publish, backup/import feature or multi-document merged PDF is included.
- Browser fallback downloads Markdown/ZIP; PDF requires the Windows desktop runtime.
