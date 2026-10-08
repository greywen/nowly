import { describe, expect, it } from 'vitest';
import type { Annotation } from './annotation-document';
import {
  BOX_HANDLES,
  handleCursor,
  handlePosition,
  handlesFor,
  hitTestHandles,
  MIN_SIZE,
  resizeAnnotation
} from './annotation-resize';

const selection = { x: 0, y: 0, width: 1000, height: 800 };

const square: Annotation = {
  id: 'r1',
  kind: 'rect',
  x: 100,
  y: 100,
  width: 200,
  height: 100,
  color: '#f06445',
  strokeWidth: 4
};

const arrow: Annotation = {
  id: 'a1',
  kind: 'arrow',
  x: 100,
  y: 100,
  width: 200,
  height: 100,
  color: '#f06445',
  strokeWidth: 4
};

describe('which handles a shape gets', () => {
  it('gives a box shape all eight', () => {
    for (const kind of ['rect', 'ellipse'] as const) {
      expect(handlesFor({ ...square, kind })).toEqual(BOX_HANDLES);
    }
    expect(handlesFor({ ...square, kind: 'pen', points: [] })).toHaveLength(8);
    expect(
      handlesFor({ ...square, kind: 'mosaic', blockSize: 16, blocks: [] })
    ).toHaveLength(8);
  });

  it('gives an arrow two, one per end', () => {
    // A box cannot express direction: an arrow and its opposite share a box, so
    // eight grips would reverse some arrows and not others.
    expect(handlesFor(arrow)).toEqual(['start', 'end']);
  });

  it('gives text none', () => {
    // Its box is measured from the glyphs. A grip could only stretch the letters,
    // which the renderer cannot do, or set a type size outside the three §5.2
    // allows. The property panel owns the size instead.
    const text: Annotation = {
      ...square,
      kind: 'text',
      fontSize: 24,
      content: 'hello'
    } as Annotation;
    expect(handlesFor(text)).toEqual([]);
  });
});

describe('where the handles sit', () => {
  it('places the eight around the box', () => {
    expect(handlePosition(square, 'nw')).toEqual({ x: 100, y: 100 });
    expect(handlePosition(square, 'n')).toEqual({ x: 200, y: 100 });
    expect(handlePosition(square, 'ne')).toEqual({ x: 300, y: 100 });
    expect(handlePosition(square, 'w')).toEqual({ x: 100, y: 150 });
    expect(handlePosition(square, 'e')).toEqual({ x: 300, y: 150 });
    expect(handlePosition(square, 'sw')).toEqual({ x: 100, y: 200 });
    expect(handlePosition(square, 's')).toEqual({ x: 200, y: 200 });
    expect(handlePosition(square, 'se')).toEqual({ x: 300, y: 200 });
  });

  it('normalises a shape dragged out right to left', () => {
    // Stored with negative extent, but "nw" must still be the visual top-left or
    // the grips would appear on the wrong corners.
    const backwards: Annotation = { ...square, x: 300, y: 200, width: -200, height: -100 };
    expect(handlePosition(backwards, 'nw')).toEqual({ x: 100, y: 100 });
    expect(handlePosition(backwards, 'se')).toEqual({ x: 300, y: 200 });
  });

  it('puts an arrow grip on each end, following its direction', () => {
    expect(handlePosition(arrow, 'start')).toEqual({ x: 100, y: 100 });
    expect(handlePosition(arrow, 'end')).toEqual({ x: 300, y: 200 });
    // Reversed: the tail is where the arrow starts, not where the box does.
    const reversed: Annotation = { ...arrow, x: 300, y: 200, width: -200, height: -100 };
    expect(handlePosition(reversed, 'start')).toEqual({ x: 300, y: 200 });
    expect(handlePosition(reversed, 'end')).toEqual({ x: 100, y: 100 });
  });
});

describe('grabbing a handle', () => {
  it('finds one slightly off the exact point', () => {
    // A 6px dot that needs 6px precision to grab makes editing feel hostile.
    expect(hitTestHandles(square, { x: 104, y: 103 })).toBe('nw');
  });

  it('finds nothing far from every grip', () => {
    expect(hitTestHandles(square, { x: 200, y: 150 })).toBeNull();
  });

  it('finds nothing on text, which has no grips', () => {
    const text = { ...square, kind: 'text', fontSize: 24, content: 'x' } as Annotation;
    expect(hitTestHandles(text, { x: 100, y: 100 })).toBeNull();
  });

  it('names a cursor per grip direction', () => {
    expect(handleCursor('nw')).toBe('nwse-resize');
    expect(handleCursor('ne')).toBe('nesw-resize');
    expect(handleCursor('n')).toBe('ns-resize');
    expect(handleCursor('e')).toBe('ew-resize');
    expect(handleCursor('start')).toBe('move');
  });
});

