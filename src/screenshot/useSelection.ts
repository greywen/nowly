import { useCallback, useRef, useState } from 'react';
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
  frameRef: React.RefObject<HTMLImageElement | null>,
  candidates: readonly CaptureWindowCandidate[] = []
) {
  const [state, setState] = useState<SelectionState>({
    phase: 'aiming',
    selection: null,
    draft: null,
    pointerPixel: null,
    transforming: false,
    box: null
  });
  // A mirror of `state`, so a handler that runs before React re-renders still sees
  // the committed rectangle: a press and its first move can arrive in one batch.
  const stateRef = useRef(state);
  stateRef.current = state;
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

  const boxOf = useCallback((): FrameBox | null => {
    const image = frameRef.current;
    if (!image) return null;
    return frameBoxFromElement(image);
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
      setState((current) => ({
        ...current,
        phase: 'dragging',
        draft: candidate,
        pointerPixel: pixel,
        box
      }));
      return true;
    },
    [boxOf, candidates]
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
        setState((current) => ({ ...current, selection: next, pointerPixel: pixel, box }));
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

      setState((current) => {
        // While dragging, a pointer that leaves the frame keeps the last valid
        // rectangle rather than dropping the drag.
        if (current.phase !== 'dragging' || !dragAnchor) {
          return {
            ...current,
            pointerPixel: pixel,
            box,
            draft: current.phase === 'aiming' ? candidateAt(pixel, candidates) : current.draft
          };
        }
        if (!pixel) return current;
        if (!moved) {
          return { ...current, pointerPixel: pixel, box };
        }
        // A zero-width or zero-height drag has no rectangle yet; keep aiming
        // feedback rather than showing a degenerate one.
        return { ...current, draft: draggedSelection, pointerPixel: pixel, box };
      });
    },
    [boxOf, candidates]
  );

  const onPointerUp = useCallback(() => {
    // A finished transform leaves the live rectangle as the committed one.
    if (transform.current) {
      transform.current = null;
      setState((current) => ({ ...current, transforming: false }));
      return;
    }
    if (!anchor.current) return;
    const clickedCandidate = pressedCandidate.current;
    const usedCustomDrag = customDrag.current;
    anchor.current = null;
    pressedCandidate.current = null;
    customDrag.current = false;
    setState((current) => {
      if (current.phase !== 'dragging') return current;
      const { draft } = current;
      const committed = usedCustomDrag ? draft : clickedCandidate;
      if (!committed) return { ...current, phase: 'aiming', draft: null };
      return { ...current, phase: 'editing', selection: committed, draft: null };
    });
  }, []);

  const cancelGesture = useCallback(() => {
    // §5 of the 2026-09-30 amendment: an interruption rolls back exactly the
    // gesture in progress. A transform returns to the rectangle it started from,
    // which is not the same as discarding the selection altogether.
    const active = transform.current;
    if (active) {
      transform.current = null;
      setState((current) => ({ ...current, selection: active.base, transforming: false }));
      return true;
    }
    if (!anchor.current) return false;
    anchor.current = null;
    pressedCandidate.current = null;
    customDrag.current = false;
    setState((current) => ({
      ...current,
      phase: 'aiming',
      selection: null,
      draft: candidateAt(current.pointerPixel, candidates)
    }));
    return true;
  }, [candidates]);

  const reset = useCallback(() => {
    anchor.current = null;
    pressedCandidate.current = null;
    customDrag.current = false;
    transform.current = null;
    setState({
      phase: 'aiming',
      selection: null,
      draft: null,
      pointerPixel: null,
      transforming: false,
      box: null
    });
  }, []);

  /// Replaces the committed selection, for the keyboard adjustments in §7.
  const setSelection = useCallback((selection: PixelRect) => {
    setState((current) =>
      current.phase === 'editing' ? { ...current, selection } : current
    );
  }, []);

  /// Starts dragging the committed rectangle itself, from a press inside it.
  ///
  /// Returns false when there is nothing to move, so the caller can fall through
  /// to whatever else owns that press.
  const beginMove = useCallback(
    (pixel: { x: number; y: number }) => {
      const current = stateRef.current;
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
      setState((current) => ({ ...current, transforming: true }));
      return true;
    },
    []
  );

  /// Starts a resize from one of the eight handles.
  const beginResize = useCallback(
    (handle: ResizeHandle, pixel: { x: number; y: number }) => {
      const current = stateRef.current;
      if (current.phase !== 'editing' || !current.selection) return false;
      transform.current = { handle, origin: pixel, base: current.selection };
      setState((previous) => ({ ...previous, transforming: true }));
      return true;
    },
    []
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
