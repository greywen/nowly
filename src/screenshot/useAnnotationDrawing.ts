import { useCallback, useRef, useState } from 'react';
import {
  addAnnotation,
  type Annotation,
  type AnnotationDocument,
  type PenPoint
} from './annotation-document';
import { interpolateStroke, strokeToMosaicBlocks } from './mosaic-brush';
import type { PixelRect } from './screenshot-model';
import { measureTextBox } from './text-metrics';
import type { ToolProperties } from './tool-properties';
import type { ToolId } from './toolbar-model';

// Turning pointer drags into annotations.
//
// §5.3 of docs/superpowers/specs/2026-09-25-nowly-screenshot-design.md: one drag
// is one undo step. So the in-progress shape lives here, outside the document, and
// the document is only touched once on release. A 50-point pen stroke therefore
// commits a single transaction.
//
// §5.2 line 205: shapes and pointer positions are clipped to the output range, so
// nothing can be drawn outside the selection.
//
// The mosaic is a brush rather than a rectangle, matching the WeChat flow the user
// asked for. Its stroke is sampled like a pen's, then turned into block-aligned
// rectangles by `mosaic-brush.ts`. The samples themselves are not stored: the
// committed object carries only the blocks, which is what both the preview and the
// export consume.

export type DrawingState = {
  /// The shape being dragged, in frame physical pixels. Not in the document yet.
  draft: Annotation | null;
  /// A text object awaiting input. Empty text is never committed, per §5.3.
  pendingText: {
    id: string;
    x: number;
    y: number;
    initialContent: string;
    color: string;
    fontSize: number;
  } | null;
};

export type UseAnnotationDrawing = {
  state: DrawingState;
  onPointerDown: (pixel: PenPoint) => boolean;
  onPointerMove: (pixel: PenPoint) => void;
  onPointerUp: () => void;
  /// Abandons the in-progress shape without committing it, for Esc.
  cancelDraft: () => boolean;
  /// Commits or discards the pending text.
  commitText: (content: string) => void;
  cancelText: () => void;
};

function clampToSelection(pixel: PenPoint, selection: PixelRect): PenPoint {
  return {
    x: Math.min(Math.max(pixel.x, selection.x), selection.x + selection.width - 1),
    y: Math.min(Math.max(pixel.y, selection.y), selection.y + selection.height - 1)
  };
}

function rectFrom(start: PenPoint, end: PenPoint) {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y)
  };
}

