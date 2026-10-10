// The annotation model and its history.
//
// Specified in docs/superpowers/specs/2026-09-25-nowly-screenshot-design.md §5.3.
// One versioned document serves both the preview and the exported pixels, so this
// is the only place object geometry lives: nothing is ever derived by screenshotting
// the DOM.
//
// All geometry is in output physical pixels, never CSS pixels, so a scaled display
// or a zoomed preview cannot change what gets exported.
//
// A committed object stays editable, per §5.2 and §7: it can be selected, moved,
// deleted, and — for text — re-edited. Those are transactions like any other, so
// they go through `commit` and each one is a single undo step. What never happens
// here is an in-progress gesture: a drag that is still moving lives in the editing
// hook, so cancelling it leaves no history entry at all.
//
// Which object is selected is *not* stored here. Selection is editor state, not
// document state: it must not be undone, redone, or exported.

export type PenPoint = { x: number; y: number };

export type MosaicBlock = { x: number; y: number; width: number; height: number };

export type AnnotationKind = 'rect' | 'ellipse' | 'arrow' | 'pen' | 'text' | 'mosaic';

type Common = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /// One of design.md's eight approved colours.
  color: string;
};

export type Annotation =
  | (Common & {
      kind: 'rect' | 'ellipse';
      strokeWidth: number;
      /// Painted solid in `color` when true. Absent means outline only.
      filled?: boolean;
    })
  | (Common & { kind: 'arrow'; strokeWidth: number })
  | (Common & { kind: 'pen'; strokeWidth: number; points: readonly PenPoint[] })
  | (Common & { kind: 'text'; fontSize: number; content: string })
  | (Common & { kind: 'mosaic'; blockSize: number; blocks: readonly MosaicBlock[] });

export type AnnotationDocument = {
  /// Creation order, which is also the painting order.
  objects: readonly Annotation[];
  past: readonly (readonly Annotation[])[];
  future: readonly (readonly Annotation[])[];
};

export function emptyDocument(): AnnotationDocument {
  return { objects: [], past: [], future: [] };
}

/// One committed transaction: the previous state goes onto the undo stack and the
/// redo branch is dropped. In-progress drags never come through here, so a drag is
/// one undo step rather than one per frame.
function commit(
  doc: AnnotationDocument,
  objects: readonly Annotation[]
): AnnotationDocument {
  return {
    objects,
    past: [...doc.past, doc.objects],
    future: []
  };
}

/// Text with no visible content is not an object at all, per §5.3.
function isEmptyText(annotation: Annotation): boolean {
  return annotation.kind === 'text' && annotation.content.trim() === '';
}

export function addAnnotation(
  doc: AnnotationDocument,
  annotation: Annotation
): AnnotationDocument {
  if (isEmptyText(annotation)) return doc;
  return commit(doc, [...doc.objects, annotation]);
}

/// Replaces one object in place, keeping its painting order.
///
/// Order matters: an object that jumped to the front when it was moved would change
/// which shape covers which, so a move is never implemented as remove-then-append.
/// Editing text down to nothing deletes the object instead, for the same reason
/// `addAnnotation` refuses to create it.
export function updateAnnotation(
  doc: AnnotationDocument,
  annotation: Annotation
): AnnotationDocument {
  const index = doc.objects.findIndex((object) => object.id === annotation.id);
  if (index === -1) return doc;
  if (isEmptyText(annotation)) return deleteAnnotation(doc, annotation.id);
  const objects = doc.objects.slice();
  objects[index] = annotation;
  return commit(doc, objects);
}

export function deleteAnnotation(doc: AnnotationDocument, id: string): AnnotationDocument {
  const objects = doc.objects.filter((object) => object.id !== id);
  if (objects.length === doc.objects.length) return doc;
  return commit(doc, objects);
}

export function findAnnotation(
  doc: AnnotationDocument,
  id: string | null
): Annotation | null {
  if (!id) return null;
  return doc.objects.find((object) => object.id === id) ?? null;
}

/// Moves an object by a whole-pixel delta.
///
/// A pen stroke's samples and a mosaic's blocks are the real geometry — the
/// bounding box is derived from them — so they are translated too. Moving only the
/// box would leave the drawn stroke behind while its selection outline walked away.
export function translateAnnotation(
  annotation: Annotation,
  deltaX: number,
  deltaY: number
): Annotation {
  const dx = Math.round(deltaX);
  const dy = Math.round(deltaY);
  if (dx === 0 && dy === 0) return annotation;
  const moved = { ...annotation, x: annotation.x + dx, y: annotation.y + dy };
  if (moved.kind === 'pen') {
    return {
      ...moved,
      points: moved.points.map((point) => ({ x: point.x + dx, y: point.y + dy }))
    };
  }
  if (moved.kind === 'mosaic') {
    return {
      ...moved,
      blocks: moved.blocks.map((block) => ({
        ...block,
        x: block.x + dx,
        y: block.y + dy
      }))
    };
  }
  return moved;
}

/// The rectangle an object occupies, normalised so a negative-width arrow still
/// reports a real box. Hit testing and move clamping both need it.
export function annotationBounds(annotation: Annotation): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const x = annotation.width < 0 ? annotation.x + annotation.width : annotation.x;
  const y = annotation.height < 0 ? annotation.y + annotation.height : annotation.y;
  return {
    x,
    y,
    width: Math.abs(annotation.width),
    height: Math.abs(annotation.height)
  };
}

export function canUndo(doc: AnnotationDocument): boolean {
  return doc.past.length > 0;
}

export function canRedo(doc: AnnotationDocument): boolean {
  return doc.future.length > 0;
}

export function undo(doc: AnnotationDocument): AnnotationDocument {
  const previous = doc.past[doc.past.length - 1];
  if (!previous) return doc;
  return {
    objects: previous,
    past: doc.past.slice(0, -1),
    future: [doc.objects, ...doc.future]
  };
}

export function redo(doc: AnnotationDocument): AnnotationDocument {
  const [next, ...rest] = doc.future;
  if (!next) return doc;
  return {
    objects: next,
    past: [...doc.past, doc.objects],
    future: rest
  };
}
