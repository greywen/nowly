import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { KanbanSnapshot } from './kanban-model';
import { KanbanFieldManagerDialog } from './KanbanFieldManagerDialog';

const snapshot: KanbanSnapshot = {
  lanes: [{ id: 'lane-a', name: '待处理', color: 'primary', position: 0, createdAt: 'x', updatedAt: 'x' }],
  cards: [
    {
      id: 'c1', laneId: 'lane-a', title: '任务一', description: null, dueDate: null,
      priorityId: 'p1', position: 0, tagIds: ['t1'], collaboratorIds: ['u1'], createdAt: 'x', updatedAt: 'x'
    },
    {
      id: 'c2', laneId: 'lane-a', title: '任务二', description: null, dueDate: null,
      priorityId: 'p1', position: 1, tagIds: [], collaboratorIds: [], createdAt: 'x', updatedAt: 'x'
    }
  ],
  priorities: [{ id: 'p1', name: '高', color: 'danger', position: 0, createdAt: 'x', updatedAt: 'x' }],
  tags: [{ id: 't1', name: '设计', color: 'info', createdAt: 'x', updatedAt: 'x' }],
  collaborators: [{ id: 'u1', name: '小明', createdAt: 'x', updatedAt: 'x' }]
};

function props(overrides: Partial<Parameters<typeof KanbanFieldManagerDialog>[0]> = {}) {
  return {
    snapshot,
    onClose: vi.fn(),
    createPriority: vi.fn().mockResolvedValue(snapshot.priorities[0]),
    updatePriority: vi.fn().mockResolvedValue(snapshot.priorities[0]),
    deletePriority: vi.fn().mockResolvedValue(undefined),
    reorderPriorities: vi.fn().mockResolvedValue(snapshot.priorities),
    createTag: vi.fn().mockResolvedValue(snapshot.tags[0]),
    updateTag: vi.fn().mockResolvedValue(snapshot.tags[0]),
    deleteTag: vi.fn().mockResolvedValue(undefined),
    createCollaborator: vi.fn().mockResolvedValue(snapshot.collaborators[0]),
    updateCollaborator: vi.fn().mockResolvedValue(snapshot.collaborators[0]),
    deleteCollaborator: vi.fn().mockResolvedValue(undefined),
    ...overrides
  } satisfies Parameters<typeof KanbanFieldManagerDialog>[0];
}

describe('KanbanFieldManagerDialog', () => {
  it('switches between the three global field types', async () => {
    const user = userEvent.setup();
    render(<KanbanFieldManagerDialog {...props()} />);

    expect(screen.getByRole('tab', { name: '优先级', selected: true })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: '标签' }));
    expect(screen.getByRole('tab', { name: '标签', selected: true })).toBeInTheDocument();
    expect(screen.getByLabelText('标签列表')).toHaveTextContent('设计');
    await user.click(screen.getByRole('tab', { name: '协作人' }));
    expect(screen.getByLabelText('协作人列表')).toHaveTextContent('小明');
  });

  it('creates a new priority through the form', async () => {
    const user = userEvent.setup();
    const createPriority = vi.fn().mockResolvedValue(snapshot.priorities[0]);
    render(<KanbanFieldManagerDialog {...props({ createPriority })} />);

    await user.type(screen.getByLabelText('新增优先级'), '紧急');
    await user.click(screen.getByRole('button', { name: '添加优先级' }));
    expect(createPriority).toHaveBeenCalledWith({ name: '紧急', color: '#4FC9DA' });
  });

  it('shows the affected task count before deleting a priority and cascades on confirm', async () => {
    const user = userEvent.setup();
    const deletePriority = vi.fn().mockResolvedValue(undefined);
    render(<KanbanFieldManagerDialog {...props({ deletePriority })} />);

    await user.click(screen.getByRole('button', { name: '删除高' }));
    const dialog = screen.getByRole('dialog', { name: /删除.*高/ });
    expect(within(dialog).getByText(/2 张任务/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: '删除' }));
    expect(deletePriority).toHaveBeenCalledWith('p1');
  });

  it('collaborators have no color picker', async () => {
    const user = userEvent.setup();
    render(<KanbanFieldManagerDialog {...props()} />);
    await user.click(screen.getByRole('tab', { name: '协作人' }));
    expect(screen.queryByText('颜色')).not.toBeInTheDocument();
  });
});
