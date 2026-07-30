import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { CalendarEvent } from './calendar-model';
import type { MatrixTask } from '../matrix/matrix-model';
import { DateDetailDialog } from './DateDetailDialog';

function event(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 'e1',
    title: '设计评审',
    startAt: '2026-07-23T14:00',
    endAt: '2026-07-23T15:00',
    allDay: false,
    category: 'work',
    color: 'blue',
    linkedTaskId: null,
    note: '',
    createdAt: '2026-07-23T09:00:00Z',
    updatedAt: '2026-07-23T09:00:00Z',
    ...overrides
  };
}

const tasks: MatrixTask[] = [{
  id: 't1',
  title: '发布 Nowly v0.1',
  quadrant: 'important_urgent',
  dueAt: '2026-07-23',
  priority: 1,
  completed: false,
  linkedEventId: 'linked',
  note: '',
  createdAt: '2026-07-23T09:00:00Z',
  updatedAt: '2026-07-23T09:00:00Z'
}];

const events = [
  event({ id: 'other-day', title: '其他日期', startAt: '2026-07-24T09:00', endAt: '2026-07-24T10:00' }),
  event({ id: 'timed-b', title: '同刻后项', startAt: '2026-07-23T14:00', endAt: '2026-07-23T15:00' }),
  event({ id: 'early', title: '晨会', startAt: '2026-07-23T09:00', endAt: '2026-07-23T09:30', category: 'learning' }),
  event({ id: 'all-day', title: '产品发布日', startAt: '2026-07-23T00:00', endAt: '2026-07-23T23:59', allDay: true, category: 'important', color: 'red' }),
  event({ id: 'linked', title: '关联评审', startAt: '2026-07-23T11:00', endAt: '2026-07-23T12:00', linkedTaskId: 't1', category: 'personal' }),
  event({ id: 'missing-link', title: '旧关联', startAt: '2026-07-23T13:00', endAt: '2026-07-23T13:30', linkedTaskId: 'missing' }),
  event({ id: 'timed-a', title: '同刻前项', startAt: '2026-07-23T14:00', endAt: '2026-07-23T15:00' })
];

describe('DateDetailDialog', () => {
  it('shows the full local date, weekday, count, and both creation entries', () => {
    render(
      <DateDetailDialog
        isoDate="2026-07-23"
        events={events}
        tasks={tasks}
        isTopLayer
        onClose={vi.fn()}
        onCreateEvent={vi.fn()}
        onCreateTask={vi.fn()}
        onEditEvent={vi.fn()}
      />
    );

    expect(screen.getByRole('dialog', { name: '2026年7月23日 星期四' })).toBeInTheDocument();
    expect(screen.getByText('共 6 个日程')).toBeInTheDocument();
    expect(screen.queryByText('其他日期')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新建任务' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新建日程' })).toBeInTheDocument();
  });

  it('sorts all-day first and timed events by start, end, and id', () => {
    render(
      <DateDetailDialog
        isoDate="2026-07-23"
        events={events}
        tasks={tasks}
        isTopLayer
        onClose={vi.fn()}
        onCreateEvent={vi.fn()}
        onEditEvent={vi.fn()}
      />
    );
    const rows = within(screen.getByRole('list', { name: '当日日程' }))
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label'));
    expect(rows).toEqual([
      '全天 产品发布日，重要',
      '09:00 晨会，学习',
      '11:00 关联评审，个人',
      '13:00 旧关联，工作',
      '14:00 同刻前项，工作',
      '14:00 同刻后项，工作'
    ]);
  });

  it('shows an existing linked task title and omits a missing task hint', () => {
    render(
      <DateDetailDialog
        isoDate="2026-07-23"
        events={events}
        tasks={tasks}
        isTopLayer
        onClose={vi.fn()}
        onCreateEvent={vi.fn()}
        onEditEvent={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: /关联评审/ })).toHaveTextContent('关联任务：发布 Nowly v0.1');
    expect(screen.getByRole('button', { name: /旧关联/ })).not.toHaveTextContent('关联任务');
  });

  it('shows a static empty state', () => {
    render(
      <DateDetailDialog
        isoDate="2026-07-23"
        events={[]}
        tasks={[]}
        isTopLayer
        onClose={vi.fn()}
        onCreateEvent={vi.fn()}
        onEditEvent={vi.fn()}
      />
    );
    expect(screen.getByText('当天暂无日程')).toBeInTheDocument();
    expect(screen.getByText('共 0 个日程')).toBeInTheDocument();
  });

  it('emits task, event, and edit intents with the date and trigger', async () => {
    const user = userEvent.setup();
    const onCreateTask = vi.fn();
    const onCreateEvent = vi.fn();
    const onEditEvent = vi.fn();
    render(
      <DateDetailDialog
        isoDate="2026-07-23"
        events={[events[2]]}
        tasks={[]}
        isTopLayer
        onClose={vi.fn()}
        onCreateEvent={onCreateEvent}
        onCreateTask={onCreateTask}
        onEditEvent={onEditEvent}
      />
    );
    const taskButton = screen.getByRole('button', { name: '新建任务' });
    await user.click(taskButton);
    expect(onCreateTask).toHaveBeenCalledWith('2026-07-23', taskButton);

    await user.click(screen.getByRole('button', { name: '新建日程' }));
    expect(onCreateEvent).toHaveBeenCalledWith('2026-07-23');

    const eventButton = screen.getByRole('button', { name: /09:00 晨会，学习/ });
    await user.click(eventButton);
    expect(onEditEvent).toHaveBeenCalledWith(events[2], eventButton);
  });

  it('closes with Escape only while topmost', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { rerender } = render(
      <DateDetailDialog isoDate="2026-07-23" events={[]} tasks={[]} isTopLayer onClose={onClose} onCreateEvent={vi.fn()} onEditEvent={vi.fn()} />
    );
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
    rerender(
      <DateDetailDialog isoDate="2026-07-23" events={[]} tasks={[]} isTopLayer={false} onClose={onClose} onCreateEvent={vi.fn()} onEditEvent={vi.fn()} />
    );
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('restores focus to the opening trigger after close', async () => {
    const user = userEvent.setup();
    const trigger = document.createElement('button');
    trigger.textContent = '7月23日';
    document.body.append(trigger);
    const restoreFocusRef = { current: trigger };

    function Harness() {
      const [open, setOpen] = useState(true);
      return open ? (
        <DateDetailDialog
          isoDate="2026-07-23"
          events={[]}
          tasks={[]}
          isTopLayer
          restoreFocusRef={restoreFocusRef}
          onClose={() => setOpen(false)}
          onCreateEvent={vi.fn()}
          onEditEvent={vi.fn()}
        />
      ) : null;
    }

    render(<Harness />);
    await user.click(screen.getByRole('button', { name: '关闭日期详情' }));
    expect(trigger).toHaveFocus();
    trigger.remove();
  });
});