describe('resizing by a handle', () => {
  it('moves the dragged edge and pins the opposite one', () => {
    const next = resizeAnnotation(square, 'e', { x: 400, y: 150 }, selection);
    expect(next).toMatchObject({ x: 100, y: 100, width: 300, height: 100 });
  });

  it('moves the origin when dragging a leading edge', () => {
    const next = resizeAnnotation(square, 'nw', { x: 50, y: 60 }, selection);
    expect(next).toMatchObject({ x: 50, y: 60, width: 250, height: 140 });
  });

  it('leaves the other axis alone for an edge grip', () => {
    const next = resizeAnnotation(square, 'n', { x: 999, y: 40 }, selection);
    expect(next).toMatchObject({ x: 100, y: 40, width: 200, height: 160 });
  });

  it('stops at a minimum size instead of inverting', () => {
    // Dragging the right edge past the left must park against the limit, not turn
    // the shape inside out or collapse it to nothing.
    const next = resizeAnnotation(square, 'e', { x: 10, y: 150 }, selection);
    expect(next.width).toBe(MIN_SIZE);
    expect(next.x).toBe(100);
  });

  it('pins the far edge when a leading edge is over-dragged', () => {
    const next = resizeAnnotation(square, 'w', { x: 999, y: 150 }, selection);
    expect(next.width).toBe(MIN_SIZE);
    // The right edge stayed where it was.
    expect(next.x + next.width).toBe(300);
  });

  it('keeps the shape inside the capture rectangle', () => {
    // The export is the selection, so anything dragged outside it is invisible and
    // unrecoverable.
    const small = { x: 0, y: 0, width: 250, height: 250 };
    const next = resizeAnnotation(square, 'se', { x: 9999, y: 9999 }, small);
    expect(next.x + next.width).toBeLessThanOrEqual(250);
    expect(next.y + next.height).toBeLessThanOrEqual(250);
  });

  it('carries a pen stroke samples with the box', () => {
    const pen: Annotation = {
      ...square,
      kind: 'pen',
      points: [
        { x: 100, y: 100 },
        { x: 200, y: 150 },
        { x: 300, y: 200 }
      ]
    };

    const next = resizeAnnotation(pen, 'e', { x: 500, y: 150 }, selection);

    expect(next.kind).toBe('pen');
    const points = (next as Extract<Annotation, { kind: 'pen' }>).points;
    // The box doubled in width, so the midpoint sample sits at the new middle.
    expect(points[0]).toEqual({ x: 100, y: 100 });
    expect(points[2].x).toBe(500);
    expect(points[1].x).toBe(300);
    // The untouched axis did not move.
    expect(points[1].y).toBe(150);
  });

  it('re-snaps mosaic cells to the grid rather than scaling them', () => {
    // `mosaic.rs` fills whole cells of the grid it is given. A scaled rectangle no
    // longer lines up with that grid, so the preview and the exported file would
    // disagree about which pixels are obscured.
    const mosaic: Annotation = {
      ...square,
      kind: 'mosaic',
      blockSize: 16,
      blocks: [
        { x: 96, y: 96, width: 16, height: 16 },
        { x: 112, y: 96, width: 16, height: 16 }
      ]
    };

    const next = resizeAnnotation(mosaic, 'e', { x: 500, y: 200 }, selection);

    const blocks = (next as Extract<Annotation, { kind: 'mosaic' }>).blocks;
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      expect(block.width).toBe(16);
      expect(block.x % 16).toBe(0);
      expect(block.y % 16).toBe(0);
    }
  });

  it('moves one arrow end and leaves the other anchored', () => {
    const next = resizeAnnotation(arrow, 'start', { x: 50, y: 50 }, selection);

    expect(next).toMatchObject({ x: 50, y: 50 });
    // The tip did not move.
    expect(next.x + next.width).toBe(300);
    expect(next.y + next.height).toBe(200);
  });

  it('lets an arrow be dragged past its own tail, reversing it', () => {
    // Unlike a box, an arrow has a direction, and reversing it is a legitimate
    // edit rather than something to clamp away.
    const next = resizeAnnotation(arrow, 'end', { x: 20, y: 30 }, selection);

    expect(next.width).toBeLessThan(0);
    expect(next.x + next.width).toBe(20);
  });

  it('ignores a handle that does not belong to the shape', () => {
    // A stale grip from a previous selection must not deform the wrong shape.
    expect(resizeAnnotation(arrow, 'nw', { x: 0, y: 0 }, selection)).toBe(arrow);
    const text = { ...square, kind: 'text', fontSize: 24, content: 'x' } as Annotation;
    expect(resizeAnnotation(text, 'se', { x: 0, y: 0 }, selection)).toBe(text);
  });
});
