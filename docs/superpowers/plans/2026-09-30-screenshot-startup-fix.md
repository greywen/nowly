# Screenshot Startup Repair

Date: 2026-09-30

Scope: repair screenshot startup and recovery. Preserve the existing selection,
annotation and export implementation, unrelated working-tree changes, and the
approved screenshot specification. Do not claim full screenshot release acceptance.

## Evidence

- The existing workspace debug binary with the current Vite frontend can show a
  frozen desktop, accept a drag selection, and display the editing toolbar.
- The reported permanent "Bar hides, nothing else happens" failure has not yet
  been reproduced consistently. Main-thread window marshalling is not a proven
  live root cause.
- Current startup holds its session lock across blocking work, checks deadlines
  only between operations, and treats native window construction as readiness.
- Frame metadata is currently treated as ready before image loading/decoding.
- Cleanup uses global screenshot labels, so releasing the startup lock alone
  would introduce stale-session cleanup races.

## Tasks

- [x] Inspect current implementation and perform a native startup/selection probe.
- [x] Add failing regression tests for image readiness, startup timeout, stale
  cleanup, repeated requests and visible retry feedback.
- [x] Implement session-qualified native ownership and bounded startup supervision.
- [x] Acknowledge each mounted session surface and decoded overlay image.
- [x] Keep failure feedback at the initiating button and suppress duplicate requests.
- [x] Run focused and broader regressions, production build and independent review.
- [x] Rebuild and verify native click, selection, cancel, repeat, and failure recovery.
- [x] Record verified coverage and remaining platform/acceptance boundaries.

## 2026-10-09: Prewarmed frame request regression

The real Windows probe reproduced startup timing out after five seconds: only
`screenshot-session-1` acknowledged readiness. The overlay had already requested
`describe_capture_frame` while prewarmed, and Rust rejected it as an inactive
session with “系统操作失败，请重试。” The frontend then remained failed and never
acknowledged the overlay when capture began.

`describe_capture_frame` now returns `null` before the calling window's session
and frames are ready, matching the frontend's listen-first/begin-event contract.
Actual startup failures and missing frames after readiness still return errors.
The native verification script asserts that the prewarmed request returns `null`.
Five consecutive real captures, cancellation, duplicate rejection, startup
timeout and successful retry passed in an isolated `com.nowly.capture-probe`
instance. Debug click-to-interactive measurements were 1.23–1.43 seconds; the
native frozen desktop appeared in 108–144 ms. Personal app data was not changed.

## Interface Contract

- Labels: `screenshot-session-{session_id}` and
  `screenshot-overlay-{session_id}-{display_id}`.
- `capture_window_ready()` and `capture_window_failed()` accept no client identity;
  Rust authenticates the calling window and derives its session.
- Session placeholder acknowledges mount, and again on the begin event when it
  was prewarmed before its session existed. Overlays acknowledge once their frame
  plan is rendered; the frozen desktop itself is painted natively beneath them
  (see 2026-10-09 below), so the WebView's own copy of the pixels only feeds the
  magnifier and never gates visibility.
- Keep `start_screen_capture` pending until readiness or failure, so failures
  return to the original Bar action.
- Cleanup and late results belong to one session. Old callbacks cannot terminate,
  display, or overwrite a newer session.
- The deadline starts at request entry. The supervisor bounds slow capture and
  frontend startup independently; it cannot guarantee redraw if the OS event loop
  itself is frozen.

## Verification

Use unit tests for injected hangs/timeouts and stale completions, React tests for
load/decode ordering and duplicate actions, and real Windows interaction for the
native lifecycle. Use the current locked dependencies. No network uploads or
unrelated application data edits are part of this repair.

## Final Result

The current release executable was rebuilt and exercised on 2026-09-30.
Real startup, cancel/repeat, clipboard pixels and one-session decode-failure
recovery passed. The failure injection rejected the renderer's image decode;
the native IPC, session teardown, Bar recovery and successful retry stayed real.
The historical permanent-hide report was not consistently reproduced before
the repair, so this is not a claim that one suspected lock was its proven cause.

See `../specs/2026-09-30-screenshot-interaction-verification.md` for exact
counts, executable hash, native output evidence and unverified release gates.

## 2026-10-09: Native freeze layer and prewarmed overlays

### Why the earlier tuning could not reach "instant"

Clicking the Bar button still took 2–3 seconds to show anything. Tuning PNG
compression and overlapping WebView loading with capture only shaved parts of
one serial critical path: cold-create a WebView2 window per display, load
`screenshot.html`, encode the full desktop, push it through the custom scheme,
decode it, and only then show anything. Even the best release measurement of
that path (about 600 ms on one 2240×1400 display) was a floor, not a typical
case. The 2026-10-08 window-before-capture change also delayed the freeze
moment by the window creation time, and acknowledging before decode moved
the decode after the window became visible rather than removing it.

### What changed

1. **Capture first, then show natively.** After the Bar hides and DWM
   composes, GDI captures each display into a DIB section that is kept, not
   copied. A plain Win32 freeze window per display (`screen_capture/freeze.rs`)
   paints that bitmap with one `BitBlt` and is shown with `SW_SHOWNOACTIVATE`
   immediately. It is topmost, a tool window, never activates, and shows a
   crosshair. No encoding, transfer or WebView is on this path.
