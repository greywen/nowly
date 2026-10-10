import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { KeyAction, KeyContext } from './key-dispatch';
import { useCaptureKeyboard } from './useCaptureKeyboard';

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

function press(init: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  window.dispatchEvent(event);
  return event;
}

function setup(overrides: Partial<KeyContext> = {}) {
  const actions: KeyAction[] = [];
  const hook = renderHook((props: { context: KeyContext }) =>
    useCaptureKeyboard(props.context, (action) => actions.push(action)),
    { initialProps: { context: context(overrides) } }
  );
  return { actions, hook };
}

describe('the capture keyboard', () => {
  it('applies a consumed key and prevents its default', () => {
    const { actions } = setup();

    const event = press({ key: 'z', ctrlKey: true });

    expect(actions).toEqual([{ type: 'undo' }]);
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves a deferred key alone', () => {
    // A text control keeps its own clipboard and editing behaviour, so the event
    // must reach it unprevented.
    const { actions } = setup({ textEditing: true });

    const event = press({ key: 'c', ctrlKey: true });

    expect(actions).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });

  it('never blocks Tab, so focus can still move', () => {
    // Tab resolves to `ignore`, and preventing it would trap keyboard users.
    const { actions } = setup();

    const event = press({ key: 'Tab' });

    expect(actions).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });

  it.each([
    ['button', 'button'],
    ['input', 'input'],
    ['select', 'select'],
    ['textarea', 'textarea'],
    ['toolbar', 'div']
  ])('derives control focus from a focused %s event target', (name, tagName) => {
    const { actions } = setup();
    const control = document.createElement(tagName);
    if (name === 'toolbar') control.setAttribute('role', 'toolbar');
    document.body.append(control);

    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true
    });
    control.dispatchEvent(event);
    control.remove();

    expect(actions).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });

  it('reads isComposing from the event, not from state', () => {
    // An IME composition is only knowable from the event; state could lag a
    // keystroke and let Enter finish the capture mid-composition.
    const { actions } = setup();

    press({ key: 'Enter', isComposing: true });

    expect(actions).toEqual([]);
  });

  it('sees updated context without missing a key', () => {
    const actions: KeyAction[] = [];
    const { rerender } = renderHook(
      (props: { context: KeyContext }) =>
        useCaptureKeyboard(props.context, (action) => actions.push(action)),
      { initialProps: { context: context({ phase: 'aiming' }) } }
    );

    press({ key: 'c', ctrlKey: true });
    rerender({ context: context({ phase: 'editing' }) });
    press({ key: 'c', ctrlKey: true });

    // Aiming copies the colour, editing copies the image.
    expect(actions).toEqual([{ type: 'copyHex' }, { type: 'copyImageAndFinish' }]);
  });

  it('reports the arrow keys with their modifiers', () => {
    const { actions } = setup();

    press({ key: 'ArrowRight', shiftKey: true });
    press({ key: 'ArrowRight', altKey: true });

    expect(actions).toEqual([
      { type: 'moveSelection', dx: 10, dy: 0 },
      { type: 'resizeSelection', dx: 1, dy: 0 }
    ]);
  });

  it('stops listening once unmounted', () => {
    const onAction = vi.fn();
    const { unmount } = renderHook(() => useCaptureKeyboard(context(), onAction));

    unmount();
    press({ key: 'z', ctrlKey: true });

    expect(onAction).not.toHaveBeenCalled();
  });
});
