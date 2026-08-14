# Focus Timer Fullscreen Statistics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an app-wide accurate focus timer with wallpaper fullscreen presentation, tray-safe native completion notifications, persistent completed/interrupted sessions, and responsive trend reporting.

**Architecture:** A pure TypeScript timer reducer drives React presentation while a Rust in-memory coordinator owns authoritative background completion. Stable session IDs connect the coordinator, SQLite records, and idempotent UI retries; focused repository modules isolate persistence and aggregation from UI code.

**Tech Stack:** React 19, TypeScript, Vitest/Testing Library, SVG, CSS Container Queries, Tauri 2, Rust, rusqlite, tauri-plugin-notification, Playwright.

---

## File map

**Create**

- `src/focus/focus-model.ts` — domain types, validation, formatting, reducer and elapsed-time calculations.
- `src/focus/focus-model.test.ts` — deterministic state-machine tests.
- `src/focus/FocusTimerContext.tsx` — app-wide provider, native coordinator bridge, record retries and statistics refresh.
- `src/focus/FocusTimerContext.test.tsx` — provider/native-event integration tests.
- `src/focus/FocusTimerWidget.tsx` — responsive module presentation.
- `src/focus/FocusTimerWidget.test.tsx` — module behavior and accessible state tests.
- `src/focus/FocusFullscreenLayer.tsx` — immersive wallpaper/foreground overlay.
- `src/focus/FocusFullscreenLayer.test.tsx` — auto-entry, controls and keyboard tests.
- `src/focus/FocusStatisticsDialog.tsx` — period switcher, summaries and line chart.
- `src/focus/FocusStatisticsDialog.test.tsx` — aggregation presentation and error/empty tests.
- `src/focus/FocusLineChart.tsx` — dependency-free accessible SVG line chart.
- `src-tauri/src/focus.rs` — SQLite CRUD and aggregate commands.
- `src-tauri/src/focus_timer.rs` — in-memory native timer coordinator and completion notification.
- `tests/nowly-focus-timer.spec.ts` — reusable end-to-end acceptance.

**Modify**

- `src/data/nowly-repository.ts` and `src/data/tauri-nowly-repository.ts` — focus repository contract/IPC adapter.
- Repository test factories (`src/**/*.test.tsx`) — add default focus methods.
- `src-tauri/src/db.rs` — migration 11 focus table/indexes.
- `src-tauri/src/main.rs` — modules, managed coordinator, plugin, commands and quit cleanup.
- `src-tauri/Cargo.toml`, `src-tauri/capabilities/default.json` — notification plugin and permission.
- `src/app/App.tsx`, `src/main.tsx` — provider, module, dialog and fullscreen integration.
- `src/widgets/extension-modules.tsx` — remove the old locally stateful timer registration path.
- `src/widgets/FocusTimerWidget.tsx` — delete after replacement.
- `src/app/layout/DesktopShell.tsx` — overlay slot and wallpaper-mode signal without coupling shell to timer internals.
- `src/app/styles.css` — design-system-compliant responsive timer, overlay, dialog and chart styles.
- `src/i18n/translations.ts` — complete Chinese/English focus copy.
- `src/app/App.test.tsx` and layout tests — new provider defaults and wallpaper behavior.

### Task 1: Pure focus domain and state machine

**Files:** Create `src/focus/focus-model.ts`, `src/focus/focus-model.test.ts`

- [ ] **Step 1: Write failing tests for validation and time accounting**

```ts
it.each([[1, true], [720, true], [0, false], [721, false], [1.5, false]])(
  'validates %s minutes', (minutes, valid) => expect(isValidFocusMinutes(minutes)).toBe(valid)
);
it('excludes paused time and completes once', () => {
  let state = startFocus(initialFocusState(25), { id: 's1', nowWallMs: 1_000, nowMonoMs: 10 });
  state = pauseFocus(state, 10_010);
  state = resumeFocus(state, 20_010);
  expect(snapshotFocus(state, 25_010).focusedSeconds).toBe(15);
});
```

- [ ] **Step 2: Run `npm test -- src/focus/focus-model.test.ts`; expect FAIL because the module does not exist.**

- [ ] **Step 3: Implement explicit types and pure operations**

```ts
export type FocusStatus = 'idle' | 'running' | 'paused' | 'completed';
export type FocusState = {
  status: FocusStatus; sessionId: string | null; plannedSeconds: number;
  accumulatedMs: number; runStartedMonoMs: number | null; startedAt: string | null;
  fullscreen: boolean; fullscreenDismissed: boolean;
};
export const isValidFocusMinutes = (value: number) => Number.isInteger(value) && value >= 1 && value <= 720;
export function focusedMs(state: FocusState, nowMonoMs: number) {
  return state.accumulatedMs + (state.status === 'running' && state.runStartedMonoMs !== null
    ? Math.max(0, nowMonoMs - state.runStartedMonoMs) : 0);
}
```

