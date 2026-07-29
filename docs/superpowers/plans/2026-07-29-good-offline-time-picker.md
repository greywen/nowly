# Good Offline Time Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace event start/end native time inputs with one shared offline Good Flatpickr-style time picker.

**Architecture:** Two semantic button triggers store `HH:mm` values and share one popup inside the dialog layer. Vanilla JavaScript manages hour/minute spinbuttons, quick values, keyboard adjustment, focus, positioning, and mutual exclusion with the existing date picker.

**Tech Stack:** HTML5, CSS, vanilla JavaScript, inline SVG, Playwright, TypeScript, Markdown

---

## Files

- Modify `tests/nowly-prototype.spec.ts`: add structure, visual, behavior, keyboard, positioning, and mutual-exclusion tests.
- Modify `docs/prototypes/nowly-final-uiux.html`: replace native inputs and implement shared popup/controller.
- Modify `design.md`: add authoritative time-picker rules and checklist.
- Modify `docs/00-index.md`: link specification and plan.

### Task 1: Write failing time-picker contracts

- [ ] Assert zero `input[type="time"]`, two `[data-time-picker]` triggers, initial `14:00`/`15:00`, and ARIA popup attributes.
- [ ] Assert one shared dialog named `选择时间`, two spinbuttons with correct values/ranges, and six quick-time buttons.
- [ ] Assert hour/minute increment and wrap behavior, quick selection, Clear, and fixed Now `09:40`.
- [ ] Assert keyboard Arrow/Page/Home/End/Enter behavior.
- [ ] Assert date/time popup mutual exclusion, Escape/outside/parent-dialog closure, focus return, and no Header overlap.
- [ ] Run focused tests and verify RED because native time inputs remain.

### Task 2: Build Good trigger and popup styles

- [ ] Add chevron-up/down and clock symbols as needed to the inline sprite.
- [ ] Replace start/end inputs with `.input.time-picker-trigger` buttons containing formatted time and clock icon.
- [ ] Add one hidden 280px `.time-picker-popup` with title, hour/minute controls, quick grid, Clear, and Now.
- [ ] Style white surface, 15.2px radius, dropdown shadow, 28px values, 35px buttons, and Good states using existing tokens.
- [ ] Ensure no animation, blur, external dependency, or native time control.

### Task 3: Implement shared controller

- [ ] Parse/format/clamp `HH:mm` values without Date timezone behavior.
- [ ] Open from either trigger, read its value, set `aria-expanded`, position within dialog below Header, and focus hour.
- [ ] Implement independent hour ±1 and minute ±5 cyclic controls.
- [ ] Implement six quick values, Clear, and fixed Now `09:40`.
- [ ] Implement ArrowUp/Down, PageUp/Down, Home, End, and Enter on spinbuttons.
- [ ] Make date and time popups mutually exclusive.
- [ ] Close on outside click, Escape, and parent dialog closure; restore focus.
- [ ] Run focused tests until GREEN.

### Task 4: Document and verify

- [ ] Add Time Picker rules after Date Picker in `design.md`.
- [ ] Add a new-page checklist item.
- [ ] Link spec/plan in `docs/00-index.md`.
- [ ] Run full Playwright, Vitest, build, and `git diff --check`.
- [ ] Capture event popup at 1366×768 and inspect clipping/alignment.
- [ ] Commit `feature: add Good offline time picker`.

## Self-Review

The plan covers both fields, one popup, values/ranges, quick choices, fixed now, keyboard/ARIA, positioning, mutual exclusion, closure/focus, offline/no-motion constraints, and design documentation without changing unrelated business logic.
