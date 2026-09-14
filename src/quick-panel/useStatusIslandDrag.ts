import { invoke } from '@tauri-apps/api/core';
import { useCallback, useEffect, useRef, useState } from 'react';

// Parking the top surface. The island lives on the top edge, so the only thing
// the user can change about its place is how far along that edge it sits: the
// gesture reports x travel and nothing else, and the native side clamps it to
// the work area so it can never be dragged off screen or away from the edge.
//
// A long press, not a plain drag: a single click opens the panel, and the same
// pixels cannot mean both "open" and "move" without one of them firing by
// accident. The press has to be held before anything moves.
//
// This is input-driven motion (design.md §10: "直接响应输入的运动（拖拽跟手）"),
// not a transition. Nothing here interpolates; the surface is wherever the
// pointer has moved it.

/** How long the button must be held before the surface can be moved. */
export const DRAG_HOLD_MS = 350;

/** One arrow key press, for moving the surface without a pointer. */
export const NUDGE_STEP = 24;

type PressState = {
  pointerId: number;
  /** Screen x, so the delta survives the window moving out from under us. */
  originScreenX: number;
  lastScreenX: number;
  dragging: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  /** The pending move, if this frame has not reported one yet. */
  frame: number | null;
};

export type StatusIslandDrag = {
  /** True while the surface is being moved, for the grabbing cursor. */
  dragging: boolean;
  onGrab: (event: React.PointerEvent) => void;
  /** Moves the surface by one step. Negative is left. */
  nudge: (steps: number) => void;
  /**
   * Whether the click that just landed was the end of a drag. Reading it clears
   * it, so releasing a drag over the island does not also open the panel.
   */
  consumedClick: () => boolean;
};

export function useStatusIslandDrag(): StatusIslandDrag {
  const press = useRef<PressState | null>(null);
  const suppressClick = useRef(false);
  const [dragging, setDragging] = useState(false);

  const finish = useCallback((state: PressState) => {
    if (state.timer !== null) clearTimeout(state.timer);
    if (state.frame !== null) cancelAnimationFrame(state.frame);
    press.current = null;
    if (!state.dragging) return;
    suppressClick.current = true;
    setDragging(false);
    void invoke('end_status_island_drag');
  }, []);

  // A press that is still open when the surface unmounts (shape change, window
  // teardown) would otherwise leave native believing a drag is in progress,
  // which refuses every hover-open from then on.
  useEffect(() => () => {
    const state = press.current;
    if (state) finish(state);
  }, [finish]);

  const onGrab = useCallback((event: React.PointerEvent) => {
    // Primary button only: a right click is the context menu, not a move.
    if (event.button !== 0) return;
    const element = event.currentTarget as HTMLElement;
    // Keeps the pointer logically owned by the island while the window slides out
    // from under it. Not load-bearing: the listeners below are on `window`, so a
    // host without capture (or one that refuses it for this pointer) still
    // tracks the whole gesture.
    try {
      element.setPointerCapture?.(event.pointerId);
    } catch {
      // Nothing to recover: the drag works without capture.
    }

    const state: PressState = {
      pointerId: event.pointerId,
      originScreenX: event.screenX,
      lastScreenX: event.screenX,
      dragging: false,
      timer: null,
      frame: null
    };
    press.current = state;

    function onMove(moveEvent: PointerEvent) {
      if (press.current !== state || moveEvent.pointerId !== state.pointerId) return;
      state.lastScreenX = moveEvent.screenX;
      if (!state.dragging || state.frame !== null) return;
      // One native call per painted frame. A pointer reports far faster than the
      // window can be redrawn, and each call moves the window on the main thread:
      // one per event floods the event loop and the whole app stops responding.
      state.frame = requestAnimationFrame(() => {
        state.frame = null;
        if (press.current !== state || !state.dragging) return;
        // Total travel since the press, not an increment: the surface stays glued
        // to the pointer even when a move is dropped or a position is clamped.
        void invoke('drag_status_island', { deltaX: state.lastScreenX - state.originScreenX });
      });
    }

    function onRelease(releaseEvent: PointerEvent) {
      if (releaseEvent.pointerId !== state.pointerId) return;
      try {
        element.releasePointerCapture?.(state.pointerId);
      } catch {
        // Already released, or never captured.
      }
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onRelease);
      window.removeEventListener('pointercancel', onRelease);
      if (press.current === state) finish(state);
    }

    // On `window`, so a pointer that leaves the 288x48 window vertically still
    // reports its release. An element-scoped listener would lose the gesture and
    // leave native holding a drag that never ends.
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onRelease);
    window.addEventListener('pointercancel', onRelease);

    state.timer = setTimeout(() => {
      state.timer = null;
      if (press.current !== state) return;
      void invoke('begin_status_island_drag').then(began => {
        // Released while the request was in flight, or nothing draggable there:
        // either way native must not be left holding a drag.
        if (press.current !== state) {
          if (began === true) void invoke('end_status_island_drag');
          return;
        }
        if (began !== true) return;
        state.dragging = true;
        setDragging(true);
        // The pointer may have travelled during the hold. Re-anchor to where it
        // is now so the surface does not jump the moment the drag starts.
        state.originScreenX = state.lastScreenX;
      });
    }, DRAG_HOLD_MS);
  }, [finish]);

  // Keyboard equivalent, so parking the surface is not pointer-only.
  const nudge = useCallback((steps: number) => {
    void invoke('begin_status_island_drag').then(began => {
      if (began !== true) return;
      return invoke('drag_status_island', { deltaX: steps * NUDGE_STEP })
        .finally(() => invoke('end_status_island_drag'));
    });
  }, []);

  const consumedClick = useCallback(() => {
    const consumed = suppressClick.current;
    suppressClick.current = false;
    return consumed;
  }, []);

  return { dragging, onGrab, nudge, consumedClick };
}
