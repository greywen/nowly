import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  addAnnotation,
  emptyDocument,
  undo,
  type Annotation,
  type AnnotationDocument
} from './annotation-document';
import { useAnnotationEditing } from './useAnnotationEditing';
import { measureTextBox } from './text-metrics';

const selection = { x: 100, y: 100, width: 400, height: 300 };

const square: Annotation = {
  id: 'r1',
  kind: 'rect',
  x: 200,
  y: 200,
  width: 100,
  height: 80,
  color: '#f06445',
  strokeWidth: 4
};

const note: Annotation = {
  id: 't1',
  kind: 'text',
  x: 150,
  y: 150,
  // Measured the same way the app measures it, so the fixture cannot disagree with
  // what a commit would have produced.
  ...measureTextBox('before', 24),
  color: '#f06445',
  fontSize: 24,
  content: 'before'
};

/// A live document, so a hook that reads `doc` sees what it just wrote.
function setup(objects: readonly Annotation[] = [square], enabled = true) {
  let doc: AnnotationDocument = objects.reduce(
    (current, object) => addAnnotation(current, object),
    emptyDocument()
  );
  const setDoc = vi.fn((next: AnnotationDocument) => {
    doc = next;
  });
  const hook = renderHook(() => useAnnotationEditing(selection, doc, setDoc, enabled));
  const rerender = () => hook.rerender();
  return {
    hook,
    setDoc,
    rerender,
    get doc() {
      return doc;
    }
  };
}

describe('selecting a committed object', () => {
  it('selects the object under the pointer', () => {
    const { hook } = setup();

    const started = act(() => hook.result.current.onPointerDown({ x: 200, y: 240 }));
    void started;

    expect(hook.result.current.state.selectedId).toBe('r1');
  });

  it('clears the selection when the press lands on empty space', () => {
    const { hook } = setup();
    act(() => hook.result.current.onPointerDown({ x: 200, y: 240 }));

    act(() => hook.result.current.onPointerDown({ x: 450, y: 390 }));

    expect(hook.result.current.state.selectedId).toBeNull();
  });

  it('reports whether the press was consumed, so the drawing path can stay out', () => {
    const { hook } = setup();
    let onObject = false;
    let onEmpty = true;

    act(() => {
      onObject = hook.result.current.onPointerDown({ x: 200, y: 240 });
    });
    act(() => {
      onEmpty = hook.result.current.onPointerDown({ x: 450, y: 390 });
    });

    expect(onObject).toBe(true);
    expect(onEmpty).toBe(false);
  });

  it('does nothing while an export is running', () => {
    // §8.1 freezes the document, so a move must not even start.
    const { hook } = setup([square], false);

    act(() => hook.result.current.onPointerDown({ x: 200, y: 240 }));

    expect(hook.result.current.state.selectedId).toBeNull();
  });
});

