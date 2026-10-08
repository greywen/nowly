import { useEffect, useRef } from 'react';
import { dispatchKey, type KeyAction, type KeyContext } from './key-dispatch';

// The one keyboard listener for a capture window.
//
// §7 of docs/superpowers/specs/2026-09-25-nowly-screenshot-design.md gives every
// key exactly one owner, and `key-dispatch.ts` decides who that is. This hook only
// feeds it real events and applies the result, so the priority rules stay testable
// without a DOM.

/// Actions this hook consumes. Anything it defers keeps its native behaviour.
const DEFERRED: readonly KeyAction['type'][] = [
  'deferToDialog',
  'deferToIme',
  'deferToText',
  'deferToControl',
  'ignore'
];

export function useCaptureKeyboard(
  context: KeyContext,
  onAction: (action: KeyAction) => void
) {
  // Read through refs, so the listener is installed once and still sees current
  // state: re-registering on every state change would drop a keypress in between.
  const contextRef = useRef(context);
  const actionRef = useRef(onAction);
  contextRef.current = context;
  actionRef.current = onAction;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target instanceof Element ? event.target : null;
      const focusedControl = target?.closest(
        'button, input, select, textarea, [contenteditable="true"], [role="toolbar"]'
      );
      const action = dispatchKey(
        {
          key: event.key,
          ctrl: event.ctrlKey,
          shift: event.shiftKey,
          alt: event.altKey
        },
        // `isComposing` is only knowable from the event, so it is merged in here
        // rather than tracked in React state that could lag a keystroke.
        {
          ...contextRef.current,
          composing: contextRef.current.composing || event.isComposing,
          focus: focusedControl ? 'control' : contextRef.current.focus
        }
      );

      if (DEFERRED.includes(action.type)) {
        // Not ours. In particular Tab keeps moving focus and a text control keeps
        // its own editing and clipboard behaviour.
        return;
      }

      // Only a key we actually consume is prevented, so nothing silently swallows
      // keys that still need to reach the browser or a control.
      event.preventDefault();
      actionRef.current(action);
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
