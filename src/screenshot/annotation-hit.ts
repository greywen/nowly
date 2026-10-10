import { annotationBounds, type Annotation, type PenPoint } from './annotation-document';
import type { PixelRect } from './screenshot-model';

// Hit testing a committed annotation, and clamping its movement.
//
// §7 of docs/superpowers/specs/2026-09-25-nowly-screenshot-design.md needs a
// selected object, and the amendment's §4 needs the object under the pointer. Both
// run against the document rather than against the DOM: the annotation SVG is
// `pointer-events: none` so the capture surface keeps one pointer stream, and
// hit testing the real geometry is the only way an open shape can be grabbed by its
// stroke instead of by the empty middle of its bounding box.
//
// Everything here is in frame physical pixels, like the document itself.

/// Extra reach around a stroke, in physical pixels, so a thin line is still
/// grabbable without demanding pixel-exact aim.
const GRAB_SLACK = 6;

function reach(strokeWidth: number): number {
  return strokeWidth / 2 + GRAB_SLACK;
}

function withinBox(
  pixel: PenPoint,
  box: { x: number; y: number; width: number; height: number },
  slack = 0
): boolean {
  return (
    pixel.x >= box.x - slack &&
    pixel.y >= box.y - slack &&
    pixel.x <= box.x + box.width + slack &&
    pixel.y <= box.y + box.height + slack
  );
}

/// Distance from a point to a line segment, which is what a stroke really is.
function distanceToSegment(pixel: PenPoint, from: PenPoint, to: PenPoint): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(pixel.x - from.x, pixel.y - from.y);
  const t = Math.min(
    1,
    Math.max(0, ((pixel.x - from.x) * dx + (pixel.y - from.y) * dy) / lengthSquared)
  );
  return Math.hypot(pixel.x - (from.x + t * dx), pixel.y - (from.y + t * dy));
}

/// Whether the pointer is on this one object.
///
/// Open shapes are hit on their outline, not on their interior: a rectangle drawn
/// around a region must not swallow every press inside that region, or the shapes
/// underneath it would become unreachable. Text and mosaics are filled, so their box
/// is the hit area.
export function hitsAnnotation(annotation: Annotation, pixel: PenPoint): boolean {
  const bounds = annotationBounds(annotation);

  switch (annotation.kind) {
    case 'rect': {
      const slack = reach(annotation.strokeWidth);
      if (!withinBox(pixel, bounds, slack)) return false;
      // A filled rectangle has no hole: its interior is painted, so it is the shape.
      if (annotation.filled) return true;
      const insideLeft = pixel.x >= bounds.x + slack;
      const insideRight = pixel.x <= bounds.x + bounds.width - slack;
      const insideTop = pixel.y >= bounds.y + slack;
      const insideBottom = pixel.y <= bounds.y + bounds.height - slack;
      // Inside the box but away from every edge: that is the hole, not the shape.
      return !(insideLeft && insideRight && insideTop && insideBottom);
    }
    case 'ellipse': {
      const slack = reach(annotation.strokeWidth);
      const rx = bounds.width / 2;
      const ry = bounds.height / 2;
      if (rx <= 0 || ry <= 0) return withinBox(pixel, bounds, slack);
      const nx = (pixel.x - (bounds.x + rx)) / rx;
      const ny = (pixel.y - (bounds.y + ry)) / ry;
      const radius = Math.hypot(nx, ny);
      // Converted back to pixels along the smaller axis, so the tolerance is the
      // same distance on screen at every aspect ratio.
      const tolerance = slack / Math.max(1, Math.min(rx, ry));
      if (annotation.filled) return radius <= 1 + tolerance;
      return Math.abs(radius - 1) <= tolerance;
    }
    case 'arrow':
      // Stored unnormalised, so the stored corners are the real endpoints.
      return (
        distanceToSegment(
          pixel,
          { x: annotation.x, y: annotation.y },
          { x: annotation.x + annotation.width, y: annotation.y + annotation.height }
        ) <= reach(annotation.strokeWidth)
      );
    case 'pen': {
      const slack = reach(annotation.strokeWidth);
      if (!withinBox(pixel, bounds, slack)) return false;
      if (annotation.points.length === 1) {
        return Math.hypot(pixel.x - annotation.points[0].x, pixel.y - annotation.points[0].y) <= slack;
      }
      for (let index = 1; index < annotation.points.length; index += 1) {
        if (distanceToSegment(pixel, annotation.points[index - 1], annotation.points[index]) <= slack) {
          return true;
        }
      }
      return false;
    }
    case 'text':
      return withinBox(pixel, bounds, GRAB_SLACK / 2);
    case 'mosaic':
      // The painted cells are the object; its bounding box may cover ground the
      // brush never touched.
      return annotation.blocks.some((block) => withinBox(pixel, block));
  }
}

/// The topmost object under the pointer, or `null`.
///
/// Reverse creation order, because creation order is painting order: the object the
/// user sees on top is the one they mean to grab.
export function hitTestAnnotations(
  objects: readonly Annotation[],
  pixel: PenPoint
): Annotation | null {
  for (let index = objects.length - 1; index >= 0; index -= 1) {
    if (hitsAnnotation(objects[index], pixel)) return objects[index];
  }
  return null;
}

/// Trims a move so the object stays inside the capture rectangle.
///
/// An object dragged out of the selection would be invisible in the preview and
/// absent from the export, which reads as data loss rather than as a move. Both axes
/// are trimmed independently, so sliding along an edge still works.
export function clampTranslation(
  annotation: Annotation,
  deltaX: number,
  deltaY: number,
  selection: PixelRect
): { dx: number; dy: number } {
  const bounds = annotationBounds(annotation);
  // An object wider than the selection cannot be contained; leave that axis free
  // rather than snapping it to an edge the user did not drag it to.
  const dx =
    bounds.width <= selection.width
      ? Math.min(
          Math.max(Math.round(deltaX), selection.x - bounds.x),
          selection.x + selection.width - (bounds.x + bounds.width)
        )
      : Math.round(deltaX);
  const dy =
    bounds.height <= selection.height
      ? Math.min(
          Math.max(Math.round(deltaY), selection.y - bounds.y),
          selection.y + selection.height - (bounds.y + bounds.height)
        )
      : Math.round(deltaY);
  return { dx, dy };
}
