# Nowly Settings and Window Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the approved settings and make Rust the authority for foreground, wallpaper, and hidden-to-tray lifecycle behavior.

**Architecture:** A focused Rust settings module validates and transactionally replaces the typed settings document. A lifecycle module owns `WindowMode` and pure close decisions, while Tauri adapters perform native effects and publish events only after success. React edits copied settings in an accessible dialog, relies on repository IPC, and clears the overlay stack before native close handling continues.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Tauri 2, Rust, rusqlite, Win32, lucide-react.

---

## File map

- `src-tauri/src/settings.rs`, `commands.rs`, `models.rs`: typed validation, transactional update, IPC.
- `src-tauri/src/window_lifecycle.rs`: authoritative mode and close-decision state machine.
- `src-tauri/src/main.rs`, `wallpaper.rs`: native effects, close handshake, expanded tray commands.
- `src/data/nowly-repository.ts`, `tauri-nowly-repository.ts`: sole frontend command boundary.
- `src/settings/SettingsDialog.tsx`, `src/settings/useSettings.ts`: copied draft UI and write ownership.
- `src/app/App.tsx`, `src/modals/ModalRoot.tsx`, `src/lib/modal-store.ts`: settings entry and overlay cleanup.
- `src/app/styles.css`: design-system-compliant settings dialog.

### Task 1: Persist validated settings

- [ ] Add Rust tests proving valid complete settings replace all keys atomically and invalid enums do not alter storage.
- [ ] Run `cargo test --manifest-path src-tauri/Cargo.toml settings::tests -- --nocapture`; expect RED because update support is absent.
- [ ] Implement `write_app_settings` with an Immediate transaction, fixed key list, JSON serialization, and validation for density/week-start/date-format.
- [ ] Add `update_app_settings` command returning the reread document and map internal failures to `CommandError`.
- [ ] Run the focused Rust tests; expect PASS.
- [ ] Commit with `feature: persist application settings`.

### Task 2: Establish authoritative lifecycle decisions

- [ ] Add pure Rust tests for `Foreground`, `Wallpaper`, `HiddenToTray`, successful transitions, wallpaper-enabled close, tray close, and wallpaper-failure fallback.
- [ ] Run `cargo test --manifest-path src-tauri/Cargo.toml window_lifecycle::tests -- --nocapture`; expect RED because the module is absent.
- [ ] Implement synchronized lifecycle state plus `CloseAction::{Wallpaper, HideToTray}` and stable camelCase mode values.
- [ ] Adapt wallpaper/foreground commands to update preference only after native success and emit mode afterward; expose `get_window_mode`.
- [ ] Add a `request-overlay-cleanup`/`overlay-cleanup-complete` close handshake and hide fallback.
- [ ] Run focused and complete Rust tests; expect PASS.
- [ ] Commit with `feature: own window lifecycle in rust`.

### Task 3: Add typed frontend settings state

- [ ] Extend repository tests for `update_app_settings` and `get_window_mode`; run the focused test and observe RED.
- [ ] Add repository types/methods and a `useSettings` test proving successful replace, error preservation, and retry.
- [ ] Run hook tests and observe RED because the hook is absent.
- [ ] Implement the repository adapter and `useSettings` without optimistic false-success state.
- [ ] Run focused tests; expect PASS.
- [ ] Commit with `feature: add settings state owner`.

### Task 4: Build the settings dialog

- [ ] Add component tests for visible labels, Good native checks/radios, copied drafts, cancel, save pending text, and write-error retention.
- [ ] Run the component test and observe RED because the dialog is absent.
- [ ] Implement the dialog using `Dialog`, `Select`, native checkbox/radio controls, no animation, and all approved setting fields except monitor choices (stage 6 supplies enumerated options).
- [ ] Add only semantic `.settings-*` styles using root tokens and internal body scrolling.
- [ ] Run component tests and `npm run build`; expect PASS.
- [ ] Commit with `feature: add application settings dialog`.

### Task 5: Integrate overlays, mode events, and tray actions

- [ ] Add App tests proving the settings button opens the dialog, tray settings events open it in foreground, native mode is queried, and overlay cleanup removes the top layer before acknowledgement.
- [ ] Run `npm test -- src/app/App.test.tsx`; expect RED.
- [ ] Add the top-bar settings action, Settings modal state, lifecycle listeners, authoritative mode query, and cleanup acknowledgement.
- [ ] Expand the tray menu to open, toggle wallpaper preference/mode, open settings, and exit; synchronize labels from persisted preference.
- [ ] Run App and Rust tests; expect PASS.
- [ ] Commit with `feature: connect settings and window lifecycle`.

### Task 6: Stage gate and review

- [ ] Add Playwright coverage for dialog accessibility, no page overflow, persistence IPC, and no animation/legacy token regressions.
- [ ] Run `npm test`, `npm run build`, `cargo test --manifest-path src-tauri/Cargo.toml`, and focused Playwright suites.
- [ ] Run `git diff --check` and inspect 1366×768 plus large viewport screenshots.
- [ ] Review against the complete-product spec; fix all critical/important findings and rerun gates.
- [ ] Mark this plan and the roadmap stage complete; commit with `docs: record window lifecycle stage completion`.

## Self-review

The tasks cover complete typed persistence, authoritative native state, close preference/fallback, overlay cleanup, settings UI errors, and expanded tray actions. Monitor enumeration and startup registration remain deliberately in stage 6. Names are consistent (`update_app_settings`, `get_window_mode`, `window-mode-changed`, `request-overlay-cleanup`, `overlay-cleanup-complete`) and no placeholders remain.
