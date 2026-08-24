import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { RepositoryProvider } from '../data/RepositoryContext';
import type { AppSettings, NowlyRepository } from '../data/nowly-repository';
import type { CalendarEvent, EventDraft, Recurrence } from './calendar-model';
import { resizeEventEndToDate, shiftEventToDate, shiftEventToHour } from './calendar-view';
import { useEvents } from './useEvents';

const settings: AppSettings = {
  wallpaperEnabled: false,
  launchAtLogin: false,
  targetMonitorId: null,
  density: 'balanced',
  weekStart: 'monday',
  dateFormat: 'localized',
  showWeekends: true
};

const draft: EventDraft = {
  title: '设计评审',
  startAt: '2026-07-23T14:00',
  endAt: '2026-07-23T15:00',
  allDay: false,
  category: 'work',
  color: 'blue',
  linkedTaskId: null,
  note: '',
  reminders: [],
  recurrence: null
};

function event(id: string, linkedTaskId: string | null = null): CalendarEvent {
  return {
    id,
    ...draft,
    linkedTaskId,
    createdAt: '2026-07-23T09:00:00Z',
    updatedAt: '2026-07-23T09:00:00Z',
    startTz: null,
    endTz: null,
    rrule: null,
    seriesId: null,
    seriesStartAt: null,
    occurrenceStartAt: null,
    subscriptionId: null,
    isOverridden: false
  };
}

const weekly: Recurrence = { freq: 'weekly', interval: 1, byDay: ['TH'], end: { kind: 'never' } };

// 系列展开出来的一个实例：`id` 是系列行 id，`occurrenceStartAt` 才是这一次的身份。
function instance(id: string, slot: string, linkedTaskId: string | null = null): CalendarEvent {
  return {
    ...event(id, linkedTaskId),
    startAt: slot,
    endAt: `${slot.slice(0, 11)}${String(Number(slot.slice(11, 13)) + 1).padStart(2, '0')}:00`,
    recurrence: weekly,
    seriesId: id,
    seriesStartAt: draft.startAt,
    occurrenceStartAt: slot
  };
}

function createRepository(overrides: Partial<NowlyRepository> = {}): NowlyRepository {
  return {
    listEventsInRange: vi.fn().mockResolvedValue([]),
    createEvent: vi.fn().mockRejectedValue(new Error('unexpected write')),
    updateEvent: vi.fn().mockRejectedValue(new Error('unexpected write')),
    deleteEvent: vi.fn().mockRejectedValue(new Error('unexpected write')),
    listTasks: vi.fn().mockResolvedValue([]),
    createTask: vi.fn().mockRejectedValue(new Error('unexpected task write')),
    updateTask: vi.fn().mockRejectedValue(new Error('unexpected task write')),
    deleteTask: vi.fn().mockRejectedValue(new Error('unexpected task write')),
    setTaskCompleted: vi.fn().mockRejectedValue(new Error('unexpected task write')),
    listNotes: vi.fn().mockResolvedValue([]),
    createNote: vi.fn(), updateNote: vi.fn(), deleteNote: vi.fn(),
    getSettings: vi.fn().mockResolvedValue(settings),
    updateSettings: vi.fn().mockResolvedValue(settings),
    listMonitors: vi.fn().mockResolvedValue([]),
    listModuleLayout: vi.fn().mockResolvedValue([]),
    saveModuleLayout: vi.fn().mockImplementation((layout) => Promise.resolve(layout)),
    getModuleState: vi.fn().mockResolvedValue(null),
    setModuleState: vi.fn().mockResolvedValue(undefined), createFocusSession:vi.fn().mockImplementation((session)=>Promise.resolve(session)), listFocusSessions:vi.fn().mockResolvedValue([]), getFocusStatistics:vi.fn().mockResolvedValue({totalFocusedSeconds:0,completedCount:0,interruptedCount:0,completionRate:0,points:[]}),
    listExtensions: vi.fn().mockResolvedValue([]),
    installExtension: vi.fn(),
    uninstallExtension: vi.fn(),
    getKanbanSnapshot: vi.fn().mockResolvedValue({ lanes: [], cards: [], priorities: [], tags: [], collaborators: [] }),
    createKanbanLane: vi.fn(), updateKanbanLane: vi.fn(), deleteKanbanLane: vi.fn(), reorderKanbanLanes: vi.fn(),
    createKanbanCard: vi.fn(), updateKanbanCard: vi.fn(), deleteKanbanCard: vi.fn(), moveKanbanCard: vi.fn(),
    createKanbanPriority: vi.fn(), updateKanbanPriority: vi.fn(), deleteKanbanPriority: vi.fn(), reorderKanbanPriorities: vi.fn(),
    createKanbanTag: vi.fn(), updateKanbanTag: vi.fn(), deleteKanbanTag: vi.fn(),
    createKanbanCollaborator: vi.fn(), updateKanbanCollaborator: vi.fn(), deleteKanbanCollaborator: vi.fn(), proxyFetch: vi.fn(), fetchRegistry: vi.fn(), downloadModule: vi.fn(), listCalendarSubscriptions: vi.fn().mockResolvedValue([]), createCalendarSubscription: vi.fn(), updateCalendarSubscription: vi.fn(), deleteCalendarSubscription: vi.fn(),
    ...overrides
  };
}