Implement `initialFocusState`, `startFocus`, `pauseFocus`, `resumeFocus`, `snapshotFocus`, `remainingSeconds`, `completeFocus`, `dismissFullscreen`, and `requestFullscreen`; reject invalid transitions by returning the unchanged state.

- [ ] **Step 4: Run the focused test and `npm test`; expect PASS.**

- [ ] **Step 5: Commit:** `git commit -m "feature: add focus timer state machine"`

### Task 2: Focus database migration and repository

**Files:** Modify `src-tauri/src/db.rs`; create `src-tauri/src/focus.rs`; modify `src-tauri/src/main.rs`, `src/data/nowly-repository.ts`, `src/data/tauri-nowly-repository.ts` and repository mocks.

- [ ] **Step 1: Add failing Rust migration tests** asserting migration version 11, table `focus_sessions`, status check, positive duration checks, unique primary key and `ended_at` index.

```rust
assert_eq!(versions.last(), Some(&11));
assert!(table_exists(&connection, "focus_sessions"));
```

- [ ] **Step 2: Run `cd src-tauri && cargo test db::tests::migrate_records_each_schema_version_once`; expect the version assertion to fail.**

- [ ] **Step 3: Add migration 11**

```sql
CREATE TABLE focus_sessions (
 id TEXT PRIMARY KEY,
 planned_seconds INTEGER NOT NULL CHECK(planned_seconds > 0),
 focused_seconds INTEGER NOT NULL CHECK(focused_seconds > 0),
 status TEXT NOT NULL CHECK(status IN ('completed','interrupted')),
 started_at TEXT NOT NULL,
 ended_at TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX idx_focus_sessions_ended_at ON focus_sessions(ended_at);
```

- [ ] **Step 4: Add failing `focus.rs` tests** for idempotent create, range listing and daily/monthly aggregate point counts including zero-filled periods. Range inputs carry explicit ISO instants and period labels/boundaries generated by the frontend.

- [ ] **Step 5: Run `cargo test focus::tests`; expect FAIL because functions are absent.**

- [ ] **Step 6: Implement Rust models and commands** `create_focus_session`, `list_focus_sessions`, `get_focus_statistics`; use `INSERT ... ON CONFLICT(id) DO NOTHING`, then read the canonical row. Calculate totals/counts in SQL and map sessions into caller-supplied period boundaries so local timezone semantics remain explicit.

- [ ] **Step 7: Add matching TypeScript contract**

```ts
export type FocusSession = { id:string; plannedSeconds:number; focusedSeconds:number; status:'completed'|'interrupted'; startedAt:string; endedAt:string; createdAt:string };
export type FocusPeriodBoundary = { period:string; startAt:string; endAtExclusive:string };
export type FocusStatistics = { totalFocusedSeconds:number; completedCount:number; interruptedCount:number; completionRate:number; points:FocusStatisticsPoint[] };
```

Add repository methods and invoke adapters using `create_focus_session`, `list_focus_sessions`, `get_focus_statistics`. Update all typed repository factories with safe resolved defaults.

- [ ] **Step 8: Run `cargo test`, `npm test`, and `npm run build`; expect PASS.**

- [ ] **Step 9: Commit:** `git commit -m "feature: persist focus sessions and statistics"`

### Task 3: Native background coordinator and notification

**Files:** Create `src-tauri/src/focus_timer.rs`; modify `src-tauri/src/main.rs`, `src-tauri/Cargo.toml`, `src-tauri/capabilities/default.json`.

- [ ] **Step 1: Write failing coordinator tests** using an injectable clock/notifier: running reaches completion once, pause prevents completion, resume uses remaining duration, cancel emits no event/notification, acknowledged snapshots disappear.

```rust
coordinator.start(snapshot, Duration::from_secs(2), now);
assert!(coordinator.poll(now + Duration::from_secs(1)).is_none());
assert_eq!(coordinator.poll(now + Duration::from_secs(2)).unwrap().id, "s1");
assert!(coordinator.poll(now + Duration::from_secs(3)).is_none());
```

- [ ] **Step 2: Run `cargo test focus_timer::tests`; expect module/function failure.**

- [ ] **Step 3: Add `tauri-plugin-notification = "2"`, initialize it, and grant `notification:default` in the main capability.**

