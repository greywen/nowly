import { useCallback, useRef, useState } from 'react';
import {
  deleteAnnotation,
  findAnnotation,
  translateAnnotation,
  updateAnnotation,
  type Annotation,
  type AnnotationDocument,
  type PenPoint
} from './annotation-document';
import { clampTranslation, hitTestAnnotations } from './annotation-hit';
import {
  hitTestHandles,
  resizeAnnotation,
  type AnnotationHandle
} from './annotation-resize';
import { strokeToMosaicBlocks } from './mosaic-brush';
import type { PixelRect } from './screenshot-model';
import { measureTextBox } from './text-metrics';
import type { PropertyRow, PropertyValue } from './tool-properties';

// Selecting, moving, deleting and re-editing a committed object.
//
// §7 of docs/superpowers/specs/2026-09-25-nowly-screenshot-design.md gives the
// selected object its own rung in the keyboard priority, and the 2026-09-30
// amendment §4/§5 require Esc to roll a transform back with no undo entry and
// double-click on text to re-edit that object. This hook owns all of that, so
// `useAnnotationDrawing` stays purely about creating shapes.
//
// Two rules shape the design:
//
//   * A transform is one transaction. The live offset lives here, outside the
//     document, and the document is written once on release — so a cancelled drag
//     leaves no history entry at all, and an accepted one is a single undo step.
//   * Selection is editor state. It is never written into the document, so undo
//     cannot resurrect a selection and the export cannot contain one.

export type EditingState = {
  /// The committed object the user is acting on, by id.
  selectedId: string | null;
  /// The object as it looks mid-drag, substituted for its committed self in the
  /// preview. Null when nothing is being dragged.
  moving: Annotation | null;
  /// The grip being dragged, so the cursor keeps its direction for the whole drag
  /// even once the pointer has left the grip. Null during a whole-object move.
  draggingHandle: AnnotationHandle | null;
  /// A committed text object being re-edited, with the editor's seed content.
  editingText: {
    id: string;
    x: number;
    y: number;
    initialContent: string;
    color: string;
    fontSize: number;
  } | null;
};

export type UseAnnotationEditing = {
  state: EditingState;
  /// True when the press landed on an object and started a selection or a move.
  onPointerDown: (pixel: PenPoint) => boolean;
  onPointerMove: (pixel: PenPoint) => void;
  onPointerUp: () => void;
  /// Abandons an in-progress move, for Esc and lost capture. No undo entry.
  cancelMove: () => boolean;
  /// Clears the selection. True when there was one to clear.
  deselect: () => boolean;
  /// Deletes the selected object, for Delete/Backspace.
  deleteSelected: () => boolean;
  /// Nudges the selected object, for the arrow keys.
  nudge: (deltaX: number, deltaY: number) => boolean;
  /// The grip under the pointer on the selected object, for the cursor. Null when
  /// nothing is selected or the pointer is not on a grip.
  handleAt: (pixel: PenPoint) => AnnotationHandle | null;
  /// Restyles the selected object from a property row, as one undo step. False when
  /// nothing is selected or the row does not apply to that kind.
  restyleSelected: (row: PropertyRow, value: PropertyValue) => boolean;
  /// Opens the text editor for a committed text object. True when one was opened.
  beginTextEdit: (pixel: PenPoint) => boolean;
  /// Opens the text editor for the selected object, for Enter.
  beginTextEditOfSelection: () => boolean;
  commitTextEdit: (content: string) => void;
  cancelTextEdit: () => void;
  /// Drops a selection whose object no longer exists, after undo or delete.
  reconcile: (doc: AnnotationDocument) => void;
};

const IDLE: EditingState = {
  selectedId: null,
  moving: null,
  draggingHandle: null,
  editingText: null
};

