export type WidgetId = 'calendar' | 'matrix' | 'notes' | 'focusTimer' | 'newsWordCloud' | 'vocabulary';

export type WidgetConfig = {
  id: WidgetId;
  name: string;
  enabled: boolean;
  order: number;
  size: 'main' | 'side-large' | 'side-medium';
};

export const defaultWidgets: WidgetConfig[] = [
  { id: 'calendar', name: '日历', enabled: true, order: 1, size: 'main' },
  { id: 'matrix', name: '四象限', enabled: true, order: 2, size: 'side-large' },
  { id: 'notes', name: '便签', enabled: true, order: 3, size: 'side-medium' }
];

export function getEnabledWidgets(widgets: WidgetConfig[]): WidgetConfig[] {
  return widgets.filter((widget) => widget.enabled).sort((left, right) => left.order - right.order);
}

// --- Free-form tiling layout -------------------------------------------------

export const GRID_COLS = 12;
export const GRID_ROWS = 8;
export const GRID_GAP_PX = 16;

export type Rect = { x: number; y: number; w: number; h: number };

export type WidgetDefinition = {
  id: WidgetId;
  name: string;
  minW: number;
  minH: number;
  default: Rect;
};

export type ModuleLayout = { id: WidgetId } & Rect;
export type LayoutState = ModuleLayout[];

export const widgetDefinitions: WidgetDefinition[] = [
  { id: 'calendar', name: '日历', minW: 5, minH: 4, default: { x: 0, y: 0, w: 7, h: 8 } },
  { id: 'matrix', name: '四象限', minW: 3, minH: 3, default: { x: 7, y: 0, w: 5, h: 5 } },
  { id: 'notes', name: '便签', minW: 2, minH: 2, default: { x: 7, y: 5, w: 5, h: 3 } }
];

export const defaultLayout: LayoutState = widgetDefinitions.map((definition) => ({
  id: definition.id,
  ...definition.default
}));

export function getWidgetDefinition(id: WidgetId): WidgetDefinition | undefined {
  return widgetDefinitions.find((definition) => definition.id === id);
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function isWithinBounds(rect: Rect): boolean {
  return (
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.w >= 1 &&
    rect.h >= 1 &&
    rect.x + rect.w <= GRID_COLS &&
    rect.y + rect.h <= GRID_ROWS
  );
}

export function clampToBounds(rect: Rect): Rect {
  const w = Math.min(rect.w, GRID_COLS);
  const h = Math.min(rect.h, GRID_ROWS);
  const x = Math.min(Math.max(rect.x, 0), GRID_COLS - w);
  const y = Math.min(Math.max(rect.y, 0), GRID_ROWS - h);
  return { x, y, w, h };
}

// Can `id` occupy `rect` given the rest of `layout`? Enforces bounds, the
// module's own minimum size, and no overlap with any other module.
export function canPlace(layout: LayoutState, id: WidgetId, rect: Rect): boolean {
  if (!isWithinBounds(rect)) return false;
  const definition = getWidgetDefinition(id);
  if (definition && (rect.w < definition.minW || rect.h < definition.minH)) return false;
  return layout.every((item) => item.id === id || !rectsOverlap(item, rect));
}

function isValidLayout(layout: LayoutState): boolean {
  for (const definition of widgetDefinitions) {
    if (!layout.some((item) => item.id === definition.id)) return false;
  }
  for (let a = 0; a < layout.length; a += 1) {
    const item = layout[a];
    const definition = getWidgetDefinition(item.id);
    if (!definition) return false;
    if (!isWithinBounds(item)) return false;
    if (item.w < definition.minW || item.h < definition.minH) return false;
    for (let b = a + 1; b < layout.length; b += 1) {
      if (rectsOverlap(item, layout[b])) return false;
    }
  }
  return true;
}

function isIntRect(value: unknown): value is Rect {
  if (typeof value !== 'object' || value === null) return false;
  const rect = value as Record<string, unknown>;
  return (
    Number.isInteger(rect.x) &&
    Number.isInteger(rect.y) &&
    Number.isInteger(rect.w) &&
    Number.isInteger(rect.h)
  );
}

export function normalizeLayout(raw: unknown): LayoutState {
  if (!Array.isArray(raw)) return defaultLayout;
  const seen = new Set<WidgetId>();
  const result: LayoutState = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) return defaultLayout;
    const id = (entry as { id?: unknown }).id;
    if (typeof id !== 'string' || !getWidgetDefinition(id as WidgetId)) return defaultLayout;
    if (!isIntRect(entry)) return defaultLayout;
    if (seen.has(id as WidgetId)) return defaultLayout;
    seen.add(id as WidgetId);
    const { x, y, w, h } = entry as unknown as Rect;
    result.push({ id: id as WidgetId, x, y, w, h });
  }
  if (!isValidLayout(result)) return defaultLayout;
  return result;
}
