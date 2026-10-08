import {
  annotationBounds,
  type Annotation,
  type PenPoint
} from './annotation-document';
import { strokeToMosaicBlocks } from './mosaic-brush';
import type { PixelRect } from './screenshot-model';

// Reshaping a committed annotation by its handles.
//
// §5.3 of the design spec gives a selected object a frame; this is what the frame's
// grips do. Kept as pure geometry, separate from the hook, for the same reason
// `annotation-hit.ts` is: "where are the grips and what does dragging one produce"
// has one answer per shape, and it is worth asserting without a pointer or a render.
//
// Which grips a shape gets is a property of the shape, not a style choice:
//
//   - rect, ellipse, pen, mosaic get the eight box grips, because a box is what
//     they are.
//   - arrow gets two, one per end. A box would be a lie: an arrow drawn from its
//     own bottom-right to its top-left has the same box as its opposite, so the
//     eight grips could not express which way it points, and dragging "nw" would
//     silently reverse some arrows and not others.
//   - text gets none. Its box is measured from the glyphs, so a grip could only
//     either stretch the letters (the renderer draws real text, it cannot) or
//     change the type size — and §5.2 allows exactly three sizes, which the
//     property panel already offers. A grip that snapped to the nearest of three
//     sizes would feel broken, and one that set any size would break the spec.

export type BoxHandle = 'nw' | 'n' | 'ne' | 'w' | 'e' | 'sw' | 's' | 'se';
export type EndHandle = 'start' | 'end';
export type AnnotationHandle = BoxHandle | EndHandle;

/// Clockwise from the top-left, matching `SelectionLayer`'s order so the two sets of
/// grips cannot drift apart visually.
export const BOX_HANDLES: readonly BoxHandle[] = [
  'nw',
  'n',
  'ne',
  'w',
  'e',
  'sw',
  's',
  'se'
];

const END_HANDLES: readonly EndHandle[] = ['start', 'end'];

/// Half the grip's hit square, in physical pixels. Larger than the painted dot:
/// §5.3 wants the frame to be unobtrusive, and a 6px dot that needs 6px precision
/// to grab is the kind of detail that makes editing feel hostile.
export const HANDLE_GRAB = 9;

/// The smallest a shape may be reshaped to. Below this a shape is invisible but
/// still present, which reads as "I deleted it by accident" and cannot be undone
/// by dragging back, because there is nothing left to aim at.
export const MIN_SIZE = 8;

export function handlesFor(annotation: Annotation): readonly AnnotationHandle[] {
  if (annotation.kind === 'arrow') return END_HANDLES;
  // Measured from its content, so there is nothing a grip could set. See above.
  if (annotation.kind === 'text') return [];
  return BOX_HANDLES;
}

/// Where a grip sits, in frame physical pixels.
export function handlePosition(
  annotation: Annotation,
  handle: AnnotationHandle
): PenPoint {
  if (handle === 'start') return { x: annotation.x, y: annotation.y };
  if (handle === 'end') {
    return { x: annotation.x + annotation.width, y: annotation.y + annotation.height };
  }
  // The normalised box, so a shape dragged out right-to-left still puts "nw" at its
  // visual top-left rather than at the corner it happened to start from.
  const bounds = annotationBounds(annotation);
  const midX = bounds.x + bounds.width / 2;
  const midY = bounds.y + bounds.height / 2;
  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;
  switch (handle) {
    case 'nw':
      return { x: bounds.x, y: bounds.y };
    case 'n':
      return { x: midX, y: bounds.y };
    case 'ne':
      return { x: right, y: bounds.y };
    case 'w':
      return { x: bounds.x, y: midY };
    case 'e':
      return { x: right, y: midY };
    case 'sw':
      return { x: bounds.x, y: bottom };
    case 's':
      return { x: midX, y: bottom };
    case 'se':
      return { x: right, y: bottom };
  }
}

/// The grip under the pointer, or null.
///
/// Grips win over the object's own body, so a shape small enough that its grips
/// overlap it can still be reshaped rather than only moved.
export function hitTestHandles(
  annotation: Annotation,
  pixel: PenPoint
): AnnotationHandle | null {
  for (const handle of handlesFor(annotation)) {
    const point = handlePosition(annotation, handle);
    if (
      Math.abs(pixel.x - point.x) <= HANDLE_GRAB &&
      Math.abs(pixel.y - point.y) <= HANDLE_GRAB
    ) {
      return handle;
    }
  }
  return null;
}

