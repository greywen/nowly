// Event names shared with `src-tauri/src/quick_create.rs` and the main window.
export const QUICK_CREATE_OPEN_EVENT = 'quick-create-open';
export const QUICK_CREATE_CLOSE_REQUESTED_EVENT = 'quick-create-close-requested';

/** Emitted after the quick-create window writes data, so the main window reloads it. */
export const RECORDS_CHANGED_EVENT = 'nowly-records-changed';
export type RecordsChangedKind = 'event' | 'task' | 'note' | 'category';
export type RecordsChanged = { kind: RecordsChangedKind };

const RECORDS_CHANGED_KINDS: readonly RecordsChangedKind[] = ['event', 'task', 'note', 'category'];

export function recordsChangedKind(payload: unknown): RecordsChangedKind | null {
  if (!payload || typeof payload !== 'object') return null;
  const { kind } = payload as Record<string, unknown>;
  return typeof kind === 'string' && (RECORDS_CHANGED_KINDS as readonly string[]).includes(kind)
    ? kind as RecordsChangedKind
    : null;
}
