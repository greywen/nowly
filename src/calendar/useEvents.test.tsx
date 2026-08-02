import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { RepositoryProvider } from '../data/RepositoryContext';
import type { AppSettings, NowlyRepository } from '../data/nowly-repository';
import type { CalendarEvent, EventDraft } from './calendar-model';
import { useEvents } from './useEvents';

const settings: AppSettings = {
  wallpaperEnabled: false,
  launchAtLogin: false,
  targetMonitorId: null,
  density: 'balanced',
  weekStart: 'monday',
  dateFormat: 'localized',
  showWeekends: true,
  calendarEnabled: true,
  matrixEnabled: true,
  notesEnabled: true
};

const draft: EventDraft = {
  title: '设计评审',
  startAt: '2026-07-23T14:00',
  endAt: '2026-07-23T15:00',
  allDay: false,
  category: 'work',
  color: 'blue',
  linkedTaskId: null,
  note: ''
};

function event(id: string, linkedTaskId: string | null = null): CalendarEvent {
  return {
    id,
    ...draft,
    linkedTaskId,
    createdAt: '2026-07-23T09:00:00Z',
    updatedAt: '2026-07-23T09:00:00Z'
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
      updateEvent: vi.fn().mockResolvedValue(event('e1')),
      deleteEvent: vi.fn().mockResolvedValue(undefined)
    });
    const { result } = renderHook(() => useEvents({ now, onRefreshTasks: vi.fn() }), {
      wrapper: wrapper(repository)
    });
    await waitFor(() => expect(result.current.events.status).toBe('ready'));

    await act(() => result.current.createEvent(draft));
    await act(() => result.current.updateEvent(existing, draft));
    await act(() => result.current.deleteEvent(existing));
    expect(repository.listEventsInRange).toHaveBeenCalledTimes(4);
  });

  it('refreshes tasks for any linked write but not for unlinked-to-unlinked writes', async () => {
    const onRefreshTasks = vi.fn().mockResolvedValue(undefined);
    const linked = event('linked', 't1');
    const repository = createRepository({
      listEventsInRange: vi.fn().mockResolvedValue([]),
      createEvent: vi.fn().mockResolvedValue(event('created', 't1')),
      updateEvent: vi.fn().mockResolvedValue(event('updated')),
      deleteEvent: vi.fn().mockResolvedValue(undefined)
    });
    const { result } = renderHook(() => useEvents({ now, onRefreshTasks }), {
      wrapper: wrapper(repository)
    });
    await waitFor(() => expect(result.current.events.status).toBe('ready'));

    await act(() => result.current.createEvent({ ...draft, linkedTaskId: 't1' }));
    await act(() => result.current.updateEvent(linked, draft));
    await act(() => result.current.deleteEvent(linked));
    expect(onRefreshTasks).toHaveBeenCalledTimes(3);

    await act(() => result.current.updateEvent(event('plain'), draft));
    await act(() => result.current.deleteEvent(event('plain')));
    expect(onRefreshTasks).toHaveBeenCalledTimes(3);
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
});
