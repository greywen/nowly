import { describe, expect, it } from 'vitest';
import { dispatchKey, type KeyContext } from './key-dispatch';

function context(overrides: Partial<KeyContext> = {}): KeyContext {
  return {
    phase: 'editing',
    saveDialogOpen: false,
    composing: false,
    textEditing: false,
    popoverOpen: false,
    draftInProgress: false,
    selectedObject: null,
    focus: 'canvas',
    annotationCount: 0,
    toolActive: false,
    ...overrides
  };
}

describe('key dispatch priority', () => {
  it('gives everything to an open save dialog', () => {
    // Highest rung: even a composition or a text control does not outrank it.
    const ctx = context({ saveDialogOpen: true, composing: true, textEditing: true });

    for (const key of ['Escape', 'Enter', 'c', 's']) {
      expect(dispatchKey({ key, ctrl: true }, ctx)).toEqual({ type: 'deferToDialog' });
    }
  });

  it('gives Esc, Enter and Ctrl+S to an unfinished composition', () => {
    // §7: Enter/Esc must not finish the capture, and Ctrl+S must not save a
    // half-typed candidate.
    const ctx = context({ composing: true, textEditing: true });

    expect(dispatchKey({ key: 'Escape' }, ctx)).toEqual({ type: 'deferToIme' });
    expect(dispatchKey({ key: 'Enter' }, ctx)).toEqual({ type: 'deferToIme' });
    expect(dispatchKey({ key: 's', ctrl: true }, ctx)).toEqual({ type: 'deferToIme' });
  });

  it('keeps text editing local, with no clipboard or history side effect', () => {
    const ctx = context({ textEditing: true });

    // Ctrl+C/X/V/Z/Y belong to the text control, not to the image or history.
    for (const key of ['c', 'x', 'v', 'z', 'y']) {
      expect(dispatchKey({ key, ctrl: true }, ctx)).toEqual({ type: 'deferToText' });
    }
    expect(dispatchKey({ key: 'Enter' }, ctx)).toEqual({ type: 'newline' });
    expect(dispatchKey({ key: 'Enter', ctrl: true }, ctx)).toEqual({ type: 'commitText' });
    expect(dispatchKey({ key: 'Escape' }, ctx)).toEqual({ type: 'cancelTextEdit' });
    expect(dispatchKey({ key: 'Backspace' }, ctx)).toEqual({ type: 'deferToText' });
  });

  it('closes an open popover before reaching the draft or the session', () => {
    const ctx = context({ popoverOpen: true, draftInProgress: true });

    expect(dispatchKey({ key: 'Escape' }, ctx)).toEqual({ type: 'closePopover' });
  });

  it('dismisses the active drawing tool before cancelling the session', () => {
    expect(dispatchKey({ key: 'Escape' }, context({ toolActive: true }))).toEqual({
      type: 'dismissTool'
    });
  });

  it('gives the selected object Esc, Delete and the arrows', () => {
    // §7's "selected annotation" rung sits above the capture's main state, so a
    // local edit never also exports or ends the session.
    const ctx = context({ selectedObject: { id: 'r1', kind: 'other' } });

    expect(dispatchKey({ key: 'Escape' }, ctx)).toEqual({ type: 'deselectObject' });
    expect(dispatchKey({ key: 'Delete' }, ctx)).toEqual({ type: 'deleteObject' });
    expect(dispatchKey({ key: 'Backspace' }, ctx)).toEqual({ type: 'deleteObject' });
    expect(dispatchKey({ key: 'ArrowRight' }, ctx)).toEqual({
      type: 'moveObject',
      dx: 1,
      dy: 0
    });
    expect(dispatchKey({ key: 'ArrowUp', shift: true }, ctx)).toEqual({
      type: 'moveObject',
      dx: 0,
      dy: -10
    });
  });

  it('re-enters text editing on Enter, but only for a text object', () => {
    expect(
      dispatchKey({ key: 'Enter' }, context({ selectedObject: { id: 't1', kind: 'text' } }))
    ).toEqual({ type: 'editSelectedText' });
    // Any other kind has nothing to edit, so Enter keeps finishing the capture.
    expect(
      dispatchKey({ key: 'Enter' }, context({ selectedObject: { id: 'r1', kind: 'other' } }))
    ).toEqual({ type: 'copyImageAndFinish' });
  });

  it('keeps a focused control’s own keys even with an object selected', () => {
    const ctx = context({ selectedObject: { id: 'r1', kind: 'other' }, focus: 'control' });

    expect(dispatchKey({ key: 'Backspace' }, ctx)).toEqual({ type: 'deferToControl' });
    expect(dispatchKey({ key: 'Enter' }, ctx)).toEqual({ type: 'deferToControl' });
  });

  it('cancels an in-progress move before clearing the selection', () => {
    // One Esc consumes exactly one layer: the uncommitted transform first.
    const ctx = context({
      selectedObject: { id: 'r1', kind: 'other' },
      draftInProgress: true
    });

    expect(dispatchKey({ key: 'Escape' }, ctx)).toEqual({ type: 'cancelDraft' });
  });

  it('never navigates back on a stray Delete or Backspace', () => {
    // §7: with nothing selected the key is explicitly nobody's, not the WebView's.
    expect(dispatchKey({ key: 'Backspace' }, context())).toEqual({ type: 'ignore' });
    expect(dispatchKey({ key: 'Delete' }, context())).toEqual({ type: 'ignore' });
  });

  it('never exports an uncommitted draft', () => {
    const ctx = context({ draftInProgress: true });

    // §7: Ctrl+C during a drag or stroke must not touch the clipboard.
    expect(dispatchKey({ key: 'c', ctrl: true }, ctx)).toEqual({ type: 'ignore' });
    expect(dispatchKey({ key: 'Enter' }, ctx)).toEqual({ type: 'ignore' });
    expect(dispatchKey({ key: 'Escape' }, ctx)).toEqual({ type: 'cancelDraft' });
    // There is no synchronous commit path, so save also waits for release.
    expect(dispatchKey({ key: 's', ctrl: true }, ctx)).toEqual({ type: 'ignore' });
  });


});

