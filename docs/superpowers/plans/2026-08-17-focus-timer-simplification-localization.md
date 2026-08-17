# Focus Timer Simplification and Localization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove focus charts, headings, and fullscreen behavior; make wallpaper rendering read-only; and localize the complete focus experience in Chinese and English.

**Architecture:** `App` passes its window mode into a mode-aware `FocusTimerWidget`. The widget and statistics dialog render all text through the existing i18n store, while `FocusTimerContext` remains responsible for timing, persistence, native coordination, and localized native completion notifications. Fullscreen-only state, components, styles, and app wiring are deleted.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Tauri APIs, CSS.

---

## File Structure

- Modify `src/focus/FocusTimerWidget.tsx`: foreground and read-only wallpaper presentations; icon-only actions; localized strings.
- Modify `src/focus/FocusTimerWidget.test.tsx`: card simplification, wallpaper behavior, and English coverage.
- Modify `src/focus/FocusStatisticsDialog.tsx`: localized summary-only report.
- Modify `src/focus/FocusStatisticsDialog.test.tsx`: period, summary, no-chart, error, and English coverage.
- Modify `src/focus/FocusTimerContext.tsx`: remove fullscreen API and localize native notification snapshots.
- Modify `src/focus/FocusTimerContext.test.tsx`: localized notification tests.
- Modify `src/focus/focus-model.ts` and `src/focus/focus-model.test.ts`: remove fullscreen state and transitions.
- Modify `src/app/App.tsx` and `src/app/App.test.tsx`: pass mode to widget and remove fullscreen app wiring.
- Modify `src/i18n/translations.ts`: add complete Chinese and English focus dictionaries.
- Modify `src/app/styles.css`: simplify timer/report styling and add read-only wallpaper layout.
- Delete `src/focus/FocusLineChart.tsx`, `src/focus/FocusFullscreenLayer.tsx`, and `src/focus/FocusFullscreenLayer.test.tsx`.

### Task 1: Simplify and localize the focus timer card

- [ ] **Step 1: Replace the widget tests with failing behavior tests**

In `src/focus/FocusTimerWidget.test.tsx`, render with `mode="foreground"` and assert: no heading named `专注计时`, no `img` chart, icon-only buttons named `查看统计` and `重置计时`, no `全屏专注`, and existing preset/custom/start behavior. Add a `mode="wallpaper"` test asserting only `role="timer"` plus `双击返回前台以操作专注计时`, with no buttons or custom input. Set language to `en` and assert `View statistics`, `Reset timer`, `Start focus`, and the `Enter a whole number from 1 to 720 minutes.` validation message.

- [ ] **Step 2: Run the widget tests and verify RED**

Run: `npm test -- src/focus/FocusTimerWidget.test.tsx`
Expected: FAIL because `mode` is unsupported, Chinese literals remain, charts/fullscreen/title still render, and wallpaper controls are not hidden.

- [ ] **Step 3: Add complete focus card translations**

In both language dictionaries in `src/i18n/translations.ts`, add keys for `focusTimer.statistics`, `focusTimer.idleHint`, `focusTimer.runningHint`, `focusTimer.pausedHint`, `focusTimer.custom`, `focusTimer.customMinutes`, `focusTimer.customError`, `focusTimer.useDuration`, `focusTimer.startFocus`, `focusTimer.resume`, `focusTimer.weekMinutes`, and `focusTimer.wallpaperHint`. Keep/reset existing keys where reusable and use natural English labels.

- [ ] **Step 4: Implement the minimal mode-aware widget**

Change the prop type to `{ mode: 'foreground' | 'wallpaper'; onOpenStatistics(): void }`. Call `useTranslation()` so language changes re-render. For wallpaper mode, return only the timer and localized hint in `.focus-timer--wallpaper`. For foreground mode, remove `<h2>`, `FocusLineChart`, and `Maximize2`; make statistics and reset `btn-icon` buttons with localized `aria-label`; retain the total-minutes summary without a chart; localize every visible and accessible string.

- [ ] **Step 5: Run widget tests and verify GREEN**

Run: `npm test -- src/focus/FocusTimerWidget.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit the card change**

```bash
git add src/focus/FocusTimerWidget.tsx src/focus/FocusTimerWidget.test.tsx src/i18n/translations.ts
git commit -m "feature: simplify and localize focus timer card"
```

### Task 2: Remove charts and localize statistics

- [ ] **Step 1: Write failing statistics dialog tests**

Update `src/focus/FocusStatisticsDialog.test.tsx` to assert four summaries and period switching remain, while `queryByRole('img')`, `专注时长折线图`, and `青绿色折线` are absent. Add an error-state test for localized retry. Add an English test asserting `Focus statistics`, `Last 30 days`, `90 minutes`, `3 completed`, `1 interrupted`, and `75%`.

- [ ] **Step 2: Run dialog tests and verify RED**

Run: `npm test -- src/focus/FocusStatisticsDialog.test.tsx`
Expected: FAIL because the chart/legend still render and dialog strings are hard-coded Chinese.

- [ ] **Step 3: Add statistics translations**

Add Chinese/English keys: `focusStatistics.title`, `focusStatistics.intro`, `focusStatistics.last7Days`, `focusStatistics.last30Days`, `focusStatistics.last12Months`, `focusStatistics.minutes`, `focusStatistics.times`, `focusStatistics.total`, `focusStatistics.completed`, `focusStatistics.interrupted`, `focusStatistics.rate`, `focusStatistics.loadError`, and `focusStatistics.retry`.

- [ ] **Step 4: Implement summary-only localized statistics**

In `src/focus/FocusStatisticsDialog.tsx`, call `useTranslation()`, replace all literals with `t(...)`, remove `FocusLineChart`, the no-record chart branch, and `.focus-statistics__legend`. Always render the four numeric summaries and render only the localized alert/retry block when status is `error`.

- [ ] **Step 5: Delete chart source and styling**

Delete `src/focus/FocusLineChart.tsx`. Remove `.focus-chart`, `.focus-timer__trend-chart`, chart-specific container queries, and `.focus-statistics__legend` rules from `src/app/styles.css`. Make `.focus-timer__trend` a single-column summary button.

- [ ] **Step 6: Run dialog and widget tests and verify GREEN**

Run: `npm test -- src/focus/FocusStatisticsDialog.test.tsx src/focus/FocusTimerWidget.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit statistics simplification**

