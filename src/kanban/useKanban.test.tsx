import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { RepositoryProvider } from '../data/RepositoryContext';
import type { NowlyRepository } from '../data/nowly-repository';
import type { KanbanCard, KanbanLane, KanbanSnapshot } from './kanban-model';
import { useKanban } from './useKanban';

function lane(id: string, position: number): KanbanLane {
  return { id, name: id, color: 'primary', position, createdAt: 'x', updatedAt: 'x' };
}

function card(id: string, laneId: string, position: number): KanbanCard {
  return {
    id, laneId, title: id, description: null, dueDate: null, priorityId: null,
    position, tagIds: [], collaboratorIds: [], createdAt: 'x', updatedAt: 'x'
  };
}

const baseSnapshot: KanbanSnapshot = {
  lanes: [lane('lane-a', 0), lane('lane-b', 1)],
  cards: [card('c1', 'lane-a', 0), card('c2', 'lane-a', 1), card('c3', 'lane-b', 0)],
  priorities: [],
  tags: [],
  collaborators: []
};

function repository(overrides: Partial<NowlyRepository> = {}): NowlyRepository {
  return {
    listEventsInRange: vi.fn().mockResolvedValue([]), createEvent: vi.fn(), updateEvent: vi.fn(), deleteEvent: vi.fn(),
    listTasks: vi.fn().mockResolvedValue([]), createTask: vi.fn(), updateTask: vi.fn(), deleteTask: vi.fn(), setTaskCompleted: vi.fn(),
    listNotes: vi.fn().mockResolvedValue([]), createNote: vi.fn(), updateNote: vi.fn(), deleteNote: vi.fn(),
    getSettings: vi.fn(), updateSettings: vi.fn(), listMonitors: vi.fn(),
    listModuleLayout: vi.fn().mockResolvedValue([]), saveModuleLayout: vi.fn(),
    getModuleState: vi.fn().mockResolvedValue(null), setModuleState: vi.fn().mockResolvedValue(undefined), createFocusSession:vi.fn().mockImplementation((session)=>Promise.resolve(session)), listFocusSessions:vi.fn().mockResolvedValue([]), getFocusStatistics:vi.fn().mockResolvedValue({totalFocusedSeconds:0,completedCount:0,interruptedCount:0,completionRate:0,points:[]}),
    listExtensions: vi.fn().mockResolvedValue([]), installExtension: vi.fn(), uninstallExtension: vi.fn(),
    getKanbanSnapshot: vi.fn().mockResolvedValue(baseSnapshot),
    createKanbanLane: vi.fn(), updateKanbanLane: vi.fn(), deleteKanbanLane: vi.fn().mockResolvedValue(undefined),
    reorderKanbanLanes: vi.fn().mockResolvedValue([]),
    createKanbanCard: vi.fn(), updateKanbanCard: vi.fn(), deleteKanbanCard: vi.fn(),
    moveKanbanCard: vi.fn().mockResolvedValue(undefined),
    createKanbanPriority: vi.fn(), updateKanbanPriority: vi.fn(), deleteKanbanPriority: vi.fn(), reorderKanbanPriorities: vi.fn(),
    createKanbanTag: vi.fn(), updateKanbanTag: vi.fn(), deleteKanbanTag: vi.fn(),
    createKanbanCollaborator: vi.fn(), updateKanbanCollaborator: vi.fn(), deleteKanbanCollaborator: vi.fn(), proxyFetch: vi.fn(), fetchRegistry: vi.fn(), downloadModule: vi.fn(), listCalendarSubscriptions: vi.fn().mockResolvedValue([]), createCalendarSubscription: vi.fn(), updateCalendarSubscription: vi.fn(), deleteCalendarSubscription: vi.fn(), refreshCalendarSubscription: vi.fn(), listExternalEventsInRange: vi.fn().mockResolvedValue([]),
    ...overrides
  };
}

function wrapper(repo: NowlyRepository) {
  return ({ children }: { children: ReactNode }) => (
    <RepositoryProvider repository={repo}>{children}</RepositoryProvider>
  );
}

