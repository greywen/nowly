# Screenshot Interaction Amendment

Date: 2026-09-30
Status: approved by the user ("可以 开始实施").

This amendment supersedes the ordinary-capture interaction conflicts in
`2026-09-25-nowly-screenshot-design.md`. It does not replace the original
privacy, output, annotation, or scrolling-capture requirements.

## Approved Flow

1. Clicking the Bar screenshot control starts one bounded capture request.
   Repeated input cannot start another request. Hide the Bar, freeze the desktop,
   decode every frame, then show the selection surface directly. A session
   identity/Alt+Tab placeholder is technical infrastructure, not a startup page.
2. Before overlays appear, freeze eligible visible top-level window bounds in
   topmost-first order. Exclude minimized, cloaked, empty, Bar, and screenshot
   helper windows. The Nowly main window remains eligible. Do not send handles,
   titles, process names, or other window metadata to the renderer.
3. While aiming, hovering highlights the topmost candidate under the pointer.
   A click selects that candidate; a deliberate drag selects a custom rectangle.
   With no candidate, a click stays in aiming. Toolbar and resize handles appear
   only after selection is committed.
4. Esc/right-click first cancel local text/drawing/transform work and restore the
   state before that uncommitted gesture. Next dismiss selected object/tool.
   Right-click on an unannotated selection returns to aiming; right-click with
   committed annotations does not erase them. Right-click while aiming exits.
   Esc with no local editing context exits. The explicit cancel button exits.
5. Pointer cancellation, lost capture, or focus loss rolls back only the current
   gesture. A cancelled transform creates no undo entry.
6. Finish, Enter on the canvas, and double-click on empty space inside the
   selection copy the final image and exit. Double-click on a text annotation
   edits that object instead. Input/IME and toolbar events never export.
7. Copy/save are single-flight and freeze editing. A cancelled save or failed
   output keeps the selection and all committed annotations, allowing retry.
8. Startup failure restores the Bar with retry feedback at the original control.
   Late work from a retired session cannot show windows, replace frames, or
   close a newer capture.

## Coordinate Contract

`describe_capture_frame` adds:

```ts
type FramePlan = {
  path: string;
  width: number;
  height: number;
  originX: number;
  originY: number;
  windowCandidates: Array<{ x: number; y: number; width: number; height: number }>;
};
```

`originX`/`originY` are the signed physical virtual-desktop origin of that display.
Candidate rectangles are clipped to that display and expressed in display-local
physical pixels, topmost first. Selection, annotation, and hit testing remain
display-local. Only native export/preview/color command coordinates receive the
display origin. Mosaic rectangles remain selection-local.

This patch corrects per-display origins; it does not claim to complete the old
specification's shared cross-monitor drag selection. Native display-topology,
mixed-DPI, task-switch privacy, and long-screenshot acceptance remain separately
tracked and must not be marked passed by mocked browser tests.

## Acceptance

- Delayed/corrupt image startup has correct ready/failed behavior.
- One click selects the topmost eligible frozen window; drag overrides hover.
- Esc/right-click/capture loss preserve previously committed content.
- Text double-click edits; empty-area double-click finishes once.
- Negative display origins reach export, preview, and color sampling correctly.
- Save cancellation/failure and immediate duplicate completion are covered.
- Unit, browser, build, and native test evidence are recorded separately.