describe('moving a committed object', () => {
  it('commits exactly one transaction for a whole drag', () => {
    const { hook, setDoc } = setup();

    act(() => hook.result.current.onPointerDown({ x: 200, y: 210 }));
    act(() => hook.result.current.onPointerMove({ x: 230, y: 240 }));
    act(() => hook.result.current.onPointerMove({ x: 250, y: 260 }));
    act(() => hook.result.current.onPointerUp());

    expect(setDoc).toHaveBeenCalledTimes(1);
    expect(setDoc.mock.calls[0][0].objects[0]).toMatchObject({ x: 250, y: 250 });
    expect(setDoc.mock.calls[0][0].past).toHaveLength(2);
  });

  it('keeps the in-progress move out of the document', () => {
    const { hook, setDoc } = setup();

    act(() => hook.result.current.onPointerDown({ x: 200, y: 210 }));
    act(() => hook.result.current.onPointerMove({ x: 250, y: 260 }));

    expect(hook.result.current.state.moving).toMatchObject({ id: 'r1', x: 250, y: 250 });
    expect(setDoc).not.toHaveBeenCalled();
  });

  it('rolls a cancelled move back without an undo entry', () => {
    // §5 of the amendment: a cancelled transform creates no undo entry.
    const { hook, setDoc } = setup();

    act(() => hook.result.current.onPointerDown({ x: 200, y: 210 }));
    act(() => hook.result.current.onPointerMove({ x: 250, y: 250 }));
    let cancelled = false;
    act(() => {
      cancelled = hook.result.current.cancelMove();
    });
    act(() => hook.result.current.onPointerUp());

    expect(cancelled).toBe(true);
    expect(hook.result.current.state.moving).toBeNull();
    expect(setDoc).not.toHaveBeenCalled();
  });

  it('commits nothing for a press that never moved', () => {
    const { hook, setDoc } = setup();

    act(() => hook.result.current.onPointerDown({ x: 200, y: 210 }));
    act(() => hook.result.current.onPointerUp());

    expect(setDoc).not.toHaveBeenCalled();
    expect(hook.result.current.state.selectedId).toBe('r1');
  });

  it('keeps the object inside the capture rectangle', () => {
    const { hook, setDoc } = setup();

    act(() => hook.result.current.onPointerDown({ x: 200, y: 210 }));
    act(() => hook.result.current.onPointerMove({ x: 10, y: 10 }));
    act(() => hook.result.current.onPointerUp());

    expect(setDoc.mock.calls[0][0].objects[0]).toMatchObject({ x: 100, y: 100 });
  });

  it('moves a pen stroke sample by sample, not just its box', () => {
    // Moving only the bounding box would leave the drawn stroke behind.
    const stroke: Annotation = {
      id: 'p1',
      kind: 'pen',
      x: 200,
      y: 200,
      width: 100,
      height: 0,
      color: '#f06445',
      strokeWidth: 4,
      points: [
        { x: 200, y: 200 },
        { x: 300, y: 200 }
      ]
    };
    const { hook, setDoc } = setup([stroke]);

    act(() => hook.result.current.onPointerDown({ x: 250, y: 200 }));
    act(() => hook.result.current.onPointerMove({ x: 260, y: 210 }));
    act(() => hook.result.current.onPointerUp());

    expect(setDoc.mock.calls[0][0].objects[0]).toMatchObject({
      x: 210,
      y: 210,
      points: [
        { x: 210, y: 210 },
        { x: 310, y: 210 }
      ]
    });
  });

  it('moves a mosaic block by block, so the mask follows the object', () => {
    const mask: Annotation = {
      id: 'm1',
      kind: 'mosaic',
      x: 208,
      y: 208,
      width: 16,
      height: 16,
      color: '#211f1c',
      blockSize: 16,
      blocks: [{ x: 208, y: 208, width: 16, height: 16 }]
    };
    const { hook, setDoc } = setup([mask]);

    act(() => hook.result.current.onPointerDown({ x: 210, y: 210 }));
    act(() => hook.result.current.onPointerMove({ x: 220, y: 210 }));
    act(() => hook.result.current.onPointerUp());

    expect(setDoc.mock.calls[0][0].objects[0]).toMatchObject({
      blocks: [{ x: 218, y: 208, width: 16, height: 16 }]
    });
  });

  it('keeps the painting order when an object is moved', () => {
    // Re-appending the moved object would change which shape covers which.
    const other: Annotation = { ...square, id: 'r2', x: 250, y: 250 };
    const { hook, setDoc } = setup([square, other]);

    act(() => hook.result.current.onPointerDown({ x: 200, y: 240 }));
    act(() => hook.result.current.onPointerMove({ x: 215, y: 240 }));
    act(() => hook.result.current.onPointerUp());

    expect(setDoc.mock.calls[0][0].objects.map((object) => object.id)).toEqual(['r1', 'r2']);
  });
});

