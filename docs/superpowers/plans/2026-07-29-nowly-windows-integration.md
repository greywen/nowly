# Nowly Windows System Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reliable login startup, background launch, single-instance activation, stable monitor targeting, display fallback, and shell recovery.

**Architecture:** Dedicated Rust services isolate startup and monitor policy from WorkerW mechanics. Stable Windows display device names are persisted, pure selection chooses saved/primary fallback without overwriting preference, and serialized native reconciliation reuses the existing wallpaper operation lock. Tauri plugins own OS registration and duplicate-process forwarding.

**Tech Stack:** Tauri 2, Rust, Win32 `windows` crate, tauri-plugin-autostart, tauri-plugin-single-instance, React/TypeScript.

---

### Task 1: Startup and single instance
- [ ] Test background-mode decision for wallpaper preference on/off.
- [ ] Implement `--background` parsing and no-focus startup path.
- [ ] Add autostart plugin registration with `--background`; synchronize registration after settings writes.
- [ ] Add single-instance plugin before setup; duplicate launches restore/focus the existing main window.
- [ ] Run Rust tests and commit `feature: add windows startup lifecycle`.

### Task 2: Stable monitor discovery and selection
- [ ] Add tests for saved monitor selection, primary default, disconnect fallback without preference replacement, and reconnect restoration.
- [ ] Implement `MonitorInfo` with Win32 display device name, friendly name fallback, geometry, primary flag, and scale.
- [ ] Expose `list_monitors`; keep enumeration order irrelevant.
- [ ] Run focused tests and commit `feature: enumerate stable windows monitors`.

### Task 3: Targeted wallpaper reconciliation
- [ ] Test pure target selection and serialized reconciliation generations.
- [ ] Position the window on the selected monitor before WorkerW attachment.
- [ ] On display/DPI/taskbar/shell changes, rediscover desktop layers and selected monitor; use primary fallback while preserving the saved ID.
- [ ] Reattach when Explorer recreates WorkerW/Progman.
- [ ] Run Rust tests and commit `feature: reconcile wallpaper display changes`.

### Task 4: Monitor settings UI and stage gate
- [ ] Add repository and settings-dialog tests for monitor loading/selection and failed switch retention.
- [ ] Add typed `listMonitors`, monitor field metadata, loading/error/retry states, and immediate wallpaper reattachment after save.
- [ ] Run `npm test`, `npm run build`, Cargo tests, Playwright, and `git diff --check`.
- [ ] Review critical/important findings, update roadmap/index, and commit `docs: record windows integration completion`.

## Self-review

The plan covers startup registration, silent background policy, duplicate activation, stable monitor IDs, fallback/reconnect, serialized display reconciliation, and Explorer recovery. Installer verification remains stage 7. No placeholders remain.
