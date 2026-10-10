import { describe, expect, it } from 'vitest';
import { interpolateStroke, strokeToMosaicBlocks } from './mosaic-brush';

describe('strokeToMosaicBlocks', () => {
  it('returns an empty array when given no points', () => {
    expect(strokeToMosaicBlocks([], 16)).toEqual([]);
  });

  it('returns an empty array when blockSize is zero or negative', () => {
    expect(strokeToMosaicBlocks([{ x: 10, y: 10 }], 0)).toEqual([]);
    expect(strokeToMosaicBlocks([{ x: 10, y: 10 }], -5)).toEqual([]);
  });

  it('maps a single point to one block', () => {
    // Point at (10, 10) with blockSize 16 falls into cell (0, 0)
    const blocks = strokeToMosaicBlocks([{ x: 10, y: 10 }], 16);
    expect(blocks).toEqual([{ x: 0, y: 0, width: 16, height: 16 }]);
  });

  it('maps multiple points in the same cell to one block', () => {
    // All these points fall into cell (0, 0) with blockSize 16
    const blocks = strokeToMosaicBlocks(
      [
        { x: 5, y: 5 },
        { x: 10, y: 10 },
        { x: 15, y: 15 }
      ],
      16
    );
    expect(blocks).toEqual([{ x: 0, y: 0, width: 16, height: 16 }]);
  });

  it('maps points in different cells to separate blocks', () => {
    // (10, 10) → cell (0, 0), (20, 20) → cell (16, 16)
    const blocks = strokeToMosaicBlocks(
      [
        { x: 10, y: 10 },
        { x: 20, y: 20 }
      ],
      16
    );
    expect(blocks).toEqual([
      { x: 0, y: 0, width: 16, height: 16 },
      { x: 16, y: 16, width: 16, height: 16 }
    ]);
  });

  it('sorts blocks top-to-bottom, left-to-right', () => {
    const blocks = strokeToMosaicBlocks(
      [
        { x: 50, y: 10 }, // cell (48, 0)
        { x: 10, y: 50 }, // cell (0, 48)
        { x: 10, y: 10 }, // cell (0, 0)
        { x: 50, y: 50 } // cell (48, 48)
      ],
      16
    );
    expect(blocks).toEqual([
      { x: 0, y: 0, width: 16, height: 16 },
      { x: 48, y: 0, width: 16, height: 16 },
      { x: 0, y: 48, width: 16, height: 16 },
      { x: 48, y: 48, width: 16, height: 16 }
    ]);
  });

  it('handles negative coordinates correctly', () => {
    // Point at (-10, -10) with blockSize 16 falls into cell (-16, -16)
    const blocks = strokeToMosaicBlocks([{ x: -10, y: -10 }], 16);
    expect(blocks).toEqual([{ x: -16, y: -16, width: 16, height: 16 }]);
  });

  it('handles a stroke that revisits the same cell', () => {
    const blocks = strokeToMosaicBlocks(
      [
        { x: 5, y: 5 },
        { x: 20, y: 20 },
        { x: 10, y: 10 } // back to the first cell
      ],
      16
    );
    expect(blocks).toEqual([
      { x: 0, y: 0, width: 16, height: 16 },
      { x: 16, y: 16, width: 16, height: 16 }
    ]);
  });
});

describe('interpolateStroke', () => {
  it('returns an empty array when given no points', () => {
    expect(interpolateStroke([], 8)).toEqual([]);
  });

  it('returns the original points when step is zero or negative', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 100, y: 100 }
    ];
    expect(interpolateStroke(points, 0)).toEqual(points);
    expect(interpolateStroke(points, -5)).toEqual(points);
  });

  it('returns the original points when they are already close enough', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 5, y: 5 }
    ];
    // Distance is ~7.07, step is 10, so no interpolation needed
    expect(interpolateStroke(points, 10)).toEqual(points);
  });

  it('inserts intermediate points when the gap is too large', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 30, y: 0 }
    ];
    // Distance is 30, step is 10, so we need 3 segments (2 intermediate points)
    const result = interpolateStroke(points, 10);
    expect(result.length).toBe(4);
    expect(result[0]).toEqual({ x: 0, y: 0 });
    expect(result[1].x).toBeCloseTo(10, 0);
    expect(result[2].x).toBeCloseTo(20, 0);
    expect(result[3]).toEqual({ x: 30, y: 0 });
  });

  it('handles diagonal strokes correctly', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 30, y: 40 }
    ];
    // Distance is 50, step is 25, so we need 2 segments (1 intermediate point)
    const result = interpolateStroke(points, 25);
    expect(result.length).toBe(3);
    expect(result[0]).toEqual({ x: 0, y: 0 });
    expect(result[1].x).toBeCloseTo(15, 0);
    expect(result[1].y).toBeCloseTo(20, 0);
    expect(result[2]).toEqual({ x: 30, y: 40 });
  });

  it('processes a multi-segment stroke', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 5, y: 0 }, // close, no interpolation
      { x: 25, y: 0 } // far, needs interpolation
    ];
    const result = interpolateStroke(points, 10);
    expect(result.length).toBeGreaterThan(3);
    expect(result[0]).toEqual({ x: 0, y: 0 });
    expect(result[1]).toEqual({ x: 5, y: 0 });
    // Intermediate points inserted between (5, 0) and (25, 0)
    expect(result[result.length - 1]).toEqual({ x: 25, y: 0 });
  });
});
