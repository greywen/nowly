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

export type SizePreset = { id: string; label: string; cols: number; rows: number };

export type WidgetDefinition = {
  id: WidgetId;
  name: string;
  presets: SizePreset[];
  defaultPresetId: string;
};

export type ModuleLayout = { id: WidgetId; presetId: string };
export type LayoutState = ModuleLayout[];

export const widgetDefinitions: WidgetDefinition[] = [
  {
    id: 'calendar',
    name: '日历',
    presets: [
      { id: 'medium', label: '中', cols: 6, rows: 4 },
      { id: 'large', label: '大', cols: 8, rows: 6 }
    ],
    defaultPresetId: 'large'
  },
  {
    id: 'matrix',
    name: '四象限',
    presets: [
      { id: 'small', label: '小', cols: 4, rows: 4 },
      { id: 'medium', label: '中', cols: 6, rows: 5 }
    ],
    defaultPresetId: 'medium'
  },
  {
    id: 'notes',
    name: '便签',
    presets: [
      { id: 'small', label: '小', cols: 3, rows: 3 },
      { id: 'medium', label: '中', cols: 4, rows: 5 }
    ],
    defaultPresetId: 'small'
  }
];

export const defaultLayout: LayoutState = widgetDefinitions.map((definition) => ({
  id: definition.id,
  presetId: definition.defaultPresetId
}));

export function getWidgetDefinition(id: WidgetId): WidgetDefinition | undefined {
  return widgetDefinitions.find((definition) => definition.id === id);
}

export function getPreset(id: WidgetId, presetId: string): SizePreset | undefined {
  return getWidgetDefinition(id)?.presets.find((preset) => preset.id === presetId);
}

export function getNextPresetId(id: WidgetId, presetId: string): string {
  const definition = getWidgetDefinition(id);
  if (!definition) return presetId;
  const index = definition.presets.findIndex((preset) => preset.id === presetId);
  const next = definition.presets[(index + 1) % definition.presets.length];
  return next.id;
}

export function reorderLayout(layout: LayoutState, fromId: WidgetId, toId: WidgetId): LayoutState {
  if (fromId === toId) return layout;
  const fromIndex = layout.findIndex((item) => item.id === fromId);
  const toIndex = layout.findIndex((item) => item.id === toId);
  if (fromIndex === -1 || toIndex === -1) return layout;
  const next = layout.filter((item) => item.id !== fromId);
  const insertAt = next.findIndex((item) => item.id === toId);
  next.splice(insertAt, 0, layout[fromIndex]);
  return next;
}

export function normalizeLayout(raw: unknown): LayoutState {
  if (!Array.isArray(raw)) return defaultLayout;
  const seen = new Set<WidgetId>();
  const result: LayoutState = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) return defaultLayout;
    const id = (item as { id?: unknown }).id;
    const presetId = (item as { presetId?: unknown }).presetId;
    if (typeof id !== 'string' || typeof presetId !== 'string') return defaultLayout;
    const definition = getWidgetDefinition(id as WidgetId);
    if (!definition) return defaultLayout;
    if (!definition.presets.some((preset) => preset.id === presetId)) return defaultLayout;
    if (seen.has(id as WidgetId)) continue;
    seen.add(id as WidgetId);
    result.push({ id: id as WidgetId, presetId });
  }
  for (const definition of widgetDefinitions) {
    if (!seen.has(definition.id)) {
      result.push({ id: definition.id, presetId: definition.defaultPresetId });
    }
  }
  return result;
}
