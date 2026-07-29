# Good Offline Single Date Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the event and task native date inputs with one shared, offline Good-style single-date picker while preserving the main calendar and completing the approved unchecked-control contrast fix.

**Architecture:** Two semantic button triggers store ISO dates in `data-value` and share one popup controller rendered inside the dialog layer. Vanilla JavaScript generates a Monday-first 42-day grid, manages focus and keyboard navigation, and updates only the active trigger; CSS reproduces Good Date Range Picker surfaces using existing design tokens and no animation.

**Tech Stack:** HTML5, native CSS, vanilla JavaScript, inline SVG, Playwright, TypeScript, Markdown

---

## File Structure

- Modify `tests/nowly-prototype.spec.ts`: add contracts for trigger structure, shared popup, date state, keyboard behavior, closure, and checkbox contrast.
- Modify `docs/prototypes/nowly-final-uiux.html`: add the two triggers, shared popup, CSS, and controller.
- Modify `design.md`: document the date picker and corrected unchecked-control contrast.
- Modify `docs/00-index.md`: link the date-picker specification and plan.

### Task 1: Complete unchecked-control contrast

**Files:**
- Modify: `tests/nowly-prototype.spec.ts`
- Modify: `docs/prototypes/nowly-final-uiux.html`
- Modify: `design.md`

- [ ] Run the already-modified `Good solid checkbox states` test and verify it fails with actual `rgb(246, 241, 233)` instead of expected `rgb(218, 211, 195)`.
- [ ] Change `.form-check-solid .form-check-input:not(:checked)` to `background-color: var(--border-emphasis)`.
- [ ] Change the unchecked background rule in `design.md` from `#F6F1E9` to `#DAD3C3`, retaining zero border.
- [ ] Run the focused test and verify it passes.

### Task 2: Establish date-picker contracts

**Files:**
- Modify: `tests/nowly-prototype.spec.ts`

- [ ] Add a test asserting no `input[type="date"]`, exactly two `[data-date-picker]` triggers, visible formatted values, and `aria-haspopup="dialog"`.
- [ ] Add a test opening the event date picker and asserting one visible dialog named `选择日期`, 42 date buttons, seven column headers, and selected `2026年7月23日`.
- [ ] Add a test selecting `2026年7月24日`, asserting trigger text and `data-value` update, popup closure, and focus return.
- [ ] Add a test for next-month navigation, Today, Clear, outside click, and Escape.
- [ ] Add a keyboard test for ArrowRight and Enter changing July 23 to July 24.
- [ ] Run the focused tests and verify they fail because the native date inputs and no popup remain.

### Task 3: Build trigger and popup visual system

**Files:**
- Modify: `docs/prototypes/nowly-final-uiux.html`

- [ ] Add `i-calendar-days` to the inline SVG sprite.
- [ ] Replace `event-date` and `task-due` native inputs with button triggers carrying `data-date-picker`, `data-value="2026-07-23"`, accessible labels, `aria-haspopup="dialog"`, and `aria-expanded="false"`.
- [ ] Add one hidden `.date-picker-popup` inside `.dialog-layer` with header navigation, month title, weekday headers, `role="grid"`, and footer actions.
- [ ] Add CSS for a 320px white popup, `15.2px` radius, dropdown shadow, 42-cell grid, selected/today/off-month states, and Good Solid triggers.
- [ ] Ensure the popup has no transition, animation, blur, or external dependency.

### Task 4: Implement date state and accessibility

**Files:**
- Modify: `docs/prototypes/nowly-final-uiux.html`

- [ ] Implement ISO parsing/formatting without timezone drift using numeric year/month/day parts.
- [ ] Generate a Monday-first 42-day grid for the displayed month.
- [ ] Open against the active trigger, render its selected month, set ARIA states, and focus selected date.
- [ ] Implement previous/next month, fixed Today (`2026-07-23`), Clear, date selection, outside click, and Escape.
- [ ] Implement ArrowLeft/Right/Up/Down, PageUp/PageDown, Enter, and Space.
- [ ] Close the picker whenever the parent business dialog closes and restore focus appropriately.
- [ ] Run focused tests until all pass.

### Task 5: Document and verify

**Files:**
- Modify: `design.md`
- Modify: `docs/00-index.md`

- [ ] Add a Date Picker component section to `design.md` with trigger, popup, state, accessibility, offline, and no-motion rules.
- [ ] Add the date picker specification and plan to `docs/00-index.md`.
- [ ] Run `npx playwright test tests/nowly-prototype.spec.ts` and expect all four viewport projects to pass.
- [ ] Run `npm test`, `npm run build`, and `git diff --check` and expect success.
- [ ] Capture 1366×768 screenshots of the event and task pickers and visually inspect clipping, alignment, and contrast.
- [ ] Commit with `feature: add Good single date picker`.

## Plan Self-Review

- Coverage includes both fields, one shared popup, 42 cells, all required states and keyboard operations, popup closure with parent dialogs, offline/no-motion constraints, design documentation, and the pending checkbox contrast correction.
- Selectors are based on existing `.dialog-layer`, `.dialog`, `.input`, `.btn`, and dialog-controller code.
- No additional libraries, persistence, range selection, or main-calendar changes are introduced.
