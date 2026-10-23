import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), convertFileSrc: vi.fn() }));

import { normalizeShortcutStatus } from './client';

const screenshot = { shortcut: 'Ctrl+Alt+A', registered: true, error: null };
const history = { shortcut: 'Ctrl+Alt+H', registered: false, error: 'conflict' };

describe('normalizeShortcutStatus', () => {
  it('keeps the screenshot bindings and treats unset quick-create bindings as null', () => {
    expect(normalizeShortcutStatus({
      screenshot, history,
      createEvent: { shortcut: 'Ctrl+Alt+E', registered: true, error: null },
      createTask: { shortcut: '', registered: false, error: null },
      createNote: { shortcut: 'Ctrl+Alt+N', registered: false, error: 'conflict' }
    })).toEqual({
      screenshot, history,
      createEvent: { shortcut: 'Ctrl+Alt+E', registered: true, error: null },
      createTask: null,
      createNote: { shortcut: 'Ctrl+Alt+N', registered: false, error: 'conflict' }
    });
  });
  it('accepts payloads without quick-create bindings', () => {
    expect(normalizeShortcutStatus({ screenshot, history })).toEqual({
      screenshot, history, createEvent: null, createTask: null, createNote: null
    });
    expect(normalizeShortcutStatus({
      screenshotShortcut: 'Ctrl+Alt+A', screenshotRegistered: true,
      screenshotHistoryShortcut: 'Ctrl+Alt+H', screenshotHistoryRegistered: true
    })).toMatchObject({ createEvent: null, createTask: null, createNote: null });
  });
  it('still rejects missing screenshot bindings', () => {
    expect(() => normalizeShortcutStatus({ history })).toThrow('Invalid shortcut status');
    expect(() => normalizeShortcutStatus(null)).toThrow('Invalid shortcut status');
  });
});