export function useAnnotationEditing(
  selection: PixelRect,
  doc: AnnotationDocument,
  setDoc: (next: AnnotationDocument) => void,
  /// False while an export is running: §8.1 freezes the document, so a move must
  /// not start either.
  enabled = true
): UseAnnotationEditing {
  const [state, setState] = useState<EditingState>(IDLE);
  // A mirror, so a handler can read the live state without a side effect inside a
  // setState updater: React may run an updater twice, which would commit twice.
  const stateRef = useRef(state);
  const apply = useCallback((next: EditingState) => {
    stateRef.current = next;
    setState(next);
  }, []);
  /// Where the drag started and which object it grabbed. A press that never moves
  /// is a selection, not a transform, so nothing is committed from here.
  ///
  /// `handle` is the grip being dragged, or null for a whole-object move. Both go
  /// through the same field on purpose: a resize is a transform like any other, so
  /// it inherits one-transaction-per-drag and Esc-rolls-back-with-no-undo without
  /// a second code path that could disagree about either.
  const grab = useRef<{
    origin: PenPoint;
    object: Annotation;
    handle: AnnotationHandle | null;
  } | null>(null);

  const onPointerDown = useCallback(
    (pixel: PenPoint) => {
      if (!enabled) return false;
      // A grip of the already-selected object wins over everything, including a
      // shape stacked on top of it. Otherwise a grip that happens to sit over
      // another object would be unusable, and the grips of a small shape — the
      // ones most needed — would be the first to become unreachable.
      const selected = findAnnotation(doc, stateRef.current.selectedId);
      const handle = selected ? hitTestHandles(selected, pixel) : null;
      if (selected && handle) {
        grab.current = { origin: pixel, object: selected, handle };
        return true;
      }

      const hit = hitTestAnnotations(doc.objects, pixel);
      if (!hit) {
        // A press on empty space clears the selection, the same way clicking off a
        // shape does in WeChat's editor.
        if (stateRef.current.selectedId !== null) apply(IDLE);
        return false;
      }
      grab.current = { origin: pixel, object: hit, handle: null };
      apply({
        selectedId: hit.id,
        moving: null,
        draggingHandle: null,
        editingText: null
      });
      return true;
    },
    [doc, enabled, apply]
  );

  const onPointerMove = useCallback(
    (pixel: PenPoint) => {
      const grabbed = grab.current;
      if (!grabbed) return;

      if (grabbed.handle) {
        const resized = resizeAnnotation(
          grabbed.object,
          grabbed.handle,
          pixel,
          selection
        );
        // An unchanged result shows the committed object instead of an identical
        // copy, so "did not move" and "moved by zero" render the same.
        apply({
          ...stateRef.current,
          draggingHandle: grabbed.handle,
          moving: resized === grabbed.object ? null : resized
        });
        return;
      }

      const { dx, dy } = clampTranslation(
        grabbed.object,
        pixel.x - grabbed.origin.x,
        pixel.y - grabbed.origin.y,
        selection
      );
      if (dx === 0 && dy === 0) {
        // Back at the start: show the committed object rather than an identical
        // copy, so "nothing moved" and "moved by zero" look the same.
        if (stateRef.current.moving) {
          apply({ ...stateRef.current, moving: null, draggingHandle: grabbed.handle });
        }
        return;
      }
      apply({
        ...stateRef.current,
        draggingHandle: null,
        moving: translateAnnotation(grabbed.object, dx, dy)
      });
    },
    [selection, apply]
  );

  const onPointerUp = useCallback(() => {
    const grabbed = grab.current;
    grab.current = null;
    const { moving } = stateRef.current;
    if (!grabbed || !moving) {
      // A press without movement only selected something.
      if (stateRef.current.moving || stateRef.current.draggingHandle) {
        apply({ ...stateRef.current, moving: null, draggingHandle: null });
      }
      return;
    }
    apply({ ...stateRef.current, moving: null, draggingHandle: null });
    // One transaction for the whole drag.
    setDoc(updateAnnotation(doc, moving));
  }, [doc, setDoc, apply]);

  const cancelMove = useCallback(() => {
    const active = grab.current !== null || stateRef.current.moving !== null;
    if (!active) return false;
    grab.current = null;
    apply({ ...stateRef.current, moving: null, draggingHandle: null });
    return true;
  }, [apply]);

  const deselect = useCallback(() => {
    if (stateRef.current.selectedId === null) return false;
    grab.current = null;
    apply(IDLE);
    return true;
  }, [apply]);

  const deleteSelected = useCallback(() => {
    if (!enabled) return false;
    const { selectedId } = stateRef.current;
    if (!selectedId) return false;
    grab.current = null;
    apply(IDLE);
    setDoc(deleteAnnotation(doc, selectedId));
    return true;
  }, [doc, setDoc, enabled, apply]);

  const nudge = useCallback(
    (deltaX: number, deltaY: number) => {
      if (!enabled) return false;
      const selected = findAnnotation(doc, stateRef.current.selectedId);
      if (!selected) return false;
      const { dx, dy } = clampTranslation(selected, deltaX, deltaY, selection);
      if (dx === 0 && dy === 0) {
        // Already against the edge: consumed, so the key does not fall through and
        // move the capture rectangle instead.
        return true;
      }
      setDoc(updateAnnotation(doc, translateAnnotation(selected, dx, dy)));
      return true;
    },
    [doc, setDoc, selection, enabled]
  );

  const openEditor = useCallback(
    (object: Annotation | null) => {
      if (!object || object.kind !== 'text') return false;
      grab.current = null;
      apply({
        selectedId: object.id,
        moving: null,
        draggingHandle: null,
        editingText: {
          id: object.id,
          x: object.x,
          y: object.y,
          initialContent: object.content,
          color: object.color,
          fontSize: object.fontSize
        }
      });
      return true;
    },
    [apply]
  );

  const beginTextEdit = useCallback(
    (pixel: PenPoint) => {
      if (!enabled) return false;
      return openEditor(hitTestAnnotations(doc.objects, pixel));
    },
    [doc.objects, enabled, openEditor]
  );

  const beginTextEditOfSelection = useCallback(() => {
    if (!enabled) return false;
    return openEditor(findAnnotation(doc, stateRef.current.selectedId));
  }, [doc, enabled, openEditor]);

  const commitTextEdit = useCallback(
    (content: string) => {
      const editing = stateRef.current.editingText;
      if (!editing) return;
      const existing = findAnnotation(doc, editing.id);
      apply({ ...stateRef.current, editingText: null });
      if (!existing || existing.kind !== 'text') return;
      // Unchanged text is not a transaction: committing it anyway would put an
      // undo step in the history for an edit the user abandoned by clicking away.
      if (existing.content === content) return;
      const next = updateAnnotation(doc, {
        ...existing,
        content,
        // Measured with the same function the creation path uses, so a re-edit and
        // a new object agree on where the object is.
        ...measureTextBox(content, existing.fontSize)
      });
      // Emptying the text deletes the object, so nothing may stay selected.
      if (content.trim() === '') apply(IDLE);
      setDoc(next);
    },
    [doc, setDoc, apply]
  );

  const cancelTextEdit = useCallback(() => {
    apply({ ...stateRef.current, editingText: null });
  }, [apply]);

  const reconcile = useCallback(
    (next: AnnotationDocument) => {
      const { selectedId, editingText } = stateRef.current;
      if (!selectedId && !editingText) return;
      // Undo can remove the object a selection or an open editor points at. Keeping
      // either would show chrome for an object that is no longer in the picture.
      if (!findAnnotation(next, selectedId)) apply(IDLE);
      else if (editingText && !findAnnotation(next, editingText.id)) {
        apply({ selectedId, moving: null, draggingHandle: null, editingText: null });
      }
    },
    [apply]
  );

  /// Applies a property row to the selected object, as one undo step.
  ///
  /// Returns false when nothing is selected or the row does not apply, so the
  /// caller can fall back to changing the tool default for the next shape.
  const restyleSelected = useCallback(
    (row: PropertyRow, value: PropertyValue) => {
      if (!enabled) return false;
      const selected = findAnnotation(doc, stateRef.current.selectedId);
      if (!selected) return false;
      const next = annotationWithProperty(selected, row, value);
      if (!next) return false;
      setDoc(updateAnnotation(doc, next));
      return true;
    },
    [doc, setDoc, enabled]
  );

  const handleAt = useCallback(
    (pixel: PenPoint) => {
      const selected = findAnnotation(doc, stateRef.current.selectedId);
      return selected ? hitTestHandles(selected, pixel) : null;
    },
    [doc]
  );

  return {
    state,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    cancelMove,
    deselect,
    deleteSelected,
    nudge,
    handleAt,
    restyleSelected,
    beginTextEdit,
    beginTextEditOfSelection,
    commitTextEdit,
    cancelTextEdit,
    reconcile
  };
}

