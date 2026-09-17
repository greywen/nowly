# Nowly Bar AI Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the existing AI calendar/task assistant as a morphing composer and sheet inside Nowly Bar.

**Architecture:** `StatusIslandApp` coordinates status, compact composer, and assistant-sheet states in the existing `quick-panel-handle` window. `AssistantDock` gains an embedded-bar presentation and host callbacks while retaining all conversation and execution logic. Rust restores the Nowly panel source so the same native window grows only after submission.

**Tech Stack:** React, TypeScript, Vitest, Tauri 2, Rust, CSS.

---

### Task 1: Restore the interactive Nowly source

**Files:**
- Modify: `src-tauri/src/quick_panel.rs`
- Modify: `src-tauri/src/main.rs`
- Test: `src-tauri/src/quick_panel.rs`

- [ ] Add a Rust test asserting that `PanelSource::Nowly` can take over the single open sheet and that toggling it again closes the sheet.
- [ ] Run `cargo test quick_panel::tests::opening_the_other_half_swaps_the_sheet_instead_of_closing_it` from `src-tauri` and verify it fails because `PanelSource::Nowly` is absent.
- [ ] Restore `PanelSource::Nowly`, `toggle_nowly_panel`, and source-aware acknowledgement without restoring hover-open behavior for the logo.
- [ ] Register `toggle_nowly_panel` in the Tauri invoke handler.
- [ ] Re-run the focused Rust test and verify it passes.

### Task 2: Add the compact bar composer contract

**Files:**
- Modify: `src/assistant/AssistantDock.tsx`
- Modify: `src/assistant/AssistantDock.test.tsx`
- Modify: `src/assistant/assistant.css`

- [ ] Add failing tests for the embedded presentation: focusing does not expand the full sheet, submitting reports expansion, the user message appears immediately, and Escape reports compact close.
- [ ] Run `npm test -- src/assistant/AssistantDock.test.tsx` and verify the new tests fail for missing embedded props and behavior.
- [ ] Add an `embedded` presentation plus `autoFocus`, `onSubmit`, `onExpandedChange`, and `onRequestClose` callbacks with default floating behavior unchanged.
- [ ] Add scoped embedded CSS so the composer and panel participate in the rail layout rather than using the main-app absolute positioning.
- [ ] Re-run the focused assistant tests and verify they pass.

### Task 3: Integrate the assistant into Nowly Bar

**Files:**
- Modify: `src/app/layout/StatusIsland.tsx`
- Modify: `src/quick-panel/StatusIslandApp.tsx`
- Modify: `src/quick-panel/StatusIslandApp.test.tsx`
- Modify: `src/app/styles.css`
- Modify: `src/i18n/translations.ts`

- [ ] Replace the existing no-AI-entry assertion with failing tests for a clickable logo, a full-rail composer takeover, automatic focus, compact Escape, and submit-driven sheet growth.
- [ ] Run `npm test -- src/quick-panel/StatusIslandApp.test.tsx` and verify the new tests fail because the logo is branding-only.
- [ ] Make the logo a button and add assistant header/body slots to `TopRail`.
- [ ] Add `status`, `composer`, and `assistant` surface coordination in `StatusIslandApp`; invoke `toggle_nowly_panel` only after submission and close it through the existing collapse path.
- [ ] Add rail-scoped CSS using the existing grow/shrink variables and cover the complete width through the rightmost action boundary.
- [ ] Add Chinese and English accessibility strings for the assistant entry and compact close action.
- [ ] Re-run the focused Nowly Bar tests and verify they pass.

### Task 4: Regression and delivery

**Files:**
- Test: `src/assistant/AssistantDock.test.tsx`
- Test: `src/quick-panel/StatusIslandApp.test.tsx`
- Test: `src-tauri/src/quick_panel.rs`

- [ ] Run the two focused frontend test files.
- [ ] Run `cargo test quick_panel::tests` from `src-tauri`.
- [ ] Run `npm test`.
- [ ] Run `cargo test` from `src-tauri`.
- [ ] Run `npm run build`.
- [ ] Run `cargo fmt --check` from `src-tauri`.
- [ ] Run `git diff --check`.
- [ ] Review `git diff` to keep pre-existing calendar-form changes separate and ensure no credential material is present.
- [ ] Commit the approved design, implementation, tests, and related existing Nowly Bar naming changes with repository-format commit messages.
