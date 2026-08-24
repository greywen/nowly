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
  showWeekends: true
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
    createKanbanCollaborator: vi.fn(), updateKanbanCollaborator: vi.fn(), deleteKanbanCollaborator: vi.fn(), proxyFetch: vi.fn(), fetchRegistry: vi.fn(), downloadModule: vi.fn(), listCalendarSubscriptions: vi.fn().mockResolvedValue([]), createCalendarSubscription: vi.fn(), updateCalendarSubscription: vi.fn(), deleteCalendarSubscription: vi.fn(), refreshCalendarSubscription: vi.fn(), listExternalEventsInRange: vi.fn().mockResolvedValue([]),
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

  it('optimistically completes, disables duplicate writes, and accepts the server entity', async () => {
    const open = task('open');
    const write = deferred<MatrixTask>();
    const setTaskCompleted = vi.fn(() => write.promise);
    const repository = createRepository({
      listTasks: vi.fn().mockResolvedValue([open, task('later', { dueAt: null })]),
      setTaskCompleted
    });
    const { result } = renderHook(() => useTasks({ onRefreshEvents: vi.fn() }), {
      wrapper: wrapper(repository)
    });
    await waitFor(() => expect(result.current.tasks.status).toBe('ready'));

    act(() => { void result.current.setTaskCompleted(open, true); });
    expect(result.current.tasks.data.find((item) => item.id === open.id)?.completed).toBe(true);
    expect(result.current.pendingTaskIds.has(open.id)).toBe(true);
    act(() => { void result.current.setTaskCompleted(open, true); });
    expect(setTaskCompleted).toHaveBeenCalledOnce();

    await act(async () => write.resolve({ ...open, completed: true, updatedAt: 'server' }));
    expect(result.current.pendingTaskIds.has(open.id)).toBe(false);
    expect(result.current.tasks.data.find((item) => item.id === open.id)?.updatedAt).toBe('server');
    expect(result.current.failedCompletion).toBeNull();
  });

  it('rolls back a failed completion and retries the original target', async () => {
    const open = task('open');
    const setTaskCompleted = vi.fn()
      .mockRejectedValueOnce({ message: '完成状态保存失败' })
      .mockResolvedValueOnce({ ...open, completed: true, updatedAt: 'retry' });
    const repository = createRepository({
      listTasks: vi.fn().mockResolvedValue([open]),
      setTaskCompleted
    });
    const { result } = renderHook(() => useTasks({ onRefreshEvents: vi.fn() }), {
      wrapper: wrapper(repository)
    });
    await waitFor(() => expect(result.current.tasks.status).toBe('ready'));

    await act(() => result.current.setTaskCompleted(open, true));
    expect(result.current.tasks.data[0].completed).toBe(false);
    expect(result.current.failedCompletion).toMatchObject({
      taskId: open.id,
      targetCompleted: true,
      message: '完成状态保存失败'
    });

    await act(() => result.current.retryFailedCompletion());
    expect(setTaskCompleted).toHaveBeenLastCalledWith(open.id, true);
    expect(result.current.tasks.data[0]).toMatchObject({ completed: true, updatedAt: 'retry' });
    expect(result.current.failedCompletion).toBeNull();

    act(() => result.current.dismissTaskError());
    expect(result.current.failedCompletion).toBeNull();
  });

  it('invalidates a failed completion after editing or deleting the task', async () => {
    const open = task('open');
    const changed = task('open', { title: '已编辑' });
    const listTasks = vi.fn()
      .mockResolvedValueOnce([open])
      .mockResolvedValueOnce([changed])
      .mockResolvedValueOnce([changed])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const repository = createRepository({
      listTasks,
      setTaskCompleted: vi.fn().mockRejectedValue({ message: '完成失败' }),
      updateTask: vi.fn().mockResolvedValue(changed),
      deleteTask: vi.fn().mockResolvedValue(undefined)
    });
    const { result } = renderHook(() => useTasks({ onRefreshEvents: vi.fn() }), {
      wrapper: wrapper(repository)
    });
    await waitFor(() => expect(result.current.tasks.status).toBe('ready'));

    await act(() => result.current.setTaskCompleted(open, true));
    await act(() => result.current.updateTask(open, { ...draft, title: '已编辑' }));
    await act(() => result.current.retryFailedCompletion());
    expect(repository.setTaskCompleted).toHaveBeenCalledOnce();
    expect(listTasks).toHaveBeenCalledTimes(3);

    await act(() => result.current.setTaskCompleted(changed, true));
    await act(() => result.current.deleteTask(changed));
    await act(() => result.current.retryFailedCompletion());
    expect(repository.setTaskCompleted).toHaveBeenCalledTimes(2);
    expect(listTasks).toHaveBeenCalledTimes(5);
  });

  it('does not let an older completion response overwrite a newer edit', async () => {
    const open = task('open');
    const older = deferred<MatrixTask>();
    const edited = task('open', { title: '已编辑', updatedAt: 'newer' });
    const repository = createRepository({
      listTasks: vi.fn().mockResolvedValueOnce([open]).mockResolvedValue([edited]),
      setTaskCompleted: vi.fn(() => older.promise),
      updateTask: vi.fn().mockResolvedValue(edited)
    });
    const { result } = renderHook(() => useTasks({ onRefreshEvents: vi.fn() }), {
      wrapper: wrapper(repository)
    });
    await waitFor(() => expect(result.current.tasks.status).toBe('ready'));

    act(() => { void result.current.setTaskCompleted(open, true); });
    await act(() => result.current.updateTask(open, { ...draft, title: '已编辑' }));
    await act(async () => older.resolve({ ...open, completed: true, updatedAt: 'older' }));

    expect(result.current.tasks.data[0]).toMatchObject({ title: '已编辑', updatedAt: 'newer' });
    expect(result.current.pendingTaskIds.has(open.id)).toBe(false);
  });
});