/// The bounding box of a set of block rectangles, in frame physical pixels.
///
/// The mosaic's own box is derived rather than dragged: the painted blocks are the
/// truth, and a box that did not contain them would misreport what is covered.
function boundsOfBlocks(
  blocks: readonly { x: number; y: number; width: number; height: number }[]
) {
  if (blocks.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const block of blocks) {
    left = Math.min(left, block.x);
    top = Math.min(top, block.y);
    right = Math.max(right, block.x + block.width);
    bottom = Math.max(bottom, block.y + block.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function useAnnotationDrawing(
  tool: ToolId,
  properties: ToolProperties,
  selection: PixelRect,
  doc: AnnotationDocument,
  setDoc: (next: AnnotationDocument) => void,
  /// Injected so tests get stable ids.
  nextId: () => string = () => `a${Math.random().toString(36).slice(2, 10)}`
): UseAnnotationDrawing {
  const [state, setState] = useState<DrawingState>({ draft: null, pendingText: null });
  const anchor = useRef<PenPoint | null>(null);
  /// The mosaic brush's raw samples for the current stroke. They are not part of the
  /// committed object, so they live here rather than in the draft.
  const brushPoints = useRef<PenPoint[]>([]);
  // A mirror of `state`, so a handler can read the current draft without putting a
  // side effect inside a setState updater: React may run an updater twice, which
  // would commit the same annotation twice.
  const stateRef = useRef(state);
  const apply = useCallback((next: DrawingState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const onPointerDown = useCallback(
    (raw: PenPoint) => {
      const pixel = clampToSelection(raw, selection);

      if (tool === 'select') {
        return false;
      }

      if (tool === 'text') {
        // A click opens an editor; the object only exists once it has content.
        apply({
          draft: null,
          pendingText: {
            id: nextId(),
            x: pixel.x,
            y: pixel.y,
            initialContent: '',
            color: properties.color,
            fontSize: properties.fontSize
          }
        });
        return true;
      }

      anchor.current = pixel;
      const base = { id: nextId(), x: pixel.x, y: pixel.y, width: 0, height: 0 };

      if (tool === 'mosaic') {
        // The brush starts covering ground on press, so a single click already
        // masks one block rather than producing nothing.
        brushPoints.current = [pixel];
        const blocks = strokeToMosaicBlocks([pixel], properties.mosaicBlockSize);
        apply({
          pendingText: null,
          draft: {
            ...base,
            ...boundsOfBlocks(blocks),
            kind: 'mosaic',
            color: properties.color,
            blockSize: properties.mosaicBlockSize,
            blocks
          }
        });
        return true;
      }

      apply({
        pendingText: null,
        draft:
          tool === 'pen'
            ? {
                ...base,
                kind: 'pen',
                color: properties.color,
                strokeWidth: properties.strokeWidth,
                points: [pixel]
              }
            : tool === 'arrow'
              ? {
                  ...base,
                  kind: 'arrow',
                  color: properties.color,
                  strokeWidth: properties.strokeWidth
                }
              : {
                  ...base,
                  kind: tool,
                  color: properties.color,
                  strokeWidth: properties.strokeWidth,
                  filled: properties.filled
                }
      });
      return true;
    },
    [tool, properties, selection, nextId, apply]
  );

  const onPointerMove = useCallback(
    (raw: PenPoint) => {
      const pixel = clampToSelection(raw, selection);
      const current = stateRef.current;
      if (!current.draft || !anchor.current) return;

      if (current.draft.kind === 'pen') {
        const points: readonly PenPoint[] = [...current.draft.points, pixel];
        // The box follows the stroke, so hit testing and moving work on it.
        const xs = points.map((point) => point.x);
        const ys = points.map((point) => point.y);
        apply({
          ...current,
          draft: {
            ...current.draft,
            points,
            x: Math.min(...xs),
            y: Math.min(...ys),
            width: Math.max(...xs) - Math.min(...xs),
            height: Math.max(...ys) - Math.min(...ys)
          }
        });
        return;
      }

      if (current.draft.kind === 'mosaic') {
        // Half a block between samples, so a fast drag cannot skip a cell and
        // leave an uncovered gap in the middle of the stroke.
        brushPoints.current = [...brushPoints.current, pixel];
        const dense = interpolateStroke(brushPoints.current, current.draft.blockSize / 2);
        const blocks = strokeToMosaicBlocks(dense, current.draft.blockSize);
        apply({
          ...current,
          draft: { ...current.draft, ...boundsOfBlocks(blocks), blocks }
        });
        return;
      }

      // An arrow keeps its direction, so it is not normalised to top-left.
      if (current.draft.kind === 'arrow') {
        apply({
          ...current,
          draft: {
            ...current.draft,
            x: anchor.current.x,
            y: anchor.current.y,
            width: pixel.x - anchor.current.x,
            height: pixel.y - anchor.current.y
          }
        });
        return;
      }

      apply({ ...current, draft: { ...current.draft, ...rectFrom(anchor.current, pixel) } });
    },
    [selection, apply]
  );

  const onPointerUp = useCallback(() => {
    anchor.current = null;
    brushPoints.current = [];
    const current = stateRef.current;
    if (!current.draft) return;

    // A zero-sized shape is a stray click, not an object. A mosaic is judged by its
    // blocks instead: one click is a deliberate single-block mask, not a stray.
    const empty =
      current.draft.kind === 'pen'
        ? current.draft.points.length < 2
        : current.draft.kind === 'mosaic'
          ? current.draft.blocks.length === 0
          : current.draft.width === 0 && current.draft.height === 0;

    apply({ ...current, draft: null });
    if (!empty) {
      // One transaction for the whole drag.
      setDoc(addAnnotation(doc, current.draft));
    }
  }, [doc, setDoc, apply]);

  const commitText = useCallback(
    (content: string) => {
      const pending = stateRef.current.pendingText;
      if (!pending) return;

      apply({ ...stateRef.current, pendingText: null });
      if (content.trim() === '') return;

      setDoc(
        addAnnotation(doc, {
          id: pending.id,
          kind: 'text',
          x: pending.x,
          y: pending.y,
          // Measured, not estimated: the box is the object's hit area, and the old
          // `length * fontSize * 0.6` guess under-measured CJK by about half, so
          // the right side of 你好世界 was not part of the object at all.
          ...measureTextBox(content, pending.fontSize),
          color: pending.color,
          fontSize: pending.fontSize,
          content
        })
      );
    },
    [doc, setDoc, apply]
  );

  const cancelDraft = useCallback(() => {
    // §7: Esc reverts the drag, so the shape never reaches the document and the
    // history is untouched.
    const hadDraft = anchor.current !== null || stateRef.current.draft !== null;
    if (!hadDraft) return false;
    anchor.current = null;
    brushPoints.current = [];
    apply({ ...stateRef.current, draft: null });
    return true;
  }, [apply]);

  const cancelText = useCallback(() => {
    apply({ ...stateRef.current, pendingText: null });
  }, [apply]);

  return {
    state,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    cancelDraft,
    commitText,
    cancelText
  };
}
