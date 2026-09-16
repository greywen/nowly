# Calendar Event Form Borderless Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the card-heavy calendar event form with the approved compact, borderless quick-entry layout while preserving all existing event behavior.

**Architecture:** Keep `EventModal` as the form owner and continue using the existing `DatePicker`, `TimePicker`, `Select`, `ColorPicker`, and `RichEditor`. Add small pure date-time helpers for duration shortcuts, then restructure only the presentation and local interaction state for reminder chips and the expandable recurrence editor.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, existing Nowly CSS design tokens.

---

### Task 1: Duration shortcut behavior

**Files:**
- Modify: `src/lib/event-draft.ts`
- Test: `src/lib/event-draft.test.ts`

- [ ] Add failing tests proving a duration shortcut updates the end date/time for same-day and cross-midnight starts.
- [ ] Run `npm test -- src/lib/event-draft.test.ts` and confirm the new tests fail because the helper is missing.
- [ ] Add `applyEventDuration(form, minutes)` using local calendar arithmetic and returning an updated `EventFormDraft`.
- [ ] Run `npm test -- src/lib/event-draft.test.ts` and confirm all tests pass.

### Task 2: Compact EventModal interaction hierarchy

**Files:**
- Modify: `src/modals/EventModal.test.tsx`
- Modify: `src/modals/EventModal.tsx`
- Modify: `src/i18n/translations.ts`

- [ ] Replace the old layout assertion with tests for the continuous group order: lead, time, note, quick settings, advanced settings.
- [ ] Add failing tests for 30-minute and 1-hour duration shortcuts.
- [ ] Add failing tests for reminder presets, custom reminder editing, and removable reminder chips.
- [ ] Add failing tests that recurrence is collapsed for a new event and expanded for an existing recurring event.
- [ ] Run `npm test -- src/modals/EventModal.test.tsx` and confirm the expected failures.
- [ ] Implement the new group structure while retaining every existing form control and save/delete path.
- [ ] Implement duration buttons with `aria-pressed`.
- [ ] Implement reminder chips for 10 and 60 minutes, plus a custom editor toggle.
- [ ] Implement the native advanced-settings disclosure with `aria-expanded` and automatic expansion for recurring/error states.
- [ ] Add concise Chinese and English labels for the new controls.
- [ ] Run `npm test -- src/modals/EventModal.test.tsx` and confirm all tests pass.

### Task 3: Borderless responsive presentation

**Files:**
- Modify: `src/app/styles.css`

- [ ] Replace section-card styles with continuous groups separated by `1px solid var(--border-default)`.
- [ ] Style the combined start/end range, duration chips, reminder chips, combined category/color row, and disclosure row.
- [ ] Keep the editor functional while reducing its visual height and toolbar spacing.
- [ ] Add responsive rules so time endpoints and quick settings stack without horizontal overflow below 900px and 640px.
- [ ] Run `npm test -- src/modals/EventModal.test.tsx`.

### Task 4: Visual and regression verification

**Files:**
- Create locally only: `calendar-form-borderless-desktop.png`
- Create locally only: `calendar-form-borderless-tablet.png`
- Create locally only: `calendar-form-borderless-mobile.png`

- [ ] Start the Vite app from the feature worktree.
- [ ] Open the real EventModal and capture desktop, 820px, and 390px screenshots.
- [ ] Verify each viewport has no horizontal overflow and the footer remains usable.
- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Run `git diff --check`.
- [ ] Commit the implementation with `feature: refine calendar event form interactions`.