- [ ] **Step 4: Implement managed coordinator commands** `start_focus_timer`, `pause_focus_timer`, `resume_focus_timer`, `cancel_focus_timer`, `get_pending_focus_completion`, `acknowledge_focus_completion`. Keep only memory state; use `Instant` for elapsed time and retain one unacknowledged completion snapshot.

- [ ] **Step 5: Start one coordinator worker** that sleeps/polls efficiently, emits `focus-session-completed`, and calls the notification plugin exactly once with localized-neutral payload supplied at start. Notification errors are logged and do not discard completion.

- [ ] **Step 6: On tray “quit”, call coordinator `discard()` before `app.exit(0)`; window close/hide does not discard. Notification click shows/focuses the main window.**

- [ ] **Step 7: Run `cargo fmt --check && cargo test`; expect PASS.**

- [ ] **Step 8: Commit:** `git commit -m "feature: add background focus completion notifications"`

### Task 4: Global React provider and native bridge

**Files:** Create `src/focus/FocusTimerContext.tsx`, `src/focus/FocusTimerContext.test.tsx`; modify `src/main.tsx`.

- [ ] **Step 1: Write failing provider tests** with fake monotonic/wall clocks and mocked Tauri invoke/listen for start, pause, resume, natural completion, interrupted record, failed-save retry, pending completion recovery, and persisted last custom duration.

- [ ] **Step 2: Run `npm test -- src/focus/FocusTimerContext.test.tsx`; expect missing provider failure.**

- [ ] **Step 3: Implement provider API**

```ts
type FocusTimerApi = {
 state: FocusState; remainingSeconds:number; focusedSeconds:number;
 start(minutes?:number):Promise<void>; pause():Promise<void>; resume():Promise<void>;
 interrupt():Promise<void>; reset():Promise<void>;
 enterFullscreen():void; exitFullscreen():void;
 statistics: FocusStatisticsResource; loadStatistics(period:FocusRange):Promise<void>;
 retryPendingRecord():Promise<void>;
};
```

Use `performance.now()` for UI elapsed calculation, `Date` only for ISO timestamps, one repaint interval while running, stable `crypto.randomUUID()`, repository idempotency, and module state key `focusTimerPreferences` only for selected/last custom duration—not active sessions.

- [ ] **Step 4: Reconcile native events** by session ID, persist the completion snapshot, acknowledge only after successful repository write, and load pending completion once at provider startup. Explicit app process exit remains native-only and creates no frontend record.

- [ ] **Step 5: Wrap `App` inside `FocusTimerProvider` beneath `RepositoryProvider` in `src/main.tsx`.**

- [ ] **Step 6: Run focused tests, full `npm test`, and build; expect PASS.**

- [ ] **Step 7: Commit:** `git commit -m "feature: add global focus timer provider"`

### Task 5: Responsive focus module and mini chart

**Files:** Create `src/focus/FocusLineChart.tsx`, `src/focus/FocusTimerWidget.tsx`, tests; modify `src/widgets/extension-modules.tsx`, `src/app/App.tsx`, `src/app/styles.css`, translations; delete `src/widgets/FocusTimerWidget.tsx`.

- [ ] **Step 1: Write failing component tests** for presets, custom validation (0/721 rejected), start/pause/reset confirmation, disabled idle fullscreen, stats trigger, accessible chart summary and failed-stat retry.

- [ ] **Step 2: Run focused tests; expect missing component failures.**

- [ ] **Step 3: Implement dependency-free SVG chart** with a zero baseline, safe one-point/zero-max handling, `role="img"`, translated summary, and text data list available to assistive technology.

- [ ] **Step 4: Implement widget** consuming `useFocusTimer`; use standard project buttons/dialog/popover treatment and no local timer. Register the new component directly in `App` rather than through `ModuleHost`; remove old component mapping/file.

- [ ] **Step 5: Add design-compliant CSS** including `container-type: size` and explicit tested rules:

```css
.focus-timer { container-type: size; }
@container (max-width: 420px), (max-height: 390px) {
  .focus-timer__trend-chart { display: none; }
}
```

Keep cumulative value and statistics button visible; allow presets to wrap; maintain 40px controls and semantic typography.

- [ ] **Step 6: Add all Chinese/English keys** for states, controls, validation, confirmations, chart summaries and errors.

- [ ] **Step 7: Run focused tests, `npm test`, build; expect PASS.**

- [ ] **Step 8: Commit:** `git commit -m "feature: add responsive focus timer module"`

### Task 6: Statistics dialog

**Files:** Create `src/focus/FocusStatisticsDialog.tsx` and test; modify `src/app/App.tsx`, `src/app/styles.css`, translations.

- [ ] **Step 1: Write failing tests** for 7/30/12 period selection, local boundary count, summary values, zero completion rate, empty/error/retry states, Esc and focus restoration.

