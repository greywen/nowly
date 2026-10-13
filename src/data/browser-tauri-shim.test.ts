import { afterEach, describe, expect, it, vi } from 'vitest';
import { listen } from '@tauri-apps/api/event';
import { installBrowserTauriBackend } from './browser-tauri-shim';

const storageKey = 'nowly:browser-backend';
const defaultMenu = [
  { id: 'screenshot', visible: true },
  { id: 'screenshotHistory', visible: true },
  { id: 'assistant', visible: true }
];

type BrowserInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

function invoke(): BrowserInvoke {
  const internals = Reflect.get(window, '__TAURI_INTERNALS__') as { invoke: BrowserInvoke };
  return internals.invoke;
}

afterEach(() => {
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
  Reflect.deleteProperty(window, '__TAURI_EVENT_PLUGIN_INTERNALS__');
  vi.unstubAllGlobals();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('browser focus coordinator', () => {
  it('broadcasts the same seconds it exposes in both snapshots and freezes on pause', async () => {
    vi.useFakeTimers();
    try {
      installBrowserTauriBackend();
      const updated = vi.fn();
      const remove = await listen('focus-timer-updated', updated);
      await invoke()('start_focus_timer', { snapshot: { id: 'session', plannedSeconds: 60, startedAt: new Date().toISOString() }, remainingSeconds: 60 });
      await vi.advanceTimersByTimeAsync(1250);
      expect(await invoke()('get_focus_timer_snapshot')).toEqual(expect.objectContaining({ remainingSeconds: 59, focusedSeconds: 1 }));
      expect(updated).toHaveBeenLastCalledWith(expect.objectContaining({ payload: expect.objectContaining({ remainingSeconds: 59 }) }));
      await invoke()('pause_focus_timer');
      await vi.advanceTimersByTimeAsync(3000);
      expect(await invoke()('get_status_island_snapshot')).toEqual(expect.objectContaining({ focus: expect.objectContaining({ status: 'paused', remainingSeconds: 59 }) }));
      await invoke()('resume_focus_timer');
      await vi.advanceTimersByTimeAsync(750);
      expect(await invoke()('get_focus_timer_snapshot')).toEqual(expect.objectContaining({ remainingSeconds: 58 }));
      await invoke()('cancel_focus_timer');
      remove();
    } finally { vi.useRealTimers(); }
  });
});

describe('browser Bar shell commands', () => {
  it('coordinates notification-only strip, pointer, notification and panel holds', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    installBrowserTauriBackend();
    await invoke()('update_app_settings', { settings: { notificationMode: 'notification' } });
    expect(await invoke()('get_status_island_presentation')).toEqual(expect.objectContaining({ strip: true }));
    await invoke()('set_status_island_presence', { surface: 'island', present: true });
    expect(await invoke()('get_status_island_presentation')).toEqual(expect.objectContaining({ strip: false }));
    await invoke()('toggle_bar_menu');
    await invoke()('set_status_island_presence', { surface: 'island', present: false });
    expect(await invoke()('get_status_island_presentation')).toEqual(expect.objectContaining({ strip: false }));
    await invoke()('set_status_island_visibility', { visible: true });
    await invoke()('close_status_island_details');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(await invoke()('get_status_island_presentation')).toEqual(expect.objectContaining({ strip: false }));
    await invoke()('set_status_island_visibility', { visible: false });
    expect(await invoke()('get_status_island_presentation')).toEqual(expect.objectContaining({ strip: true }));
  });

  it('opens and closes the current menu through shell events without opening a removed route', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    const openWindow = vi.spyOn(window, 'open').mockReturnValue(null);
    installBrowserTauriBackend();
    const opened = vi.fn();
    const closed = vi.fn();
    const unlistenOpen = await listen('status-island-details-open', opened);
    const unlistenClose = await listen('status-island-details-close', closed);
    await invoke()('toggle_bar_menu');
    expect(opened).toHaveBeenCalledWith(expect.objectContaining({
      payload: { generation: 1, source: 'menu', identity: null }
    }));
    await invoke()('toggle_bar_menu');
    expect(closed).toHaveBeenCalledWith(expect.objectContaining({ payload: { generation: 2 } }));
    expect(openWindow).not.toHaveBeenCalled();
    await expect(invoke()('toggle_screenshot_menu')).rejects.toEqual(expect.objectContaining({ code: 'system_error' }));
    await expect(invoke()('close_screenshot_menu')).rejects.toEqual(expect.objectContaining({ code: 'system_error' }));
    unlistenOpen();
    unlistenClose();
  });
  it('switches menu to assistant and history within the same shell and unlistens correctly', async () => {
    const openWindow = vi.spyOn(window, 'open').mockReturnValue(null);
    installBrowserTauriBackend();
    const opened = vi.fn();
    const remove = await listen('status-island-details-open', opened);
    await invoke()('toggle_bar_menu');
    await invoke()('toggle_nowly_panel');
    await invoke()('open_screenshot_history');
    expect(opened.mock.calls.map(([event]) => event.payload.source)).toEqual(['menu', 'nowly', 'history']);
    remove();
    await invoke()('toggle_bar_menu');
    expect(opened).toHaveBeenCalledTimes(3);
    expect(openWindow).not.toHaveBeenCalled();
  });
});

describe('browser bar menu persistence', () => {
  it.each([{ barButtons: [] }, { barButtons: ['screenshot'] }])('replaces legacy buttons $barButtons with durable defaults', async ({ barButtons }) => {
    localStorage.setItem(storageKey, JSON.stringify({ settings: { barButtons } }));
    installBrowserTauriBackend();
    expect(await invoke()('get_app_settings')).toEqual(expect.objectContaining({ barMenu: defaultMenu }));
    const stored = JSON.parse(localStorage.getItem(storageKey)!);
    expect(stored.settings.barMenu).toEqual(defaultMenu);
    expect(stored.settings).not.toHaveProperty('barButtons');
  });
  it('preserves hidden item order after save and reinstall', async () => {
    installBrowserTauriBackend();
    const barMenu = [
      { id: 'assistant', visible: false }, { id: 'screenshotHistory', visible: false },
      { id: 'screenshot', visible: false }
    ];
    const settings = await invoke()('get_app_settings') as Record<string, unknown>;
    await invoke()('update_app_settings', { settings: { ...settings, barMenu } });
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
    installBrowserTauriBackend();
    expect(await invoke()('get_app_settings')).toEqual(expect.objectContaining({ barMenu }));
    expect(await invoke()('get_status_island_snapshot')).toEqual(expect.objectContaining({ barMenu }));
  });
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
