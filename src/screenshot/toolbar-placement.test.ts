import { describe, expect, it } from 'vitest';
import { toolbarPlacement } from './toolbar-placement';

const viewport = { width: 1493, height: 933 };
/// Thirteen 40px buttons, three 8px gaps inside groups plus dividers and padding.
const toolbar = { width: 592, height: 56 };

describe('toolbar placement', () => {
  it('sits 8px below the selection, right edges aligned', () => {
    const selection = { left: 300, top: 200, width: 700, height: 300 };

    const placement = toolbarPlacement(selection, toolbar, viewport);

    expect(placement.position).toBe('below');
    expect(placement.top).toBe(508);
    // Right edge aligned: 300 + 700 - 592.
    expect(placement.left).toBe(408);
  });

  it('flips above when there is no room below', () => {
    const selection = { left: 300, top: 200, width: 700, height: 700 };

    const placement = toolbarPlacement(selection, toolbar, viewport);

    expect(placement.position).toBe('above');
    expect(placement.top).toBe(200 - 8 - 56);
  });

  it('clamps to the display instead of hanging off the right edge', () => {
    // A selection flush to the right edge would push the right-aligned toolbar
    // past the display.
    const selection = { left: 1200, top: 100, width: 293, height: 200 };

    const placement = toolbarPlacement(selection, toolbar, viewport);

    expect(placement.left).toBe(viewport.width - 8 - toolbar.width);
    expect(placement.left + toolbar.width).toBeLessThanOrEqual(viewport.width - 8);
  });

  it('clamps to the left margin for a selection at the left edge', () => {
    const selection = { left: 0, top: 100, width: 200, height: 200 };

    const placement = toolbarPlacement(selection, toolbar, viewport);

    // 0 + 200 - 592 is negative, so it stops at the margin.
    expect(placement.left).toBe(8);
  });

  it('goes inside only when it fits on neither side', () => {
    // A selection covering nearly the whole display.
    const selection = { left: 10, top: 10, width: 1470, height: 910 };

    const placement = toolbarPlacement(selection, toolbar, viewport);

    expect(placement.position).toBe('inside');
    expect(placement.top).toBe(10 + 910 - 56 - 8);
  });

  it('moves off the bottom handles when one is being dragged', () => {
    // §5.1 line 101: the inside placement must not cover the control point being
    // operated.
    const selection = { left: 10, top: 10, width: 1470, height: 910 };

    const placement = toolbarPlacement(selection, toolbar, viewport, 'se');

    expect(placement.position).toBe('inside');
    expect(placement.top).toBe(18);
    // Clear of the bottom edge where sw/s/se live.
    expect(placement.top + toolbar.height).toBeLessThan(selection.top + selection.height - 8);
  });

  it('stays at the bottom for a top handle drag', () => {
    const selection = { left: 10, top: 10, width: 1470, height: 910 };

    const placement = toolbarPlacement(selection, toolbar, viewport, 'nw');

    expect(placement.top).toBe(10 + 910 - 56 - 8);
  });

  it.each([
    [{ left: 0, top: 0, width: 50, height: 50 }],
    [{ left: 1443, top: 883, width: 50, height: 50 }],
    [{ left: 10, top: 10, width: 1470, height: 910 }],
    [{ left: 700, top: 400, width: 1, height: 1 }]
  ])('stays fully on the display for %j', (selection) => {
    const placement = toolbarPlacement(selection, toolbar, viewport);

    expect(placement.left).toBeGreaterThanOrEqual(8);
    expect(placement.top).toBeGreaterThanOrEqual(8);
    expect(placement.left + toolbar.width).toBeLessThanOrEqual(viewport.width - 8);
    expect(placement.top + toolbar.height).toBeLessThanOrEqual(viewport.height - 8);
  });
});