describe('useKanban', () => {
  it('loads a snapshot sorted by lane and card position', async () => {
    const { result } = renderHook(() => useKanban(), { wrapper: wrapper(repository()) });
    await waitFor(() => expect(result.current.snapshot.status).toBe('ready'));
    expect(result.current.snapshot.data.lanes.map((l) => l.id)).toEqual(['lane-a', 'lane-b']);
    expect(result.current.snapshot.data.cards.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
  });

  it('retains data on read failure and retries', async () => {
    const getKanbanSnapshot = vi.fn()
      .mockResolvedValueOnce(baseSnapshot)
      .mockRejectedValueOnce({ message: '读取失败' })
      .mockResolvedValueOnce(baseSnapshot);
    const { result } = renderHook(() => useKanban(), { wrapper: wrapper(repository({ getKanbanSnapshot })) });
    await waitFor(() => expect(result.current.snapshot.status).toBe('ready'));
    await act(() => result.current.retry());
    expect(result.current.snapshot).toMatchObject({ status: 'error', message: '读取失败' });
    expect(result.current.snapshot.data.lanes).toHaveLength(2);
    await act(() => result.current.retry());
    expect(result.current.snapshot.status).toBe('ready');
  });

  it('reloads after a successful card create', async () => {
    const repo = repository({ createKanbanCard: vi.fn().mockResolvedValue(card('c4', 'lane-b', 1)) });
    const { result } = renderHook(() => useKanban(), { wrapper: wrapper(repo) });
    await waitFor(() => expect(result.current.snapshot.status).toBe('ready'));
    await act(() => result.current.createCard({
      laneId: 'lane-b', title: '新任务', description: null, dueDate: null,
      priorityId: null, tagIds: [], collaboratorIds: []
    }));
    expect(repo.createKanbanCard).toHaveBeenCalledOnce();
    expect(repo.getKanbanSnapshot).toHaveBeenCalledTimes(2);
  });

  it('optimistically moves a card and keeps it on success', async () => {
    const repo = repository();
    const { result } = renderHook(() => useKanban(), { wrapper: wrapper(repo) });
    await waitFor(() => expect(result.current.snapshot.status).toBe('ready'));
    await act(() => result.current.moveCard('c1', 'lane-b', 0));
    expect(repo.moveKanbanCard).toHaveBeenCalledWith('c1', 'lane-b', 0);
    // After the optimistic move c1 now belongs to lane-b at index 0.
    const moved = result.current.snapshot.data.cards.find((c) => c.id === 'c1');
    expect(moved?.laneId).toBe('lane-b');
  });

  it('rolls back the snapshot when a card move fails and exposes a retry', async () => {
    const moveKanbanCard = vi.fn().mockRejectedValue({ message: '移动失败' });
    const repo = repository({ moveKanbanCard });
    const { result } = renderHook(() => useKanban(), { wrapper: wrapper(repo) });
    await waitFor(() => expect(result.current.snapshot.status).toBe('ready'));
    await act(() => result.current.moveCard('c1', 'lane-b', 0));
    const rolledBack = result.current.snapshot.data.cards.find((c) => c.id === 'c1');
    expect(rolledBack?.laneId).toBe('lane-a');
    expect(result.current.dragError).toBe('移动失败');
  });

  it('optimistically reorders lanes and rolls back on failure', async () => {
    const reorderKanbanLanes = vi.fn().mockRejectedValue({ message: '排序失败' });
    const repo = repository({ reorderKanbanLanes });
    const { result } = renderHook(() => useKanban(), { wrapper: wrapper(repo) });
    await waitFor(() => expect(result.current.snapshot.status).toBe('ready'));
    await act(() => result.current.reorderLanes(['lane-b', 'lane-a']));
    expect(result.current.snapshot.data.lanes.map((l) => l.id)).toEqual(['lane-a', 'lane-b']);
    expect(result.current.dragError).toBe('排序失败');
  });
});