```bash
git add src/focus/FocusStatisticsDialog.tsx src/focus/FocusStatisticsDialog.test.tsx src/focus/FocusLineChart.tsx src/app/styles.css src/i18n/translations.ts
git commit -m "feature: replace focus charts with localized summaries"
```

### Task 3: Remove fullscreen focus behavior

- [ ] **Step 1: Write failing model and app expectations**

In `src/focus/focus-model.test.ts`, remove tests of `requestFullscreen`/`dismissFullscreen` and assert `initialFocusState(25)` equals a state without `fullscreen` or `fullscreenDismissed`. In `src/app/App.test.tsx`, extend the wallpaper test to assert the focus timer remains visible with the wallpaper hint, has no focus action buttons, and no fullscreen overlay appears.

- [ ] **Step 2: Run targeted tests and verify RED**

Run: `npm test -- src/focus/focus-model.test.ts src/app/App.test.tsx`
Expected: FAIL because model state still includes fullscreen fields and `App` does not pass window mode into the widget.

- [ ] **Step 3: Remove fullscreen model and context API**

In `src/focus/focus-model.ts`, remove `fullscreen`, `fullscreenDismissed`, `requestFullscreen`, and `dismissFullscreen`. In `src/focus/FocusTimerContext.tsx`, remove those imports, `enterFullscreen`, and `exitFullscreen` from `FocusApi` and the memoized value.

- [ ] **Step 4: Remove fullscreen app wiring**

In `src/app/App.tsx`, delete the `FocusFullscreenLayer` import, fullscreen auto-entry effect, and `overlay` prop. Render `<FocusTimerWidget mode={windowMode} ... />`.

- [ ] **Step 5: Delete fullscreen-only files and CSS**

Delete `src/focus/FocusFullscreenLayer.tsx` and `src/focus/FocusFullscreenLayer.test.tsx`. Remove all `.focus-fullscreen*` rules from `src/app/styles.css`. Add `.focus-timer--wallpaper` rules that vertically center the timer/hint and hide no content via CSS because controls are absent from the DOM.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run: `npm test -- src/focus/focus-model.test.ts src/focus/FocusTimerContext.test.tsx src/focus/FocusTimerWidget.test.tsx src/app/App.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit fullscreen removal**

```bash
git add src/focus src/app/App.tsx src/app/App.test.tsx src/app/styles.css
git commit -m "refactor: remove focus fullscreen mode"
```

### Task 4: Localize native focus completion notifications

- [ ] **Step 1: Write failing Context notification tests**

In `src/focus/FocusTimerContext.test.tsx`, reset language in `beforeEach`. Add one Chinese and one English start test that inspect `invoke('start_focus_timer', { snapshot: ... })`. Assert Chinese title/body `专注完成` and `你已完成 25 分钟专注，休息一下吧。`; assert English title/body `Focus complete` and `You completed a 25-minute focus session. Take a break.`.

- [ ] **Step 2: Run Context tests and verify RED**

Run: `npm test -- src/focus/FocusTimerContext.test.tsx`
Expected: English notification test FAIL because notification text is hard-coded Chinese.

- [ ] **Step 3: Add notification translations and implementation**

Add `focusTimer.notificationTitle` and `focusTimer.notificationBody` to both dictionaries, with `{minutes}` interpolation. In `FocusTimerContext.start`, use `t(...)` for `notificationTitle` and `notificationBody`. Ensure the provider subscribes to language changes with `useTranslation()` so starts after a live language switch use the active language.

- [ ] **Step 4: Run Context tests and verify GREEN**

Run: `npm test -- src/focus/FocusTimerContext.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit notification localization**

```bash
git add src/focus/FocusTimerContext.tsx src/focus/FocusTimerContext.test.tsx src/i18n/translations.ts
git commit -m "feature: localize focus completion notifications"
```

### Task 5: Final regression and cleanup

- [ ] **Step 1: Search for removed focus UI**

Run: `rg -n "FocusLineChart|FocusFullscreenLayer|enterFullscreen|exitFullscreen|requestFullscreen|dismissFullscreen|focus-chart|focus-fullscreen" src`
Expected: no matches.

- [ ] **Step 2: Search focus files for remaining Chinese literals**

Run: `rg -n "[一-龥]" src/focus --glob '*.{ts,tsx}'`
Expected: only Chinese text inside tests that explicitly verify Chinese output; no production component literals.

- [ ] **Step 3: Run all frontend tests**

Run: `npm test`
Expected: all Vitest tests PASS with no unhandled errors.

- [ ] **Step 4: Run production build**

Run: `npm run build`
Expected: TypeScript and Vite build succeed.

- [ ] **Step 5: Inspect repository diff**

Run: `git status --short && git diff --check`
Expected: only intentional files remain and `git diff --check` prints nothing.

- [ ] **Step 6: Commit any final test-only cleanup**

```bash
git add src
git commit -m "test: verify simplified focus timer experience"
```

Skip this commit if the working tree is already clean.
