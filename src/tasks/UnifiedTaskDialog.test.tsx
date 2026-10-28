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
  lanes: [
    { id: 'lane-a', name: '待处理', color: '#4FC9DA', position: 0, createdAt: 'x', updatedAt: 'x' },
    { id: 'lane-done', name: '已完成', color: '#B8D935', position: 1, createdAt: 'x', updatedAt: 'x' }
  ],
  tags: [],
  defaultLaneId: 'lane-a',
  completionLaneId: 'lane-done',
  viewPreferences: {}
};

const created: Task = {
  id: 'task-1', title: '整理周报', description: '', priority: 'important_urgent', dueDate: null, completed: false,
  laneId: 'lane-a', boardPosition: 0, tagIds: [], steps: [],
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
      <UnifiedTaskDialog mode={{ type: 'create', dueDate: null }}
        onClose={onClose} onSaved={onSaved} onDirtyChange={onDirtyChange} />,
      { wrapper: wrapper({ getTaskWorkspaceSnapshot: vi.fn().mockResolvedValue(workspace), createWorkspaceTask }) }
    );
    await waitFor(() => expect(screen.getByRole('combobox', { name: '看板泳道' })).toHaveTextContent('待处理'));
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);

    await user.type(screen.getByLabelText('任务标题'), '整理周报');
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    await user.click(screen.getByRole('button', { name: '保存任务' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(created));
    expect(createWorkspaceTask).toHaveBeenCalledWith(expect.objectContaining({ title: '整理周报', laneId: 'lane-a' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSaved.mock.invocationCallOrder[0]).toBeLessThan(onClose.mock.invocationCallOrder[0]);
  });

  it('saves steps added while creating, including text still in the step input', async () => {
    const user = userEvent.setup();
    const createWorkspaceTask = vi.fn().mockResolvedValue(created);
    render(<UnifiedTaskDialog mode={{ type: 'create', dueDate: null }} onClose={vi.fn()} />,
      { wrapper: wrapper({ getTaskWorkspaceSnapshot: vi.fn().mockResolvedValue(workspace), createWorkspaceTask }) });
    await user.type(await screen.findByLabelText('任务标题'), '整理周报');
    const stepInput = screen.getByRole('textbox', { name: '新步骤' });
    await user.type(stepInput, '收集数据{Enter}');
    expect(createWorkspaceTask).not.toHaveBeenCalled();
    await user.type(stepInput, '写摘要');
    await user.click(screen.getByRole('button', { name: '添加' }));
    await user.type(stepInput, '  发送  ');
    await user.click(screen.getByRole('button', { name: '保存任务' }));
    await waitFor(() => expect(createWorkspaceTask).toHaveBeenCalledWith(expect.objectContaining({
      steps: [
        { id: null, title: '收集数据', completed: false },
        { id: null, title: '写摘要', completed: false },
        { id: null, title: '发送', completed: false }
      ]
    })));
  });

  it('still saves with Enter in the title now that the form has a second text box', async () => {
    const user = userEvent.setup();
    const createWorkspaceTask = vi.fn().mockResolvedValue(created);
    render(<UnifiedTaskDialog mode={{ type: 'create', dueDate: null }} onClose={vi.fn()} />,
      { wrapper: wrapper({ getTaskWorkspaceSnapshot: vi.fn().mockResolvedValue(workspace), createWorkspaceTask }) });
    await user.type(await screen.findByLabelText('任务标题'), '整理周报{Enter}');
    await waitFor(() => expect(createWorkspaceTask).toHaveBeenCalledWith(
      expect.objectContaining({ title: '整理周报', steps: [] })));
  });

  it('edits stored steps and sends them in their new order', async () => {
    const user = userEvent.setup();
    const stored: Task = { ...created, steps: [{ id: 's1', title: '一', completed: false }, { id: 's2', title: '二', completed: false }] };
    const updateWorkspaceTask = vi.fn().mockResolvedValue(stored);
    const onDirtyChange = vi.fn();
    render(<UnifiedTaskDialog mode={{ type: 'edit', task: stored }} onClose={vi.fn()} onDirtyChange={onDirtyChange} />,
      { wrapper: wrapper({ getTaskWorkspaceSnapshot: vi.fn().mockResolvedValue({ ...workspace, tasks: [stored] }), updateWorkspaceTask }) });
    await screen.findByLabelText('任务标题');
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    await user.click(screen.getByRole('checkbox', { name: '完成步骤：一' }));
    await user.click(screen.getByRole('button', { name: '删除步骤：二' }));
    await user.type(screen.getByRole('textbox', { name: '新步骤' }), '三{Enter}');
    screen.getByRole('button', { name: '调整步骤顺序：三' }).focus();
    await user.keyboard('{ArrowUp}');
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    await user.click(screen.getByRole('button', { name: '保存任务' }));
    await waitFor(() => expect(updateWorkspaceTask).toHaveBeenCalledWith('task-1', expect.objectContaining({
      steps: [{ id: null, title: '三', completed: false }, { id: 's1', title: '一', completed: true }]
    })));
  });

  it('keeps the dialog open on Escape in a step edit and saves a rename left open when saving', async () => {
    const user = userEvent.setup();
    const stored: Task = { ...created, steps: [{ id: 's1', title: '一', completed: false }] };
    const updateWorkspaceTask = vi.fn().mockResolvedValue(stored);
    const onClose = vi.fn();
    const onDirtyChange = vi.fn();
    render(<UnifiedTaskDialog mode={{ type: 'edit', task: stored }} onClose={onClose} onDirtyChange={onDirtyChange} />,
      { wrapper: wrapper({ getTaskWorkspaceSnapshot: vi.fn().mockResolvedValue({ ...workspace, tasks: [stored] }), updateWorkspaceTask }) });
    await user.click(await screen.findByRole('button', { name: '编辑步骤：一' }));
    await user.type(screen.getByRole('textbox', { name: '步骤内容' }), '改');
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    await user.click(screen.getByRole('button', { name: '编辑步骤：一' }));
    await user.type(screen.getByRole('textbox', { name: '步骤内容' }), '二');
    await user.click(screen.getByRole('button', { name: '保存任务' }));
    await waitFor(() => expect(updateWorkspaceTask).toHaveBeenCalledWith('task-1', expect.objectContaining({
      steps: [{ id: 's1', title: '一二', completed: false }]
    })));
  });

  it('defaults new tasks to the fourth quadrant and offers no completed checkbox or collaborators', async () => {
    const user = userEvent.setup();
    const createWorkspaceTask = vi.fn().mockResolvedValue(created);
    render(<UnifiedTaskDialog mode={{ type: 'create', dueDate: null }} onClose={vi.fn()} />,
      { wrapper: wrapper({ getTaskWorkspaceSnapshot: vi.fn().mockResolvedValue(workspace), createWorkspaceTask }) });
    await screen.findByLabelText('任务标题');
    expect(screen.getAllByRole('radio').map((radio) => radio.closest('label')?.textContent)).toEqual([
      '重要且紧急', '重要不紧急', '不重要但紧急', '不重要不紧急'
    ]);
    expect(screen.getByRole('radio', { name: '不重要不紧急' })).toBeChecked();
    expect(screen.queryByRole('checkbox', { name: '已完成' })).not.toBeInTheDocument();
    expect(screen.queryByText('协作人')).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: '重要不紧急' }));
    await user.type(screen.getByLabelText('任务标题'), '读书{Enter}');
    await waitFor(() => expect(createWorkspaceTask).toHaveBeenCalledWith(expect.objectContaining({
      priority: 'important_not_urgent', completed: false, laneId: 'lane-a'
    })));
  });

  it('derives completion from the chosen lane', async () => {
    const user = userEvent.setup();
    const updateWorkspaceTask = vi.fn().mockResolvedValue(created);
    render(<UnifiedTaskDialog mode={{ type: 'edit', task: created }} onClose={vi.fn()} />,
      { wrapper: wrapper({ getTaskWorkspaceSnapshot: vi.fn().mockResolvedValue({ ...workspace, tasks: [created] }), updateWorkspaceTask }) });
    await user.click(await screen.findByRole('combobox', { name: '看板泳道' }));
    await user.click(screen.getByRole('option', { name: '已完成' }));
    await user.click(screen.getByRole('button', { name: '保存任务' }));
    await waitFor(() => expect(updateWorkspaceTask).toHaveBeenCalledWith('task-1', expect.objectContaining({
      laneId: 'lane-done', completed: true
    })));
  });
});