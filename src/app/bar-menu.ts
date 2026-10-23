import type { QuickCreateKind } from '../quick-create/request';

export type BarFeatureId = 'screenshot' | 'screenshotHistory' | 'assistant' | 'createEvent' | 'createTask' | 'createNote';
export type BarMenuItem = { id: BarFeatureId; visible: boolean };
export type BarMenuGroupId = 'create' | 'capture';

// New features are appended so menus stored by older versions normalize
// without reordering what the user already arranged.
export const DEFAULT_BAR_MENU: readonly BarMenuItem[] = [
  { id: 'screenshot', visible: true },
  { id: 'screenshotHistory', visible: true },
  { id: 'assistant', visible: true },
  { id: 'createEvent', visible: true },
  { id: 'createTask', visible: true },
  { id: 'createNote', visible: true }
];

/** Display order of the groups is fixed; only items inside a group can be reordered. */
export const BAR_MENU_GROUPS: ReadonlyArray<{ id: BarMenuGroupId; ids: readonly BarFeatureId[] }> = [
  { id: 'create', ids: ['createEvent', 'createTask', 'createNote'] },
  { id: 'capture', ids: ['screenshot', 'screenshotHistory', 'assistant'] }
];

const quickCreateKinds: Partial<Record<BarFeatureId, QuickCreateKind>> = {
  createEvent: 'event',
  createTask: 'task',
  createNote: 'note'
};

export function normalizeBarMenu(value: unknown): BarMenuItem[] {
  const result: BarMenuItem[] = [];
  const seen = new Set<string>();
  for (const entry of Array.isArray(value) ? value : []) {
    if (!entry || typeof entry !== 'object') continue;
    const { id, visible } = entry;
    if (!DEFAULT_BAR_MENU.some(item => item.id === id) || seen.has(id)) continue;
    seen.add(id);
    result.push({ id: id as BarFeatureId, visible: typeof visible === 'boolean' ? visible : true });
  }
  for (const item of DEFAULT_BAR_MENU) {
    if (!seen.has(item.id)) result.push({ ...item });
  }
  return result;
}

export function barMenuGroupOf(id: BarFeatureId): BarMenuGroupId {
  return BAR_MENU_GROUPS.find(group => group.ids.includes(id))?.id ?? 'capture';
}

export function quickCreateKindOf(id: BarFeatureId): QuickCreateKind | null {
  return quickCreateKinds[id] ?? null;
}

export function groupBarMenu(items: readonly BarMenuItem[], include: (item: BarMenuItem) => boolean) {
  return BAR_MENU_GROUPS.map(group => ({
    id: group.id,
    items: items.filter(item => group.ids.includes(item.id) && include(item))
  }));
}

/** Swaps an item with the nearest non-excluded neighbour of the same group. */
export function moveBarMenuItem(
  items: readonly BarMenuItem[],
  id: BarFeatureId,
  offset: -1 | 1,
  exclude: ReadonlySet<BarFeatureId> = new Set()
): BarMenuItem[] {
  const group = barMenuGroupOf(id);
  const peers = items.filter(item => barMenuGroupOf(item.id) === group && !exclude.has(item.id));
  const index = peers.findIndex(item => item.id === id);
  const target = index < 0 ? undefined : peers[index + offset];
  const next = [...items];
  if (!target) return next;
  const from = next.findIndex(item => item.id === id);
  const to = next.findIndex(item => item.id === target.id);
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}
