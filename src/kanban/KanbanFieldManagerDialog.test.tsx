import { render, screen } from '@testing-library/react';
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
  it('offers only tag and collaborator settings', async () => {
    const user = userEvent.setup();
    render(<KanbanFieldManagerDialog {...props()} />);

    expect(screen.getByRole('tab', { name: '标签(1)', selected: true })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /优先级/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /视图联动/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText('标签列表')).toHaveTextContent('设计');
    await user.click(screen.getByRole('tab', { name: '协作人(1)' }));
    expect(screen.getByLabelText('协作人列表')).toHaveTextContent('小明');
  });

  it('collaborators have no color picker', async () => {
    const user = userEvent.setup();
    render(<KanbanFieldManagerDialog {...props()} />);
    await user.click(screen.getByRole('tab', { name: '协作人(1)' }));
    expect(screen.queryByText('颜色')).not.toBeInTheDocument();
  });

});
