import { describe, expect, it } from 'vitest';
import {
  GRID_COLS,
  GRID_ROWS,
  canPlace,
  clampToBounds,
  defaultLayout,
  defaultWidgets,
  getEnabledWidgets,
  getWidgetDefinition,
  isWithinBounds,
  normalizeLayout,
  rectsOverlap,
  widgetDefinitions,
  type LayoutState
} from './widget-registry';

describe('widget registry', () => {
  it('contains calendar, matrix, and notes as enabled MVP widgets', () => {
    expect(defaultWidgets.map((widget) => widget.id)).toEqual(['calendar', 'matrix', 'notes']);
    expect(getEnabledWidgets(defaultWidgets).map((widget) => widget.id)).toEqual(['calendar', 'matrix', 'notes']);
  });
});

describe('widget definitions', () => {
  it('defines a name, minimum size, and default rect for calendar, matrix, and notes', () => {
    expect(widgetDefinitions.map((definition) => definition.id)).toEqual(['calendar', 'matrix', 'notes']);
    for (const definition of widgetDefinitions) {
      expect(definition.minW).toBeGreaterThan(0);
      expect(definition.minH).toBeGreaterThan(0);
      expect(definition.default.w).toBeGreaterThanOrEqual(definition.minW);
      expect(definition.default.h).toBeGreaterThanOrEqual(definition.minH);
      expect(isWithinBounds(definition.default)).toBe(true);
    }
  });

  it('looks up a definition by id', () => {
    expect(getWidgetDefinition('calendar')?.name).toBe('日历');
    expect(getWidgetDefinition('focusTimer')).toBeUndefined();
  });
});

describe('defaultLayout', () => {
  it('tiles the whole 12x8 grid with no overlap and no holes', () => {
    expect(defaultLayout.map((item) => item.id)).toEqual(['calendar', 'matrix', 'notes']);

    let coveredArea = 0;
    for (const item of defaultLayout) {
      coveredArea += item.w * item.h;
      expect(isWithinBounds(item)).toBe(true);
    }
    expect(coveredArea).toBe(GRID_COLS * GRID_ROWS);

    for (let a = 0; a < defaultLayout.length; a += 1) {
      for (let b = a + 1; b < defaultLayout.length; b += 1) {
        expect(rectsOverlap(defaultLayout[a], defaultLayout[b])).toBe(false);
      }
    }
  });
});

describe('rectsOverlap', () => {
  it('detects overlapping and adjacent rects', () => {
    expect(rectsOverlap({ x: 0, y: 0, w: 4, h: 4 }, { x: 2, y: 2, w: 4, h: 4 })).toBe(true);
    expect(rectsOverlap({ x: 0, y: 0, w: 4, h: 4 }, { x: 4, y: 0, w: 4, h: 4 })).toBe(false);
    expect(rectsOverlap({ x: 0, y: 0, w: 4, h: 4 }, { x: 0, y: 4, w: 4, h: 4 })).toBe(false);
  });
});

describe('isWithinBounds', () => {
  it('accepts rects inside the grid and rejects those spilling out', () => {
    expect(isWithinBounds({ x: 0, y: 0, w: 12, h: 8 })).toBe(true);
    expect(isWithinBounds({ x: -1, y: 0, w: 4, h: 4 })).toBe(false);
    expect(isWithinBounds({ x: 10, y: 0, w: 4, h: 4 })).toBe(false);
    expect(isWithinBounds({ x: 0, y: 6, w: 4, h: 4 })).toBe(false);
  });
});

describe('clampToBounds', () => {
  it('shifts a rect back inside the grid keeping its size', () => {
    expect(clampToBounds({ x: -3, y: -2, w: 4, h: 4 })).toEqual({ x: 0, y: 0, w: 4, h: 4 });
    expect(clampToBounds({ x: 20, y: 20, w: 4, h: 4 })).toEqual({ x: 8, y: 4, w: 4, h: 4 });
  });
});

describe('canPlace', () => {
  const layout: LayoutState = [
    { id: 'calendar', x: 0, y: 0, w: 5, h: 4 },
    { id: 'matrix', x: 5, y: 0, w: 4, h: 4 },
    { id: 'notes', x: 0, y: 4, w: 4, h: 3 }
  ];

  it('accepts a rect that fits in free space', () => {
    expect(canPlace(layout, 'notes', { x: 5, y: 4, w: 4, h: 3 })).toBe(true);
  });

  it('rejects a rect that overlaps another module', () => {
    expect(canPlace(layout, 'notes', { x: 0, y: 0, w: 4, h: 3 })).toBe(false);
  });

  it('ignores the module being placed when checking overlap', () => {
    expect(canPlace(layout, 'calendar', { x: 0, y: 0, w: 5, h: 4 })).toBe(true);
  });

  it('rejects out-of-bounds rects and rects smaller than the minimum size', () => {
    expect(canPlace(layout, 'matrix', { x: 10, y: 0, w: 4, h: 4 })).toBe(false);
    expect(canPlace(layout, 'calendar', { x: 0, y: 0, w: 4, h: 4 })).toBe(false);
  });
});

describe('normalizeLayout', () => {
  it('falls back to defaultLayout for empty, non-array, or malformed input', () => {
    expect(normalizeLayout(null)).toEqual(defaultLayout);
    expect(normalizeLayout('nope')).toEqual(defaultLayout);
    expect(normalizeLayout([{ id: 'calendar', x: 0, y: 0, w: 5 }])).toEqual(defaultLayout);
    expect(normalizeLayout([{ id: 'unknown', x: 0, y: 0, w: 4, h: 4 }])).toEqual(defaultLayout);
  });

  it('falls back when a stored rect is out of bounds, too small, or overlapping', () => {
    const tooSmall: LayoutState = [
      { id: 'calendar', x: 0, y: 0, w: 2, h: 2 },
      { id: 'matrix', x: 5, y: 0, w: 4, h: 4 },
      { id: 'notes', x: 0, y: 4, w: 4, h: 3 }
    ];
    expect(normalizeLayout(tooSmall)).toEqual(defaultLayout);

    const overlapping: LayoutState = [
      { id: 'calendar', x: 0, y: 0, w: 6, h: 6 },
      { id: 'matrix', x: 4, y: 0, w: 5, h: 5 },
      { id: 'notes', x: 0, y: 5, w: 4, h: 3 }
    ];
    expect(normalizeLayout(overlapping)).toEqual(defaultLayout);
  });

  it('falls back when not every defined module is present', () => {
    expect(normalizeLayout([{ id: 'calendar', x: 0, y: 0, w: 7, h: 8 }])).toEqual(defaultLayout);
  });

  it('keeps a valid stored layout unchanged', () => {
    const stored: LayoutState = [
      { id: 'calendar', x: 0, y: 0, w: 5, h: 4 },
      { id: 'matrix', x: 5, y: 0, w: 4, h: 4 },
      { id: 'notes', x: 0, y: 4, w: 4, h: 3 }
    ];
    expect(normalizeLayout(stored)).toEqual(stored);
  });
});
