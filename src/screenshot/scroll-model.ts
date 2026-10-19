export type ScrollHint = 'lostTrack' | 'fixedEdges' | 'full' | 'captureFailed';

/// The native scrolling capture as the overlay sees it. `revision` changes only
/// when the confirmed image changes; `sequence` orders every update.
export type ScrollState = {
  sessionId: string;
  revision: number;
  sequence: number;
  phase: 'capturing' | 'finished' | 'cancelled';
  width: number;
  height: number;
  region: { x: number; y: number; width: number; height: number };
  hint: ScrollHint | null;
  grewUpward?: boolean;
  workerDone?: boolean;
};

/// Events and command results can arrive out of order; the later sequence wins.
export function acceptScrollUpdate(current: ScrollState | null, next: ScrollState): ScrollState {
  if (!current || current.sessionId !== next.sessionId) return next;
  return next.sequence < current.sequence ? current : next;
}

export const SCROLL_HINT_KEYS: Readonly<Record<ScrollHint, string>> = {
  lostTrack: 'screenshot.auto.lostTrack',
  fixedEdges: 'screenshot.auto.fixedEdges',
  full: 'screenshot.auto.full',
  captureFailed: 'screenshot.auto.captureFailed'
};

type CssRect = { left: number; top: number; width: number; height: number };

const SCROLL_ERROR_KEYS: Readonly<Record<string, string>> = {
  scroll_nothing_yet: 'screenshot.auto.nothingYet',
  scroll_too_small: 'screenshot.auto.tooSmall',
  scroll_too_large: 'screenshot.auto.tooLarge',
  scroll_one_screen: 'screenshot.scrollBlocked.crossesDisplays',
  scroll_live_failed: 'screenshot.auto.startFailed',
  archived_copy_failed: 'screenshot.export.savedCopyFailed'
};

/// A rejected command as something the overlay can show: a known code becomes
/// its own sentence, a message Rust already wrote for users is kept, and anything
/// else falls back to `fallbackKey`.
export function describeScrollError(error: unknown, fallbackKey: string): { key: string } | { message: string } {
  if (typeof error === 'object' && error !== null) {
    const { code, message } = error as { code?: unknown; message?: unknown };
    if (typeof code === 'string' && SCROLL_ERROR_KEYS[code]) return { key: SCROLL_ERROR_KEYS[code] };
    if (!(error instanceof Error) && typeof message === 'string' && message) return { message };
  }
  return { key: fallbackKey };
}

export const PREVIEW_WIDTH = 160;
const GAP = 8;

/// The live preview sits beside the selection, never over it: the selection is
/// the hole the user scrolls through. Left first, as in the reference, then right.
export function previewPlacement(selection: CssRect, viewport: { width: number; height: number }): CssRect | null {
  const top = Math.max(0, selection.top);
  const height = Math.min(selection.top + selection.height, viewport.height) - top;
  if (height < 48) return null;
  if (selection.left - GAP - PREVIEW_WIDTH >= 0) {
    return { left: selection.left - GAP - PREVIEW_WIDTH, top, width: PREVIEW_WIDTH, height };
  }
  const right = selection.left + selection.width + GAP;
  if (right + PREVIEW_WIDTH <= viewport.width) return { left: right, top, width: PREVIEW_WIDTH, height };
  return null;
}

/// The hint goes above the selection, or below it when the selection starts at
/// the top of the screen.
export function hintPlacement(selection: CssRect, hintHeight = 28): { left: number; top: number } {
  return selection.top >= hintHeight
    ? { left: selection.left, top: selection.top - hintHeight }
    : { left: selection.left, top: selection.top + selection.height + GAP };
}
