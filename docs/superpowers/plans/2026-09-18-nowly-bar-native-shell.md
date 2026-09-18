# Nowly Bar Native Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the simulated borderless Nowly Bar host with an explicit Windows popup HWND and make the collapsed Bar a continuous `288×40px` white shell with a subtle internal separator.

**Architecture:** Keep the existing single `408px`-wide native host and the independent status/assistant animation state machines. Normalize only the `quick-panel-handle` HWND style, calculate a DPI-aware rounded native region for each surface, and make `.status-rail__status-presence` own the single collapsed/status surface containing both the status control and Logo control.

**Tech Stack:** Rust, Tauri 2, Windows API through the `windows` crate, React, TypeScript, CSS, Vitest, Playwright.

---

### Task 1: Lock the native style and rounded-region contract with failing tests

**Files:**
- Modify: `src-tauri/src/quick_panel.rs`
- Modify: `src-tauri/tauri.conf.json`

- [ ] **Step 1: Add failing tests for popup style normalization**

Add Windows-only tests that construct a style containing `WS_CAPTION`, `WS_THICKFRAME`, `WS_SYSMENU`, `WS_MINIMIZEBOX`, `WS_MAXIMIZEBOX`, `WS_VISIBLE`, and `WS_CLIPSIBLINGS`. Assert that `normalized_handle_style` adds `WS_POPUP`, removes only the five decoration bits, preserves unrelated bits, and is idempotent.

- [ ] **Step 2: Add failing tests for DPI-aware rounded region geometry**

Add a pure `SurfaceRegion` geometry assertion for `1.0`, `1.25`, `1.5`, `1.75`, and `2.0` scale factors. Assert centered `288×40 / 20px`, centered `288×288 / 15.2px`, and full `408×440 / 15.2px` geometry using rounded physical-pixel values.

- [ ] **Step 3: Add failing configuration assertions**

Extend `handle_window_has_no_native_shadow_or_background` to require:

```rust
assert_eq!(handle["resizable"], false);
assert_eq!(handle["minimizable"], false);
assert_eq!(handle["maximizable"], false);
```

- [ ] **Step 4: Run the focused Rust tests and verify RED**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml quick_panel::tests -- --nocapture
```

Expected: compile failures for the missing normalization/geometry functions or assertion failures for missing Tauri configuration.

### Task 2: Implement the formal Windows popup HWND and rounded native regions

**Files:**
- Modify: `src-tauri/src/quick_panel.rs`
- Modify: `src-tauri/tauri.conf.json`

- [ ] **Step 1: Implement pure style normalization**

Create a Windows-only function that receives `WINDOW_STYLE`, inserts `WS_POPUP`, and removes `WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX`.

- [ ] **Step 2: Apply style changes idempotently**

Create `normalize_handle_window_style` that reads `GWL_STYLE`, returns without a frame refresh when already normalized, otherwise calls `SetWindowLongPtrW` and:

```rust
SetWindowPos(
    hwnd,
    None,
    0,
    0,
    0,
    0,
    SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
)
```

Clear and inspect the Win32 last-error value so a zero previous style is not mistaken for failure.

- [ ] **Step 3: Implement pure rounded-region geometry**

Replace `surface_client_bounds` with a `SurfaceRegion` containing `left`, `top`, `right`, `bottom`, and `radius`. Round all logical dimensions through the same scale conversion helper.

- [ ] **Step 4: Apply rounded regions**

Replace `CreateRectRgn` with `CreateRoundRectRgn`. Use an ellipse diameter of `radius * 2`, compare the desired region with the current region using `EqualRgn`, delete temporary GDI objects on every failed/no-op path, and transfer ownership to Windows only after successful `SetWindowRgn`.

- [ ] **Step 5: Make initialization fail closed**

Normalize the HWND style before the Bar is shown and before position/region reconciliation. If initial style, WebView transparency, bounds, or region setup fails, hide `quick-panel-handle`, return/log the contextual error, and leave the main app running.

- [ ] **Step 6: Set explicit Tauri window capabilities**

Add:

```json
"minimizable": false,
"maximizable": false
```

to `quick-panel-handle`, preserving `focus: false` and avoiding `WS_EX_NOACTIVATE`.

- [ ] **Step 7: Run focused Rust tests and verify GREEN**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml quick_panel::tests -- --nocapture
```

Expected: all `quick_panel::tests` pass.

### Task 3: Lock the continuous shell DOM and visual contract with failing tests

