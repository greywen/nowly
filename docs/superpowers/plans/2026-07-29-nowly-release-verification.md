# Nowly Release Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to execute every gate and record evidence.

**Goal:** Produce a tested Windows installer and explicit release evidence for automated, manual, performance, installation, and usage requirements.

**Architecture:** Automated suites remain executable gates; Windows-only behavior uses a reproducible manual matrix rather than fake automation. Release documentation records environment, evidence, known limitations, recovery, and uninstall behavior.

**Tech Stack:** Vitest, Playwright, Cargo Test, Tauri bundler (NSIS/MSI), Windows 10/11.

---

### Task 1: Automated release gates
- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Run `cargo test --manifest-path src-tauri/Cargo.toml`.
- [ ] Run `npx playwright test` for all four configured viewports.
- [ ] Run `git diff --check` and static scans for animation, legacy blue, page overflow, emoji/business SVG, and direct Tauri command names outside the adapter.

### Task 2: Installer gate
- [ ] Run `npm run tauri build` and record produced MSI/NSIS paths and checksums.
- [ ] Install cleanly, launch, upgrade over the previous build, and uninstall while documenting whether user SQLite data remains.
- [ ] Verify Start menu and uninstall entries and non-admin failure messaging.

### Task 3: Windows manual matrix
- [ ] Verify Windows 10 and 11 foreground/wallpaper/close/tray paths.
- [ ] Verify login background startup and duplicate launch activation.
- [ ] Verify primary/secondary target, disconnect fallback, reconnect, negative coordinates, 100/125/150% scaling.
- [ ] Verify Explorer restart and taskbar top/bottom/left/right plus auto-hide.
- [ ] Verify full CRUD persistence and event-task links after restart.

### Task 4: Resource and documentation gate
- [ ] Record idle CPU/GPU/memory after five minutes in foreground, wallpaper, and tray modes.
- [ ] Write user guide, troubleshooting, data location, exit behavior, and known limitations.
- [ ] Review release evidence, fix blocking findings, rerun affected gates, update roadmap/index, and commit `docs: complete nowly release verification`.

## Self-review

Every approved release dimension has an explicit executable or manual gate; no Windows-native behavior is mislabeled automated and no placeholders remain.
