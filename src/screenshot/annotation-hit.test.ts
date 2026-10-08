import { describe, expect, it } from 'vitest';
import type { Annotation } from './annotation-document';
import { clampTranslation, hitTestAnnotations, hitsAnnotation } from './annotation-hit';

const selection = { x: 100, y: 100, width: 400, height: 300 };

/// `rect` shares one union member with ellipse and arrow, so `Extract` by kind
/// would resolve to `never`. The shape is spelled out instead.
type RectAnnotation = Annotation & { kind: 'rect' };

function rect(overrides: Partial<RectAnnotation> = {}): Annotation {
  return {
    id: 'r',
    kind: 'rect',
    x: 200,
    y: 200,
    width: 100,
    height: 80,
    color: '#f06445',
    strokeWidth: 4,
    ...overrides
  };
}

describe('hit testing a shape', () => {
  it('grabs an open rectangle by its edge, not by the hole in the middle', () => {
    // A rectangle drawn around a region must not swallow every press inside it, or
    // the shapes underneath become unreachable.
    const shape = rect();

    expect(hitsAnnotation(shape, { x: 200, y: 240 })).toBe(true);
    expect(hitsAnnotation(shape, { x: 250, y: 240 })).toBe(false);
  });

  it('allows a few pixels of slack so a thin stroke is still grabbable', () => {
    const shape = rect({ strokeWidth: 2 });

    expect(hitsAnnotation(shape, { x: 196, y: 240 })).toBe(true);
    expect(hitsAnnotation(shape, { x: 150, y: 240 })).toBe(false);
  });

  it('grabs an ellipse on its curve rather than in its box corner', () => {
    const shape: Annotation = {
      id: 'e',
      kind: 'ellipse',
      x: 200,
      y: 200,
      width: 100,
      height: 100,
      color: '#f06445',
      strokeWidth: 4
    };

    // The rightmost point of the curve.
    expect(hitsAnnotation(shape, { x: 300, y: 250 })).toBe(true);
    // The box's top-left corner, which the curve does not pass through.
    expect(hitsAnnotation(shape, { x: 201, y: 201 })).toBe(false);
  });

  it('grabs an arrow along its shaft, including when it points up and left', () => {
    // An arrow is stored unnormalised, so its box has a negative size: testing the
    // box alone would miss the stroke entirely.
    const shape: Annotation = {
      id: 'a',
      kind: 'arrow',
      x: 300,
      y: 300,
      width: -100,
      height: -100,
      color: '#f06445',
      strokeWidth: 4
    };

    expect(hitsAnnotation(shape, { x: 250, y: 250 })).toBe(true);
    expect(hitsAnnotation(shape, { x: 250, y: 290 })).toBe(false);
  });

  it('grabs a pen stroke on the line, not inside the loop it encloses', () => {
    const shape: Annotation = {
      id: 'p',
      kind: 'pen',
      x: 200,
      y: 200,
      width: 100,
      height: 100,
      color: '#f06445',
      strokeWidth: 4,
      points: [
        { x: 200, y: 200 },
        { x: 300, y: 200 },
        { x: 300, y: 300 }
      ]
    };

    expect(hitsAnnotation(shape, { x: 250, y: 200 })).toBe(true);
    expect(hitsAnnotation(shape, { x: 240, y: 260 })).toBe(false);
  });

  it('grabs text anywhere in its box, because text is filled', () => {
    const shape: Annotation = {
      id: 't',
      kind: 'text',
      x: 200,
      y: 200,
      width: 120,
      height: 34,
      color: '#f06445',
      fontSize: 24,
      content: 'hello'
    };

    expect(hitsAnnotation(shape, { x: 260, y: 215 })).toBe(true);
    expect(hitsAnnotation(shape, { x: 400, y: 215 })).toBe(false);
  });

  it('grabs a mosaic only on a painted cell', () => {
    // The brush may leave parts of its bounding box untouched, and untouched pixels
    // are not part of the object.
    const shape: Annotation = {
      id: 'm',
      kind: 'mosaic',
      x: 200,
      y: 200,
      width: 64,
      height: 64,
      color: '#211f1c',
      blockSize: 16,
      blocks: [{ x: 200, y: 200, width: 16, height: 16 }]
    };

    expect(hitsAnnotation(shape, { x: 205, y: 205 })).toBe(true);
    expect(hitsAnnotation(shape, { x: 255, y: 255 })).toBe(false);
  });
});

describe('picking one of several objects', () => {
  it('returns the topmost, since creation order is painting order', () => {
    const under = rect({ id: 'under' });
    const over = rect({ id: 'over' });

    expect(hitTestAnnotations([under, over], { x: 200, y: 240 })?.id).toBe('over');
  });

  it('returns null when the pointer is on no object', () => {
    expect(hitTestAnnotations([rect()], { x: 450, y: 390 })).toBeNull();
  });
});

describe('clamping a move', () => {
  it('keeps an object inside the capture rectangle', () => {
    // An object dragged out of the selection would vanish from the export, which
    // reads as data loss rather than as a move.
    const shape = rect({ x: 110, y: 110 });

    expect(clampTranslation(shape, -50, -50, selection)).toEqual({ dx: -10, dy: -10 });
  });

  it('trims the two axes independently, so sliding along an edge still works', () => {
    // Against the left edge already, with room to spare below: the blocked axis
    // must not freeze the free one.
    const shape = rect({ x: 100, y: 200 });

    expect(clampTranslation(shape, -50, 200, selection)).toEqual({ dx: 0, dy: 120 });
  });

  it('leaves an oversized object free rather than snapping it to an edge', () => {
    const shape = rect({ x: 100, y: 200, width: 500, height: 20 });

    expect(clampTranslation(shape, 30, 0, selection).dx).toBe(30);
  });

  it('measures an arrow by its real box, not by its negative size', () => {
    const arrow: Annotation = {
      id: 'a',
      kind: 'arrow',
      x: 200,
      y: 200,
      width: -80,
      height: -80,
      color: '#f06445',
      strokeWidth: 4
    };

    // Its true left edge is 120, so it can only move 20 further left.
    expect(clampTranslation(arrow, -50, 0, selection).dx).toBe(-20);
  });
});

describe('a filled closed shape', () => {
  it('is hit anywhere inside a filled rectangle, not only on its outline', () => {
    const filled = { ...rect(), filled: true } as Annotation;
    expect(hitsAnnotation(filled, { x: 250, y: 240 })).toBe(true);
    expect(hitsAnnotation(rect(), { x: 250, y: 240 })).toBe(false);
  });

  it('is hit inside a filled ellipse but not outside it', () => {
    const ellipse = { ...rect(), kind: 'ellipse', filled: true } as Annotation;
    expect(hitsAnnotation(ellipse, { x: 250, y: 240 })).toBe(true);
    // The bounding box corner is outside the ellipse itself.
    expect(hitsAnnotation(ellipse, { x: 203, y: 203 })).toBe(false);
  });
});
