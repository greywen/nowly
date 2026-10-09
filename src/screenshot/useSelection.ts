import { useCallback, useEffect, useRef, useState } from 'react';
import {
  frameBoxFromElement,
  pointerToFramePixel,
  type FrameBox
} from './frame-geometry';
import {
  moveSelection,
  resizeSelection,
  selectionFromDrag,
  type PixelRect,
  type ResizeHandle
} from './screenshot-model';
import type { CaptureWindowCandidate } from './useCaptureFrame';

/// The overlay covers one display, so the frame's own rectangle is the bound.
function boundsOf(box: FrameBox): PixelRect {
  return { x: 0, y: 0, width: box.frameWidth, height: box.frameHeight };
}

// The aiming drag: from the first press to the release that produces a selection.
//
// §4.2 of docs/superpowers/specs/2026-09-25-nowly-screenshot-design.md: the drag
// works in physical pixels, and a press that never moves is not a selection.

export type SelectionPhase = 'aiming' | 'dragging' | 'editing';

export type SelectionState = {
  phase: SelectionPhase;
  /// The committed selection, in this display's physical pixels.
  selection: PixelRect | null;
  /// The rectangle being dragged right now, for live feedback.
  draft: PixelRect | null;
  /// The pixel under the pointer, or null when it is off the frame.
  pointerPixel: { x: number; y: number } | null;
  /// An uncommitted move or resize of the committed rectangle. §7 gives Esc to the
  /// gesture in progress, so the key dispatcher has to be able to see this one.
  transforming: boolean;
  /// The frame box the last event was resolved against, so the renderer scales
  /// with the same numbers the selection was built from rather than reading the
  /// DOM during render.
  box: FrameBox | null;
};

function samePoint(
  left: { x: number; y: number } | null,
  right: { x: number; y: number } | null
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.x === right.x && left.y === right.y;
}

function sameRect(left: PixelRect | null, right: PixelRect | null): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
}

function sameBox(left: FrameBox | null, right: FrameBox | null): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.frameWidth === right.frameWidth &&
    left.frameHeight === right.frameHeight &&
    left.renderedWidth === right.renderedWidth &&
    left.renderedHeight === right.renderedHeight &&
    left.offsetX === right.offsetX &&
    left.offsetY === right.offsetY
  );
}

function sameState(left: SelectionState, right: SelectionState): boolean {
  return (
    left.phase === right.phase &&
    left.transforming === right.transforming &&
    sameRect(left.selection, right.selection) &&
    sameRect(left.draft, right.draft) &&
    samePoint(left.pointerPixel, right.pointerPixel) &&
    sameBox(left.box, right.box)
  );
}

function candidateAt(
  pixel: { x: number; y: number } | null,
  candidates: readonly CaptureWindowCandidate[]
): PixelRect | null {
  if (!pixel) return null;
  return (
    candidates.find(
      (candidate) =>
        pixel.x >= candidate.x &&
        pixel.y >= candidate.y &&
        pixel.x < candidate.x + candidate.width &&
        pixel.y < candidate.y + candidate.height
    ) ?? null
  );
}