- [ ] **Step 2: Run focused tests; expect missing dialog failure.**

- [ ] **Step 3: Implement local boundary builder** where 7/30 views emit daily ISO boundaries and 12-month emits month boundaries; period labels are localized separately from query keys.

- [ ] **Step 4: Implement dialog** with existing `Dialog`, three `aria-pressed` period buttons, summary cards, `FocusLineChart`, textual legend, static loading/error/empty states, and close button.

- [ ] **Step 5: Connect widget statistics trigger to App-owned dialog state so it layers correctly with existing modals.**

- [ ] **Step 6: Style only with `design.md` tokens: white surface, default border/radius, `shadow-lg`, functional-light summary surfaces, no animation.**

- [ ] **Step 7: Run focused/full tests and build; expect PASS.**

- [ ] **Step 8: Commit:** `git commit -m "feature: add focus statistics dialog"`

### Task 7: Fullscreen wallpaper layer and lifecycle integration

**Files:** Create `src/focus/FocusFullscreenLayer.tsx` and test; modify `src/app/layout/DesktopShell.tsx`, its tests, `src/app/App.tsx`, `src/app/styles.css`, translations.

- [ ] **Step 1: Write failing tests** for: running + wallpaper auto-opens; idle/paused do not auto-open; manual dismissal blocks re-entry in same session; manual fullscreen works running/paused; Esc exits view without interrupting; end confirmation records interruption; completion offers restart/exit; pointer and Tab reveal controls.

- [ ] **Step 2: Run focused tests; expect missing layer failure.**

- [ ] **Step 3: Give `DesktopShell` a presentation slot** such as `wallpaperOverlay?: ReactNode`, rendered above workspace but without importing focus types. Preserve existing wallpaper double-click capture.

- [ ] **Step 4: Implement layer** consuming global state. On `windowMode` transition to wallpaper, request fullscreen only when running and not dismissed. Separate “exit fullscreen” from destructive “end focus”. Use existing `ConfirmDialog` for interruption.

- [ ] **Step 5: Implement control visibility** with immediate pointer/focus/touch state. Hidden controls use `display:none`/`hidden`, are removed from focus order, and reappear on pointer movement or keyboard navigation; no timers or opacity animation.

- [ ] **Step 6: Add overlay CSS**: transparent app surface over actual wallpaper, centered clamp-sized tabular timer, static text shadow, token-compliant controls, no generated gradient/background image.

- [ ] **Step 7: Ensure window-mode double-click returns foreground while provider keeps running; manual fullscreen in foreground uses the same overlay slot.**

- [ ] **Step 8: Run focused/full tests and build; expect PASS.**

- [ ] **Step 9: Commit:** `git commit -m "feature: add wallpaper fullscreen focus mode"`

### Task 8: End-to-end verification and polish

**Files:** Create `tests/nowly-focus-timer.spec.ts`; modify only defects proven by tests.

- [ ] **Step 1: Add Playwright scenarios** that add the focus module, select a short test-controlled duration, start, enter wallpaper, verify fullscreen, pause/resume, exit fullscreen without stopping, complete and view updated stats; add an interrupted flow and a minimum-size module screenshot/assertion that chart is hidden but stats entry remains.

- [ ] **Step 2: Add static design assertions** scanning computed styles for 40px buttons, 15.2px radius, expected border color, no transitions/animations, and no app-generated fullscreen gradient.

- [ ] **Step 3: Run `npm run e2e -- tests/nowly-focus-timer.spec.ts`; expect failures first, then repair only demonstrated integration defects.**

- [ ] **Step 4: Run complete verification:**

```bash
npm test
npm run build
npm run e2e
cd src-tauri && cargo fmt --check && cargo test && cargo check
```

Expected: all commands pass with zero failing tests and no TypeScript/Rust compile errors.

- [ ] **Step 5: Inspect `git diff --check`, `git status --short`, and verify no unrelated files or generated artifacts are staged.**

- [ ] **Step 6: Commit:** `git commit -m "test: verify focus timer fullscreen and statistics"`

### Task 9: Final code review

**Files:** All files changed by Tasks 1–8.

- [ ] **Step 1: Invoke requesting-code-review** and compare implementation line-by-line against `docs/superpowers/specs/2026-08-14-focus-timer-fullscreen-statistics-design.md` and root `design.md`.

- [ ] **Step 2: Resolve every Critical/Important finding using a failing regression test first; run the smallest relevant suite after each repair.**

- [ ] **Step 3: Re-run the complete verification command set from Task 8.**

- [ ] **Step 4: Commit review repairs with the applicable unified message, for example:** `git commit -m "fix: resolve focus timer review findings"`