function wrapper(repository: NowlyRepository) {
  return ({ children }: { children: ReactNode }) => (
    <RepositoryProvider repository={repository}>{children}</RepositoryProvider>
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const now = () => new Date(2026, 6, 23, 9, 42);

describe('useEvents', () => {
  it('loads the current local month and navigates previous, next, and across years', async () => {
    const repository = createRepository();
    const { result } = renderHook(() => useEvents({ now, onRefreshTasks: vi.fn() }), {
      wrapper: wrapper(repository)
    });

    await waitFor(() => expect(result.current.events.status).toBe('ready'));
    expect(repository.listEventsInRange).toHaveBeenLastCalledWith({
      startAt: '2026-07-01T00:00',
      endAtExclusive: '2026-08-01T00:00'
    });

    act(() => result.current.goToPreviousMonth());
    expect(result.current.events).toEqual({ status: 'loading', data: [] });
    await waitFor(() => expect(result.current.monthIndex).toBe(5));
    act(() => result.current.goToNextMonth());
    await waitFor(() => expect(result.current.monthIndex).toBe(6));
    act(() => result.current.goToMonthContaining('2026-12-15'));
    await waitFor(() => expect(result.current.monthIndex).toBe(11));
    act(() => result.current.goToNextMonth());
    await waitFor(() => expect([result.current.year, result.current.monthIndex]).toEqual([2027, 0]));
    act(() => result.current.goToPreviousMonth());
    await waitFor(() => expect([result.current.year, result.current.monthIndex]).toEqual([2026, 11]));
  });

  it('returns to today and retries a failed month read', async () => {
    const listEventsInRange = vi.fn().mockRejectedValueOnce(new Error('日程读取失败')).mockResolvedValue([]);
    const repository = createRepository({ listEventsInRange });
    const { result } = renderHook(() => useEvents({ now, onRefreshTasks: vi.fn() }), {
      wrapper: wrapper(repository)
    });

    await waitFor(() => expect(result.current.events.status).toBe('error'));
    expect(result.current.events).toMatchObject({ message: '日程读取失败', data: [] });
    await act(() => result.current.retryEvents());
    await waitFor(() => expect(result.current.events.status).toBe('ready'));
    act(() => result.current.goToNextMonth());
    act(() => result.current.goToToday());
    expect([result.current.year, result.current.monthIndex]).toEqual([2026, 6]);
  });

  it('ignores stale success and failure responses from older months', async () => {
    const july = deferred<CalendarEvent[]>();
    const august = deferred<CalendarEvent[]>();
    const repository = createRepository({
      listEventsInRange: vi.fn().mockImplementationOnce(() => july.promise).mockImplementationOnce(() => august.promise)
    });
    const { result } = renderHook(() => useEvents({ now, onRefreshTasks: vi.fn() }), {
      wrapper: wrapper(repository)
    });

    act(() => result.current.goToNextMonth());
    await act(async () => august.resolve([event('august')]));
    await waitFor(() => expect(result.current.events.data).toEqual([event('august')]));
    await act(async () => july.reject(new Error('stale failure')));
    expect(result.current.events).toMatchObject({ status: 'ready', data: [event('august')] });
  });

  it('refreshes the displayed month after create, update, and delete', async () => {
    const existing = event('e1');
    const repository = createRepository({
      listEventsInRange: vi.fn().mockResolvedValue([existing]),
      createEvent: vi.fn().mockResolvedValue(event('e2')),
      updateEvent: vi.fn().mockResolvedValue(undefined),
      deleteEvent: vi.fn().mockResolvedValue(undefined)
    });
    const { result } = renderHook(() => useEvents({ now, onRefreshTasks: vi.fn() }), {
      wrapper: wrapper(repository)
    });
    await waitFor(() => expect(result.current.events.status).toBe('ready'));

    await act(() => result.current.createEvent(draft));
    await act(() => result.current.updateEvent(existing, draft, 'all'));
    await act(() => result.current.deleteEvent(existing, 'all'));
    expect(repository.listEventsInRange).toHaveBeenCalledTimes(4);
  });

  it('refreshes tasks for any linked write but not for unlinked-to-unlinked writes', async () => {
    const onRefreshTasks = vi.fn().mockResolvedValue(undefined);
    const linked = event('linked', 't1');
    const repository = createRepository({
      listEventsInRange: vi.fn().mockResolvedValue([]),
      createEvent: vi.fn().mockResolvedValue(event('created', 't1')),
      updateEvent: vi.fn().mockResolvedValue(undefined),
      deleteEvent: vi.fn().mockResolvedValue(undefined)
    });
    const { result } = renderHook(() => useEvents({ now, onRefreshTasks }), {
      wrapper: wrapper(repository)
    });
    await waitFor(() => expect(result.current.events.status).toBe('ready'));

    await act(() => result.current.createEvent({ ...draft, linkedTaskId: 't1' }));
    await act(() => result.current.updateEvent(linked, draft, 'all'));
    await act(() => result.current.deleteEvent(linked, 'all'));
    expect(onRefreshTasks).toHaveBeenCalledTimes(3);

    // 新建关联：旧实体未关联，只有草稿能告知这次写入会动任务。
    await act(() => result.current.updateEvent(event('plain'), { ...draft, linkedTaskId: 't2' }, 'all'));
    expect(onRefreshTasks).toHaveBeenCalledTimes(4);

    await act(() => result.current.updateEvent(event('plain'), draft, 'all'));
    await act(() => result.current.deleteEvent(event('plain'), 'all'));
    expect(onRefreshTasks).toHaveBeenCalledTimes(4);
  });

  it('rethrows write failures without changing current event data', async () => {
    const existing = event('e1');
    const failure = new Error('保存失败');
    const repository = createRepository({
      listEventsInRange: vi.fn().mockResolvedValue([existing]),
      createEvent: vi.fn().mockRejectedValue(failure)
    });
    const { result } = renderHook(() => useEvents({ now, onRefreshTasks: vi.fn() }), {
      wrapper: wrapper(repository)
    });
    await waitFor(() => expect(result.current.events.data).toEqual([existing]));

    await expect(act(() => result.current.createEvent(draft))).rejects.toBe(failure);
    expect(result.current.events).toEqual({ status: 'ready', data: [existing] });
  });

  it('sends the structured target and the chosen scope for every edit scope', async () => {
    const updateEvent = vi.fn().mockResolvedValue(undefined);
    const deleteEvent = vi.fn().mockResolvedValue(undefined);
    const repository = createRepository({ updateEvent, deleteEvent });
    const { result } = renderHook(() => useEvents({ now, onRefreshTasks: vi.fn() }), {
      wrapper: wrapper(repository)
    });
    await waitFor(() => expect(result.current.events.status).toBe('ready'));

    const first = instance('s1', '2026-07-23T14:00');
    const later = instance('s1', '2026-07-30T14:00');

    await act(() => result.current.updateEvent(first, draft, 'occurrence'));
    expect(updateEvent).toHaveBeenLastCalledWith(
      { id: 's1', occurrenceStartAt: '2026-07-23T14:00' },
      draft,
      'occurrence'
    );
    await act(() => result.current.updateEvent(later, draft, 'thisAndFollowing'));
    expect(updateEvent).toHaveBeenLastCalledWith(
      { id: 's1', occurrenceStartAt: '2026-07-30T14:00' },
      draft,
      'thisAndFollowing'
    );
    await act(() => result.current.updateEvent(later, draft, 'all'));
    expect(updateEvent).toHaveBeenLastCalledWith({ id: 's1', occurrenceStartAt: '2026-07-30T14:00' }, draft, 'all');

    await act(() => result.current.deleteEvent(first, 'occurrence'));
    expect(deleteEvent).toHaveBeenLastCalledWith({ id: 's1', occurrenceStartAt: '2026-07-23T14:00' }, 'occurrence');
    await act(() => result.current.deleteEvent(later, 'thisAndFollowing'));
    expect(deleteEvent).toHaveBeenLastCalledWith(
      { id: 's1', occurrenceStartAt: '2026-07-30T14:00' },
      'thisAndFollowing'
    );
    await act(() => result.current.deleteEvent(later, 'all'));
    expect(deleteEvent).toHaveBeenLastCalledWith({ id: 's1', occurrenceStartAt: '2026-07-30T14:00' }, 'all');
  });

  it('keeps single events on a null occurrence slot and the whole-series scope', async () => {
    const updateEvent = vi.fn().mockResolvedValue(undefined);
    const deleteEvent = vi.fn().mockResolvedValue(undefined);
    const repository = createRepository({ updateEvent, deleteEvent });
    const { result } = renderHook(() => useEvents({ now, onRefreshTasks: vi.fn() }), {
      wrapper: wrapper(repository)
    });
    await waitFor(() => expect(result.current.events.status).toBe('ready'));
    const single = event('e1');

    await act(() => result.current.updateEvent(single, draft, 'all'));
    await act(() => result.current.deleteEvent(single, 'all'));

    expect(updateEvent).toHaveBeenCalledWith({ id: 'e1', occurrenceStartAt: null }, draft, 'all');
    expect(deleteEvent).toHaveBeenCalledWith({ id: 'e1', occurrenceStartAt: null }, 'all');
    // 目标必须是结构化的两键对象，而不是整条实体：多余字段会被后端拒绝。
    expect(Object.keys(updateEvent.mock.calls[0][0]).sort()).toEqual(['id', 'occurrenceStartAt']);
    expect(Object.keys(deleteEvent.mock.calls[0][0]).sort()).toEqual(['id', 'occurrenceStartAt']);
  });

  it('shows the refetched range after a write instead of anything the mutation returned', async () => {
    const before = event('e1');
    const after = { ...event('e1'), title: '改期评审' };
    const listEventsInRange = vi.fn().mockResolvedValueOnce([before]).mockResolvedValue([after]);
    const updateEvent = vi.fn().mockResolvedValue(undefined);
    const repository = createRepository({ listEventsInRange, updateEvent });
    const { result } = renderHook(() => useEvents({ now, onRefreshTasks: vi.fn() }), {
      wrapper: wrapper(repository)
    });
    await waitFor(() => expect(result.current.events.data).toEqual([before]));

    let returned: unknown = 'unset';
    await act(async () => {
      returned = await result.current.updateEvent(before, draft, 'all');
    });

    expect(returned).toBeUndefined();
    expect(listEventsInRange).toHaveBeenCalledTimes(2);
    expect(listEventsInRange).toHaveBeenLastCalledWith({
      startAt: '2026-07-01T00:00',
      endAtExclusive: '2026-08-01T00:00'
    });
    expect(result.current.events).toEqual({ status: 'ready', data: [after] });
  });

  it('drags a recurring instance as one occurrence and a single event as the whole series', async () => {
    const updateEvent = vi.fn().mockResolvedValue(undefined);
    const repository = createRepository({ updateEvent });
    const { result } = renderHook(() => useEvents({ now, onRefreshTasks: vi.fn() }), {
      wrapper: wrapper(repository)
    });
    await waitFor(() => expect(result.current.events.status).toBe('ready'));

    const single = event('e1');
    await act(() => result.current.moveEvent(single, '2026-07-24'));
    expect(updateEvent).toHaveBeenLastCalledWith(
      { id: 'e1', occurrenceStartAt: null },
      shiftEventToDate(single, '2026-07-24'),
      'all'
    );

    const occurrence = instance('s1', '2026-07-23T14:00');
    await act(() => result.current.moveEvent(occurrence, '2026-07-24'));
    expect(updateEvent).toHaveBeenLastCalledWith(
      { id: 's1', occurrenceStartAt: '2026-07-23T14:00' },
      shiftEventToDate(occurrence, '2026-07-24'),
      'occurrence'
    );

    await act(() => result.current.moveEventToHour(occurrence, '2026-07-23', 9));
    expect(updateEvent).toHaveBeenLastCalledWith(
      { id: 's1', occurrenceStartAt: '2026-07-23T14:00' },
      shiftEventToHour(occurrence, '2026-07-23', 9),
      'occurrence'
    );

    await act(() => result.current.resizeEvent(occurrence, '2026-07-25'));
    expect(updateEvent).toHaveBeenLastCalledWith(
      { id: 's1', occurrenceStartAt: '2026-07-23T14:00' },
      resizeEventEndToDate(occurrence, '2026-07-25'),
      'occurrence'
    );
  });
});
