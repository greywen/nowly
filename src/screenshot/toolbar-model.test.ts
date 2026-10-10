import { describe, expect, it } from 'vitest';
import { translate } from '../i18n';
import {
  CONTROL_LABEL_KEYS,
  DEFAULT_TOOL,
  isDisabled,
  SCROLL_BLOCK_KEYS,
  scrollBlockReason,
  TOOL_ORDER,
  TOOLBAR_GROUPS,
  type ScrollBlockReason,
  type ToolbarState
} from './toolbar-model';

function state(overrides: Partial<ToolbarState> = {}): ToolbarState {
  return {
    selectionCrossesDisplays: false,
    annotationCount: 0,
    baseImageIsLong: false,
    captureTargetUnavailable: false,
    canUndo: false,
    canRedo: false,
    exporting: false,
    ...overrides
  };
}

describe('toolbar contents', () => {
  it('lists the tools in the order the spec fixes', () => {
    expect(TOOL_ORDER).toEqual([
      'select',
      'rect',
      'ellipse',
      'arrow',
      'pen',
      'text',
      'mosaic'
    ]);
  });

  it('defaults to the select tool', () => {
    expect(DEFAULT_TOOL).toBe('select');
    expect(TOOL_ORDER[0]).toBe('select');
  });

  it('keeps the three fixed groups in order', () => {
    expect(TOOLBAR_GROUPS).toEqual([
      TOOL_ORDER,
      ['undo', 'redo', 'scroll'],
      ['save', 'cancel', 'done']
    ]);
  });

  it('gives every control an accessible name, in both languages', () => {
    const controls = TOOLBAR_GROUPS.flat();

    for (const control of controls) {
      const key = CONTROL_LABEL_KEYS[control];
      expect(key, `${control} has no label key`).toBeTruthy();
      // A missing string falls back to the raw key, so this catches an untranslated
      // control rather than rendering the key at the user.
      expect(translate(key), `${key} is untranslated`).not.toBe(key);
    }
  });

  it('names the copy in done and the format in save', () => {
    // §5.1: no separate copy button, so these two must say what they do.
    expect(translate(CONTROL_LABEL_KEYS.done)).toContain('复制');
    expect(translate(CONTROL_LABEL_KEYS.save)).toContain('PNG');
  });
});

describe('scrolling capture availability', () => {
  it('is available with a plain single-display selection', () => {
    expect(scrollBlockReason(state())).toBeNull();
    expect(isDisabled('scroll', state())).toBe(false);
  });

  it.each([
    [{ selectionCrossesDisplays: true }, 'crossesDisplays'],
    [{ annotationCount: 1 }, 'hasAnnotations'],
    [{ baseImageIsLong: true }, 'alreadyLong'],
    [{ captureTargetUnavailable: true }, 'unsafeEnvironment']
  ] as const)('reports %j as %s', (overrides, reason) => {
    expect(scrollBlockReason(state(overrides))).toBe(reason);
    expect(isDisabled('scroll', state(overrides))).toBe(true);
  });

  it('prefers the most specific cause when several apply', () => {
    // A cross-display selection is the more actionable message, so it wins over
    // the others rather than the check order being incidental.
    expect(
      scrollBlockReason(
        state({
          selectionCrossesDisplays: true,
          annotationCount: 3,
          baseImageIsLong: true,
          captureTargetUnavailable: true
        })
      )
    ).toBe('crossesDisplays');
  });

  it('has a translated reason for every cause', () => {
    const reasons: ScrollBlockReason[] = [
      'crossesDisplays',
      'hasAnnotations',
      'alreadyLong',
      'unsafeEnvironment'
    ];

    for (const reason of reasons) {
      const key = SCROLL_BLOCK_KEYS[reason];
      expect(translate(key), `${key} is untranslated`).not.toBe(key);
    }
  });
});

describe('toolbar disabled states', () => {
  it('ties undo and redo to the history', () => {
    expect(isDisabled('undo', state())).toBe(true);
    expect(isDisabled('redo', state())).toBe(true);
    expect(isDisabled('undo', state({ canUndo: true }))).toBe(false);
    expect(isDisabled('redo', state({ canRedo: true }))).toBe(false);
  });

  it('freezes the document and the finishing controls during an export', () => {
    // §8.1 freezes the exported version, so nothing may change the document and
    // the export must not be started twice.
    const exporting = state({ canUndo: true, canRedo: true, exporting: true });

    for (const control of ['rect', 'pen', 'text', 'undo', 'redo', 'save', 'done'] as const) {
      expect(isDisabled(control, exporting), `${control} should be frozen`).toBe(true);
    }
  });

  it('never disables cancel', () => {
    // Cancel has to stay reachable, or a stuck export would trap the session.
    expect(isDisabled('cancel', state())).toBe(false);
    expect(isDisabled('cancel', state({ exporting: true }))).toBe(false);
  });

  it('leaves the drawing tools usable in a normal editing state', () => {
    for (const tool of TOOL_ORDER) {
      expect(isDisabled(tool, state()), `${tool} should be usable`).toBe(false);
    }
  });
});