describe('deleting and nudging', () => {
  it('deletes the selected object as one transaction and clears the selection', () => {
    const { hook, setDoc } = setup();
    act(() => hook.result.current.onPointerDown({ x: 200, y: 240 }));

    let deleted = false;
    act(() => {
      deleted = hook.result.current.deleteSelected();
    });

    expect(deleted).toBe(true);
    expect(setDoc.mock.calls[0][0].objects).toEqual([]);
    expect(hook.result.current.state.selectedId).toBeNull();
  });

  it('deletes nothing when nothing is selected', () => {
    const { hook, setDoc } = setup();

    let deleted = true;
    act(() => {
      deleted = hook.result.current.deleteSelected();
    });

    expect(deleted).toBe(false);
    expect(setDoc).not.toHaveBeenCalled();
  });

  it('nudges the selected object by whole pixels', () => {
    const { hook, setDoc } = setup();
    act(() => hook.result.current.onPointerDown({ x: 200, y: 240 }));

    act(() => {
      hook.result.current.nudge(10, 0);
    });

    expect(setDoc.mock.calls[0][0].objects[0]).toMatchObject({ x: 210, y: 200 });
  });

  it('consumes an arrow key that cannot move further, so the selection does not move instead', () => {
    const edge: Annotation = { ...square, x: 100, y: 100 };
    const { hook, setDoc } = setup([edge]);
    act(() => hook.result.current.onPointerDown({ x: 100, y: 140 }));

    let consumed = false;
    act(() => {
      consumed = hook.result.current.nudge(-5, 0);
    });

    expect(consumed).toBe(true);
    expect(setDoc).not.toHaveBeenCalled();
  });
});

describe('re-editing text', () => {
  it('opens the editor seeded with the object’s own content', () => {
    const { hook } = setup([note]);

    let opened = false;
    act(() => {
      opened = hook.result.current.beginTextEdit({ x: 200, y: 160 });
    });

    expect(opened).toBe(true);
    expect(hook.result.current.state.editingText).toMatchObject({
      id: 't1',
      initialContent: 'before',
      fontSize: 24
    });
  });

  it('refuses to open an editor on a shape', () => {
    const { hook } = setup();

    let opened = true;
    act(() => {
      opened = hook.result.current.beginTextEdit({ x: 200, y: 240 });
    });

    expect(opened).toBe(false);
    expect(hook.result.current.state.editingText).toBeNull();
  });

  it('updates the same object in place rather than adding a second one', () => {
    const { hook, setDoc } = setup([note]);
    act(() => hook.result.current.beginTextEdit({ x: 200, y: 160 }));

    act(() => hook.result.current.commitTextEdit('after'));

    const committed = setDoc.mock.calls[0][0].objects;
    expect(committed).toHaveLength(1);
    expect(committed[0]).toMatchObject({ id: 't1', content: 'after' });
  });

  it('writes no transaction when the text is unchanged', () => {
    // Clicking away without typing must not leave an undo step behind.
    const { hook, setDoc } = setup([note]);
    act(() => hook.result.current.beginTextEdit({ x: 200, y: 160 }));

    act(() => hook.result.current.commitTextEdit('before'));

    expect(setDoc).not.toHaveBeenCalled();
    expect(hook.result.current.state.editingText).toBeNull();
  });

  it('deletes the object when its text is emptied', () => {
    // §5.3: text with no visible content is not an object.
    const { hook, setDoc } = setup([note]);
    act(() => hook.result.current.beginTextEdit({ x: 200, y: 160 }));

    act(() => hook.result.current.commitTextEdit('   '));

    expect(setDoc.mock.calls[0][0].objects).toEqual([]);
    expect(hook.result.current.state.selectedId).toBeNull();
  });

  it('discards an edit on cancel', () => {
    const { hook, setDoc } = setup([note]);
    act(() => hook.result.current.beginTextEdit({ x: 200, y: 160 }));

    act(() => hook.result.current.cancelTextEdit());

    expect(hook.result.current.state.editingText).toBeNull();
    expect(setDoc).not.toHaveBeenCalled();
  });

  it('opens the editor for the selected object, for Enter', () => {
    const { hook } = setup([note]);
    act(() => hook.result.current.onPointerDown({ x: 200, y: 160 }));

    let opened = false;
    act(() => {
      opened = hook.result.current.beginTextEditOfSelection();
    });

    expect(opened).toBe(true);
    expect(hook.result.current.state.editingText?.id).toBe('t1');
  });
});

