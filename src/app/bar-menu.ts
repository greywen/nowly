export type BarFeatureId = 'screenshot' | 'screenshotHistory' | 'assistant';
export type BarMenuItem = { id: BarFeatureId; visible: boolean };

export const DEFAULT_BAR_MENU: readonly BarMenuItem[] = [
  { id: 'screenshot', visible: true },
  { id: 'screenshotHistory', visible: true },
  { id: 'assistant', visible: true }
];

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
