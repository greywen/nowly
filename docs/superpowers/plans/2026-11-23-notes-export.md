# Notes Export Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Export one or multiple notes as readable PDF or portable Markdown, including attachments.

**Architecture:** A pure preparation/packaging service snapshots notes and resolves attachments. A lazy rich-text converter uses the existing Quill model to generate sanitized semantic HTML and GFM. Native Windows commands render HTML via WebView2 and save a single PDF/MD/ZIP with an OS save dialog. React controls own selection and status, never mutate notes.

**Tech Stack:** React, TypeScript, Quill, Turndown/GFM, fflate, Tauri/Rust, WebView2.

**Spec:** `docs/superpowers/specs/2026-11-23-notes-export-design.md`

## Task 1: Content and archive

Files: `src/notes/export/{content,archive,service}.ts` and corresponding tests.

- [x] Write failing tests for real Delta/legacy conversions, lists, tables, links, formulas, filenames, duplicate titles, portable attachments, missing attachments and empty selection.
- [x] Run `npm test -- src/notes/export`; observe failure before implementing.
- [x] Implement a `NoteExportFormat = 'pdf' | 'markdown'` service returning `{name: string, bytes: Uint8Array}`. Inject the native PDF renderer at the I/O boundary.
- [x] Real Quill serialization, allowlisted URLs, GFM conversion, and `fflate.zipSync` must be exercised in tests (not mocked).
- [x] Rerun tests. Commit is consolidated with the other export layers after final review.

## Task 2: Windows output

Files: `src-tauri/src/note_export.rs`, `src-tauri/src/note_export/{pdf,save}.rs`, `src-tauri/src/main.rs`.

- [x] Write validation and atomic-output tests first; run `cargo test --manifest-path src-tauri/Cargo.toml note_export`.
- [x] Implement renderer with a private temporary directory and hidden, navigation-restricted WebView2 window. Callback completion, bounded timeout and cleanup are required.
- [x] Implement save command with raw IPC bytes, main-window check, file type/name/size validation, OS confirmation, and staged replacement.
- [x] Run focused Rust tests and `cargo check --manifest-path src-tauri/Cargo.toml`.

## Task 3: User flow and localization

Files: `src/notes/NotesManagerDialog.tsx`, `src/modals/NoteModal.tsx`, `src/notes/export/NoteExportControls.tsx`, feature CSS/translations and tests.

- [x] Add failing UI tests for entering export, individual selection, all/none, selected count, disabled empty submit, in-flight guard, failure/retry and single draft snapshot.
- [x] Implement controls and native adapter. Browser mode supports Markdown download and clearly explains desktop-only PDF.
- [x] Integrate all seven locales; run note/modal/i18n tests.

## Task 4: Verification and review

- [x] Run `npm run build`, focused and full frontend tests, Rust tests. Unrelated full-suite failures are recorded in the ledger.
- [x] Add browser acceptance tests for selection and downloaded ZIP contents.
- [x] Run isolated native PDF smoke harness; extract Chinese text and render PDF pages for inspection.
- [x] Request a fresh-context code review under requesting-code-review; repair important findings with regression tests.
- [x] Record evidence and limitations, commit scoped changes, retain worktree for review. Do not merge/push.
