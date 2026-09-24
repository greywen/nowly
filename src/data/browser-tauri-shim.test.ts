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
