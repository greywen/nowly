# Screenshot Repair Verification

Date: 2026-09-30

Scope: the approved ordinary-capture startup and interaction amendment.
This report does not grant full screenshot release acceptance.

## Build Identity

- Base commit: `b1e114dd81c7afc1bfb3da9cec6c6bc0f5e75350`, plus the dirty
  workspace implementation. No commit, reset, push or unrelated AI rewrite.
- Executable: `src-tauri/target/release/nowly.exe`.
- SHA-256:
  `1784A64D23838C75295809EB57DC339B5659F65FEC63594EA956186863A6E70D`.
- Windows 11 Pro, build `26200.8655`, WebView2 `153.0.4234.48`.
- Physical capture: one `2240x1400` display, origin `(0, 0)`, scale `1.5`.
- `npm run tauri build -- --no-bundle`: PASS. Existing chunk-size and Rust
  unused-code warnings remain; no installer was built.

## Automated Results

| Check | Result |
|---|---|
| `npx vitest run src/screenshot` | 374 passed |
| `npm test -- --reporter=json --outputFile=.superpowers/validation/screenshot-interaction-vitest-final.json` | 1131 passed, 4 failed |
| `cargo test --quiet -- --test-threads=1` | 736 passed, 0 failed, 5 ignored |
| Screenshot Playwright matrix | 38 passed |
| TypeScript and production frontend build | PASS |
| `git diff --check` | PASS; existing LF/CRLF notices only |

Browser command:

```powershell
$env:PW_PORT = '1431'
$env:PW_REUSE_SERVER = 'false'
npx playwright test tests/nowly-screenshot-startup.spec.ts --project=1366x768 --project=1920x1080 --workers=1 --timeout=60000
```

The browser matrix uses real React, image loading/decoding, pointer events,
keyboard routing, canvas pixels and screenshots. Its native IPC is simulated.
It covers window hover/click, drag override, four gesture interruption paths,
layered right-click, text creation/re-edit, IME event ownership, toolbar Enter,
duplicate completion, output retry, save cancellation, and zh/en Bar geometry.

The four full-suite failures are outside the screenshot implementation:

- AssistantDock confirmation copy expectation.
- AssistantDock completed-card detail-button expectation.
- Bar logo opening the assistant: input autofocus expectation.
- Already-open assistant submission: input autofocus expectation.

The working tree already contained the AI changes behind these expectations.
The isolated AssistantDock run was 37 passed / 2 failed. Both autofocus failures
were also present before this iteration. Only obsolete, already-ignored
`autoFocus` and `onRequestClose` caller props were removed for build compatibility.

Regression work included failing cases before production fixes for startup
readiness, session retirement, candidate geometry, output origin/single-flight,
gesture cancellation and keyboard ownership. Real-browser tests additionally
exposed CORS canvas taint, toolbar Enter completion, and new-text focus loss.
Those failures were repaired and the final 38-case matrix rerun in full.

Independent scoped review passed after fixes to main-thread suppression,
session-qualified cleanup, exact-origin CORS, live output checks and clipboard
HWND ownership. A final session check now follows image preparation and
OpenClipboard, immediately before clipboard mutation.

## Actual Windows Application

The current release executable was launched with a process-local loopback
WebView2 debugging argument. Playwright drove its real Bar and overlay; native
IPC, GDI frames, PNG scheme, Windows clipboard and file dialog were not mocked.
The test argument and all temporary renderer instrumentation were removed by
stopping the owned test process and starting the same executable normally.

The desktop test source was `tests/fixtures/screenshot-target.html`. When the
computer-use helper could not bind Chrome, that synthetic content was displayed
temporarily in the test process's main WebView. This did not write business data.

| Probe | Observed Result |
|---|---|
| First real Bar click | Decoded `2240x1400` frame in about 651 ms |
| Window hover | Topmost eligible `1924x1127` window; no toolbar or handles |
| Window click | Same window selected; eight handles and toolbar appeared |
| Aiming magnifier | Known synthetic patch read `#4FC9DA` |
| Bar suppression | Native visibility false during capture, true after exit |
| Right-click on empty selection | Returned to aiming without ending session |
| Custom drag | Exact `120x60` physical-pixel region |
| Finish button | Real clipboard image, `120x60`, all 7200 RGB pixels correct |
| Color copy | Real clipboard text exactly `#4FC9DA`; session stayed open |
| Text and PNG output | `300x180` decoded PNG, correct teal corner and 422 exact annotation-color pixels |
| Three repeated start/Esc cycles | Ready in 900, 790 and 765 ms; only main and Bar remained after each |
| One-session decode rejection | Bar restored with retry within 621 ms; no capture windows remained |
| Retry after injected failure | A new session opened and the button error cleared |
| Empty-area double-click | Session closed; verified-source `120x60` clipboard image had zero incorrect pixels |

The injected failure replaced only image decode for session 8. Readiness IPC,
native retirement, Bar recovery and session 9 retry were real. An earlier CDP
network-abort attempt did not intercept the Tauri custom protocol and is not
counted as a failure-recovery pass.

The first double-click pixel assertion reused coordinates after desktop focus
changed and failed. It is not counted as a pass. The fixture was reactivated,
all 7200 source pixels were checked before selection, and the test was repeated
successfully against that verified frozen frame.

The native Save As dialog was observed as a nested modal owned by the disabled
overlay, not a separate `list_windows` entry. The helper's attempted Cancel
action returned a focus error. A PNG was actually saved and independently
decoded, but this does not establish native save-cancellation behavior.

## Local Evidence

- `test-results/native-capture-120x60.png`
- `test-results/native-capture-double-click-120x60.png`
- `test-results/native-screenshot-annotated.png`
- `test-results/screenshot-interaction-focused.json`
- `.superpowers/validation/screenshot-interaction-vitest-final.json`
- Browser screenshots under `test-results/nowly-screenshot-startup-*`:
  `overlay-ready.png`, `window-click-selection.png`,
  `cross-origin-magnifier.png`, `annotation-editing.png`,
  `output-retry.png`, and `bar-capture-retry.png`.

Screenshots at both browser sizes were inspected for blank content, clipping and
overflow. PNG/canvas and clipboard claims above also have numeric pixel checks,
not just visual inspection. Local test artifacts are intentionally gitignored.

## Remaining Gates

- Native Save As cancellation/failure/overwrite and focus restoration.
- Actual Chinese IME composition and cross-application paste into WeChat,
  Paint and Word.
- Mixed-DPI and negative-origin real displays, continuous cross-display drag,
  rotation, display detach and HDR/protected content.
- Full Alt+Tab suspend/resume, task-switch thumbnails and Peek privacy.
- Long capture, scrolling targets and stitching acceptance.
- Prescribed cold/hot startup sample size and P95 thresholds; the timings above
  are smoke measurements, not a performance acceptance result.
- The four unrelated AI regression failures and complete release security,
  accessibility and compatibility matrices.

The original permanent "Bar hides and nothing happens" report was not
consistently reproduced before these changes. The confirmed fixes are supported
by explicit regressions and the current native workflow, not by claiming one
suspected deadlock was the historically proven sole cause.
