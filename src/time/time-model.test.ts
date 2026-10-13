import { describe, expect, it } from 'vitest';
import { defaultTimeSettings, normalizeTimeSettings } from './time-model';

describe('global time settings', () => {
  it('stores appearance once and keeps cities independent of appearance', () => {
    const settings = defaultTimeSettings();
    expect(settings.displayContent).toBe('clocks');
    expect(settings.focusPreferences).toEqual({ defaultMinutes: 25 });
    expect(settings.appearance).toMatchObject({ layout: 'horizontal', fontMode: 'auto', fontSize: 96 });
    expect(Object.keys(settings.clocks[0]).sort()).toEqual(['id', 'label', 'timeZone']);
  });

  it('normalizes the global font range without changing the chosen display', () => {
    const settings = defaultTimeSettings();
    const normalized = normalizeTimeSettings({
      ...settings, displayContent: 'focus',
      appearance: { ...settings.appearance, fontMode: 'manual', fontSize: 999 }
    });
    expect(normalized.appearance.fontSize).toBe(160);
    expect(normalized.displayContent).toBe('focus');
  });

  it('keeps global preferences when an empty clock list is repaired', () => {
    const settings = defaultTimeSettings();
    const normalized = normalizeTimeSettings({
      ...settings, displayContent: 'focus', focusPreferences: { defaultMinutes: 45 }, clocks: []
    });
    expect(normalized.clocks).toHaveLength(1);
    expect(normalized.focusPreferences.defaultMinutes).toBe(45);
    expect(normalized.displayContent).toBe('focus');
  });
});