export function useSelection(
  frameRef: React.RefObject<HTMLElement | null>,
  candidates: readonly CaptureWindowCandidate[] = [],
  /// The planned physical frame size; the element's natural size until loaded.
  frameSize?: { width: number; height: number } | null
) {
  const [state, setState] = useState<SelectionState>({
    phase: 'aiming',
    selection: null,
    draft: null,
    pointerPixel: null,
    transforming: false,
    box: null
  });
  // The gesture's latest state, including samples not yet published to React.
  // Pointer events arrive faster than a frame, and a press/move/up batch can
  // finish before the next paint. Handlers read this, not the rendered state.
  const live = useRef(state);
  const publishScheduled = useRef(false);
  const frameId = useRef(0);
  // Layout of a display-sized frame is not free. The box does not change during
  // a drag, so reading it on every pointer sample forces a sync layout of the
  // transparent overlay at pointer-report rate.
  const boxCache = useRef<FrameBox | null>(null);
  const cachedElement = useRef<EventTarget | null>(null);
  const boxObserver = useRef<ResizeObserver | null>(null);
  const anchor = useRef<{ x: number; y: number } | null>(null);
  const pressedCandidate = useRef<PixelRect | null>(null);
  const customDrag = useRef(false);
  /// An in-progress move or resize of the committed selection.
  ///
  /// `base` is the rectangle the gesture started from, so an interruption restores
  /// exactly that rather than integrating the deltas back. The selection is not
  /// part of the annotation history, so none of this produces an undo entry.
  const transform = useRef<{
    handle: ResizeHandle | null;
    origin: { x: number; y: number };
    base: PixelRect;
  } | null>(null);
  /// The live pointer pixel, for handlers that run before React re-renders.
  const pointerPixelRef = useRef<{ x: number; y: number } | null>(null);
  // Read through a ref so a new size object does not rebuild every handler.
  const frameSizeRef = useRef(frameSize);
  frameSizeRef.current = frameSize;

  useEffect(() => {
    const invalidate = () => {
      boxCache.current = null;
    };
    window.addEventListener('resize', invalidate);
    return () => {
      window.removeEventListener('resize', invalidate);
      if (publishScheduled.current) cancelAnimationFrame(frameId.current);
      boxObserver.current?.disconnect();
    };
  }, []);

  const publish = useCallback((next: SelectionState) => {
    if (sameState(live.current, next)) return;
    live.current = next;
    if (publishScheduled.current) return;
    publishScheduled.current = true;
    frameId.current = requestAnimationFrame(() => {
      publishScheduled.current = false;
      setState(live.current);
    });
  }, []);

  const commitNow = useCallback((next: SelectionState) => {
    live.current = next;
    if (publishScheduled.current) {
      publishScheduled.current = false;
      cancelAnimationFrame(frameId.current);
    }
    setState(next);
  }, []);

  const boxOf = useCallback((): FrameBox | null => {
    const element = frameRef.current;
    if (!element) {
      boxCache.current = null;
      cachedElement.current = null;
      return null;
    }
    const planned = frameSizeRef.current;
    const cached = boxCache.current;
    if (
      cached &&
      cachedElement.current === element &&
      (!planned ||
        (cached.frameWidth === planned.width && cached.frameHeight === planned.height))
    ) {
      return cached;
    }
    const box = frameBoxFromElement(element, planned ?? undefined);
    if (
      box.renderedWidth > 0 &&
      box.renderedHeight > 0 &&
      box.frameWidth > 0 &&
      box.frameHeight > 0
    ) {
      boxCache.current = box;
      cachedElement.current = element;
      if (element instanceof HTMLElement && typeof ResizeObserver !== 'undefined') {
        boxObserver.current?.disconnect();
        const observer = new ResizeObserver(() => {
          boxCache.current = null;
        });
        observer.observe(element);
        boxObserver.current = observer;
      }
    }
    return box;
  }, [frameRef]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      // Only the primary button starts a selection; §7 leaves the context menu
      // and middle click alone.
      if (event.button !== 0) return false;
      const box = boxOf();
      if (!box) return false;
      const pixel = pointerToFramePixel({ x: event.clientX, y: event.clientY }, box);
      if (!pixel) return false;

      anchor.current = pixel;
      const candidate = candidateAt(pixel, candidates);
      pressedCandidate.current = candidate;
      customDrag.current = false;
      // No draft yet: a press that never moves is zero-sized, and §4.2 line 165
      // says such a click must not produce an image.
      publish({
        ...live.current,
        phase: 'dragging',
        draft: candidate,
        pointerPixel: pixel,
        box
      });
      return true;
    },
    [boxOf, candidates, publish]
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const box = boxOf();
      if (!box) return;
      const pixel = pointerToFramePixel({ x: event.clientX, y: event.clientY }, box);
      // Written synchronously, because a keystroke can arrive before React re-renders and
      // §4.1 requires the copied colour to be the pixel the pointer is over. A caller
      // cannot do this itself on the first move: `state.box` is set by this same event, so
      // its own closure still has no box to convert the coordinate with.
      pointerPixelRef.current = pixel;

      // Moving or resizing the committed rectangle. It owns the pointer for the
      // whole gesture, so the aiming drag below never also runs.
      const active = transform.current;
      if (active) {
        if (!pixel) return;
        const deltaX = pixel.x - active.origin.x;
        const deltaY = pixel.y - active.origin.y;
        const bounds = boundsOf(box);
        const next = active.handle
          ? resizeSelection(active.base, active.handle, deltaX, deltaY, bounds)
          : moveSelection(active.base, deltaX, deltaY, bounds);
        publish({ ...live.current, selection: next, pointerPixel: pixel, box });
        return;
      }

      const dragAnchor = anchor.current;
      const moved =
        dragAnchor !== null &&
        pixel !== null &&
        (pixel.x !== dragAnchor.x || pixel.y !== dragAnchor.y);
      const draggedSelection =
        moved && dragAnchor ? selectionFromDrag(dragAnchor, pixel, boundsOf(box)) : null;
      // This must happen before React processes the queued state update. Pointer events
      // can arrive in one batch (down/move/up in tests and on a busy renderer), and the
      // release handler snapshots this ref synchronously to decide whether a candidate
      // click became a custom drag.
      if (moved) customDrag.current = true;

      const current = live.current;
      // While dragging, a pointer that leaves the frame keeps the last valid
      // rectangle rather than dropping the drag.
      if (current.phase !== 'dragging' || !dragAnchor) {
        publish({
          ...current,
          pointerPixel: pixel,
          box,
          draft: current.phase === 'aiming' ? candidateAt(pixel, candidates) : current.draft
        });
        return;
      }
      if (!pixel) return;
      if (!moved) {
        publish({ ...current, pointerPixel: pixel, box });
        return;
      }
      // A zero-width or zero-height drag has no rectangle yet; keep aiming
      // feedback rather than showing a degenerate one.
      publish({ ...current, draft: draggedSelection, pointerPixel: pixel, box });
    },
    [boxOf, candidates, publish]
  );

  const onPointerUp = useCallback(() => {
    // A finished transform leaves the live rectangle as the committed one.
    // Read `live`, not the rendered state: the last samples of this gesture may
    // still be waiting for a frame, and the release has to commit those.
    if (transform.current) {
      transform.current = null;
      commitNow({ ...live.current, transforming: false });
      return;
    }
    if (!anchor.current) return;
    const clickedCandidate = pressedCandidate.current;
    const usedCustomDrag = customDrag.current;
    anchor.current = null;
    pressedCandidate.current = null;
    customDrag.current = false;
    const current = live.current;
    if (current.phase !== 'dragging') {
      commitNow(current);
      return;
    }
    const committed = usedCustomDrag ? current.draft : clickedCandidate;
    commitNow(
      committed
        ? { ...current, phase: 'editing', selection: committed, draft: null }
        : { ...current, phase: 'aiming', draft: null }
    );
  }, [commitNow]);

  const cancelGesture = useCallback(() => {
    // §5 of the 2026-09-30 amendment: an interruption rolls back exactly the
    // gesture in progress. A transform returns to the rectangle it started from,
    // which is not the same as discarding the selection altogether.
    const active = transform.current;
    if (active) {
      transform.current = null;
      commitNow({ ...live.current, selection: active.base, transforming: false });
      return true;
    }
    if (!anchor.current) return false;
    anchor.current = null;
    pressedCandidate.current = null;
    customDrag.current = false;
    commitNow({
      ...live.current,
      phase: 'aiming',
      selection: null,
      draft: candidateAt(live.current.pointerPixel, candidates)
    });
    return true;
  }, [candidates, commitNow]);

  const reset = useCallback(() => {
    anchor.current = null;
    pressedCandidate.current = null;
    customDrag.current = false;
    transform.current = null;
    boxCache.current = null;
    cachedElement.current = null;
    commitNow({
      phase: 'aiming',
      selection: null,
      draft: null,
      pointerPixel: null,
      transforming: false,
      box: null
    });
  }, [commitNow]);

  /// Replaces the committed selection, for the keyboard adjustments in §7.
  const setSelection = useCallback((selection: PixelRect) => {
    const current = live.current;
    if (current.phase !== 'editing') return;
    commitNow({ ...current, selection });
  }, [commitNow]);

  /// Starts dragging the committed rectangle itself, from a press inside it.
  ///
  /// Returns false when there is nothing to move, so the caller can fall through
  /// to whatever else owns that press.
  const beginMove = useCallback(
    (pixel: { x: number; y: number }) => {
      const current = live.current;
      if (current.phase !== 'editing' || !current.selection) return false;
      const region = current.selection;
      if (
        pixel.x < region.x ||
        pixel.y < region.y ||
        pixel.x >= region.x + region.width ||
        pixel.y >= region.y + region.height
      ) {
        return false;
      }
      transform.current = { handle: null, origin: pixel, base: region };
      commitNow({ ...current, transforming: true });
      return true;
    },
    [commitNow]
  );

  /// Starts a resize from one of the eight handles.
  const beginResize = useCallback(
    (handle: ResizeHandle, pixel: { x: number; y: number }) => {
      const current = live.current;
      if (current.phase !== 'editing' || !current.selection) return false;
      transform.current = { handle, origin: pixel, base: current.selection };
      commitNow({ ...current, transforming: true });
      return true;
    },
    [commitNow]
  );

  return {
    state,
    /// Read by the keyboard path: a keystroke can arrive before React re-renders from the
    /// pointer move that set the position, and §4.1 requires the copied colour to be the
    /// pixel the pointer is over.
    pointerPixelRef,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    cancelGesture,
    reset,
    setSelection,
    beginMove,
    beginResize
  };
}