/// The longest line, since a multi-line box is as wide as its widest row.
function longestLine(content: string): number {
  return content.split('\n').reduce((widest, line) => Math.max(widest, line.length), 0);
}

/// Applies one property row to a committed object.
///
/// Returns `null` when the row does not belong to this kind, so an unrelated change
/// cannot quietly rewrite an object into something the spec does not allow.
export function annotationWithProperty(
  annotation: Annotation,
  row: PropertyRow,
  value: PropertyValue
): Annotation | null {
  if (row === 'color') {
    // §5.2 gives the mosaic no colour of its own: its pixels come from the image.
    if (annotation.kind === 'mosaic') return null;
    return { ...annotation, color: String(value) };
  }
  if (row === 'strokeWidth') {
    if (annotation.kind === 'text' || annotation.kind === 'mosaic') return null;
    return { ...annotation, strokeWidth: Number(value) };
  }
  if (row === 'fill') {
    if (annotation.kind !== 'rect' && annotation.kind !== 'ellipse') return null;
    return { ...annotation, filled: value === true };
  }
  if (row === 'fontSize') {
    if (annotation.kind !== 'text') return null;
    const fontSize = Number(value);
    // The box is derived from the type size, so it is re-measured rather than
    // scaled: a larger face is not a uniformly scaled version of a smaller one.
    return { ...annotation, fontSize, ...measureTextBox(annotation.content, fontSize) };
  }
  if (row === 'blockSize') {
    if (annotation.kind !== 'mosaic') return null;
    const blockSize = Number(value);
    // The painted cells are re-snapped to the new grid through each cell's centre,
    // using the same function the brush used. Keeping the old rectangles and only
    // relabelling the size would leave the preview and the export disagreeing,
    // because `mosaic.rs` fills whole cells of the grid it is given.
    const centres = annotation.blocks.map((block) => ({
      x: block.x + block.width / 2,
      y: block.y + block.height / 2
    }));
    const blocks = strokeToMosaicBlocks(centres, blockSize);
    if (blocks.length === 0) return null;
    const left = Math.min(...blocks.map((block) => block.x));
    const top = Math.min(...blocks.map((block) => block.y));
    const right = Math.max(...blocks.map((block) => block.x + block.width));
    const bottom = Math.max(...blocks.map((block) => block.y + block.height));
    return {
      ...annotation,
      blockSize,
      blocks,
      x: left,
      y: top,
      width: right - left,
      height: bottom - top
    };
  }
  return null;
}
