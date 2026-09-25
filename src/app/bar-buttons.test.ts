import { describe, expect, it } from 'vitest';
import { BAR_APPS, BAR_BUTTON_SLOTS, findBarApp, normalizeBarButtons } from './bar-buttons';

describe('the bar app catalogue', () => {
  it('offers three slots, matching design.md §8.3', () => {
    expect(BAR_BUTTON_SLOTS).toBe(3);
  });

  it('carries a label key for every app, so no button renders a raw id', () => {
    for (const app of BAR_APPS) {
      expect(app.labelKey).toMatch(/^barButtons\./);
    }
  });

  it('resolves only catalogued ids', () => {
    expect(findBarApp('screenshot')?.id).toBe('screenshot');
    expect(findBarApp('not-an-app')).toBeUndefined();
  });
});

describe('normalizeBarButtons', () => {
  it('keeps known ids in their configured order', () => {
    expect(normalizeBarButtons(['screenshot'])).toEqual(['screenshot']);
  });

  it('drops unknown ids rather than rendering a button with no handler', () => {
    expect(normalizeBarButtons(['screenshot', 'not-an-app'])).toEqual(['screenshot']);
  });

  it('removes duplicates so one app cannot occupy two slots', () => {
    expect(normalizeBarButtons(['screenshot', 'screenshot'])).toEqual(['screenshot']);
  });

  it('clamps to the slot count, so the shell cannot outgrow the native host', () => {
    const tooMany = Array.from({ length: BAR_BUTTON_SLOTS + 2 }, (_, index) =>
      index === 0 ? 'screenshot' : `app-${index}`);
    expect(normalizeBarButtons(tooMany).length).toBeLessThanOrEqual(BAR_BUTTON_SLOTS);
  });

  it('treats a missing value as no buttons', () => {
    expect(normalizeBarButtons(undefined)).toEqual([]);
    expect(normalizeBarButtons(null)).toEqual([]);
  });
});