/// The CSS cursor for a grip, so the pointer says which way the edge will move.
export function handleCursor(handle: AnnotationHandle): string {
  switch (handle) {
    case 'nw':
    case 'se':
      return 'nwse-resize';
    case 'ne':
    case 'sw':
      return 'nesw-resize';
    case 'n':
    case 's':
      return 'ns-resize';
    case 'w':
    case 'e':
      return 'ew-resize';
    // An arrow end goes wherever the pointer goes, so no axis is implied.
    case 'start':
    case 'end':
      return 'move';
  }
}

/// Clamps a point into the capture rectangle. A reshaped object may not leave the
/// selection, for the same reason a moved one may not: the export is the selection,
/// so anything outside it is invisible and unrecoverable.
function clampToSelection(point: PenPoint, selection: PixelRect): PenPoint {
  return {
    x: Math.min(Math.max(point.x, selection.x), selection.x + selection.width),
    y: Math.min(Math.max(point.y, selection.y), selection.y + selection.height)
  };
}

/// The box produced by dragging one grip to `pointer`, with the opposite edges
/// pinned. Enforces `MIN_SIZE` by stopping the dragged edge rather than by pushing
/// the pinned one, so an over-dragged edge parks against its limit and comes back
/// when the pointer does.
function resizedBox(
  bounds: PixelRect,
  handle: BoxHandle,
  pointer: PenPoint
): PixelRect {
  let { x, y, width, height } = bounds;
  const right = x + width;
  const bottom = y + height;

  if (handle.includes('w')) {
    const left = Math.min(pointer.x, right - MIN_SIZE);
    width = right - left;
    x = left;
  } else if (handle.includes('e')) {
    width = Math.max(pointer.x - x, MIN_SIZE);
  }

  if (handle.includes('n')) {
    const top = Math.min(pointer.y, bottom - MIN_SIZE);
    height = bottom - top;
    y = top;
  } else if (handle.includes('s')) {
    height = Math.max(pointer.y - y, MIN_SIZE);
  }

  return { x, y, width, height };
}

/// Maps every point of a shape through the same box change, so the parts of a shape
/// stay in the same places relative to each other.
function scalePoint(
  point: PenPoint,
  from: PixelRect,
  to: PixelRect
): PenPoint {
  // A zero-extent source has no ratio to preserve; the points collapse onto the new
  // edge rather than producing NaN.
  const scaleX = from.width === 0 ? 0 : to.width / from.width;
  const scaleY = from.height === 0 ? 0 : to.height / from.height;
  return {
    x: to.x + (point.x - from.x) * scaleX,
    y: to.y + (point.y - from.y) * scaleY
  };
}

/// The annotation produced by dragging `handle` to `pointer`.
///
/// Returns the annotation unchanged when the grip does not belong to it, so a stale
/// grip from a previous selection cannot deform the wrong shape.
export function resizeAnnotation(
  annotation: Annotation,
  handle: AnnotationHandle,
  pointer: PenPoint,
  selection: PixelRect
): Annotation {
  if (!handlesFor(annotation).includes(handle)) return annotation;
  const target = clampToSelection(pointer, selection);

  if (handle === 'start' || handle === 'end') {
    // The arrow keeps its signed extent: which end is which is the direction it
    // points, and normalising here would quietly flip arrows.
    if (handle === 'start') {
      const tipX = annotation.x + annotation.width;
      const tipY = annotation.y + annotation.height;
      return { ...annotation, x: target.x, y: target.y, width: tipX - target.x, height: tipY - target.y };
    }
    return {
      ...annotation,
      width: target.x - annotation.x,
      height: target.y - annotation.y
    };
  }

  const before = annotationBounds(annotation);
  const after = resizedBox(before, handle, target);

  if (annotation.kind === 'pen') {
    return {
      ...annotation,
      ...after,
      // Every sample moves with the box, so the stroke keeps its shape instead of
      // being clipped by a box that no longer matches it.
      points: annotation.points.map((point) => scalePoint(point, before, after))
    };
  }

  if (annotation.kind === 'mosaic') {
    // The cells are re-snapped to the grid through their scaled centres, using the
    // brush's own function. Scaled rectangles would no longer line up with the grid
    // `mosaic.rs` fills, so the preview and the exported file would disagree.
    const centres = annotation.blocks.map((block) =>
      scalePoint(
        { x: block.x + block.width / 2, y: block.y + block.height / 2 },
        before,
        after
      )
    );
    const blocks = strokeToMosaicBlocks(centres, annotation.blockSize);
    if (blocks.length === 0) return annotation;
    const left = Math.min(...blocks.map((block) => block.x));
    const top = Math.min(...blocks.map((block) => block.y));
    const right = Math.max(...blocks.map((block) => block.x + block.width));
    const bottom = Math.max(...blocks.map((block) => block.y + block.height));
    return {
      ...annotation,
      blocks,
      x: left,
      y: top,
      width: right - left,
      height: bottom - top
    };
  }

  return { ...annotation, ...after };
}
