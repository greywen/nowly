import { handleCursor, type AnnotationHandle } from './annotation-resize';
import type { ToolId } from './toolbar-model';

// Which cursor the capture surface shows.
//
// The annotation layer is `pointer-events: none` so the surface keeps one pointer
// stream (§5.3), which means nothing under the pointer can set its own cursor.
// The surface has to decide, and it is the only affordance there is: a committed
// shape has no hover highlight and no handles of its own, so a crosshair over a
// draggable rectangle actively says "draw here" and hides the whole editing model.
//
// Kept pure and separate from the component for the same reason `key-dispatch.ts`
// is: the question "what does the pointer do here" has one answer per state, and
// that answer is worth asserting without rendering an overlay.

export type PointerTarget =
  /// Over a committed annotation, which a press would pick up.
  | 'object'
  /// Inside the capture rectangle while it can still be moved.
  | 'selection'
  | 'none';
export type CursorContext = {
  /// The frozen frame has decoded. Before that nothing is interactive.
  ready: boolean;
  /// §8.1 freezes the document while an export runs.
  exporting: boolean;
  phase: 'aiming' | 'dragging' | 'editing';
  tool: ToolId;
  /// A move or resize of the capture rectangle is in progress.
  transforming: boolean;
  /// A committed object is being dragged.
  movingObject: boolean;
  /// The grip of the selected object under the pointer, or being dragged. Outranks
  /// everything else that is hoverable, because the grips sit on top.
  handle: AnnotationHandle | null;
  over: PointerTarget;
};

/// A CSS `cursor` keyword.
export type CursorName =
  | 'default'
  | 'progress'
  | 'crosshair'
  | 'move'
  | 'grabbing'
  | 'text'
  | 'nwse-resize'
  | 'nesw-resize'
  | 'ns-resize'
  | 'ew-resize';

/// The drawing tools, which all aim at a pixel rather than at an object.
const AIMED_TOOLS: ReadonlySet<ToolId> = new Set(['rect', 'ellipse', 'arrow', 'pen', 'mosaic']);

export function cursorFor(context: CursorContext): CursorName {
  // Nothing is interactive until the frame is on screen, and a crosshair would
  // invite a drag that the surface would discard.
  if (!context.ready) return 'default';
  // The export is single-flight and freezes editing, so the surface must not look
  // like it still takes input.
  if (context.exporting) return 'progress';

  // A gesture in progress outranks whatever is under the pointer: the pointer may
  // have left the object it is dragging, and the cursor still belongs to the drag.
  // A grip keeps its own direction throughout, so the axis being resized stays
  // legible for the whole drag rather than turning into a generic grab.
  if (context.handle) return handleCursor(context.handle) as CursorName;
  if (context.movingObject || context.transforming) return 'grabbing';

  if (context.phase !== 'editing') return 'crosshair';

  // A committed object can be picked up under any tool, so this is checked before
  // the tool: the cursor has to agree with what the press will actually do.
  if (context.over === 'object') return 'move';
  if (context.tool === 'select') return context.over === 'selection' ? 'move' : 'default';
  if (context.tool === 'text') return 'text';
  if (AIMED_TOOLS.has(context.tool)) return 'crosshair';
  return 'default';
}