describe('reconciling with the document', () => {
  it('drops a selection whose object undo removed', () => {
    // Keeping it would draw a frame around an object no longer in the picture.
    const { hook, doc } = setup();
    act(() => hook.result.current.onPointerDown({ x: 200, y: 240 }));
    expect(hook.result.current.state.selectedId).toBe('r1');

    act(() => hook.result.current.reconcile(undo(doc)));

    expect(hook.result.current.state.selectedId).toBeNull();
  });

  it('keeps a selection whose object is still there', () => {
    const { hook, doc } = setup();
    act(() => hook.result.current.onPointerDown({ x: 200, y: 240 }));

    act(() => hook.result.current.reconcile(doc));

    expect(hook.result.current.state.selectedId).toBe('r1');
  });
});

describe('restyling a committed object', () => {
  it('recolours the selected shape in place', () => {
    // The property panel used to set defaults for the next shape only, which is
    // what made a drawn rectangle feel permanent.
    const harness = setup();
    const { hook, rerender } = harness;
    act(() => void hook.result.current.onPointerDown({ x: 200, y: 200 }));
    act(() => hook.result.current.onPointerUp());
    rerender();

    act(() => void hook.result.current.restyleSelected('color', '#4f55da'));

    expect(harness.doc.objects).toHaveLength(1);
    expect(harness.doc.objects[0]).toMatchObject({ id: 'r1', color: '#4f55da' });
    // One undo step, and undo restores the old colour rather than the shape.
    expect(harness.doc.past).toHaveLength(2);
    const back = undo(harness.doc);
    expect(back.objects[0]).toMatchObject({ id: 'r1', color: '#f06445' });
  });

  it('keeps the drawing order when restyling, so nothing jumps to the front', () => {
    const behind: Annotation = { ...square, id: 'r0', x: 120, y: 120 };
    const harness = setup([behind, square]);
    const { hook, rerender } = harness;
    act(() => void hook.result.current.onPointerDown({ x: 120, y: 120 }));
    act(() => hook.result.current.onPointerUp());
    rerender();

    act(() => void hook.result.current.restyleSelected('strokeWidth', 8));

    expect(harness.doc.objects.map((object) => object.id)).toEqual(['r0', 'r1']);
    expect(harness.doc.objects[0]).toMatchObject({ strokeWidth: 8 });
  });

  it('re-measures a text box when the font size changes', () => {
    // The box is the hit area. Leaving it at the old size would make the enlarged
    // text ungrabbable over the part that grew.
    const harness = setup([note]);
    const { hook, rerender } = harness;
    act(() => void hook.result.current.onPointerDown({ x: 160, y: 160 }));
    act(() => hook.result.current.onPointerUp());
    rerender();

    act(() => void hook.result.current.restyleSelected('fontSize', 32));

    const updated = harness.doc.objects[0];
    expect(updated).toMatchObject({ kind: 'text', fontSize: 32 });
    expect(updated.width).toBeGreaterThan(note.width);
    expect(updated.height).toBeGreaterThan(note.height);
  });

  it('refuses a row that does not belong to the kind', () => {
    // A font size on a rectangle must not quietly invent a field, so the caller
    // falls back to changing the tool default instead.
    const harness = setup();
    const { hook, rerender, setDoc } = harness;
    act(() => void hook.result.current.onPointerDown({ x: 200, y: 200 }));
    act(() => hook.result.current.onPointerUp());
    rerender();
    setDoc.mockClear();

    let changed = true;
    act(() => {
      changed = hook.result.current.restyleSelected('fontSize', 32);
    });

    expect(changed).toBe(false);
    expect(setDoc).not.toHaveBeenCalled();
  });

  it('does nothing when no object is selected', () => {
    const { hook, setDoc } = setup();

    let changed = true;
    act(() => {
      changed = hook.result.current.restyleSelected('color', '#4f55da');
    });

    expect(changed).toBe(false);
    expect(setDoc).not.toHaveBeenCalled();
  });
});

