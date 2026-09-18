# Nowly Bar AI Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open the complete Nowly Bar AI conversation directly from the Logo and unify the status/AI close-button styling.

**Architecture:** `StatusIslandApp` coordinates only `status` and `assistant` surfaces. Logo activation immediately requests the native `408×440px` Nowly panel; `AssistantDock` becomes active and expanded only after the native open event. `TopRail` gives both panels one shared close-button variant.

**Tech Stack:** React, TypeScript, Vitest, Playwright, Tauri 2, Rust, CSS.

---

### Task 1: Replace the compact intermediate state with direct native opening

**Files:**
- Modify: `src/quick-panel/StatusIslandApp.tsx`
- Test: `src/quick-panel/StatusIslandApp.test.tsx`

- [x] Write failing tests asserting that Logo click immediately invokes `toggle_nowly_panel`, exposes no assistant input before the native event, and activates the complete assistant after that event.
- [x] Remove the `composer` rail surface, submit-driven expansion callbacks, and local compact open/close branches.
- [x] Prevent status hover opening while the native AI open request is pending.
- [x] Verify focused Nowly Bar tests pass.

### Task 2: Open the embedded conversation whenever its native panel is active

**Files:**
- Modify: `src/assistant/AssistantDock.tsx`
- Test: `src/assistant/AssistantDock.test.tsx`

- [x] Replace compact-on-focus expectations with immediate embedded expansion.
- [x] Expand the embedded conversation when `active` becomes true and keep submission inside the existing full panel.
- [x] Preserve input focus, draft state, request safety, Escape handling, voice/send switching, and floating presentation behavior.
- [x] Verify focused AssistantDock tests pass.

### Task 3: Share one close-button presentation

**Files:**
- Modify: `src/app/layout/StatusIsland.tsx`
- Modify: `src/app/styles.css`
- Test: `src/app/layout/StatusIsland.test.tsx`

- [x] Add a failing structural assertion requiring both expanded close buttons to use `status-rail__panel-close`.
- [x] Apply the shared class to status and AI close buttons.
- [x] Move `40×40px`, radius, hover color/background, and transition styling to the shared class.
- [x] Verify focused layout tests pass.

### Task 4: Remove obsolete state references and verify

**Files:**
- Modify: `design.md`
- Modify: `docs/superpowers/specs/2026-09-17-nowly-bar-ai-assistant-design.md`
- Modify: `docs/superpowers/plans/2026-09-17-nowly-bar-ai-assistant.md`
- Modify: `tests/nowly-bar-assistant.spec.ts`

- [x] Remove the compact rail state from authoritative design and plan documentation.
- [x] Update browser assertions for direct full-panel opening and shared close styling.
- [x] Run focused component tests and Nowly Bar Playwright checks.
- [x] Run the full frontend suite, production build, and `git diff --check`.
