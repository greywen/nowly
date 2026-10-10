import { afterEach, describe, expect, it } from 'vitest';
import { installBrowserTauriBackend } from './browser-tauri-shim';

const storageKey = 'nowly:browser-backend';

type BrowserInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

function invoke(): BrowserInvoke {
  const internals = Reflect.get(window, '__TAURI_INTERNALS__') as { invoke: BrowserInvoke };
  return internals.invoke;
}

afterEach(() => {
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
  localStorage.clear();
});

describe('browser screenshot history fallback', () => {
  it('returns empty history and exposes shortcut defaults without pretending native output works', async () => {
    installBrowserTauriBackend();
    expect(await invoke()('list_screenshot_history', { cursor: null })).toEqual({ items: [], nextCursor: null });
    const status = await invoke()('screenshot_shortcut_status') as Record<string, unknown>;
    expect(status).toEqual({
      screenshot: { shortcut: 'Ctrl+Alt+A', registered: false, error: expect.any(String) },
      history: { shortcut: 'Ctrl+Alt+H', registered: false, error: expect.any(String) }
    });
    await expect(invoke()('copy_screenshot_history', { id: 'missing' })).rejects.toThrow();
    await expect(invoke()('open_screenshot_folder')).rejects.toThrow();
  });
});

describe('browser Tauri task linking compatibility', () => {
  it('durably repairs legacy false linking and coordinates every eligible view', async () => {
    localStorage.setItem(storageKey, JSON.stringify({
      events: [],
      subscriptions: [],
      oauthAccounts: [],
      externalEvents: [],
      tasks: [{
        id: 'task-1',
        title: '发布 Nowly',
        description: '',
        priority: 'important_urgent',
        dueDate: '2026-09-15',
        completed: false,
        laneId: 'kanban-lane-todo',
        boardPosition: 0,
        tagIds: [],
        collaboratorIds: [],
        views: ['kanban'],
        createdAt: '2026-09-15T00:00:00.000Z',
        updatedAt: '2026-09-15T00:00:00.000Z'
      }],
      notes: [],
      settings: { taskViewLinkingEnabled: false },
      moduleLayout: [],
      focusSessions: [],
      extensions: [],
      kanban: { lanes: [], cards: [], priorities: [], tags: [], collaborators: [] }
    }));

    installBrowserTauriBackend();

    const stored = JSON.parse(localStorage.getItem(storageKey) ?? '{}');
    expect(stored.settings.taskViewLinkingEnabled).toBe(true);
    expect(stored.tasks[0].views).toEqual(['kanban', 'matrix']);

    const disabled = await invoke()('set_task_view_linking', { enabled: false }) as {
      linkingEnabled: boolean;
      tasks: Array<{ views: string[] }>;
    };
    expect(disabled.linkingEnabled).toBe(true);
    expect(disabled.tasks[0].views).toEqual(['kanban', 'matrix']);

    const membershipAttempt = await invoke()('set_task_view_memberships', {
      id: 'task-1',
      views: ['kanban']
    }) as { views: string[] };
    expect(membershipAttempt.views).toEqual(['kanban', 'matrix']);
  });
});
