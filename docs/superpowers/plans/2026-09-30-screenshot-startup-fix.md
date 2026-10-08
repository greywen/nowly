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

## Interface Contract

- Labels: `screenshot-session-{session_id}` and
  `screenshot-overlay-{session_id}-{display_id}`.
- `capture_window_ready()` and `capture_window_failed()` accept no client identity;
  Rust authenticates the calling window and derives its session.
- Session placeholder acknowledges mount. Overlays acknowledge only valid decoded
  pixels; metadata alone never satisfies the startup barrier.
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
