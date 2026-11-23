import { fireEvent, render, screen, within } from '@testing-library/react';
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
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onOpen).toHaveBeenCalledWith(open, title);
  });

  it.each([
    '.task-row',
    '.task-row__title',
    '.task-row__meta',
    '.task-lane-chip',
    '.task-tag',
    '.task-step-count'
  ])('opens once from %s and returns a focusable trigger', async (selector) => {
    const user = userEvent.setup();
    const task: MatrixTask = {
      ...open,
      lane: { id: 'lane-a', name: '进行中', color: '#4FC9DA' },
      tags: [{ id: 'tag-a', name: '发布', color: '#4FC9DA' }],
      steps: [{ id: 's1', title: '评审', completed: false }]
    };
    const onOpen = vi.fn();
    const onToggle = vi.fn();
    const { container } = render(
      <TaskRow task={task} pending={false} onToggle={onToggle} onOpen={onOpen} />
    );
    const target = container.querySelector<HTMLElement>(selector)!;
    const title = screen.getByRole('button', { name: '编辑任务：发布 Nowly' });

    await user.click(target);

    expect(onOpen).toHaveBeenCalledExactlyOnceWith(task, title);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it.each([false, true])('excludes the whole completion label when pending=%s', async (pending) => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const onToggle = vi.fn();
    const { container } = render(
      <TaskRow task={open} pending={pending} onToggle={onToggle} onOpen={onOpen} />
    );

    await user.click(container.querySelector('.task-row__check')!);
    expect(onOpen).not.toHaveBeenCalled();
    expect(onToggle).toHaveBeenCalledTimes(pending ? 0 : 1);
  });

  it('suppresses clicks throughout a drag and after dragend until a new press', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const onDragStart = vi.fn();
    const onDragEnd = vi.fn();
    const { container, rerender } = render(
      <TaskRow task={open} pending={false} onToggle={vi.fn()} onOpen={onOpen}
        onDragStart={onDragStart} onDragEnd={onDragEnd} />
    );
    const row = container.querySelector('.task-row')!;
    const title = screen.getByRole('button', { name: '编辑任务：发布 Nowly' });

    fireEvent.pointerDown(title, { button: 0 });
    fireEvent.dragStart(row);
    expect(onDragStart).toHaveBeenCalledWith(expect.anything(), open);
    fireEvent.click(title);
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.dragEnd(row);
    expect(onDragEnd).toHaveBeenCalledOnce();
    rerender(
      <TaskRow task={open} pending={false} dragging={false} onToggle={vi.fn()} onOpen={onOpen}
        onDragStart={onDragStart} onDragEnd={onDragEnd} />
    );
    fireEvent.click(row);
    fireEvent.click(title);
    expect(onOpen).not.toHaveBeenCalled();

    await user.click(title);
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(open, title);
  });

  it.each(['{Enter}', ' '])('allows keyboard activation with %s after a cancelled drag', async (key) => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const { container } = render(
      <TaskRow task={open} pending={false} onToggle={vi.fn()} onOpen={onOpen}
        onDragStart={vi.fn()} onDragEnd={vi.fn()} />
    );
    const row = container.querySelector('.task-row')!;
    const title = screen.getByRole('button', { name: '编辑任务：发布 Nowly' });
    fireEvent.dragStart(row);
    fireEvent.dragEnd(row);
    fireEvent.click(title);
    expect(onOpen).not.toHaveBeenCalled();

    title.focus();
    await user.keyboard(key);
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(open, title);
  });

  it('does not start dragging from the completion control', () => {
    const onDragStart = vi.fn();
    const { container } = render(
      <TaskRow task={open} pending={false} onToggle={vi.fn()} onOpen={vi.fn()}
        onDragStart={onDragStart} />
    );
    const row = container.querySelector('.task-row')!;

    fireEvent.pointerDown(screen.getByRole('checkbox'), { button: 0 });
    expect(fireEvent.dragStart(row)).toBe(false);
    expect(onDragStart).not.toHaveBeenCalled();
  });

  it('ignores a cancelled pointer gesture and allows the next click', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<TaskRow task={open} pending={false} onToggle={vi.fn()} onOpen={onOpen} />);
    const title = screen.getByRole('button', { name: '编辑任务：发布 Nowly' });

    fireEvent.pointerDown(title, { button: 0 });
    fireEvent.pointerCancel(title);
    fireEvent.click(title);
    expect(onOpen).not.toHaveBeenCalled();
    await user.click(title);
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(open, title);
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
    const { container } = render(
      <TaskRow
        task={{ ...open, completed: true }}
        pending
        onToggle={vi.fn()}
        onOpen={vi.fn()}
      />
    );

    expect(within(container).getByText(/已完成/)).toBeInTheDocument();
    const checkbox = screen.getByRole('checkbox', { name: '标记任务为未完成：发布 Nowly' });
    expect(checkbox).toBeChecked();
    expect(checkbox).toBeDisabled();
    await user.tab();
    expect(screen.getByRole('button', { name: '编辑任务：发布 Nowly' })).toHaveFocus();
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('shows the board lane of an open task as a labelled chip', () => {
    const { container, rerender } = render(
      <TaskRow
        task={{ ...open, lane: { id: 'lane-a', name: '进行中', color: '#4FC9DA' } }}
        pending={false}
        onToggle={vi.fn()}
        onOpen={vi.fn()}
      />
    );
    expect(container.querySelector('.task-lane-chip')).not.toBeNull();
    expect(screen.getByText('看板泳道：进行中')).toBeInTheDocument();

    rerender(<TaskRow task={open} pending={false} onToggle={vi.fn()} onOpen={vi.fn()} />);
    expect(container.querySelector('.task-lane-chip')).toBeNull();
  });
});