**Files:**
- Modify: `src/app/layout/StatusIsland.test.tsx`
- Modify: `tests/nowly-bar-assistant.spec.ts`
- Modify: `tests/screen-status-island.spec.ts`

- [ ] **Step 1: Add a DOM ownership test**

Render `TopRail` and assert:

```ts
const presence = container.querySelector('.status-rail__status-presence')!;
expect(presence.querySelector('.status-rail__sheet')).not.toBeNull();
expect(presence.querySelector('.status-rail__nowly')).not.toBeNull();
expect(container.querySelector('.status-rail > .status-rail__nowly')).toBeNull();
```

- [ ] **Step 2: Replace the obsolete gap test**

In `screen-status-island.spec.ts`, replace the `240 + 8 + 40` assertions with a `288×40` presence shell, a `240px` status action lane, and a `48px` Logo action lane. Assert there is no uncovered pixel between those lanes.

- [ ] **Step 3: Add computed-style assertions for the subtle separator**

Assert that `.status-rail__status-presence` owns the white background, `1px #EAEAEA` border, `20px` collapsed radius, and clipping. Assert that `.status-rail__nowly` has no independent border/background and its `::before` separator is `1px`, `#F6F1E9`, and `22px` high.

- [ ] **Step 4: Run focused browser tests and verify RED**

Run:

```powershell
npx playwright test tests/nowly-bar-assistant.spec.ts tests/screen-status-island.spec.ts
```

Expected: failures because the Logo remains a sibling with an independent circular surface and the old gap geometry is still present.

### Task 4: Implement the continuous collapsed/status shell

**Files:**
- Modify: `design.md`
- Modify: `src/app/layout/StatusIsland.tsx`
- Modify: `src/app/styles.css`

- [ ] **Step 1: Update the authoritative design wording**

Record that the two panels retain independent controls and state, while the collapsed/status visual surface is one continuous `288×40px` shell. Replace the obsolete `240×40 + 8px + 40×40` wording with a `240px` status action lane, `48px` Logo action lane, and `1px #F6F1E9` separator inset `9px`.

- [ ] **Step 2: Move the Logo into the status presence shell**

Move the existing `.status-rail__nowly` button inside `.status-rail__status-presence`, after `.status-rail__sheet`, without changing its semantics, click handler, accessible name, or assistant state.

- [ ] **Step 3: Make presence own the visible shell**

Give `.status-rail__status-presence` the sole collapsed white background, border, radius, and clipping. Make `.status-rail__sheet` borderless/transparent while collapsed and preserve its `288×288px / 15.2px` open geometry.

- [ ] **Step 4: Convert the Logo to an internal action lane**

Position the Logo in the rightmost `48px`, remove its independent circular border/background, and draw the separator with `::before` at `top: 9px; bottom: 9px; width: 1px; background: var(--border-subtle, #F6F1E9)`.

- [ ] **Step 5: Preserve morph and interaction behavior**

Keep status and assistant animation state independent, keep the Logo clickable only while the status surface is collapsed, and preserve the existing AI Logo handoff, reverse-operation, and reduced-motion behavior.

- [ ] **Step 6: Run focused component and Playwright tests**

Run:

```powershell
npm test -- src/app/layout/StatusIsland.test.tsx
npx playwright test tests/nowly-bar-assistant.spec.ts tests/screen-status-island.spec.ts
```

Expected: all focused tests pass.

### Task 5: Verify the complete feature and inspect the live HWND

**Files:**
- Modify only if verification finds a regression in files already listed above.

- [ ] **Step 1: Run format and static diff checks**

Run:

```powershell
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
git diff --check
```

- [ ] **Step 2: Run full automated verification**

Run:

```powershell
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: zero failures and successful production build.

- [ ] **Step 3: Inspect a real `quick-panel-handle` HWND**

Launch an isolated development binary/target directory if the user's current `nowly.exe` is locked. Read `GWL_STYLE` for the actual Nowly Bar HWND and verify the five decoration bits are zero and `WS_POPUP` is nonzero.

- [ ] **Step 4: Validate the visual symptom**

Place the Bar over a window with a visible Windows title bar and system buttons. Capture/inspect the collapsed Bar and confirm the continuous white surface covers all `288×40px`, no native buttons bleed through, rounded corners exclude hit testing, and status/AI focus still works.

- [ ] **Step 5: Request independent code review**

Provide the reviewer with the design spec, this plan, the implementation diff, and verification outputs. Resolve every Critical and Important finding.

- [ ] **Step 6: Commit only this task's files**

Stage only the native shell spec/plan and the implementation/test files touched by this task. Do not stage unrelated dirty-worktree changes.
