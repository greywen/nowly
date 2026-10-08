export type PixelPoint = {
  x: number;
  y: number;
};

export type PixelRect = PixelPoint & {
  width: number;
  height: number;
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

export function selectionFromDrag(
  start: PixelPoint,
  end: PixelPoint,
  bounds: PixelRect
): PixelRect | null {
  const boundsRight = bounds.x + bounds.width;
  const boundsBottom = bounds.y + bounds.height;
  const startX = clamp(Math.floor(start.x), bounds.x, boundsRight);
  const startY = clamp(Math.floor(start.y), bounds.y, boundsBottom);
  const endX = clamp(Math.floor(end.x), bounds.x, boundsRight);
  const endY = clamp(Math.floor(end.y), bounds.y, boundsBottom);
  const x = Math.min(startX, endX);
  const y = Math.min(startY, endY);
  const width = Math.abs(endX - startX);
  const height = Math.abs(endY - startY);

  return width === 0 || height === 0 ? null : { x, y, width, height };
}

export function moveSelection(
  selection: PixelRect,
  deltaX: number,
  deltaY: number,
  bounds: PixelRect
): PixelRect {
  const maxX = bounds.x + bounds.width - selection.width;
  const maxY = bounds.y + bounds.height - selection.height;
  return {
    ...selection,
    x: clamp(selection.x + Math.round(deltaX), bounds.x, maxX),
    y: clamp(selection.y + Math.round(deltaY), bounds.y, maxY)
  };
}

/// The eight resize handles, named by the edges they move.
export type ResizeHandle = 'nw' | 'n' | 'ne' | 'w' | 'e' | 'sw' | 's' | 'se';

const MOVES_LEFT: ReadonlySet<ResizeHandle> = new Set(['nw', 'w', 'sw']);
const MOVES_RIGHT: ReadonlySet<ResizeHandle> = new Set(['ne', 'e', 'se']);
const MOVES_TOP: ReadonlySet<ResizeHandle> = new Set(['nw', 'n', 'ne']);
const MOVES_BOTTOM: ReadonlySet<ResizeHandle> = new Set(['sw', 's', 'se']);

// Resizes by one handle, in physical pixels.
//
// Two rules the spec fixes: the selection never leaves the captured virtual
// desktop, and it never inverts. Dragging a handle past its opposite edge stops
// at 1x1 with that opposite edge fixed, rather than flipping the rectangle.
export function resizeSelection(
  selection: PixelRect,
  handle: ResizeHandle,
  deltaX: number,
  deltaY: number,
  bounds: PixelRect
): PixelRect {
  const boundsRight = bounds.x + bounds.width;
  const boundsBottom = bounds.y + bounds.height;
  const stepX = Math.round(deltaX);
  const stepY = Math.round(deltaY);

  let left = selection.x;
  let right = selection.x + selection.width;
  let top = selection.y;
  let bottom = selection.y + selection.height;

  // Each edge is clamped against its opposite edge, keeping a minimum of one
  // pixel, and against the captured desktop.
  if (MOVES_LEFT.has(handle)) left = clamp(left + stepX, bounds.x, right - 1);
  if (MOVES_RIGHT.has(handle)) right = clamp(right + stepX, left + 1, boundsRight);
  if (MOVES_TOP.has(handle)) top = clamp(top + stepY, bounds.y, bottom - 1);
  if (MOVES_BOTTOM.has(handle)) bottom = clamp(bottom + stepY, top + 1, boundsBottom);

  return { x: left, y: top, width: right - left, height: bottom - top };
}