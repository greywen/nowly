import { describe, expect, it } from 'vitest';
import {
  defaultLayout,
  defaultWidgets,
  getEnabledWidgets,
  getNextPresetId,
  getPreset,
  getWidgetDefinition,
  normalizeLayout,
  reorderLayout,
  widgetDefinitions
} from './widget-registry';

describe('widget registry', () => {
  it('contains calendar, matrix, and notes as enabled MVP widgets', () => {
    expect(defaultWidgets.map((widget) => widget.id)).toEqual(['calendar', 'matrix', 'notes']);
    expect(getEnabledWidgets(defaultWidgets).map((widget) => widget.id)).toEqual(['calendar', 'matrix', 'notes']);
  });
});

describe('widget definitions', () => {
  it('defines presets and a valid default preset for calendar, matrix, and notes', () => {
    expect(widgetDefinitions.map((definition) => definition.id)).toEqual(['calendar', 'matrix', 'notes']);
    for (const definition of widgetDefinitions) {
      expect(definition.presets.length).toBeGreaterThan(0);
      expect(definition.presets.some((preset) => preset.id === definition.defaultPresetId)).toBe(true);
    }
  });

  it('looks up a definition and a preset by id', () => {
    expect(getWidgetDefinition('calendar')?.name).toBe('日历');
    expect(getPreset('calendar', 'large')).toMatchObject({ cols: 8, rows: 6 });
    expect(getPreset('calendar', 'missing')).toBeUndefined();
  });

  it('cycles to the next preset and wraps around', () => {
    expect(getNextPresetId('calendar', 'medium')).toBe('large');
    expect(getNextPresetId('calendar', 'large')).toBe('medium');
    expect(getNextPresetId('notes', 'small')).toBe('medium');
    expect(getNextPresetId('notes', 'medium')).toBe('small');
  });
});

describe('defaultLayout', () => {
  it('orders calendar, matrix, notes with their default presets', () => {
    expect(defaultLayout).toEqual([
      { id: 'calendar', presetId: 'large' },
      { id: 'matrix', presetId: 'medium' },
      { id: 'notes', presetId: 'small' }
    ]);
  });
});

describe('reorderLayout', () => {
  it('moves a module to the target position by removing then inserting at the target index', () => {
    const result = reorderLayout(defaultLayout, 'calendar', 'notes');
    expect(result.map((item) => item.id)).toEqual(['matrix', 'calendar', 'notes']);
  });

  it('moves a later module before an earlier target', () => {
    const result = reorderLayout(defaultLayout, 'notes', 'calendar');
    expect(result.map((item) => item.id)).toEqual(['notes', 'calendar', 'matrix']);
  });

  it('returns the layout unchanged when ids match or are unknown', () => {
    expect(reorderLayout(defaultLayout, 'calendar', 'calendar')).toEqual(defaultLayout);
    expect(reorderLayout(defaultLayout, 'calendar', 'focusTimer')).toEqual(defaultLayout);
  });

  it('preserves each module preset while reordering', () => {
    const result = reorderLayout(defaultLayout, 'calendar', 'notes');
    expect(result.find((item) => item.id === 'calendar')?.presetId).toBe('large');
  });
});

describe('normalizeLayout', () => {
  it('falls back to defaultLayout for empty, non-array, or malformed input', () => {
    expect(normalizeLayout(null)).toEqual(defaultLayout);
    expect(normalizeLayout('nope')).toEqual(defaultLayout);
    expect(normalizeLayout([{ id: 'calendar' }])).toEqual(defaultLayout);
    expect(normalizeLayout([{ id: 'unknown', presetId: 'x' }])).toEqual(defaultLayout);
    expect(normalizeLayout([{ id: 'calendar', presetId: 'missing' }])).toEqual(defaultLayout);
  });

  it('keeps a valid custom order and appends missing defined modules', () => {
    const stored = [{ id: 'notes', presetId: 'medium' }];
    expect(normalizeLayout(stored)).toEqual([
      { id: 'notes', presetId: 'medium' },
      { id: 'calendar', presetId: 'large' },
      { id: 'matrix', presetId: 'medium' }
    ]);
  });

  it('drops duplicate ids while normalizing', () => {
    const stored = [
      { id: 'calendar', presetId: 'medium' },
      { id: 'calendar', presetId: 'large' }
    ];
    expect(normalizeLayout(stored)).toEqual([
      { id: 'calendar', presetId: 'medium' },
      { id: 'matrix', presetId: 'medium' },
      { id: 'notes', presetId: 'small' }
    ]);
  });
});
