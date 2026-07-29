# Nowly Windows Product Implementation Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement each linked plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved Nowly Windows 10/11 product as seven independently testable vertical stages.

**Architecture:** React feature repositories call typed Tauri commands; Rust validates requests and persists data in versioned SQLite transactions; isolated Windows services own wallpaper, tray, startup, and monitor behavior. Each stage leaves the application buildable and usable before the next stage starts.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Playwright, Tauri 2, Rust, rusqlite/SQLite, Win32 `windows` crate, lucide-react.

---

**Approved specification:** `docs/superpowers/specs/2026-07-29-nowly-windows-complete-product-design.md`

## Plan sequence

1. **Data foundation and empty startup**
   Plan: `docs/superpowers/plans/2026-07-29-nowly-data-foundation.md`
   Outcome: versioned migrations, typed settings/data IPC, repository injection, static loading/error states, empty production startup, and prototype-aligned empty widgets.

2. **Event vertical slice**
   Planned document: `docs/superpowers/plans/2026-07-29-nowly-events.md`
   Outcome: month queries, date detail, event creation/edit/delete, validation, offline date/time pickers, permanent-delete confirmation, and calendar refresh.

3. **Task vertical slice**
   Planned document: `docs/superpowers/plans/2026-07-29-nowly-tasks.md`
   Outcome: quadrant ordering, task creation/edit/delete/completion, event-task transactional linking, and failed-completion rollback.

4. **Note vertical slice**
   Planned document: `docs/superpowers/plans/2026-07-29-nowly-notes.md`
   Outcome: note creation/edit/delete, pinning, fixed colors, dashboard summaries, and the all-notes dialog.

5. **Settings and window lifecycle**
   Planned document: `docs/superpowers/plans/2026-07-29-nowly-window-lifecycle.md`
   Outcome: persisted settings, authoritative window mode, close-to-wallpaper/close-to-tray decision, overlay cleanup, and expanded tray actions.

6. **Windows system integration**
   Planned document: `docs/superpowers/plans/2026-07-29-nowly-windows-integration.md`
   Outcome: login startup, background launch, single instance, stable monitor enumeration/selection, disconnect fallback, display-change handling, and Explorer recovery.

7. **Release verification**
   Planned document: `docs/superpowers/plans/2026-07-29-nowly-release-verification.md`
   Outcome: full automated suites, Windows 10/11 manual matrix, idle-resource checks, installer verification, usage documentation, and known limitations.

## Sequencing rules

- Execute plans in order because later slices depend on the data/repository contracts established in stage 1.
- Write the next detailed stage plan only after the preceding stage passes its tests and review; this keeps exact paths and APIs synchronized with the actual codebase.
- Every production behavior follows Red-Green-Refactor: add one failing test, verify the expected failure, implement the minimum, verify green, then refactor.
- Use the commit format required by `CLAUDE.md`: `<type>: <short description>`.
- Do not rewrite the existing WorkerW/taskbar subsystem during business CRUD stages.
- Before every UI edit, reread root `design.md`; it overrides the prototype and older styles.
- Do not introduce transitions, animations, smooth scrolling, spinners, skeleton shimmer, legacy blue tokens, hand-written business SVG, or emoji icons.

## Stage gates

A stage may close only when:

- its focused Rust and React tests pass;
- `npm test`, `npm run build`, and `cargo test --manifest-path src-tauri/Cargo.toml` pass;
- changed UI has no page-level overflow and follows `design.md`;
- `git diff --check` is clean;
- the stage receives code review before the next detailed plan is written.
