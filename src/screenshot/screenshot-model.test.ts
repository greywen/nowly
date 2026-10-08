import { describe, expect, it } from 'vitest';
import {
  moveSelection,
  resizeSelection,
  selectionFromDrag,
  type PixelRect
} from './screenshot-model';

const desktop: PixelRect = { x: -1920, y: -200, width: 4480, height: 1640 };

describe('screenshot selection geometry', () => {
  it('normalizes reverse drags into a physical-pixel half-open rectangle', () => {
    expect(selectionFromDrag({ x: 120, y: 80 }, { x: 20, y: 30 }, desktop)).toEqual({
      x: 20,
      y: 30,
      width: 100,
      height: 50
    });
  });

  it('does not create an image from a click without drag', () => {
    expect(selectionFromDrag({ x: 40, y: 40 }, { x: 40, y: 40 }, desktop)).toBeNull();
  });

  it('keeps a one-pixel drag as the smallest valid selection', () => {
    expect(selectionFromDrag({ x: -2, y: -2 }, { x: -1, y: -1 }, desktop)).toEqual({
      x: -2,
      y: -2,
      width: 1,
      height: 1
    });
  });

  it('floors fractional pointer coordinates consistently across negative space', () => {
    expect(selectionFromDrag({ x: -10.1, y: -8.1 }, { x: -4.2, y: -2.2 }, desktop)).toEqual({
      x: -11,
      y: -9,
      width: 6,
      height: 6
    });
  });

  it('clamps selection endpoints to the virtual desktop', () => {
    expect(selectionFromDrag({ x: -2000, y: -300 }, { x: 3000, y: 1600 }, desktop)).toEqual(
      desktop
    );
  });

  it('moves without changing size or leaving the virtual desktop', () => {
    expect(
      moveSelection({ x: 2500, y: 1500, width: 100, height: 100 }, 50, 50, desktop)
    ).toEqual({ x: 2460, y: 1340, width: 100, height: 100 });
  });

  it.each([
    [-5000, 0, -1920, 100],
    [0, -5000, 100, -200],
    [5000, 0, 2460, 100],
    [0, 5000, 100, 1340]
  ])('clamps movement at every desktop edge', (deltaX, deltaY, x, y) => {
    expect(moveSelection({ x: 100, y: 100, width: 100, height: 100 }, deltaX, deltaY, desktop))
      .toEqual({ x, y, width: 100, height: 100 });
  });
});

describe('eight-way selection resize', () => {
  const selection: PixelRect = { x: 100, y: 100, width: 200, height: 200 };

  it.each([
    ['nw', 10, 10, { x: 110, y: 110, width: 190, height: 190 }],
    ['n', 10, 10, { x: 100, y: 110, width: 200, height: 190 }],
    ['ne', 10, 10, { x: 100, y: 110, width: 210, height: 190 }],
    ['w', 10, 10, { x: 110, y: 100, width: 190, height: 200 }],
    ['e', 10, 10, { x: 100, y: 100, width: 210, height: 200 }],
    ['sw', 10, 10, { x: 110, y: 100, width: 190, height: 210 }],
    ['s', 10, 10, { x: 100, y: 100, width: 200, height: 210 }],
    ['se', 10, 10, { x: 100, y: 100, width: 210, height: 210 }]
  ] as const)('moves only the edges the %s handle owns', (handle, deltaX, deltaY, expected) => {
    expect(resizeSelection(selection, handle, deltaX, deltaY, desktop)).toEqual(expected);
  });

  it('stops at 1x1 instead of inverting when a handle is dragged past its opposite edge', () => {
    // Dragging the south-east handle far up and left must not produce a negative
    // or flipped rectangle.
    expect(resizeSelection(selection, 'se', -5000, -5000, desktop)).toEqual({
      x: 100,
      y: 100,
      width: 1,
      height: 1
    });
  });

  it('keeps the opposite edge fixed when the moving edge is clamped', () => {
    // The north-west handle dragged past the bottom-right corner leaves that
    // corner where it was: x+width and y+height stay at 300.
    expect(resizeSelection(selection, 'nw', 5000, 5000, desktop)).toEqual({
      x: 299,
      y: 299,
      width: 1,
      height: 1
    });
  });

  it.each([
    ['nw', -5000, -5000, { x: -1920, y: -200, width: 2220, height: 500 }],
    ['se', 5000, 5000, { x: 100, y: 100, width: 2460, height: 1340 }]
  ] as const)(
    'never grows the %s handle past the captured desktop',
    (handle, deltaX, deltaY, expected) => {
      expect(resizeSelection(selection, handle, deltaX, deltaY, desktop)).toEqual(expected);
    }
  );

  it('rounds fractional deltas so the result stays on whole physical pixels', () => {
    expect(resizeSelection(selection, 'se', 9.6, -9.6, desktop)).toEqual({
      x: 100,
      y: 100,
      width: 210,
      height: 190
    });
  });

  it('resizes by a single pixel for keyboard adjustment', () => {
    // §7's Alt+arrow: the right and bottom edges move one physical pixel.
    expect(resizeSelection(selection, 'se', 1, 0, desktop)).toEqual({
      x: 100,
      y: 100,
      width: 201,
      height: 200
    });
  });
});