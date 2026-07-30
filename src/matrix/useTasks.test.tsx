import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { RepositoryProvider } from '../data/RepositoryContext';
import type { AppSettings, NowlyRepository } from '../data/nowly-repository';
import type { MatrixTask, TaskDraft } from './matrix-model';
import { useTasks } from './useTasks';

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

const draft: TaskDraft = {
  title: '发布 Nowly',
  quadrant: 'important_urgent',
  dueAt: '2026-07-23',
  priority: 1,
  completed: false,
  linkedEventId: null,
  note: ''
};

function task(id: string, overrides: Partial<MatrixTask> = {}): MatrixTask {
  return {
    id,
    ...draft,
    createdAt: '2026-07-23T09:00:00Z',
    updatedAt: '2026-07-23T09:00:00Z',
    ...overrides
  };
}

function createRepository(overrides: Partial<NowlyRepository> = {}): NowlyRepository {
  return {
    listEventsInRange: vi.fn().mockResolvedValue([]),
    createEvent: vi.fn().mockRejectedValue(new Error('unexpected event write')),
    updateEvent: vi.fn().mockRejectedValue(new Error('unexpected event write')),
    deleteEvent: vi.fn().mockRejectedValue(new Error('unexpected event write')),
    listTasks: vi.fn().mockResolvedValue([]),
    createTask: vi.fn().mockRejectedValue(new Error('unexpected task write')),
    updateTask: vi.fn().mockRejectedValue(new Error('unexpected task write')),
    deleteTask: vi.fn().mockRejectedValue(new Error('unexpected task write')),
    setTaskCompleted: vi.fn().mockRejectedValue(new Error('unexpected completion write')),
    listNotes: vi.fn().mockResolvedValue([]),
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

describe('useTasks', () => {
  it('loads and stably sorts tasks while ignoring an older read', async () => {
    const first = deferred<MatrixTask[]>();
    const retry = deferred<MatrixTask[]>();
    const open = task('open');
    const done = task('done', { completed: true, dueAt: '2026-07-01' });
    const repository = createRepository({
      listTasks: vi.fn().mockImplementationOnce(() => first.promise).mockImplementationOnce(() => retry.promise)
    });
    const { result } = renderHook(() => useTasks({ onRefreshEvents: vi.fn() }), {
      wrapper: wrapper(repository)
    });

    act(() => { void result.current.retryTasks(); });
    await act(async () => retry.resolve([done, open]));
    await waitFor(() => expect(result.current.tasks.data.map((item) => item.id)).toEqual(['open', 'done']));
    await act(async () => first.resolve([task('stale')]));
    expect(result.current.tasks.data.map((item) => item.id)).toEqual(['open', 'done']);
  });

  it('reports read failures and retries without discarding existing data', async () => {
    const existing = task('existing');
    const listTasks = vi.fn().mockResolvedValueOnce([existing]).mockRejectedValueOnce(new Error('任务读取失败'));
    const repository = createRepository({ listTasks });
    const { result } = renderHook(() => useTasks({ onRefreshEvents: vi.fn() }), {
      wrapper: wrapper(repository)
    });
    await waitFor(() => expect(result.current.tasks.status).toBe('ready'));

    await act(() => result.current.retryTasks());
    expect(result.current.tasks).toEqual({ status: 'error', data: [existing], message: '任务读取失败' });
  });

  it('refreshes events only when CRUD changes a relationship', async () => {
    const linked = task('linked', { linkedEventId: 'e1' });
    const unlinked = task('linked', { linkedEventId: null });
    const onRefreshEvents = vi.fn().mockResolvedValue(undefined);
    const repository = createRepository({
      createTask: vi.fn().mockResolvedValue(linked),
      updateTask: vi.fn().mockResolvedValue(unlinked),
      deleteTask: vi.fn().mockResolvedValue(undefined)
    });
    const { result } = renderHook(() => useTasks({ onRefreshEvents }), {
      wrapper: wrapper(repository)
    });
    await waitFor(() => expect(result.current.tasks.status).toBe('ready'));

    await act(() => result.current.createTask({ ...draft, linkedEventId: 'e1' }));
    await act(() => result.current.updateTask(linked, draft));
    await act(() => result.current.deleteTask(unlinked));

    expect(repository.listTasks).toHaveBeenCalledTimes(4);
    expect(onRefreshEvents).toHaveBeenCalledTimes(2);
  });

  it('rethrows failed writes without refreshing or mutating ready data', async () => {
    const existing = task('existing');
    const failure = new Error('保存失败');
    const onRefreshEvents = vi.fn();
    const repository = createRepository({
      listTasks: vi.fn().mockResolvedValue([existing]),
      createTask: vi.fn().mockRejectedValue(failure)
    });
    const { result } = renderHook(() => useTasks({ onRefreshEvents }), {
      wrapper: wrapper(repository)
    });
    await waitFor(() => expect(result.current.tasks.data).toEqual([existing]));

    await expect(act(() => result.current.createTask(draft))).rejects.toBe(failure);
    expect(result.current.tasks).toEqual({ status: 'ready', data: [existing] });
    expect(repository.listTasks).toHaveBeenCalledOnce();
    expect(onRefreshEvents).not.toHaveBeenCalled();
  });
});
