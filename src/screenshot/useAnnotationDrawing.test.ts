import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  addAnnotation,
  emptyDocument,
  type Annotation,
  type AnnotationDocument
} from './annotation-document';
import { defaultProperties } from './tool-properties';
import { useAnnotationDrawing } from './useAnnotationDrawing';
import type { ToolId } from './toolbar-model';

const selection = { x: 100, y: 100, width: 400, height: 300 };

/// Stable ids, so a committed object can be identified.
function ids() {
  let next = 0;
  return () => `a${(next += 1)}`;
}

function setup(tool: ToolId, initial: AnnotationDocument = emptyDocument()) {
  let doc = initial;
  const setDoc = vi.fn((next: AnnotationDocument) => {
    doc = next;
  });
  const hook = renderHook(() =>
    useAnnotationDrawing(tool, defaultProperties(), selection, doc, setDoc, ids())
  );
  return { hook, setDoc, get doc() { return doc; } };
}

describe('drawing a shape', () => {
  it('commits exactly one transaction for a whole drag', () => {
    // §5.3: one drag is one undo step.
    const { hook, setDoc, doc } = setup('rect');

    act(() => hook.result.current.onPointerDown({ x: 150, y: 150 }));
    act(() => hook.result.current.onPointerMove({ x: 200, y: 200 }));
    act(() => hook.result.current.onPointerMove({ x: 250, y: 250 }));
    act(() => hook.result.current.onPointerUp());

    expect(setDoc).toHaveBeenCalledTimes(1);
    void doc;
  });

  it('keeps the in-progress shape out of the document', () => {
    const { hook, setDoc } = setup('rect');

    act(() => hook.result.current.onPointerDown({ x: 150, y: 150 }));
    act(() => hook.result.current.onPointerMove({ x: 250, y: 250 }));

    // Visible as a draft, but not yet a transaction.
    expect(hook.result.current.state.draft).toMatchObject({
      kind: 'rect',
      x: 150,
      y: 150,
      width: 100,
      height: 100
    });
    expect(setDoc).not.toHaveBeenCalled();
  });

  it('normalises a shape dragged up and to the left', () => {
    const { hook } = setup('ellipse');

    act(() => hook.result.current.onPointerDown({ x: 250, y: 250 }));
    act(() => hook.result.current.onPointerMove({ x: 150, y: 150 }));

    expect(hook.result.current.state.draft).toMatchObject({ x: 150, y: 150, width: 100, height: 100 });
  });

  it('keeps an arrow pointing the way it was dragged', () => {
    // Normalising an arrow would reverse its head.
    const { hook } = setup('arrow');

    act(() => hook.result.current.onPointerDown({ x: 250, y: 250 }));
    act(() => hook.result.current.onPointerMove({ x: 150, y: 200 }));

    expect(hook.result.current.state.draft).toMatchObject({
      kind: 'arrow',
      x: 250,
      y: 250,
      width: -100,
      height: -50
    });
  });

  it('records every point of a pen stroke but still one transaction', () => {
    const { hook, setDoc } = setup('pen');

    act(() => hook.result.current.onPointerDown({ x: 150, y: 150 }));
    for (let step = 0; step < 50; step += 1) {
      act(() => hook.result.current.onPointerMove({ x: 150 + step, y: 150 }));
    }
    act(() => hook.result.current.onPointerUp());

    expect(setDoc).toHaveBeenCalledTimes(1);
    const committed = setDoc.mock.calls[0][0].objects[0] as Extract<Annotation, { kind: 'pen' }>;
    expect(committed.points).toHaveLength(51);
  });

  it('gives a pen stroke a box that covers it', () => {
    const { hook, setDoc } = setup('pen');

    act(() => hook.result.current.onPointerDown({ x: 200, y: 200 }));
    act(() => hook.result.current.onPointerMove({ x: 150, y: 250 }));
    act(() => hook.result.current.onPointerMove({ x: 300, y: 180 }));
    act(() => hook.result.current.onPointerUp());

    expect(setDoc.mock.calls[0][0].objects[0]).toMatchObject({
      x: 150,
      y: 180,
      width: 150,
      height: 70
    });
  });

  it('clips a drag to the selection', () => {
    // §5.2 line 205: shapes are clipped to the output range.
    const { hook } = setup('rect');

    act(() => hook.result.current.onPointerDown({ x: 50, y: 50 }));
    act(() => hook.result.current.onPointerMove({ x: 9999, y: 9999 }));

    // Clamped to 100,100 and to the selection's last pixel, 499,399.
    expect(hook.result.current.state.draft).toMatchObject({
      x: 100,
      y: 100,
      width: 399,
      height: 299
    });
  });

  it('commits nothing for a click that never moved', () => {
    const { hook, setDoc } = setup('rect');

    act(() => hook.result.current.onPointerDown({ x: 150, y: 150 }));
    act(() => hook.result.current.onPointerUp());

    expect(setDoc).not.toHaveBeenCalled();
    expect(hook.result.current.state.draft).toBeNull();
  });

  it('commits a mosaic with the chosen block size', () => {
    const { hook, setDoc } = setup('mosaic');

    act(() => hook.result.current.onPointerDown({ x: 150, y: 150 }));
    act(() => hook.result.current.onPointerMove({ x: 250, y: 250 }));
    act(() => hook.result.current.onPointerUp());

    expect(setDoc.mock.calls[0][0].objects[0]).toMatchObject({ kind: 'mosaic', blockSize: 16 });
  });
});

