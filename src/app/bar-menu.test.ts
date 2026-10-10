import { describe, expect, it } from 'vitest';
import { DEFAULT_BAR_MENU, normalizeBarMenu } from './bar-menu';

describe('normalizeBarMenu', () => {
  it('defaults to screenshot, history and assistant, all visible', () => {
    expect(normalizeBarMenu(undefined)).toEqual([
      { id: 'screenshot', visible: true },
      { id: 'screenshotHistory', visible: true },
      { id: 'assistant', visible: true }
    ]);
    expect(normalizeBarMenu(null)).toEqual(DEFAULT_BAR_MENU);
  });
  it('retains order and hidden items without mutating input', () => {
    const menu = [{ id: 'assistant', visible: false }, { id: 'screenshot', visible: false }, { id: 'screenshotHistory', visible: true }];
    expect(normalizeBarMenu(menu)).toEqual(menu);
    expect(normalizeBarMenu(menu)).not.toBe(menu);
  });
  it('drops unknown and duplicate IDs and appends missing features', () => {
    expect(normalizeBarMenu([
      { id: 'assistant', visible: false }, { id: 'unknown', visible: true },
      { id: 'assistant', visible: true }, { id: 'screenshot', visible: false }
    ])).toEqual([
      { id: 'assistant', visible: false }, { id: 'screenshot', visible: false },
      { id: 'screenshotHistory', visible: true }
    ]);
  });
  it('recovers malformed entries and defaults invalid visibility to visible', () => {
    expect(normalizeBarMenu([null, 'screenshot', { id: 'assistant', visible: 'no' }])).toEqual([
      { id: 'assistant', visible: true }, { id: 'screenshot', visible: true },
      { id: 'screenshotHistory', visible: true }
    ]);
    expect(normalizeBarMenu({})).toEqual(DEFAULT_BAR_MENU);
  });
});
