import type { SandboxExtension } from '../data/nowly-repository';
import { t } from '../i18n';

// Built-in module identifiers plus the free-form `sandbox:<uuid>` ids created by
// user-uploaded modules. Kept as a string so user modules flow through the same
// layout machinery as built-in modules.
export type WidgetId = string;

export type WidgetCategory = 'builtin' | 'extension' | 'sandbox';

// --- Free-form tiling layout -------------------------------------------------

export const GRID_COLS = 12;
export const GRID_ROWS = 8;
export const GRID_GAP_PX = 16;

export type Rect = { x: number; y: number; w: number; h: number };

export type WidgetDefinition = {
  id: WidgetId;
  name: string;
  description: string;
  category: WidgetCategory;
  minW: number;
  minH: number;
  default: Rect;
  // Present only for user modules so the host can run their source.
  extension?: SandboxExtension;
};

export type ModuleLayout = { id: WidgetId } & Rect;
export type LayoutState = ModuleLayout[];

// Built-in modules always available in the picker.
export const builtinDefinitions: WidgetDefinition[] = [
  {
    id: 'calendar',
    get name() { return t('widget.calendar.name'); },
    get description() { return t('widget.calendar.desc'); },
    category: 'builtin',
    minW: 5,
    minH: 4,
    default: { x: 0, y: 0, w: 7, h: 8 }
  },
  {
    id: 'matrix',
    get name() { return t('widget.matrix.name'); },
    get description() { return t('widget.matrix.desc'); },
    category: 'builtin',
    minW: 3,
    minH: 3,
    default: { x: 7, y: 0, w: 5, h: 5 }
  },
  {
    id: 'notes',
    get name() { return t('widget.notes.name'); },
    get description() { return t('widget.notes.desc'); },
    category: 'builtin',
    minW: 2,
    minH: 2,
    default: { x: 7, y: 5, w: 5, h: 3 }
  }
];

// The kanban board is a built-in module, but unlike calendar / matrix / notes
// it is not part of the default layout: it is added from the module picker.
// Keeping it out of `builtinDefinitions` keeps `defaultLayout` a clean tiling
// of the three starting modules while still exposing kanban as placeable.
export const kanbanDefinition: WidgetDefinition = {
  id: 'kanban',
  get name() { return t('widget.kanban.name'); },
  get description() { return t('widget.kanban.desc'); },
  category: 'builtin',
  minW: 4,
  minH: 3,
  default: { x: 0, y: 0, w: 8, h: 5 }
};

// Optional extension modules the user can add or remove from the layout.
export const extensionDefinitions: WidgetDefinition[] = [
  {
    id: 'focusTimer',
    get name() { return t('widget.focusTimer.name'); },
    get description() { return t('widget.focusTimer.desc'); },
    category: 'extension',
    minW: 2,
    minH: 2,
    default: { x: 0, y: 0, w: 4, h: 4 }
  }
];

export const SANDBOX_ID_PREFIX = 'sandbox:';

export function isSandboxWidgetId(id: WidgetId): boolean {
  return id.startsWith(SANDBOX_ID_PREFIX);
}

// Turn an installed user module into a placeable widget definition.
export function sandboxExtensionToDefinition(extension: SandboxExtension): WidgetDefinition {
  return {
    id: `${SANDBOX_ID_PREFIX}${extension.id}`,
    name: extension.name,
    description: extension.description,
    category: 'sandbox',
    minW: extension.minW,
    minH: extension.minH,
    default: { x: 0, y: 0, w: extension.defaultW, h: extension.defaultH },
    extension
  };
}

// The full set of placeable modules: built-ins, extensions, and installed user
// modules.
export function buildDefinitions(
  sandboxExtensions: SandboxExtension[] = []
): WidgetDefinition[] {
  return [
    ...builtinDefinitions,
    kanbanDefinition,
    ...extensionDefinitions,
    ...sandboxExtensions.map(sandboxExtensionToDefinition)
  ];
}

// The default layout the app ships with (built-in modules tiling the grid).
export const defaultLayout: LayoutState = builtinDefinitions.map((definition) => ({
  id: definition.id,
  ...definition.default
}));

export function getWidgetDefinition(
  id: WidgetId,
  definitions: WidgetDefinition[] = builtinDefinitions
): WidgetDefinition | undefined {
  return definitions.find((definition) => definition.id === id);
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
// module's own minimum size (when known), and no overlap with any other module.
export function canPlace(
  layout: LayoutState,
  id: WidgetId,
  rect: Rect,
  definitions: WidgetDefinition[] = builtinDefinitions
): boolean {
  if (!isWithinBounds(rect)) return false;
  const definition = getWidgetDefinition(id, definitions);
  if (definition && (rect.w < definition.minW || rect.h < definition.minH)) return false;
  return layout.every((item) => item.id === id || !rectsOverlap(item, rect));
}

// Find the first grid cell (row-major) where a `w`x`h` module fits without
// overlapping the existing layout. Returns null when the grid is full.
export function findFreeSlot(layout: LayoutState, w: number, h: number): Rect | null {
  const width = Math.min(w, GRID_COLS);
  const height = Math.min(h, GRID_ROWS);
  for (let y = 0; y + height <= GRID_ROWS; y += 1) {
    for (let x = 0; x + width <= GRID_COLS; x += 1) {
      const candidate = { x, y, w: width, h: height };
      if (layout.every((item) => !rectsOverlap(item, candidate))) return candidate;
    }
  }
  return null;
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

// Clean a stored layout against the known definitions: drop entries with an
// unknown id, malformed rect, out-of-bounds rect, below-minimum size, duplicate
// id, or overlap with an already-accepted entry. Unlike the old MVP behavior
// this does NOT require every definition to be present — the layout is now a
// free subset of modules the user has chosen to show.
export function normalizeLayout(
  raw: unknown,
  definitions: WidgetDefinition[] = builtinDefinitions
): LayoutState {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<WidgetId>();
  const result: LayoutState = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const id = (entry as { id?: unknown }).id;
    if (typeof id !== 'string') continue;
    const definition = getWidgetDefinition(id, definitions);
    if (!definition) continue;
    if (!isIntRect(entry)) continue;
    if (seen.has(id)) continue;
    const { x, y, w, h } = entry as unknown as Rect;
    const rect = { x, y, w, h };
    if (!isWithinBounds(rect)) continue;
    if (w < definition.minW || h < definition.minH) continue;
    if (result.some((item) => rectsOverlap(item, rect))) continue;
    seen.add(id);
    result.push({ id, x, y, w, h });
  }
  return result;
}
