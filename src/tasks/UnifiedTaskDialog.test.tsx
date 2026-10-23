import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { RepositoryProvider } from '../data/RepositoryContext';
import type { NowlyRepository } from '../data/nowly-repository';
import { TaskWorkspaceProvider, useTaskWorkspace } from './TaskWorkspaceContext';
import type { Task, TaskWorkspaceSnapshot } from './task-model';
import { UnifiedTaskDialog } from './UnifiedTaskDialog';

const workspace: TaskWorkspaceSnapshot = {
  tasks: [],
  lanes: [{ id: 'lane-a', name: '待处理', color: '#4FC9DA', position: 0, createdAt: 'x', updatedAt: 'x' }],
  tags: [],
  collaborators: [],
  linkingEnabled: true,
  defaultLaneId: 'lane-a',
  completionLaneId: 'lane-a',
  viewPreferences: {}
};

const created: Task = {
  id: 'task-1', title: '整理周报', description: '', priority: 'important_urgent', dueDate: null, completed: false,
  laneId: 'lane-a', boardPosition: 0, tagIds: [], collaboratorIds: [], views: ['kanban', 'matrix'],
  createdAt: 'x', updatedAt: 'x'
};

// The create form seeds its lane from the loaded workspace, as the app only
// opens it once the workspace is ready.
function WhenReady({ children }: { children: ReactNode }) {
  return useTaskWorkspace().workspace.status === 'ready' ? <>{children}</> : null;
}

function wrapper(repository: Partial<NowlyRepository>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <RepositoryProvider repository={repository as NowlyRepository}>
        <TaskWorkspaceProvider><WhenReady>{children}</WhenReady></TaskWorkspaceProvider>
      </RepositoryProvider>
    );
  };
}

describe('UnifiedTaskDialog', () => {
  it('reports dirtiness and hands the saved task to the host before closing', async () => {
    const user = userEvent.setup();
    const createWorkspaceTask = vi.fn().mockResolvedValue(created);
    const onDirtyChange = vi.fn();
    const onSaved = vi.fn();
    const onClose = vi.fn();
    render(
      <UnifiedTaskDialog mode={{ type: 'create', originView: 'matrix', dueDate: null }}
        onClose={onClose} onSaved={onSaved} onDirtyChange={onDirtyChange} />,
      { wrapper: wrapper({ getTaskWorkspaceSnapshot: vi.fn().mockResolvedValue(workspace), createWorkspaceTask }) }
    );
    await waitFor(() => expect(screen.getByRole('combobox', { name: '看板泳道' })).toHaveTextContent('待处理'));
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);

    await user.type(screen.getByLabelText('任务标题'), '整理周报');
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    await user.click(screen.getByRole('button', { name: '保存任务' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(created));
    expect(createWorkspaceTask).toHaveBeenCalledWith('matrix', expect.objectContaining({ title: '整理周报', laneId: 'lane-a' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSaved.mock.invocationCallOrder[0]).toBeLessThan(onClose.mock.invocationCallOrder[0]);
  });
});
