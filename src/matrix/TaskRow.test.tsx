import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { CalendarEvent } from '../calendar/calendar-model';
import type { MatrixTask } from './matrix-model';
import { TaskRow } from './TaskRow';

const open: MatrixTask = {
  id: 't1',
  title: '发布 Nowly',
  quadrant: 'important_urgent',
  dueAt: '2026-07-23',
  priority: 1,
  completed: false,
  linkedEventId: 'e1',
  note: '',
  createdAt: '2026-07-20T09:00:00Z',
  updatedAt: '2026-07-20T09:00:00Z'
};

const linkedEvent: CalendarEvent = {
  id: 'e1',
  title: '设计评审',
  startAt: '2026-07-23T14:00',
  endAt: '2026-07-23T15:00',
  allDay: false,
  category: 'work',
  color: 'blue',
  linkedTaskId: 't1',
  note: '',
  reminders: [],
  createdAt: '2026-07-20T09:00:00Z',
  updatedAt: '2026-07-20T09:00:00Z',
  recurrence: null,
  startTz: null,
  endTz: null,
  rrule: null,
  seriesId: null,
  seriesStartAt: null,
  occurrenceStartAt: null,
  subscriptionId: null,
  isOverridden: false
};

describe('TaskRow', () => {
  it('renders an accessible two-line row and emits separate completion and edit intents', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const onOpen = vi.fn();
    render(
      <TaskRow
        task={open}
        events={[linkedEvent]}
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
      <TaskRow task={open} events={[linkedEvent]} pending={false} onToggle={vi.fn()} onOpen={vi.fn()} />
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
        task={{ ...open, completed: true, linkedEventId: 'outside' }}
        events={[]}
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
