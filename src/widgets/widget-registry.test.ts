import { describe, expect, it } from 'vitest';
import type { SandboxExtension } from '../data/nowly-repository';
import {
  SANDBOX_ID_PREFIX,
  GRID_COLS,
  GRID_ROWS,
  buildDefinitions,
  builtinDefinitions,
  canPlace,
  clampToBounds,
  sandboxExtensionToDefinition,
  defaultLayout,
  extensionDefinitions,
  findFreeSlot,
  getWidgetDefinition,
  isSandboxWidgetId,
  isWithinBounds,
  normalizeLayout,
  rectsOverlap,
  type LayoutState
} from './widget-registry';

function extension(overrides: Partial<SandboxExtension> = {}): SandboxExtension {
  return {
    id: 'ext1',
    name: '用户模块',
    description: '示例模块',
    source: 'Nowly.defineModule(() => {});',
    permissions: ['state', 'today'],
    minW: 3,
    minH: 3,
    defaultW: 4,
    defaultH: 4,
    createdAt: '2026-07-23T00:00:00Z',
    updatedAt: '2026-07-23T00:00:00Z',
    ...overrides
  };
}

describe('widget definitions', () => {
  it('defines built-in calendar, matrix, and notes with valid geometry', () => {
    expect(builtinDefinitions.map((definition) => definition.id)).toEqual(['calendar', 'matrix', 'notes']);
    for (const definition of [...builtinDefinitions, ...extensionDefinitions]) {
      expect(definition.minW).toBeGreaterThan(0);
      expect(definition.minH).toBeGreaterThan(0);
      expect(definition.default.w).toBeGreaterThanOrEqual(definition.minW);
      expect(definition.default.h).toBeGreaterThanOrEqual(definition.minH);
    }
  });

  it('exposes the extension modules as an addable set', () => {
    expect(extensionDefinitions.map((definition) => definition.id)).toEqual([
      'focusTimer',
      'newsWordCloud',
      'vocabulary'
    ]);
    for (const definition of extensionDefinitions) {
      expect(definition.category).toBe('extension');
    }
  });

  it('looks up a definition by id within a definition list', () => {
    expect(getWidgetDefinition('calendar')?.name).toBe('日历');
    expect(getWidgetDefinition('focusTimer')).toBeUndefined();
    const all = buildDefinitions();
    expect(getWidgetDefinition('focusTimer', all)?.name).toBe('专注计时');
  });
});

describe('user modules (sandbox extensions)', () => {
  it('recognizes sandbox widget ids by prefix', () => {
    expect(isSandboxWidgetId(`${SANDBOX_ID_PREFIX}ext1`)).toBe(true);
    expect(isSandboxWidgetId('calendar')).toBe(false);
  });

  it('turns an installed module into a placeable definition', () => {
    const definition = sandboxExtensionToDefinition(extension());
    expect(definition.id).toBe(`${SANDBOX_ID_PREFIX}ext1`);
    expect(definition.category).toBe('sandbox');
    expect(definition.default).toEqual({ x: 0, y: 0, w: 4, h: 4 });
    expect(definition.extension?.source).toContain('defineModule');
  });

  it('merges built-ins, extensions, and user modules into the full set', () => {
    const all = buildDefinitions([extension()]);
    expect(all.map((definition) => definition.id)).toContain(`${SANDBOX_ID_PREFIX}ext1`);
    expect(all.filter((definition) => definition.category === 'builtin')).toHaveLength(3);
    expect(all.filter((definition) => definition.category === 'extension')).toHaveLength(3);
    expect(all.filter((definition) => definition.category === 'sandbox')).toHaveLength(1);
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

describe('findFreeSlot', () => {
  it('finds the first free cell for a module of a given size', () => {
    const layout: LayoutState = [{ id: 'calendar', x: 0, y: 0, w: 12, h: 4 }];
    expect(findFreeSlot(layout, 4, 3)).toEqual({ x: 0, y: 4, w: 4, h: 3 });
  });

  it('returns null when the grid is full', () => {
    const layout: LayoutState = [{ id: 'calendar', x: 0, y: 0, w: 12, h: 8 }];
    expect(findFreeSlot(layout, 4, 3)).toBeNull();
  });
});

describe('normalizeLayout', () => {
  it('returns an empty layout for non-array input', () => {
    expect(normalizeLayout(null)).toEqual([]);
    expect(normalizeLayout('nope')).toEqual([]);
  });

  it('drops entries with unknown ids, malformed rects, or missing fields', () => {
    expect(normalizeLayout([{ id: 'calendar', x: 0, y: 0, w: 5 }])).toEqual([]);
    expect(normalizeLayout([{ id: 'unknown', x: 0, y: 0, w: 4, h: 4 }])).toEqual([]);
  });

  it('drops out-of-bounds, too-small, or overlapping entries but keeps valid ones', () => {
    const mixed = [
      { id: 'calendar', x: 0, y: 0, w: 5, h: 4 },
      { id: 'matrix', x: 0, y: 0, w: 4, h: 4 }, // overlaps calendar -> dropped
      { id: 'notes', x: 0, y: 4, w: 1, h: 1 } // below minimum -> dropped
    ];
    expect(normalizeLayout(mixed)).toEqual([{ id: 'calendar', x: 0, y: 0, w: 5, h: 4 }]);
  });

  it('accepts a subset of modules without requiring every definition', () => {
    const stored = [{ id: 'calendar', x: 0, y: 0, w: 7, h: 8 }];
    expect(normalizeLayout(stored)).toEqual(stored);
  });

  it('keeps a valid stored layout unchanged', () => {
    const stored: LayoutState = [
      { id: 'calendar', x: 0, y: 0, w: 5, h: 4 },
      { id: 'matrix', x: 5, y: 0, w: 4, h: 4 },
      { id: 'notes', x: 0, y: 4, w: 4, h: 3 }
    ];
    expect(normalizeLayout(stored)).toEqual(stored);
  });

  it('accepts user module ids when their definitions are provided', () => {
    const definitions = buildDefinitions([extension()]);
    const stored = [{ id: `${SANDBOX_ID_PREFIX}ext1`, x: 0, y: 0, w: 4, h: 4 }];
    expect(normalizeLayout(stored, definitions)).toEqual(stored);
    // Without the user module definition, the entry is dropped.
    expect(normalizeLayout(stored)).toEqual([]);
  });
});
