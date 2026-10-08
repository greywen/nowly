import { createElement, StrictMode, type ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type React from 'react';
import { useSelection } from './useSelection';

// A 2240×1400 frame rendered at 150%, matching the development machine.
function frameRef(): React.RefObject<HTMLImageElement | null> {
  const image = {
    naturalWidth: 2240,
    naturalHeight: 1400,
    getBoundingClientRect: () => ({
      width: 1493.3333333333333,
      height: 933.3333333333334,
      left: 0,
      top: 0
    })
  } as unknown as HTMLImageElement;
  return { current: image };
}

/// Only the fields the hook reads.
function pointer(x: number, y: number, button = 0): React.PointerEvent {
  return { clientX: x, clientY: y, button } as React.PointerEvent;
}

describe('the aiming drag', () => {
  const candidates = [
    { x: 120, y: 120, width: 300, height: 200 },
    { x: 60, y: 60, width: 600, height: 500 }
  ];

  it('highlights the topmost frozen window under the pointer', () => {
    const { result } = renderHook(() => useSelection(frameRef(), candidates));

    act(() => result.current.onPointerMove(pointer(100, 100)));

    expect(result.current.state.draft).toEqual(candidates[0]);
    expect(result.current.state.phase).toBe('aiming');
  });

  it('commits the highlighted window from a click', () => {
    const { result } = renderHook(() => useSelection(frameRef(), candidates));

    act(() => result.current.onPointerMove(pointer(100, 100)));
    act(() => result.current.onPointerDown(pointer(100, 100)));
    act(() => result.current.onPointerUp());

    expect(result.current.state.phase).toBe('editing');
    expect(result.current.state.selection).toEqual(candidates[0]);
  });

  it('lets a real drag override the highlighted window', () => {
    const { result } = renderHook(() => useSelection(frameRef(), candidates));

    act(() => result.current.onPointerMove(pointer(100, 100)));
    act(() => result.current.onPointerDown(pointer(100, 100)));
    act(() => result.current.onPointerMove(pointer(300, 200)));
    act(() => result.current.onPointerUp());

    expect(result.current.state.selection).toEqual({
      x: 150,
      y: 150,
      width: 300,
      height: 150
    });
  });

  it('commits hover clicks and custom drags when StrictMode batches the pointer stream', () => {
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(StrictMode, null, children);
    const clicked = renderHook(() => useSelection(frameRef(), candidates), { wrapper });

    act(() => {
      clicked.result.current.onPointerDown(pointer(100, 100));
      clicked.result.current.onPointerUp();
    });

    expect(clicked.result.current.state.selection).toEqual(candidates[0]);

    const dragged = renderHook(() => useSelection(frameRef(), candidates), { wrapper });
    act(() => {
      dragged.result.current.onPointerDown(pointer(100, 100));
      dragged.result.current.onPointerMove(pointer(300, 200));
      dragged.result.current.onPointerUp();
    });

    expect(dragged.result.current.state.selection).toEqual({
      x: 150,
      y: 150,
      width: 300,
      height: 150
    });
  });

  it('rolls an unfinished drag back to aiming without committing its rectangle', () => {
    const { result } = renderHook(() => useSelection(frameRef(), candidates));

    act(() => result.current.onPointerDown(pointer(100, 100)));
    act(() => result.current.onPointerMove(pointer(300, 200)));
    act(() => expect(result.current.cancelGesture()).toBe(true));

    expect(result.current.state.phase).toBe('aiming');
    expect(result.current.state.selection).toBeNull();
  });

  it('starts in aiming with no selection', () => {
    const { result } = renderHook(() => useSelection(frameRef()));

    expect(result.current.state).toEqual({
      phase: 'aiming',
      selection: null,
      draft: null,
      pointerPixel: null,
      transforming: false,
      box: null
    });
  });

  it('commits a dragged rectangle in physical pixels', () => {
    const { result } = renderHook(() => useSelection(frameRef()));

    act(() => result.current.onPointerDown(pointer(100, 100)));
    act(() => result.current.onPointerMove(pointer(300, 200)));
    act(() => result.current.onPointerUp());

    // 1.5× the CSS distance: 100→150 and 300→450, so 300 wide by 150 high.
    expect(result.current.state.phase).toBe('editing');
    expect(result.current.state.selection).toEqual({
      x: 150,
      y: 150,
      width: 300,
      height: 150
    });
  });

  it('produces no image from a click that never moved', () => {
    // A click without a frozen candidate remains in aiming.
    const { result } = renderHook(() => useSelection(frameRef()));

    act(() => result.current.onPointerDown(pointer(100, 100)));
    act(() => result.current.onPointerUp());

    expect(result.current.state.phase).toBe('aiming');
    expect(result.current.state.selection).toBeNull();
  });

  it('accepts a 1×1 selection as valid', () => {
    // The spec's stated minimum, so no threshold may reject it.
    const { result } = renderHook(() => useSelection(frameRef()));

    act(() => result.current.onPointerDown(pointer(100, 100)));
    // Two thirds of a CSS pixel is one physical pixel at 150%.
    act(() => result.current.onPointerMove(pointer(100 + 2 / 3, 100 + 2 / 3)));
    act(() => result.current.onPointerUp());

    expect(result.current.state.selection).toEqual({
      x: 150,
      y: 150,
      width: 1,
      height: 1
    });
  });

  it('normalises a drag towards the top-left', () => {
    const { result } = renderHook(() => useSelection(frameRef()));

    act(() => result.current.onPointerDown(pointer(300, 200)));
    act(() => result.current.onPointerMove(pointer(100, 100)));
    act(() => result.current.onPointerUp());

    expect(result.current.state.selection).toEqual({
      x: 150,
      y: 150,
      width: 300,
      height: 150
    });
  });

  it('ignores a non-primary button', () => {
    const { result } = renderHook(() => useSelection(frameRef()));

    act(() => result.current.onPointerDown(pointer(100, 100, 2)));

    expect(result.current.state.phase).toBe('aiming');
  });

  it('tracks the pointer pixel for the magnifier while aiming', () => {
    const { result } = renderHook(() => useSelection(frameRef()));

    act(() => result.current.onPointerMove(pointer(100, 100)));

    expect(result.current.state.pointerPixel).toEqual({ x: 150, y: 150 });
  });

  it('reports no pixel when the pointer leaves the frame', () => {
    const { result } = renderHook(() => useSelection(frameRef()));

    act(() => result.current.onPointerMove(pointer(-5, 100)));

    expect(result.current.state.pointerPixel).toBeNull();
  });

  it('keeps the last rectangle when the pointer leaves mid-drag', () => {
    // Dropping the drag here would lose the user's work on a slip.
    const { result } = renderHook(() => useSelection(frameRef()));

    act(() => result.current.onPointerDown(pointer(100, 100)));
    act(() => result.current.onPointerMove(pointer(300, 200)));
    act(() => result.current.onPointerMove(pointer(-50, 200)));

    expect(result.current.state.draft).toEqual({
      x: 150,
      y: 150,
      width: 300,
      height: 150
    });
  });

  it('exposes the frame box it resolved against', () => {
    // The renderer scales with these numbers, so they must come from the same
    // resolution the selection was built from.
    const { result } = renderHook(() => useSelection(frameRef()));

    act(() => result.current.onPointerMove(pointer(100, 100)));

    expect(result.current.state.box).toMatchObject({
      frameWidth: 2240,
      frameHeight: 1400
    });
  });

  it('clears everything on reset', () => {
    const { result } = renderHook(() => useSelection(frameRef()));

    act(() => result.current.onPointerDown(pointer(100, 100)));
    act(() => result.current.onPointerMove(pointer(300, 200)));
    act(() => result.current.onPointerUp());
    act(() => result.current.reset());

    expect(result.current.state).toEqual({
      phase: 'aiming',
      selection: null,
      draft: null,
      pointerPixel: null,
      transforming: false,
      box: null
    });
  });

  it('does nothing without a laid-out frame', () => {
    const { result } = renderHook(() => useSelection({ current: null }));

    act(() => result.current.onPointerDown(pointer(100, 100)));

    expect(result.current.state.phase).toBe('aiming');
  });
});

describe('adjusting a committed selection', () => {
  /// Commits 150,150 → 450,300 physical, which is 100,100 → 300,200 in CSS.
  function committed() {
    const hook = renderHook(() => useSelection(frameRef()));
    act(() => hook.result.current.onPointerDown(pointer(100, 100)));
    act(() => hook.result.current.onPointerMove(pointer(300, 200)));
    act(() => hook.result.current.onPointerUp());
    expect(hook.result.current.state.selection).toEqual({
      x: 150,
      y: 150,
      width: 300,
      height: 150
    });
    return hook;
  }

  it('moves the rectangle from a press inside it', () => {
    const { result } = committed();

    // The press is reported in physical pixels: CSS 200,200 is physical 300,300,
    // and the rectangle's bottom edge is exclusive, so the grab is just inside it.
    act(() => {
      expect(result.current.beginMove({ x: 300, y: 250 })).toBe(true);
    });
    act(() => result.current.onPointerMove(pointer(220, 220)));
    act(() => result.current.onPointerUp());

    // 20 CSS pixels is 30 physical horizontally; the grab started 50 physical
    // pixels above the pointer's row, so the vertical delta is 80.
    expect(result.current.state.selection).toMatchObject({ x: 180, y: 230 });
    expect(result.current.state.transforming).toBe(false);
  });

  it('refuses a move that starts outside the rectangle', () => {
    const { result } = committed();

    act(() => {
      expect(result.current.beginMove({ x: 1000, y: 1000 })).toBe(false);
    });
  });

  it('resizes from a handle, keeping the opposite edge fixed', () => {
    const { result } = committed();

    // The bottom-right corner, in physical pixels.
    act(() => {
      expect(result.current.beginResize('se', { x: 450, y: 300 })).toBe(true);
    });
    act(() => result.current.onPointerMove(pointer(340, 240)));

    // 40 CSS pixels right of 300 is 60 physical, so the right edge reaches 510.
    // The vertical axis lands one pixel short: 240 CSS maps to physical 359, since
    // a pointer names the pixel it is inside and 933.33 CSS rows cover 1400.
    expect(result.current.state.selection).toEqual({
      x: 150,
      y: 150,
      width: 360,
      height: 209
    });
  });

  it('clamps a move to the captured frame', () => {
    const { result } = committed();

    act(() => {
      result.current.beginMove({ x: 300, y: 250 });
    });
    act(() => result.current.onPointerMove(pointer(0, 0)));
    act(() => result.current.onPointerUp());

    expect(result.current.state.selection).toMatchObject({ x: 0, y: 0 });
  });

  it('reports an in-progress transform, so Esc can own it', () => {
    const { result } = committed();

    act(() => {
      result.current.beginMove({ x: 300, y: 250 });
    });

    expect(result.current.state.transforming).toBe(true);
  });

  it('restores the rectangle the transform started from when cancelled', () => {
    // §5 of the amendment: an interruption rolls back the gesture, and the
    // selection is not part of the annotation history, so nothing else changes.
    const { result } = committed();
    act(() => {
      result.current.beginMove({ x: 300, y: 250 });
    });
    act(() => result.current.onPointerMove(pointer(220, 220)));
    expect(result.current.state.selection).toMatchObject({ x: 180, y: 230 });

    let cancelled = false;
    act(() => {
      cancelled = result.current.cancelGesture();
    });

    expect(cancelled).toBe(true);
    expect(result.current.state.selection).toEqual({
      x: 150,
      y: 150,
      width: 300,
      height: 150
    });
    expect(result.current.state.phase).toBe('editing');
  });

  it('does not start a transform while still aiming', () => {
    const { result } = renderHook(() => useSelection(frameRef()));

    act(() => {
      expect(result.current.beginMove({ x: 200, y: 200 })).toBe(false);
      expect(result.current.beginResize('se', { x: 200, y: 200 })).toBe(false);
    });
  });
});