2. **RGBA after the freeze is visible.** The RGBA copy that exports, mosaics
   and colour sampling use is built from the same DIB only after the freeze
   window is up (`backend::capture_native` / `backend::to_frames`).
3. **Prewarmed overlays.** While no capture runs, the windows for the *next*
   session id are built hidden (`screen_capture/pool.rs`): 2 s after launch and
   400 ms after each session ends. They keep the per-session labels, so every
   ownership rule, teardown and the fresh-document-per-session guarantee is
   unchanged. At click time `reconcile` only repositions them; any missing
   window (first click, display added) is created as before. Overlays for
   displays that have since disappeared stay hidden until teardown, because
   destroying one could end the session that just began.
4. **Non-blocking frame protocol.** `describe_capture_frame` returns `null`
   until the caller's frames exist; Rust then emits
   `screenshot-capture-begin`. Surfaces register the listener before asking,
   so neither moment can be missed.
5. **Transparent interactive overlay.** The overlay document is transparent
   and acknowledges as soon as its plan is rendered. `show_windows` shows only
   the planned overlays, raises each to the top of the topmost band, and puts
   its freeze window directly beneath it.
6. **Lazy pixels for the magnifier.** The frame is served as a top-down
   32-bit `BITMAPV4HEADER` bitmap whose bitfield masks match the stored RGBA
   order: a header plus a copy, with no encoding and no per-session cache. The
   `<img>` is invisible and only feeds the magnifier, which appears once the
   pixels decode. A pixel failure shows the §4.3 unavailable readout instead of
   failing the session.
7. **Teardown order.** Overlay destruction is queued first, then the freeze
   windows are destroyed on the main thread together with the Bar restore.
   Freeze windows are adopted only while their session is current, so a session
   cancelled mid-start cannot leak one.

Spec compatibility: nothing is captured before the click (§3.2.1); the Bar and
all of Nowly's own capture windows are hidden or not yet visible when the
screen is read (§3.2.4); nothing is shown before the frozen frame exists
(§3.2.5); the only task switch entry is still the placeholder session window
(§3.3).

### Verification

- 222 Rust screen-capture tests (746 in the crate) pass. They include ownership
  rules for prewarm targets and late builds, the non-blocking frame check, the
  BMP layout, and a real Win32 test that creates, paints and destroys a freeze
  window and checks the shared pixels are released.
- 442 screenshot frontend tests pass, covering the listen-then-describe order,
  the begin-event race, acknowledgement before pixels, and the non-fatal pixel
  failure. The 7 failures elsewhere in the full suite (icons, Status Island
  assistant, AssistantDock) fail identically on a clean `HEAD`.
- A BMP from the Rust encoder decodes byte-for-byte in Edge (top-down rows,
  RGBA order, alpha intact).
- On the release probe build, the launch prewarm built the next session's
  windows in 241 ms in the background. A capture attempted while the
  workstation was locked failed cleanly with `AccessDenied` and was followed by
  a fresh prewarm (260 ms).
- Native harness on an unlocked desktop (release build, one display, real Bar
  clicks), five warm sessions with the prewarmed overlay reused: the frozen
  desktop was visible **102–118 ms** after the start command entered, and the
  overlay was interactive **281–325 ms** after the DOM click (previously 2–3 s
  before anything appeared). Example breakdown (ms from command entry): Bar
  hidden 6–12, composition 8–14, window candidates 19–23, GDI capture 22→102
  (the largest remaining cost), freeze visible 112–119, frames stored 138–142,
  acknowledgements 154, windows shown 224–250.
- Cold path (retry immediately after a timeout, nothing prewarmed): frozen
  desktop still at 112 ms; the overlay became interactive at 732 ms, with the
  frozen desktop already on screen meanwhile.
- The same run passed: no visible capture windows at idle, Bar restored,
  duplicate start rejected, cancellation while overlays withheld readiness, a
  bounded 5 s timeout with clean teardown, and a successful retry.
- **Not yet measured:** mixed-DPI multi-monitor behaviour, and whether
  dropping `CAPTUREBLT` would shorten the 80 ms GDI capture without losing
  layered windows.

### Repeat the native verification

Use a **disposable application identifier** so this does not edit personal data.
The harness refuses any app identifier other than `com.nowly.capture-probe`.
Only local WebView2 debugging is used; desktop pixels are not saved or uploaded.
The desktop must be unlocked, and the process must stay running while the
harness executes.

```powershell
npm run build
$env:TAURI_CONFIG = '{"identifier":"com.nowly.capture-probe"}'
cargo build --release --features tauri/custom-protocol --manifest-path src-tauri\Cargo.toml
Remove-Item Env:TAURI_CONFIG
$log = Join-Path $env:TEMP 'nowly-probe-stderr.log'
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9337 --remote-debugging-address=127.0.0.1'
$probe = Start-Process .\src-tauri\target\release\nowly.exe -PassThru -RedirectStandardError $log
Remove-Item Env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
$env:NOWLY_CAPTURE_PROBE_LOG = $log
node scripts\verify-screenshot-startup.cjs
Stop-Process -Id $probe.Id
```

Afterwards, rebuild without `TAURI_CONFIG` before distributing or running the
normal application. The probe profile is disposable; no production settings are
needed.