describe('resizing a committed object by its handles', () => {
  it('drags a corner grip and commits one undo step', () => {
    const harness = setup();
    const { hook, rerender } = harness;
    // Select first: grips belong to the selected object.
    act(() => void hook.result.current.onPointerDown({ x: 200, y: 200 }));
    act(() => hook.result.current.onPointerUp());
    rerender();

    // The south-east grip of a 200,200 200x100 square sits at 300,280.
    act(() => void hook.result.current.onPointerDown({ x: 300, y: 280 }));
    act(() => hook.result.current.onPointerMove({ x: 360, y: 320 }));
    rerender();
    // Visible before it is committed.
    expect(hook.result.current.state.moving).toMatchObject({ width: 160, height: 120 });
    act(() => hook.result.current.onPointerUp());

    expect(harness.doc.objects).toHaveLength(1);
    expect(harness.doc.objects[0]).toMatchObject({ x: 200, y: 200, width: 160, height: 120 });
    // One step, and undo restores the old size rather than removing the shape.
    const back = undo(harness.doc);
    expect(back.objects[0]).toMatchObject({ width: 100, height: 80 });
  });

  it('keeps the selection while resizing', () => {
    const harness = setup();
    const { hook, rerender } = harness;
    act(() => void hook.result.current.onPointerDown({ x: 200, y: 200 }));
    act(() => hook.result.current.onPointerUp());
    rerender();

    act(() => void hook.result.current.onPointerDown({ x: 300, y: 280 }));
    act(() => hook.result.current.onPointerMove({ x: 340, y: 300 }));

    expect(hook.result.current.state.selectedId).toBe('r1');
    expect(hook.result.current.state.draggingHandle).toBe('se');
  });

  it('rolls a resize back with no undo entry', () => {
    // §5 of the amendment: a cancelled transform leaves no history behind.
    const harness = setup();
    const { hook, rerender } = harness;
    act(() => void hook.result.current.onPointerDown({ x: 200, y: 200 }));
    act(() => hook.result.current.onPointerUp());
    rerender();
    const before = harness.doc;

    act(() => void hook.result.current.onPointerDown({ x: 300, y: 280 }));
    act(() => hook.result.current.onPointerMove({ x: 400, y: 400 }));
    act(() => void hook.result.current.cancelMove());

    expect(harness.doc).toBe(before);
    expect(hook.result.current.state.moving).toBeNull();
    expect(hook.result.current.state.draggingHandle).toBeNull();
  });

  it('prefers a grip over a shape stacked on top of it', () => {
    // Otherwise the grips of a shape under another one — the hardest ones to
    // reach — would be the first to stop working.
    const cover: Annotation = { ...square, id: 'r2', x: 280, y: 260, width: 120, height: 90 };
    const harness = setup([square, cover]);
    const { hook, rerender } = harness;
    act(() => void hook.result.current.onPointerDown({ x: 200, y: 200 }));
    act(() => hook.result.current.onPointerUp());
    rerender();

    // 300,280 is the square's "se" grip and also inside the covering shape.
    act(() => void hook.result.current.onPointerDown({ x: 300, y: 280 }));
    act(() => hook.result.current.onPointerMove({ x: 340, y: 300 }));
    rerender();

    expect(hook.result.current.state.selectedId).toBe('r1');
    expect(hook.result.current.state.moving?.id).toBe('r1');
  });

  it('reports the grip under the pointer for the cursor', () => {
    const { hook, rerender } = setup();
    expect(hook.result.current.handleAt({ x: 300, y: 280 })).toBeNull();

    act(() => void hook.result.current.onPointerDown({ x: 200, y: 200 }));
    act(() => hook.result.current.onPointerUp());
    rerender();

    expect(hook.result.current.handleAt({ x: 300, y: 280 })).toBe('se');
    expect(hook.result.current.handleAt({ x: 250, y: 240 })).toBeNull();
  });

  it('offers no grips on a text object', () => {
    const { hook, rerender } = setup([note]);
    act(() => void hook.result.current.onPointerDown({ x: 160, y: 160 }));
    act(() => hook.result.current.onPointerUp());
    rerender();

    expect(hook.result.current.handleAt({ x: note.x, y: note.y })).toBeNull();
  });
});
