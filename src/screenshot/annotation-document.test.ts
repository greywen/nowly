import { describe, expect, it } from 'vitest';
import {
  addAnnotation,
  canRedo,
  canUndo,
  emptyDocument,
  redo,
  undo,
  type Annotation
} from './annotation-document';

function rect(id: string, x = 0, y = 0): Annotation {
  return {
    id,
    kind: 'rect',
    x,
    y,
    width: 40,
    height: 20,
    color: '#E5484D',
    strokeWidth: 4
  };
}

// Typed as the text variant, not the union, so callers keep its own fields.
function text(id: string, content: string): Annotation {
  return {
    id,
    kind: 'text',
    x: 10,
    y: 10,
    width: 0,
    height: 0,
    color: '#E5484D',
    fontSize: 24,
    content
  };
}

describe('annotation document', () => {
  it('stacks objects in creation order', () => {
    let doc = emptyDocument();

    doc = addAnnotation(doc, rect('a'));
    doc = addAnnotation(doc, rect('b'));

    expect(doc.objects.map((object) => object.id)).toEqual(['a', 'b']);
  });

  it('refuses an empty text object', () => {
    // §5.3: empty text generates no object at all.
    const doc = addAnnotation(emptyDocument(), text('a', '   '));

    expect(doc.objects).toEqual([]);
    expect(canUndo(doc)).toBe(false);
  });

  it('treats each committed annotation as exactly one transaction', () => {
    let doc = emptyDocument();
    doc = addAnnotation(doc, rect('a'));
    doc = addAnnotation(doc, rect('b'));

    // Two commits, so two undos return to empty and no further undo exists.
    doc = undo(doc);
    expect(doc.objects.map((object) => object.id)).toEqual(['a']);
    doc = undo(doc);
    expect(doc.objects).toEqual([]);
    expect(canUndo(doc)).toBe(false);
  });

  it('restores the same model on redo', () => {
    let doc = emptyDocument();
    doc = addAnnotation(doc, rect('a'));
    const afterCreate = doc.objects;

    doc = redo(undo(doc));

    expect(doc.objects).toEqual(afterCreate);
  });

  it('clears the redo branch on a new commit', () => {
    let doc = emptyDocument();
    doc = addAnnotation(doc, rect('a'));
    doc = undo(doc);
    expect(canRedo(doc)).toBe(true);

    doc = addAnnotation(doc, rect('b'));

    expect(canRedo(doc)).toBe(false);
    expect(doc.objects.map((object) => object.id)).toEqual(['b']);
  });

  it('ignores undo and redo at the ends of history', () => {
    const empty = emptyDocument();

    expect(undo(empty)).toEqual(empty);
    expect(redo(empty)).toEqual(empty);
  });

  it('keeps every object kind the spec defines', () => {
    let doc = emptyDocument();
    const shape = { x: 0, y: 0, width: 40, height: 20, color: '#E5484D', strokeWidth: 4 };
    doc = addAnnotation(doc, { id: 'r', kind: 'rect', ...shape });
    doc = addAnnotation(doc, { id: 'e', kind: 'ellipse', ...shape });
    doc = addAnnotation(doc, { id: 'a', kind: 'arrow', ...shape });
    doc = addAnnotation(doc, { id: 'p', kind: 'pen', ...shape, points: [{ x: 0, y: 0 }] });
    doc = addAnnotation(doc, text('t', 'hello'));
    doc = addAnnotation(doc, {
      id: 'm',
      kind: 'mosaic',
      x: 0,
      y: 0,
      width: 40,
      height: 20,
      color: '#E5484D',
      blockSize: 16,
      blocks: [{ x: 0, y: 0, width: 16, height: 16 }]
    });

    expect(doc.objects.map((object) => object.kind)).toEqual([
      'rect',
      'ellipse',
      'arrow',
      'pen',
      'text',
      'mosaic'
    ]);
  });

  it('commits a whole pen stroke as one transaction', () => {
    // §5.2: a stroke is not split into one undo step per sampled point.
    const points = Array.from({ length: 50 }, (_, index) => ({ x: index, y: index }));
    const doc = addAnnotation(emptyDocument(), {
      id: 'p',
      kind: 'pen',
      x: 0,
      y: 0,
      width: 40,
      height: 20,
      color: '#E5484D',
      strokeWidth: 4,
      points
    });

    expect(doc.past.length).toBe(1);
    expect(undo(doc).objects).toEqual([]);
  });
});