describe('main state keys', () => {
  it('copies the colour while aiming and the image while editing', () => {
    expect(dispatchKey({ key: 'c', ctrl: true }, context({ phase: 'aiming' }))).toEqual({
      type: 'copyHex'
    });
    expect(dispatchKey({ key: 'c', ctrl: true }, context({ phase: 'editing' }))).toEqual({
      type: 'copyImageAndFinish'
    });
  });

  it('saves only while editing', () => {
    expect(dispatchKey({ key: 's', ctrl: true }, context({ phase: 'editing' }))).toEqual({
      type: 'savePng'
    });
    expect(dispatchKey({ key: 's', ctrl: true }, context({ phase: 'aiming' }))).toEqual({
      type: 'ignore'
    });
  });

  it.each(['scrollPrepare', 'scrolling', 'scrollPaused', 'scrollReview'] as const)(
    'exports nothing from %s',
    (phase) => {
      // §7: no scroll phase may export before the result is accepted.
      expect(dispatchKey({ key: 'c', ctrl: true }, context({ phase }))).toEqual({
        type: 'ignore'
      });
      expect(dispatchKey({ key: 's', ctrl: true }, context({ phase }))).toEqual({
        type: 'ignore'
      });
      expect(dispatchKey({ key: 'Enter' }, context({ phase }))).toEqual({ type: 'ignore' });
    }
  );

  it('dispatches undo and redo three ways', () => {
    const ctx = context();

    expect(dispatchKey({ key: 'z', ctrl: true }, ctx)).toEqual({ type: 'undo' });
    expect(dispatchKey({ key: 'z', ctrl: true, shift: true }, ctx)).toEqual({ type: 'redo' });
    expect(dispatchKey({ key: 'y', ctrl: true }, ctx)).toEqual({ type: 'redo' });
  });

  it('finishes on Enter from the canvas but not from a button', () => {
    expect(dispatchKey({ key: 'Enter' }, context({ focus: 'canvas' }))).toEqual({
      type: 'copyImageAndFinish'
    });
    expect(dispatchKey({ key: 'Enter' }, context({ focus: 'control' }))).toEqual({
      type: 'deferToControl'
    });
  });

  it('moves and resizes an unannotated selection with the arrows', () => {
    const ctx = context();

    expect(dispatchKey({ key: 'ArrowRight' }, ctx)).toEqual({
      type: 'moveSelection',
      dx: 1,
      dy: 0
    });
    expect(dispatchKey({ key: 'ArrowRight', shift: true }, ctx)).toEqual({
      type: 'moveSelection',
      dx: 10,
      dy: 0
    });
    expect(dispatchKey({ key: 'ArrowRight', alt: true }, ctx)).toEqual({
      type: 'resizeSelection',
      dx: 1,
      dy: 0
    });
  });

  it('stops moving the selection once an annotation exists', () => {
    // The first committed annotation locks the capture rectangle.
    const ctx = context({ annotationCount: 1 });

    expect(dispatchKey({ key: 'ArrowRight' }, ctx)).toEqual({ type: 'ignore' });
    expect(dispatchKey({ key: 'ArrowRight', alt: true }, ctx)).toEqual({ type: 'ignore' });
  });



  it.each([
    ['aiming', 'cancelSession'],
    ['editing', 'cancelSession'],
    ['scrollPrepare', 'leaveScrollPrepare'],
    ['scrolling', 'stopScrollAndReview'],
    ['scrollPaused', 'stopScrollAndReview'],
    ['scrollReview', 'discardLongImage']
  ] as const)('Esc in %s consumes exactly one layer', (phase, type) => {
    expect(dispatchKey({ key: 'Escape' }, context({ phase }))).toEqual({ type });
  });

  it('ignores an unrelated key instead of letting it fall through', () => {
    expect(dispatchKey({ key: 'F5' }, context())).toEqual({ type: 'ignore' });
    expect(dispatchKey({ key: 'a' }, context())).toEqual({ type: 'ignore' });
  });
});
