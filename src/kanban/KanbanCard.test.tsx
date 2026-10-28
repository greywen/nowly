import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ResolvedCard } from './kanban-view';
import { KanbanCard } from './KanbanCard';

const quadrant = { id: 'important_urgent', name: '重要且紧急', color: '#F06445', position: 0, createdAt: 'x', updatedAt: 'x' };

function resolved(overrides: Partial<ResolvedCard['card']> = {}, extra: Partial<ResolvedCard> = {}): ResolvedCard {
  return {
    card: {
      id: 'c1',
      laneId: 'lane-a',
      title: '写设计稿',
      description: null,
      dueDate: null,
      priorityId: 'important_urgent',
      position: 0,
      tagIds: [],
      createdAt: 'x',
      updatedAt: 'x',
      ...overrides
    },
    priority: quadrant,
    tags: [],
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
  it('shows the title with a labelled quadrant dot and no meta line when nothing else is set', () => {
    render(<KanbanCard {...props()} />);
    expect(screen.getByRole('button', { name: '写设计稿' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '重要且紧急' })).toBeInTheDocument();
    expect(document.querySelector('.kanban-card__meta')).toBeNull();
    expect(document.querySelector('.kanban-badge')).toBeNull();
  });

  it('shows a read-only step count on the meta line', () => {
    render(<KanbanCard {...props({ resolved: resolved({ steps: [
      { id: 's1', title: '一', completed: true },
      { id: 's2', title: '二', completed: false },
      { id: 's3', title: '三', completed: false }
    ] }) })} />);
    expect(screen.getByText('1/3')).toBeInTheDocument();
    expect(screen.getByText('已完成 1/3 个步骤')).toBeInTheDocument();
  });

  it('renders due date and tags but never the description', () => {
    render(
      <KanbanCard
        {...props({
          resolved: resolved(
            { description: '细化交互', dueDate: '2026-08-12', tagIds: ['t1'] },
            { tags: [{ id: 't1', name: '设计', color: 'info', createdAt: 'x', updatedAt: 'x' }] }
          )
        })}
      />
    );
    expect(screen.getByText('今天到期')).toBeInTheDocument();
    expect(screen.getByText('设计')).toBeInTheDocument();
    expect(screen.queryByText('细化交互')).not.toBeInTheDocument();
  });

  it('marks a past due date as overdue unless the task is done', () => {
    const { rerender } = render(<KanbanCard {...props({ resolved: resolved({ dueDate: '2026-08-10' }) })} />);
    expect(document.querySelector('.kanban-card__date--overdue')).not.toBeNull();
    expect(screen.getByText('已逾期')).toBeInTheDocument();

    rerender(<KanbanCard {...props({ done: true, resolved: resolved({ dueDate: '2026-08-10' }) })} />);
    expect(document.querySelector('.kanban-card__date--overdue')).toBeNull();
    expect(document.querySelector('.kanban-card--done')).not.toBeNull();
  });

  it('counts attached files without reading them, and leaves images uncounted', () => {
    // An inline image is content, not an attachment, so the paperclip reports
    // files alone. Counting is a pure parse, so it costs no IO.
    const image = '0123456789abcdef0123456789abcdef.png';
    const file = 'fedcba9876543210fedcba9876543210.pdf';
    const content = JSON.stringify({
      v: 1,
      ops: [
        { insert: { image: `attachment:${image}` }, attributes: { alt: '预览图.png' } },
        { insert: '报告', attributes: { link: `attachment:${file}` } },
        { insert: '\n' }
      ]
    });
    const { rerender } = render(<KanbanCard {...props({ resolved: resolved({ description: content }) })} />);
    expect(screen.getByLabelText('1 个附件')).toHaveTextContent('1');

    const imageOnly = JSON.stringify({
      v: 1,
      ops: [{ insert: { image: `attachment:${image}` }, attributes: { alt: '图.png' } }, { insert: '\n' }]
    });
    rerender(<KanbanCard {...props({ resolved: resolved({ description: imageOnly }) })} />);
    expect(document.querySelector('.kanban-card__clip')).toBeNull();
  });

  it('opens the editor when the title is clicked', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<KanbanCard {...props({ onOpen })} />);
    await user.click(screen.getByRole('button', { name: '写设计稿' }));
    expect(onOpen).toHaveBeenCalledOnce();
  });
});