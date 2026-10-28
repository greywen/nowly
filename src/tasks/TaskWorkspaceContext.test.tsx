import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { RepositoryProvider } from '../data/RepositoryContext';
import type { NowlyRepository } from '../data/nowly-repository';
import { TaskWorkspaceProvider, useTaskWorkspace } from './TaskWorkspaceContext';
import type { Task, TaskWorkspaceSnapshot } from './task-model';

function task(id: string): Task {
  return {
    id, title: id, description: '', priority: 'important_urgent', dueDate: null, completed: false,
    laneId: 'lane-a', boardPosition: 0, tagIds: [], collaboratorIds: [], views: ['kanban', 'matrix'], steps: [],
    createdAt: 'x', updatedAt: 'x'
  };
}

function snapshot(tasks: Task[]): TaskWorkspaceSnapshot {
  return {
    tasks,
    lanes: [{ id: 'lane-a', name: '待处理', color: '#4FC9DA', position: 0, createdAt: 'x', updatedAt: 'x' }],
    tags: [],
    collaborators: [],
    linkingEnabled: true,
    defaultLaneId: 'lane-a',
    completionLaneId: 'lane-a',
    viewPreferences: {}
  };
}

function wrapper(repository: Partial<NowlyRepository>) {
  return ({ children }: { children: ReactNode }) => (
    <RepositoryProvider repository={repository as NowlyRepository}>
      <TaskWorkspaceProvider>{children}</TaskWorkspaceProvider>
    </RepositoryProvider>
  );
}

describe('TaskWorkspaceProvider', () => {
  it('refreshes for changes made elsewhere without a loading state or a read error', async () => {
    let finish!: (value: TaskWorkspaceSnapshot) => void;
    const getTaskWorkspaceSnapshot = vi.fn()
      .mockResolvedValueOnce(snapshot([task('t1')]))
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
      .mockRejectedValueOnce({ message: '读取失败' });
    const { result } = renderHook(() => useTaskWorkspace(), { wrapper: wrapper({ getTaskWorkspaceSnapshot }) });
    await waitFor(() => expect(result.current.workspace.status).toBe('ready'));

    let refreshed!: Promise<void>;
    act(() => { refreshed = result.current.refresh(); });
    expect(result.current.workspace.status).toBe('ready');
    await act(async () => {
      finish(snapshot([task('t1'), task('t2')]));
      await refreshed;
    });
    expect(result.current.workspace.data.tasks.map(({ id }) => id)).toEqual(['t1', 't2']);
    await act(() => result.current.refresh());
    expect(result.current.workspace.status).toBe('ready');
    expect(result.current.workspace.data.tasks).toHaveLength(2);
  });

  it('gives tasks from snapshots that predate steps an empty step list', async () => {
    const { steps: _steps, ...legacy } = task('t1');
    const getTaskWorkspaceSnapshot = vi.fn().mockResolvedValue(snapshot([legacy as Task]));
    const { result } = renderHook(() => useTaskWorkspace(), { wrapper: wrapper({ getTaskWorkspaceSnapshot }) });
    await waitFor(() => expect(result.current.workspace.status).toBe('ready'));
    expect(result.current.workspace.data.tasks[0].steps).toEqual([]);
  });
});
