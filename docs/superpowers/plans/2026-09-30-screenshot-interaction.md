# Screenshot Interaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Repair screenshot startup and implement the approved direct selection workflow.

**Architecture:** Rust owns one session, frozen frames, and a frozen list of window rectangles. React owns display-local editor gestures and sends virtual-desktop coordinates only at native image boundaries. Readiness and retirement remain session-scoped.

**Tech Stack:** Existing Tauri 2/Rust Windows APIs, React/TypeScript, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-30-screenshot-interaction-amendment.md`

## Constraints

- Preserve unrelated dirty changes; do not commit, reset, or push.
- Reuse existing Nowly tokens, Solar adapters, document/undo model, and output renderer.
- No title/handle logging, image uploads, new history, or AI/business-data changes.
- Keep implementation in this dirty checkout, since it contains the screenshot foundation.
- Do not treat mocked IPC as proof of native capture or clipboard success.

## Task 1: Native Startup and Frozen Window Candidates

Files: `src-tauri/src/screen_capture.rs`, `screen_capture/session.rs`,
`screen_capture/frames.rs`, `screen_capture/window.rs`, a focused candidate module,
and `src-tauri/src/main.rs`.

- [x] Run the existing failing async-protocol regression and add candidate
  eligibility, clipping, negative-origin, and z-order tests.
- [x] Serve PNG encoding through the asynchronous scheme responder, with owned
  app/caller identity and no UI-thread PNG work.
- [x] Enumerate eligible top-level windows before overlays; store the immutable
  rectangles with the session and return the approved frame-plan contract.
- [x] Keep technical session UI out of the direct selection path.
- [x] Run `cargo test screen_capture -- --test-threads=1` in `src-tauri`;
  inspect all session/readiness/retirement regressions.

Contract assertion:

```ts
expect(plan).toMatchObject({
  originX: -1920, originY: 0,
  windowCandidates: [{ x: 20, y: 30, width: 640, height: 480 }]
});
```

## Task 2: Selection and Editing Interaction

Files: `src/screenshot/ScreenshotApp.tsx`, `useCaptureFrame.ts`, `useSelection.ts`,
`useSelectionEditing.ts`, `useAnnotationEditing.ts`, `useAnnotationDrawing.ts`,
`TextEditor.tsx`, `key-dispatch.ts`, and their focused tests.

- [x] Add failing tests for hover/click/drag selection, layered context-menu
  behavior, drag rollback, text re-edit, and double-click completion.
- [x] Consume the approved frame-plan contract; initialize hover from pointer
  input, clip candidates, and keep handles/toolbar hidden while aiming.
- [x] Add rollback operations to gesture hooks, route pointer cancellation and
  focus loss, and prevent right-button events from beginning left-button work.
- [x] Edit existing text through one document transaction; route completion only
  from canvas input, not text/IME/property controls.
- [x] Run `npx vitest run src/screenshot` and retain old readiness tests.

Representative cancellation assertion:

```ts
expect(result.current.selection).toEqual(beforeDrag);
expect(result.current.doc.past).toHaveLength(beforeHistoryLength);
expect(invoke).not.toHaveBeenCalledWith('cancel_screen_capture');
```

## Task 3: Native Output Boundaries

Files: `src/screenshot/useExport.ts`, `useMosaicPreview.ts`, and focused tests.
`ScreenshotApp.tsx` is integrated by Task 2 to avoid concurrent edits.

- [x] Add failing same-tick duplicate export and signed display-origin tests.
- [x] Add a synchronous ref latch shared by copy/save.
- [x] Translate selection by display origin for export and mosaic preview only;
  leave annotation rasterization and mosaic offsets local.
- [x] Invalidate pending previews on removal/unmount and clear a stale preview.
- [x] Task 2 passes origin to these hooks and adds origin to native color sampling.
- [x] Verify save cancellation/failure retains the editor and retry remains usable.

Boundary assertion:

```ts
expect(geometry).toMatchObject({ x: -1900, y: 30, width: 100, height: 80 });
expect(geometry.mosaics[0]).toMatchObject({ x: 5, y: 7 });
```

## Task 4: Browser, Native, and Review

Files: `tests/nowly-screenshot-startup.spec.ts`, screenshot interaction browser tests,
and screenshot validation documents.

- [x] Repair no-argument IPC expectations (`{}`) and StrictMode-idempotent ACK assertions.
- [x] Test real image decoding, hover selection, right-click rollback, text edit,
  double-click completion, and retry without Bar geometry changes in browser.
- [x] Run focused tests, full frontend/native regressions, TypeScript/build, and
  `git diff --check`; distinguish unrelated pre-existing failures.
- [x] Obtain independent spec/code-quality review of concurrency and interaction.
- [x] Rebuild the actual workspace executable and exercise the native lifecycle
  against synthetic content when permitted; record remaining platform limits.
- [x] Update evidence and checklist; do not mark incomplete release gates passed.

## Progress and Decisions

- Plan/spec approved. Implementation is continuing in the existing dirty checkout.
- Native and frontend tasks have disjoint ownership; Task 2 alone edits ScreenshotApp.
- Root owns output hooks and documentation; browser reviewer owns browser tests.
- A current unrelated AssistantDock prop mismatch is a known build boundary.
- Task 3 hook regression: 7 failures / 4 passes before production edits; 11/11
  pass after adding origins, single-flight output, and preview invalidation.
- Build integration decision: remove the already-ignored `autoFocus` and
  `onRequestClose` props from the Bar caller to match the working-tree
  AssistantDock interface. Do not restore or rewrite unrelated AI changes.
- Native regression: 198 passed / 0 failed / 4 ignored. Both frame bytes and
  frame-plan reads are dispatched off the UI thread to avoid mutex waits there.
- Startup browser baseline: 5/5 passed after matching no-argument IPC and
  StrictMode behavior; new interaction cases initially failed at missing hover
  selection as expected.
- Technical-window decision: show decoded overlays first, then the static
  session identity without activation beneath them. Preserve the taskbar entry;
  do not claim the older suspend/return lifecycle has been completed.
- Final frontend: screenshot tests 374/374; full suite 1131/1135, with four
  unrelated AssistantDock/Bar AI failures. Production Tauri build passed.
- Final native: 736 passed, 0 failed, 5 ignored. Independent scoped review
  found no remaining Important issue.
- Final browser: 38/38 across 1366x768 and 1920x1080, including real PNG
  pixels, text focus, toolbar key ownership, rollback, output retry and save
  cancellation. Native IPC is simulated only in this browser matrix.
- Current release executable verified on Windows: real startup, window
  selection, custom drag, cancellation/repeat, image/HEX clipboard, annotated
  PNG output, and injected decode-failure recovery. The system-dialog
  cancellation action was not conclusively verified.
- Detailed evidence and remaining release gates:
  `../specs/2026-09-30-screenshot-interaction-verification.md`.
