// Which single handler owns a key press.
//
// §7 of docs/superpowers/specs/2026-09-25-nowly-screenshot-design.md fixes the
// priority: system save dialog → IME composition → text control → open property
// popover → current draw/drag → selected annotation → capture main state.
//
// This is written as guard clauses in exactly that order, because the rule the
// spec cares about is that every key has exactly one owner: a local edit must
// never also produce a clipboard or file side effect.

export type CapturePhase =
  | 'aiming'
  | 'editing'
  | 'scrollPrepare'
  | 'scrolling'
  | 'scrollPaused'
  | 'scrollReview';

export type KeyContext = {
  phase: CapturePhase;
  /// A native save dialog is up and owns everything.
  saveDialogOpen: boolean;
  /// An unfinished IME composition. Owns Esc and Enter before anything else.
  composing: boolean;
  /// A text control has focus, including the annotation text editor.
  textEditing: boolean;
  popoverOpen: boolean;
  /// An uncommitted selection drag, pen stroke or object transform.
  draftInProgress: boolean;
  /// The committed object the canvas has selected, if any. `kind` decides whether
  /// Enter re-enters text editing, so the id alone is not enough.
  selectedObject: { id: string; kind: 'text' | 'other' } | null;
  focus: 'canvas' | 'control';
  annotationCount: number;
  toolActive: boolean;
};

export type KeyAction =
  | { type: 'deferToDialog' }
  | { type: 'deferToIme' }
  | { type: 'deferToText' }
  | { type: 'deferToControl' }
  /// Explicitly nobody's: must not fall through to a global handler.
  | { type: 'ignore' }
  | { type: 'copyHex' }
  | { type: 'copyImageAndFinish' }
  | { type: 'savePng' }
  | { type: 'newline' }
  | { type: 'commitText' }
  | { type: 'cancelTextEdit' }
  | { type: 'closePopover' }
  | { type: 'cancelDraft' }
  | { type: 'dismissTool' }
  | { type: 'deselectObject' }
  | { type: 'deleteObject' }
  | { type: 'moveObject'; dx: number; dy: number }
  | { type: 'editSelectedText' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'moveSelection'; dx: number; dy: number }
  | { type: 'resizeSelection'; dx: number; dy: number }
  | { type: 'cancelSession' }
  | { type: 'leaveScrollPrepare' }
  | { type: 'stopScrollAndReview' }
  | { type: 'discardLongImage' };

export type KeyPress = {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
};

const ARROWS: Record<string, { dx: number; dy: number }> = {
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowRight: { dx: 1, dy: 0 },
  ArrowUp: { dx: 0, dy: -1 },
  ArrowDown: { dx: 0, dy: 1 }
};

export function dispatchKey(press: KeyPress, context: KeyContext): KeyAction {
  const { key, ctrl = false, shift = false, alt = false } = press;

  // 1. The native dialog owns everything while it is up.
  if (context.saveDialogOpen) return { type: 'deferToDialog' };

  // 2. An unfinished composition owns Esc and Enter, so neither finishes the
  //    capture, and Ctrl+S must not commit a half-typed candidate.
  if (context.composing) return { type: 'deferToIme' };

  // 3. A text control handles its own editing and its own clipboard, without
  //    touching the image or the annotation history.
  if (context.textEditing) {
    if (key === 'Escape') return { type: 'cancelTextEdit' };
    if (key === 'Enter') return ctrl ? { type: 'commitText' } : { type: 'newline' };
    return { type: 'deferToText' };
  }

  // 4. An open popover owns Esc. Its own controls receive other keys through
  //    normal focus management rather than through this dispatcher.
  if (context.popoverOpen && key === 'Escape') return { type: 'closePopover' };

  // 5. An uncommitted draft: Esc reverts it, and nothing may export it.
  if (context.draftInProgress) {
    if (key === 'Escape') return { type: 'cancelDraft' };
    if (
      key === 'Enter' ||
      (ctrl && (key === 'c' || key === 'C' || key === 's' || key === 'S'))
    ) {
      return { type: 'ignore' };
    }
  }

  if (context.toolActive && key === 'Escape') return { type: 'dismissTool' };

  // 6. The selected object: its own rung, above the capture's main state, so a
  //    local edit never also exports or ends the session.
  if (context.selectedObject && context.focus === 'canvas') {
    if (key === 'Escape') return { type: 'deselectObject' };
    if (key === 'Delete' || key === 'Backspace') return { type: 'deleteObject' };
    if (key === 'Enter' && context.selectedObject.kind === 'text') {
      return { type: 'editSelectedText' };
    }
    const arrow = ARROWS[key];
    if (arrow) {
      const step = shift ? 10 : 1;
      return { type: 'moveObject', dx: arrow.dx * step, dy: arrow.dy * step };
    }
  }

  // Delete with nothing selected is explicitly nobody's: §7 forbids it navigating
  // back, which is what an unhandled Backspace would do in a WebView.
  if (key === 'Delete' || key === 'Backspace') {
    return context.focus === 'control' ? { type: 'deferToControl' } : { type: 'ignore' };
  }

  // 7. The capture main state.
  if (key === 'Escape') return escapeForPhase(context.phase);

  if (ctrl && (key === 'z' || key === 'Z')) {
    return shift ? { type: 'redo' } : { type: 'undo' };
  }
  if (ctrl && (key === 'y' || key === 'Y')) return { type: 'redo' };

  if (ctrl && (key === 'c' || key === 'C')) {
    if (context.focus === 'control') return { type: 'deferToControl' };
    if (context.phase === 'aiming') return { type: 'copyHex' };
    if (context.phase === 'editing') return { type: 'copyImageAndFinish' };
    // Scroll phases: nothing is exportable before the result is accepted.
    return { type: 'ignore' };
  }
  if (ctrl && (key === 's' || key === 'S')) {
    if (context.focus === 'control') return { type: 'deferToControl' };
    return context.phase === 'editing' ? { type: 'savePng' } : { type: 'ignore' };
  }

  if (key === 'Enter') {
    // A focused button keeps its own keyboard semantics, so Enter never both
    // presses a button and finishes the capture.
    if (context.focus === 'control') return { type: 'deferToControl' };
    return context.phase === 'editing' ? { type: 'copyImageAndFinish' } : { type: 'ignore' };
  }

  const arrow = ARROWS[key];
  if (arrow && context.focus === 'canvas' && context.phase === 'editing') {
    // Only an unannotated selection can still be moved or resized: the first
    // committed annotation locks the capture rectangle.
    if (context.annotationCount > 0) return { type: 'ignore' };
    if (alt) return { type: 'resizeSelection', dx: arrow.dx, dy: arrow.dy };
    const step = shift ? 10 : 1;
    return { type: 'moveSelection', dx: arrow.dx * step, dy: arrow.dy * step };
  }

  return { type: 'ignore' };
}

/// Esc's last rung: one layer per press, never two.
function escapeForPhase(phase: CapturePhase): KeyAction {
  switch (phase) {
    case 'scrollPrepare':
      return { type: 'leaveScrollPrepare' };
    case 'scrolling':
    case 'scrollPaused':
      return { type: 'stopScrollAndReview' };
    case 'scrollReview':
      return { type: 'discardLongImage' };
    default:
      return { type: 'cancelSession' };
  }
}
