// The editing toolbar's fixed contents and its disabled reasons.
//
// §5.1 of docs/superpowers/specs/2026-09-25-nowly-screenshot-design.md fixes the
// order and the grouping, and §6.1 fixes the exact reason shown when scrolling
// capture is unavailable. Both are data here rather than JSX, so the order and the
// reasons can be asserted without rendering.

export type ToolId =
  | 'select'
  | 'rect'
  | 'ellipse'
  | 'arrow'
  | 'pen'
  | 'text'
  | 'mosaic';

export type ActionId = 'undo' | 'redo' | 'scroll' | 'save' | 'cancel' | 'done';

/// Drawing tools, in the order §5.1 lists them.
export const TOOL_ORDER: readonly ToolId[] = [
  'select',
  'rect',
  'ellipse',
  'arrow',
  'pen',
  'text',
  'mosaic'
];

/// The first selection defaults to "select", per §5.1.
export const DEFAULT_TOOL: ToolId = 'select';

/// The three fixed groups, separated by a 1px divider in the rendered toolbar.
export const TOOLBAR_GROUPS: readonly (readonly (ToolId | ActionId)[])[] = [
  TOOL_ORDER,
  ['undo', 'redo', 'scroll'],
  ['save', 'cancel', 'done']
];

/// i18n keys for each control's accessible name and tooltip.
///
/// §5.1: "done" says it copies as well, and "save" names the format, so no
/// separate copy button is needed.
export const CONTROL_LABEL_KEYS: Readonly<Record<ToolId | ActionId, string>> = {
  select: 'screenshot.tool.select',
  rect: 'screenshot.tool.rect',
  ellipse: 'screenshot.tool.ellipse',
  arrow: 'screenshot.tool.arrow',
  pen: 'screenshot.tool.pen',
  text: 'screenshot.tool.text',
  mosaic: 'screenshot.tool.mosaic',
  undo: 'screenshot.action.undo',
  redo: 'screenshot.action.redo',
  scroll: 'screenshot.action.scroll',
  save: 'screenshot.action.save',
  cancel: 'screenshot.action.cancel',
  done: 'screenshot.action.done'
};

/// Why scrolling capture cannot start. Checked in this order, so the most
/// specific cause wins.
export type ScrollBlockReason =
  | 'crossesDisplays'
  | 'hasAnnotations'
  | 'alreadyLong'
  | 'unsafeEnvironment';

export const SCROLL_BLOCK_KEYS: Readonly<Record<ScrollBlockReason, string>> = {
  crossesDisplays: 'screenshot.scrollBlocked.crossesDisplays',
  hasAnnotations: 'screenshot.scrollBlocked.hasAnnotations',
  alreadyLong: 'screenshot.scrollBlocked.alreadyLong',
  unsafeEnvironment: 'screenshot.scrollBlocked.unsafeEnvironment'
};

export type ToolbarState = {
  selectionCrossesDisplays: boolean;
  annotationCount: number;
  baseImageIsLong: boolean;
  /// The capture target or window exclusion could not be established.
  captureTargetUnavailable: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /// An export is running: §8.1 freezes the finishing controls meanwhile.
  exporting: boolean;
};

/// `null` when scrolling capture is available.
export function scrollBlockReason(state: ToolbarState): ScrollBlockReason | null {
  if (state.selectionCrossesDisplays) return 'crossesDisplays';
  if (state.annotationCount > 0) return 'hasAnnotations';
  if (state.baseImageIsLong) return 'alreadyLong';
  if (state.captureTargetUnavailable) return 'unsafeEnvironment';
  return null;
}

/// Whether a control is disabled.
///
/// §5.1 and §8.1: undo/redo follow the history, scrolling follows its own
/// conditions, and an export in progress freezes save and done — but never cancel,
/// which must stay reachable.
export function isDisabled(control: ToolId | ActionId, state: ToolbarState): boolean {
  switch (control) {
    case 'undo':
      return !state.canUndo || state.exporting;
    case 'redo':
      return !state.canRedo || state.exporting;
    case 'scroll':
      return scrollBlockReason(state) !== null || state.exporting;
    case 'save':
    case 'done':
      return state.exporting;
    case 'cancel':
      // Cancel stays reachable even mid-export: §8.1 only forbids cancelling once
      // the irreversible commit stage begins, which is a separate state.
      return false;
    default:
      // §8.1 freezes the exported version, so the document must not change while
      // an export is running: drawing tools are disabled too, otherwise the file
      // would not match what the user sees.
      return state.exporting;
  }
}
