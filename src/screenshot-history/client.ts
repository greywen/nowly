import { convertFileSrc, invoke } from '@tauri-apps/api/core';

export type ScreenshotHistoryEntry = {
  id: string; fileName: string; createdAt: string;
  width: number; height: number; byteSize: number; available: boolean;
};
export type ScreenshotHistoryPage = { items: ScreenshotHistoryEntry[]; nextCursor: string | null };
export type ShortcutBinding = { shortcut: string; registered: boolean; error: string | null };
export type ScreenshotShortcutStatus = {
  screenshot: ShortcutBinding;
  history: ShortcutBinding;
  // Quick-create bindings are optional; `null` means no shortcut is set.
  createEvent: ShortcutBinding | null;
  createTask: ShortcutBinding | null;
  createNote: ShortcutBinding | null;
};

function binding(value: unknown): value is ShortcutBinding {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Partial<ShortcutBinding>;
  return typeof item.shortcut === 'string' && item.shortcut.trim().length > 0 && typeof item.registered === 'boolean';
}

function optionalBinding(value: unknown): ShortcutBinding | null {
  if (!binding(value)) return null;
  return { shortcut: value.shortcut, registered: value.registered, error: typeof value.error === 'string' ? value.error : null };
}

// Native uses nested bindings; the browser development shim also supports its
// older flat status payload. Reject malformed successful IPC responses.
export function normalizeShortcutStatus(value: unknown): ScreenshotShortcutStatus {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid shortcut status');
  const status = value as Record<string, unknown>;
  const create = {
    createEvent: optionalBinding(status.createEvent),
    createTask: optionalBinding(status.createTask),
    createNote: optionalBinding(status.createNote)
  };
  if (binding(status.screenshot) && binding(status.history)) return { screenshot: status.screenshot, history: status.history, ...create };
  const error = typeof status.error === 'string' ? status.error : null;
  const screenshot = { shortcut: status.screenshotShortcut, registered: status.screenshotRegistered, error };
  const history = { shortcut: status.screenshotHistoryShortcut, registered: status.screenshotHistoryRegistered, error };
  if (binding(screenshot) && binding(history)) return { screenshot, history, ...create };
  throw new Error('Invalid shortcut status');
}
export const listScreenshotHistory = (cursor: string | null) => invoke<ScreenshotHistoryPage>('list_screenshot_history', { cursor });
export const copyScreenshotHistory = (id: string) => invoke('copy_screenshot_history', { id });
export const deleteScreenshotHistory = (id: string) => invoke('delete_screenshot_history', { id });
export const thumbnailUrl = (id: string) => convertFileSrc(id, 'screenshot-history');
