// Converting a brush stroke into block-aligned mosaic rectangles.
//
// The user paints a freehand path, and this module turns each sampled point into
// the grid cell it falls into, aligned to the mosaic grid anchored at the frame
// origin (0,0). Rust's mosaic.rs then fills each cell with the average colour of
// its covered pixels.
//
// The grid is exactly the one mosaic.rs uses: if a point at (x, y) falls into a
// cell, that cell's top-left is (floor(x / blockSize) * blockSize, floor(y / blockSize) * blockSize)
// and its bottom-right is one block away. This keeps the preview and the export
// identical, per §5.3's requirement that they share the same geometry.

import type { MosaicBlock, PenPoint } from './annotation-document';

/// Turn a brush stroke into block-aligned rectangles, one per covered grid cell.
///
/// The grid is anchored at the frame origin (0, 0) so a block's top-left is always
/// a multiple of `blockSize`. Two strokes that pass through the same cell produce
/// identical blocks, so the export and the preview agree on which pixels are masked.
///
/// The order is not meaningful — it is sorted for test stability, not visual effect.
export function strokeToMosaicBlocks(
  points: readonly PenPoint[],
  blockSize: number
): readonly MosaicBlock[] {
  if (points.length === 0) return [];
  if (blockSize <= 0) return [];

  // One block per unique grid cell. A long stroke may visit the same cell more than
  // once, and this Set ensures it is only recorded once.
  const cells = new Set<string>();

  for (const point of points) {
    const cellX = Math.floor(point.x / blockSize) * blockSize;
    const cellY = Math.floor(point.y / blockSize) * blockSize;
    // The key is stable across runs, so tests do not flake.
    cells.add(`${cellX},${cellY}`);
  }

  const blocks: MosaicBlock[] = [];
  for (const key of cells) {
    const [x, y] = key.split(',').map(Number);
    blocks.push({ x, y, width: blockSize, height: blockSize });
  }

  // Sort by top-left, then left-to-right, for test stability. The preview and export
  // do not depend on the order.
  blocks.sort((a, b) => (a.y !== b.y ? a.y - b.y : a.x - b.x));

  return blocks;
}

/// Insert intermediate points along a stroke so fast drags do not skip grid cells.
///
/// If two consecutive samples are separated by more than `step` pixels, points are
/// inserted between them. This prevents a gap in the middle of a fast gesture: the
/// user expects a continuous stroke, not a dotted one.
///
/// A `step` of `blockSize / 2` is enough to ensure that no cell is skipped, because
/// a segment cannot cross a cell boundary without passing within half a block of it.
export function interpolateStroke(
  points: readonly PenPoint[],
  step: number
): readonly PenPoint[] {
  if (points.length === 0) return [];
  if (step <= 0) return points;

  const result: PenPoint[] = [points[0]];

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const dx = curr.x - prev.x;
    const dy = curr.y - prev.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist <= step) {
      result.push(curr);
      continue;
    }

    // Insert intermediate points at `step` intervals along the segment.
    const count = Math.ceil(dist / step);
    for (let j = 1; j < count; j++) {
      const t = j / count;
      result.push({
        x: Math.round(prev.x + dx * t),
        y: Math.round(prev.y + dy * t)
      });
    }
    result.push(curr);
  }

  return result;
}