describe('the text tool', () => {
  const existingText: Annotation = {
    id: 't1',
    kind: 'text',
    x: 150,
    y: 150,
    width: 120,
    height: 34,
    color: '#F06445',
    fontSize: 24,
    content: 'before'
  };

  it('opens an editor without creating an object', () => {
    const { hook, setDoc } = setup('text');

    act(() => hook.result.current.onPointerDown({ x: 150, y: 150 }));

    expect(hook.result.current.state.pendingText).toMatchObject({ x: 150, y: 150 });
    expect(setDoc).not.toHaveBeenCalled();
  });

  it('commits text with content', () => {
    const { hook, setDoc } = setup('text');

    act(() => hook.result.current.onPointerDown({ x: 150, y: 150 }));
    act(() => hook.result.current.commitText('hello'));

    expect(setDoc.mock.calls[0][0].objects[0]).toMatchObject({
      kind: 'text',
      content: 'hello',
      fontSize: 24
    });
    expect(hook.result.current.state.pendingText).toBeNull();
  });

  it('commits nothing for whitespace-only text', () => {
    // §5.3: text with no visible content is not an object.
    const { hook, setDoc } = setup('text');

    act(() => hook.result.current.onPointerDown({ x: 150, y: 150 }));
    act(() => hook.result.current.commitText('   \n  '));

    expect(setDoc).not.toHaveBeenCalled();
    expect(hook.result.current.state.pendingText).toBeNull();
  });

  it('discards the editor on cancel', () => {
    const { hook, setDoc } = setup('text');

    act(() => hook.result.current.onPointerDown({ x: 150, y: 150 }));
    act(() => hook.result.current.cancelText());

    expect(hook.result.current.state.pendingText).toBeNull();
    expect(setDoc).not.toHaveBeenCalled();
  });


});

describe('the select tool', () => {
  it('draws nothing with the select tool', () => {
    // Selecting and moving an object belongs to `useAnnotationEditing`, which hit tests
    // per object kind. This hook only has to stay out of the way.
    const { hook } = setup('select');

    act(() => hook.result.current.onPointerDown({ x: 150, y: 150 }));
    act(() => hook.result.current.onPointerMove({ x: 250, y: 250 }));

    expect(hook.result.current.state.draft).toBeNull();
  });

  it('does not touch the document with the select tool', () => {
    // The press is handled before it reaches this hook, so writing anything here would
    // be a second owner of selection state.
    const { hook, setDoc } = setup('select');

    act(() => hook.result.current.onPointerDown({ x: 150, y: 150 }));
    act(() => hook.result.current.onPointerUp());

    expect(setDoc).not.toHaveBeenCalled();
  });
});
