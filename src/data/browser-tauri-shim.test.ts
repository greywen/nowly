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
  localStorage.clear();
  vi.restoreAllMocks();
});

const clock = { id: 'local', timeZone: 'local', label: '', mode: 'digital', hourCycle: 'h23', showSeconds: false, showLabel: false, showDate: false, showDifference: false };
const alarmDraft = { title: 'Break', hour: 9, minute: 7, repeat: { kind: 'weekly', weekdays: [1, 5] }, enabled: true };

describe('browser time persistence', () => {
  it('defaults to one minimal local digital clock and no alarms or notices', async () => {
    installBrowserTauriBackend();
    expect(await invoke()('get_time_settings')).toEqual({ clocks: [clock] });
    expect(await invoke()('list_alarms')).toEqual([]);
    expect(await invoke()('get_status_island_snapshot')).toHaveProperty('alarmNotices', []);
  });

  it('round trips settings and alarm CRUD across reinstall without altering calendar events', async () => {
    installBrowserTauriBackend();
    const settings = { clocks: [{ ...clock, id: 'tokyo', timeZone: 'Asia/Tokyo', mode: 'mixed', showDate: true }] };
    expect(await invoke()('save_time_settings', { settings })).toEqual(settings);
    const alarm = await invoke()('create_alarm', { draft: alarmDraft }) as Record<string, unknown>;
    expect(alarm).toEqual({ ...alarmDraft, id: expect.any(String), createdAt: expect.any(String), updatedAt: expect.any(String) });
    const updated = await invoke()('update_alarm', { id: alarm.id, draft: { ...alarmDraft, title: 'Edited', enabled: false } });
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
    installBrowserTauriBackend();
    expect(await invoke()('get_time_settings')).toEqual(settings);
    expect(await invoke()('list_alarms')).toEqual([updated]);
    expect(await invoke()('list_events_in_range', { range: { startAt: '2000', endAtExclusive: '2100' } })).toEqual([]);
    await invoke()('delete_alarm', { id: alarm.id });
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
    installBrowserTauriBackend();
    expect(await invoke()('list_alarms')).toEqual([]);
  });

  it.each([
    { clocks: [] },
    { clocks: [{ ...clock, timeZone: 'Not/AZone' }] },
    { clocks: [{ ...clock, mode: 'invalid' }] },
    { clocks: [{ ...clock, hourCycle: 'h24' }] },
    { clocks: [{ ...clock, showSeconds: 'yes' }] },
    { clocks: [clock, clock] }
  ])('rejects invalid clock settings without persisting them: %j', async settings => {
    installBrowserTauriBackend();
    await expect(invoke()('save_time_settings', { settings })).rejects.toMatchObject({ code: 'validation_error' });
    expect(await invoke()('get_time_settings')).toEqual({ clocks: [clock] });
  });

  it.each([
    { ...alarmDraft, title: ' ' }, { ...alarmDraft, hour: 24 }, { ...alarmDraft, minute: 1.5 },
    { ...alarmDraft, repeat: { kind: 'weekly', weekdays: [] } },
    { ...alarmDraft, repeat: { kind: 'weekly', weekdays: [0, 8] } },
    { ...alarmDraft, repeat: { kind: 'weekly', weekdays: [1, 1] } },
    { ...alarmDraft, repeat: { kind: 'once', date: '2000-01-01' } },
    { ...alarmDraft, repeat: { kind: 'once', date: '2099-02-30' } }
  ])('rejects invalid alarm drafts without storing them: %j', async draft => {
    installBrowserTauriBackend();
    await expect(invoke()('create_alarm', { draft })).rejects.toMatchObject({ code: 'validation_error' });
    expect(await invoke()('list_alarms')).toEqual([]);
  });

  it('validates once alarms against the local minute, and supports future dates', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 11, 9, 7, 30));
    try {
      installBrowserTauriBackend();
      await expect(invoke()('create_alarm', { draft: { ...alarmDraft, repeat: { kind: 'once', date: '2026-10-11' } } })).rejects.toMatchObject({ code: 'validation_error' });
      expect(await invoke()('create_alarm', { draft: { ...alarmDraft, minute: 8, repeat: { kind: 'once', date: '2026-10-11' } } })).toMatchObject({ minute: 8 });
    } finally { vi.useRealTimers(); }
  });

  it.each(['update_alarm', 'delete_alarm'])('rejects missing alarm ids for %s', async command => {
    installBrowserTauriBackend();
    await expect(invoke()(command, { id: 'missing', draft: alarmDraft })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('uses only explicit persisted notice fixtures and consumes ack/snooze idempotently', async () => {
    const notice = { id: 'notice-1', kind: 'alarm', title: 'Break', alarmId: 'a1', dueAt: '2026-10-11T09:07:00Z', count: 1, rangeStart: '2026-10-11T09:07:00Z', rangeEnd: '2026-10-11T09:07:00Z' };
    const summary = { ...notice, id: 'summary', kind: 'missedSummary', alarmId: null, count: 4 };
    localStorage.setItem(storageKey, JSON.stringify({ alarmNotices: [notice, summary] }));
    installBrowserTauriBackend();
    expect(await invoke()('get_status_island_snapshot')).toHaveProperty('alarmNotices', [notice, summary]);
    await expect(invoke()('snooze_alarm_notice', { id: 'summary' })).rejects.toMatchObject({ code: 'validation_error' });
    await invoke()('snooze_alarm_notice', { id: notice.id });
    await invoke()('snooze_alarm_notice', { id: notice.id });
    expect(await invoke()('get_status_island_snapshot')).toHaveProperty('alarmNotices', [summary]);
    await invoke()('acknowledge_alarm_notice', { id: 'summary' });
    await invoke()('acknowledge_alarm_notice', { id: 'summary' });
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
    installBrowserTauriBackend();
    expect(await invoke()('get_status_island_snapshot')).toHaveProperty('alarmNotices', []);
  });

  it('never synthesizes notices from alarms as time advances in the browser', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 11, 9, 0));
    try {
      installBrowserTauriBackend();
      await invoke()('create_alarm', { draft: { ...alarmDraft, repeat: { kind: 'once', date: '2026-10-11' } } });
      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
      expect(await invoke()('get_status_island_snapshot')).toHaveProperty('alarmNotices', []);
    } finally { vi.useRealTimers(); }
  });
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
  it('opens and closes the current menu through shell events without opening a removed route', async () => {
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
