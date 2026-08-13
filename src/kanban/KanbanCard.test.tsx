import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ResolvedCard } from './kanban-view';
import { KanbanCard } from './KanbanCard';

function resolved(overrides: Partial<ResolvedCard['card']> = {}, extra: Partial<ResolvedCard> = {}): ResolvedCard {
  return {
    card: {
      id: 'c1',
      laneId: 'lane-a',
      title: '写设计稿',
      description: null,
      dueDate: null,
      priorityId: null,
      position: 0,
      tagIds: [],
      collaboratorIds: [],
      createdAt: 'x',
      updatedAt: 'x',
      ...overrides
    },
    priority: null,
    tags: [],
    collaborators: [],
    ...extra
  };
}

function props(overrides: Partial<Parameters<typeof KanbanCard>[0]> = {}): Parameters<typeof KanbanCard>[0] {
  return {
    resolved: resolved(),
    todayIso: '2026-08-12',
    onOpen: vi.fn(),
    onDragStart: vi.fn(),
    onDragEnd: vi.fn(),
    ...overrides
  };
}

describe('KanbanCard', () => {
  it('always shows the title and omits empty optional fields', () => {
    render(<KanbanCard {...props()} />);
    expect(screen.getByText('写设计稿')).toBeInTheDocument();
    expect(screen.queryByText('今天到期')).not.toBeInTheDocument();
    // No description paragraph, no badges, no footer.
    expect(document.querySelector('.kanban-card__desc')).toBeNull();
    expect(document.querySelector('.kanban-badge')).toBeNull();
    expect(document.querySelector('.kanban-card__footer')).toBeNull();
  });

  it('renders due date, priority, tags, and collaborators when present, but never the description', () => {
    render(
      <KanbanCard
        {...props({
          resolved: resolved(
            { description: '细化交互', dueDate: '2026-08-12', priorityId: 'p1', tagIds: ['t1'], collaboratorIds: ['u1'] },
            {
              priority: { id: 'p1', name: '高', color: 'danger', position: 0, createdAt: 'x', updatedAt: 'x' },
              tags: [{ id: 't1', name: '设计', color: 'info', createdAt: 'x', updatedAt: 'x' }],
              collaborators: [{ id: 'u1', name: '小林', createdAt: 'x', updatedAt: 'x' }]
            }
          )
        })}
      />
    );
    expect(screen.queryByText('细化交互')).not.toBeInTheDocument();
    expect(screen.getByText('今天到期')).toBeInTheDocument();
    expect(screen.getByText('高')).toBeInTheDocument();
    expect(screen.getByText('设计')).toBeInTheDocument();
    expect(screen.getByLabelText('协作人：小林')).toBeInTheDocument();
  });

  it('opens the editor when the title is clicked', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<KanbanCard {...props({ onOpen })} />);
    await user.click(screen.getByRole('button', { name: '写设计稿' }));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('does not render a task-card three-dot menu', () => {
    render(<KanbanCard {...props()} />);
    expect(screen.queryByRole('button', { name: '任务操作：写设计稿' })).not.toBeInTheDocument();
  });
});
