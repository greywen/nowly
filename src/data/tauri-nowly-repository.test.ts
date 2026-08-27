import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditScope, EventDraft } from '../calendar/calendar-model';
import { tauriNowlyRepository } from './tauri-nowly-repository';

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

describe('tauriNowlyRepository', () => {
  beforeEach(() => invokeMock.mockReset());

  it('owns the exact event and startup IPC contracts', async () => {
    invokeMock.mockResolvedValue(undefined);
    const range = {
      startAt: '2026-07-01T00:00',
      endAtExclusive: '2026-08-01T00:00'
    };
    const draft = {
      title: '设计评审',
      startAt: '2026-07-23T14:00',
      endAt: '2026-07-23T15:00',
      allDay: false,
      category: 'work' as const,
      color: 'blue' as const,
      linkedTaskId: null,
      note: '',
      reminders: [],
      recurrence: null
    };

    const taskDraft = {
      title: '发布 Nowly',
      quadrant: 'important_urgent' as const,
      dueAt: '2026-07-23',
      priority: 1 as const,
      completed: false,
      linkedEventId: 'e1',
      note: ''
    };

    await tauriNowlyRepository.listEventsInRange(range);
    await tauriNowlyRepository.createEvent(draft);
    await tauriNowlyRepository.updateEvent({ id: 'e1', occurrenceStartAt: null }, draft, 'all');
    await tauriNowlyRepository.deleteEvent({ id: 'e1', occurrenceStartAt: null }, 'all');
    await tauriNowlyRepository.listTasks();
    await tauriNowlyRepository.createTask(taskDraft);
    await tauriNowlyRepository.updateTask('t1', taskDraft);
    await tauriNowlyRepository.deleteTask('t1');
    await tauriNowlyRepository.setTaskCompleted('t1', true);
    const noteDraft = { title: '产品原则', content: '保持简单', color: '#4F55DA' as const, pinned: true, icon: 'smile' as const };
    await tauriNowlyRepository.listNotes();
    await tauriNowlyRepository.createNote(noteDraft);
    await tauriNowlyRepository.updateNote('n1', noteDraft);
    await tauriNowlyRepository.deleteNote('n1');
    await tauriNowlyRepository.getSettings();
    await tauriNowlyRepository.listMonitors();
    await tauriNowlyRepository.updateSettings({
      wallpaperEnabled:false, launchAtLogin:false, targetMonitorId:null,
      density:'balanced', weekStart:'monday', dateFormat:'localized',
      showWeekends:true
    });
    const layoutEntry = { id: 'calendar', x: 0, y: 0, w: 7, h: 8 };
    await tauriNowlyRepository.listModuleLayout();
    await tauriNowlyRepository.saveModuleLayout([layoutEntry]);
    await tauriNowlyRepository.getModuleState('focusTimer');
    await tauriNowlyRepository.setModuleState('focusTimer', '{"durationMinutes":15}');
    const extensionDraft = { name: '计数器', description: '', source: 'Nowly.defineModule(()=>{});', permissions: ['state' as const], allowedHosts: [], defaultW: 4, defaultH: 4 };
    await tauriNowlyRepository.listExtensions();
    await tauriNowlyRepository.installExtension(extensionDraft);
    await tauriNowlyRepository.uninstallExtension('x1');
    const subscriptionDraft = {
      name: '家庭',
      url: 'https://example.com/a.ics',
      color: '#4FC9DA' as const,
      refreshIntervalMinutes: 15
    };
    await tauriNowlyRepository.listCalendarSubscriptions();
    await tauriNowlyRepository.createCalendarSubscription(subscriptionDraft);
    await tauriNowlyRepository.updateCalendarSubscription('s1', subscriptionDraft);
    await tauriNowlyRepository.deleteCalendarSubscription('s1');
    await tauriNowlyRepository.listExternalEventsInRange(range);

    expect(invokeMock.mock.calls).toContainEqual(['list_events_in_range', { range }]);
    expect(invokeMock.mock.calls).toContainEqual(['list_external_events_in_range', { range }]);
    expect(invokeMock.mock.calls).toContainEqual(['create_event', { draft }]);
    expect(invokeMock.mock.calls).toContainEqual([
      'update_event',
      { target: { id: 'e1', occurrenceStartAt: null }, draft, scope: 'all' }
    ]);
    expect(invokeMock.mock.calls).toContainEqual([
      'delete_event',
      { target: { id: 'e1', occurrenceStartAt: null }, scope: 'all' }
    ]);
    expect(invokeMock.mock.calls).toContainEqual(['list_tasks']);
    expect(invokeMock.mock.calls).toContainEqual(['create_task', { draft: taskDraft }]);
    expect(invokeMock.mock.calls).toContainEqual(['update_task', { id: 't1', draft: taskDraft }]);
    expect(invokeMock.mock.calls).toContainEqual(['delete_task', { id: 't1' }]);
    expect(invokeMock.mock.calls).toContainEqual(['set_task_completed', { id: 't1', completed: true }]);
    expect(invokeMock.mock.calls).toContainEqual(['list_notes']);
    expect(invokeMock.mock.calls).toContainEqual(['create_note', { draft: noteDraft }]);
    expect(invokeMock.mock.calls).toContainEqual(['update_note', { id: 'n1', draft: noteDraft }]);
    expect(invokeMock.mock.calls).toContainEqual(['delete_note', { id: 'n1' }]);
    expect(invokeMock.mock.calls).toContainEqual(['get_app_settings']);
    expect(invokeMock.mock.calls).toContainEqual(['list_monitors']);
    expect(invokeMock.mock.calls).toContainEqual(['update_app_settings', { settings: expect.objectContaining({ density:'balanced' }) }]);
    expect(invokeMock.mock.calls).toContainEqual(['list_module_layout']);
    expect(invokeMock.mock.calls).toContainEqual(['save_module_layout', { layout: [layoutEntry] }]);
    expect(invokeMock.mock.calls).toContainEqual(['get_module_state', { moduleId: 'focusTimer' }]);
    expect(invokeMock.mock.calls).toContainEqual(['set_module_state', { moduleId: 'focusTimer', state: '{"durationMinutes":15}' }]);
    expect(invokeMock.mock.calls).toContainEqual(['list_extensions']);
    expect(invokeMock.mock.calls).toContainEqual(['install_extension', { draft: extensionDraft }]);
    expect(invokeMock.mock.calls).toContainEqual(['uninstall_extension', { id: 'x1' }]);
    expect(invokeMock.mock.calls).toContainEqual(['list_calendar_subscriptions']);
    expect(invokeMock.mock.calls).toContainEqual(['create_calendar_subscription', { draft: subscriptionDraft }]);
    expect(invokeMock.mock.calls).toContainEqual(['update_calendar_subscription', { id: 's1', draft: subscriptionDraft }]);
    expect(invokeMock.mock.calls).toContainEqual(['delete_calendar_subscription', { id: 's1' }]);
  });

  it('forwards the occurrence target and every edit scope verbatim', async () => {
    invokeMock.mockResolvedValue(undefined);
    const draft: EventDraft = {
      title: '周会',
      startAt: '2026-08-10T10:00',
      endAt: '2026-08-10T11:00',
      allDay: false,
      category: 'work',
      color: '#1F9C8A',
      linkedTaskId: null,
      note: '',
      reminders: [],
      recurrence: { freq: 'weekly', interval: 1, byDay: ['MO'], end: { kind: 'never' } }
    };
    const target = { id: 's1', occurrenceStartAt: '2026-08-10T10:00' };
    const scopes: EditScope[] = ['occurrence', 'thisAndFollowing', 'all'];

    for (const scope of scopes) {
      await tauriNowlyRepository.updateEvent(target, draft, scope);
      await tauriNowlyRepository.deleteEvent(target, scope);
    }

    const updates = invokeMock.mock.calls.filter(([command]) => command === 'update_event');
    const deletions = invokeMock.mock.calls.filter(([command]) => command === 'delete_event');
    expect(updates.map(([, payload]) => payload)).toEqual([
      { target, draft, scope: 'occurrence' },
      { target, draft, scope: 'thisAndFollowing' },
      { target, draft, scope: 'all' }
    ]);
    expect(deletions.map(([, payload]) => payload)).toEqual([
      { target, scope: 'occurrence' },
      { target, scope: 'thisAndFollowing' },
      { target, scope: 'all' }
    ]);
    // 载荷的键集合必须精确：残留的旧 `id` 键会被后端当作未知字段而反序列化失败。
    expect(Object.keys(updates[0][1] as object).sort()).toEqual(['draft', 'scope', 'target']);
    expect(Object.keys(deletions[0][1] as object).sort()).toEqual(['scope', 'target']);
    expect(Object.keys(updates[0][1].target as object).sort()).toEqual(['id', 'occurrenceStartAt']);
  });
});
