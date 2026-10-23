export type QuickCreateKind = 'event' | 'task' | 'note';
export const QUICK_CREATE_KINDS: readonly QuickCreateKind[] = ['event', 'task', 'note'];

/** One open request for the quick-create window, issued by the native side. */
export type QuickCreateRequest = { id: number; kind: QuickCreateKind; maxHeight: number };

export function isQuickCreateKind(value: unknown): value is QuickCreateKind {
  return typeof value === 'string' && (QUICK_CREATE_KINDS as readonly string[]).includes(value);
}

export function normalizeQuickCreateRequest(value: unknown): QuickCreateRequest | null {
  if (!value || typeof value !== 'object') return null;
  const { id, kind, maxHeight } = value as Record<string, unknown>;
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 0 || !isQuickCreateKind(kind)) return null;
  if (typeof maxHeight !== 'number' || !Number.isFinite(maxHeight) || maxHeight <= 0) return null;
  return { id, kind, maxHeight };
}
