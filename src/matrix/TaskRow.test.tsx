import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { MatrixTask } from './matrix-model';
import { TaskRow } from './TaskRow';

const open: MatrixTask = {
  id: 't1',
  title: '发布 Nowly',
  quadrant: 'important_urgent',
  dueAt: '2026-07-23',
  priority: 1,
  completed: false,
  note: '',
  tags: [],
  createdAt: '2026-07-20T09:00:00Z',
  updatedAt: '2026-07-20T09:00:00Z'
};

describe('TaskRow', () => {
  it('shows the step count next to the meta text', () => {
    render(
      <TaskRow
        task={{ ...open, steps: [{ id: 's1', title: '一', completed: true }, { id: 's2', title: '二', completed: false }] }}
        today={new Date(2026, 6, 23)}
        pending={false}
        onToggle={vi.fn()}
        onOpen={vi.fn()}
      />
    );
    expect(screen.getByText('今天到期 · 高优先级')).toBeInTheDocument();
    expect(screen.getByText('1/2')).toBeInTheDocument();
    expect(screen.getByText('已完成 1/2 个步骤')).toBeInTheDocument();
  });

  it('renders an accessible two-line row and emits separate completion and edit intents', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const onOpen = vi.fn();
    render(
      <TaskRow
        task={open}
        today={new Date(2026, 6, 23)}
        pending={false}
        onToggle={onToggle}
        onOpen={onOpen}
      />
    );

    expect(screen.getByText('今天到期 · 高优先级')).toBeInTheDocument();
    const checkbox = screen.getByRole('checkbox', { name: '完成任务：发布 Nowly' });
    await user.click(checkbox);
    expect(onToggle).toHaveBeenCalledWith(open, true);
    expect(onOpen).not.toHaveBeenCalled();

    const title = screen.getByRole('button', { name: '编辑任务：发布 Nowly' });
    await user.click(title);
    expect(onOpen).toHaveBeenCalledWith(open, title);
  });

  it('does not show a tooltip on hover or keyboard focus', async () => {
    const user = userEvent.setup();
    render(
      <TaskRow task={open} pending={false} onToggle={vi.fn()} onOpen={vi.fn()} />
    );
    const title = screen.getByRole('button', { name: '编辑任务：发布 Nowly' });

    await user.hover(title);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    await user.unhover(title);

    await user.tab();
    await user.tab();
    expect(title).toHaveFocus();
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('announces completed, pending, and cross-month states without relying on color', async () => {
    const user = userEvent.setup();
    render(
      <TaskRow
        task={{ ...open, completed: true }}
        pending
        onToggle={vi.fn()}
        onOpen={vi.fn()}
      />
    );

    expect(screen.getByText(/已完成/)).toBeInTheDocument();
    const checkbox = screen.getByRole('checkbox', { name: '标记任务为未完成：发布 Nowly' });
    expect(checkbox).toBeChecked();
    expect(checkbox).toBeDisabled();
    await user.tab();
    expect(screen.getByRole('button', { name: '编辑任务：发布 Nowly' })).toHaveFocus();
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});
