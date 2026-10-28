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
      priorityId: 'p1', position: 0, tagIds: ['t1'], createdAt: 'x', updatedAt: 'x'
    },
    {
      id: 'c2', laneId: 'lane-a', title: '任务二', description: null, dueDate: null,
      priorityId: 'p1', position: 1, tagIds: [], createdAt: 'x', updatedAt: 'x'
    }
  ],
  priorities: [{ id: 'p1', name: '高', color: 'danger', position: 0, createdAt: 'x', updatedAt: 'x' }],
  tags: [{ id: 't1', name: '设计', color: 'info', createdAt: 'x', updatedAt: 'x' }],
};

function props(overrides: Partial<Parameters<typeof KanbanFieldManagerDialog>[0]> = {}) {
  return {
    snapshot,
    onClose: vi.fn(),
    createTag: vi.fn().mockResolvedValue(snapshot.tags[0]),
    updateTag: vi.fn().mockResolvedValue(snapshot.tags[0]),
    deleteTag: vi.fn().mockResolvedValue(undefined),
    ...overrides
  } satisfies Parameters<typeof KanbanFieldManagerDialog>[0];
}

describe('KanbanFieldManagerDialog', () => {
  it('manages tags only, with no tabs', () => {
    render(<KanbanFieldManagerDialog {...props()} />);

    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.getByLabelText('标签列表')).toHaveTextContent('设计');
    expect(screen.getByText('颜色')).toBeInTheDocument();
  });

  it('creates a tag with the chosen name', async () => {
    const user = userEvent.setup();
    const createTag = vi.fn().mockResolvedValue(snapshot.tags[0]);
    render(<KanbanFieldManagerDialog {...props({ createTag })} />);
    await user.type(screen.getByLabelText('新增标签'), '生活');
    await user.click(screen.getByRole('button', { name: '添加标签' }));
    expect(createTag).toHaveBeenCalledWith(expect.objectContaining({ name: '生活' }));
  });
});