import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CalendarEvent } from '../../calendar/calendar-model';
import type { Task } from '../../tasks/task-model';
import type {
  StatusIslandFocusIndicator,
  StatusIslandPanelContext,
  StatusIslandReminder,
  StatusIslandSummary
} from '../status-island-model';
import {
  StatusIslandIdleView,
  StatusIslandPanel,
  StatusIslandReminderView,
  StatusIslandSummaryView
} from './StatusIsland';

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'event-1', title: '产品评审', startAt: '2026-09-12T14:30', endAt: '2026-09-12T15:30', allDay: false,
    category: 'work', color: '#4FC9DA', note: '', reminders: [15], createdAt: 'x', updatedAt: 'x', recurrence: null,
    startTz: null, endTz: null, rrule: null, seriesId: null, seriesStartAt: null, occurrenceStartAt: null,
    isOverridden: false, subscriptionId: null,
    ...overrides
  };
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1', title: '发布检查', description: '', priority: 'important_urgent', dueDate: '2026-09-12',
    completed: false, laneId: 'todo', boardPosition: 0, tagIds: [], collaboratorIds: [], views: ['matrix'],
    createdAt: 'x', updatedAt: 'x',
    ...overrides
  };
}

const runningFocus: StatusIslandFocusIndicator = {
  status: 'running', remainingSeconds: 600, remainingMinutes: 10,
  plannedSeconds: 1500, progressMax: 1500, progressNow: 600
};

function indicatorSummary(overrides: Partial<StatusIslandSummary> = {}): StatusIslandSummary {
  return { lead: null, focus: null, markers: [], totalCount: 0, ...overrides };
}

function reminder(subject: StatusIslandReminder['subject'], overrides: Partial<StatusIslandReminder> = {}): StatusIslandReminder {
  return {
    identity: 'event:event-1:2026-09-12T14:30:reminder:15',
    reminderClass: 'system',
    priority: 5,
    triggerAt: '2026-09-12T14:15',
    expiresAt: '2026-09-12T14:30',
    lifecycle: 'unseen',
    acknowledgedAt: null,
    subject,
    ...overrides
  };
}

function panelActions(overrides: Partial<React.ComponentProps<typeof StatusIslandPanel>['actions']> = {}) {
  return {
    onOpenEvent: vi.fn(),
    onOpenTask: vi.fn(),
    onStartFocus: vi.fn(),
    onPauseFocus: vi.fn(),
    onResumeFocus: vi.fn(),
    onEndFocus: vi.fn(),
    onCompleteTask: vi.fn(),
    ...overrides
  };
}

describe('StatusIslandIdleView', () => {
  it('keeps the capsule and says there is nothing scheduled', () => {
    render(<StatusIslandIdleView />);

    // The capsule stays whatever the day holds. An empty day is still something
    // the surface reports, and it stays openable, so it remains a control.
    expect(screen.getByText('今天没有安排')).toBeInTheDocument();
    expect(screen.getByText('0 项日程 · 0 项待办')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '今天没有安排 · 0 项日程 · 0 项待办' })).toBeInTheDocument();
    // Nothing to acknowledge and nothing to count.
    expect(document.querySelector('.status-island__dismiss')).not.toBeInTheDocument();
    expect(document.querySelector('.status-island__signal')).not.toBeInTheDocument();
    expect(document.querySelector('.status-island')).toHaveAttribute('data-mode', 'idle');
  });
});

describe('StatusIslandSummaryView', () => {
  it('leads with the first marker and always states today\u2019s aggregate', () => {
    render(<StatusIslandSummaryView summary={indicatorSummary({
      lead: { kind: 'importantTask', count: 2, tone: 'yellow' },
      markers: [{ kind: 'importantTask', count: 2, tone: 'yellow' }, { kind: 'event', count: 1, tone: 'yellow' }],
      totalCount: 3
    })} />);

    expect(screen.getByText('重要 2 项')).toBeInTheDocument();
    expect(screen.getByText('今日汇总 · 共 3 项')).toBeInTheDocument();
    expect(document.querySelector('.status-island')).toHaveAttribute('data-mode', 'summary');
  });

  it('says so in words when the day is clear', () => {
    render(<StatusIslandSummaryView summary={indicatorSummary({
      focus: { ...runningFocus, status: 'completed', remainingSeconds: 0, remainingMinutes: 0, progressNow: 0 }
    })} />);

    expect(screen.getByText('今日暂无待处理事项')).toBeInTheDocument();
  });

  it('puts focus ahead of markers and keeps the countdown an accessible progress readout', () => {
    render(<StatusIslandSummaryView summary={indicatorSummary({
      lead: { kind: 'importantTask', count: 2, tone: 'yellow' },
      focus: runningFocus,
      markers: [{ kind: 'importantTask', count: 2, tone: 'yellow' }],
      totalCount: 2
    })} />);

    const progress = screen.getByRole('progressbar', { name: '专注进度' });
    expect(progress).toHaveTextContent('10:00');
    expect(progress).toHaveAttribute('aria-valuemin', '0');
    expect(progress).toHaveAttribute('aria-valuemax', '1500');
    expect(progress).toHaveAttribute('aria-valuenow', '600');
    expect(progress).toHaveAttribute('aria-valuetext', '专注进行中，剩余 10 分钟');
  });

  it('restates every marker as text, not just the three with a badge', () => {
    render(<StatusIslandSummaryView summary={indicatorSummary({
      lead: { kind: 'conflict', count: 2, tone: 'red' },
      markers: [
        { kind: 'conflict', count: 2, tone: 'red' },
        { kind: 'urgentTask', count: 1, tone: 'red' },
        { kind: 'event', count: 3, tone: 'yellow' },
        { kind: 'allDay', count: 4, tone: 'info' }
      ],
      totalCount: 8
    })} />);

    expect(screen.getByRole('button')).toHaveAccessibleName(
      '冲突 2 项 · 今日汇总 · 共 8 项 · 日程冲突 2 项 · 重要且紧急任务 1 项 · 今日日程 3 项 · 全天事项 4 项'
    );
  });

  it('offers no dismissal: an aggregate is not one notification to close', () => {
    render(<StatusIslandSummaryView summary={indicatorSummary({
      lead: { kind: 'urgentTask', count: 1, tone: 'red' }, totalCount: 1
    })} />);

    expect(screen.queryByRole('button', { name: /暂时隐藏/ })).not.toBeInTheDocument();
  });

  it('activates from click, Enter and Space and reports hover and focus presence', () => {
    const onActivate = vi.fn();
    const onHoverStart = vi.fn();
    const onHoverEnd = vi.fn();
    const onFocusEnter = vi.fn();
    const onFocusLeave = vi.fn();
    render(<StatusIslandSummaryView
      summary={indicatorSummary({ lead: { kind: 'conflict', count: 2, tone: 'red' }, totalCount: 2 })}
      onActivate={onActivate} onHoverStart={onHoverStart} onHoverEnd={onHoverEnd}
      onFocusEnter={onFocusEnter} onFocusLeave={onFocusLeave}
    />);
    const trigger = screen.getByRole('button');

    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.keyDown(trigger, { key: ' ' });
    expect(onActivate).toHaveBeenCalledTimes(3);

    fireEvent.keyDown(trigger, { key: 'a' });
    expect(onActivate).toHaveBeenCalledTimes(3);

    fireEvent.mouseEnter(trigger);
    fireEvent.mouseLeave(trigger);
    fireEvent.focus(trigger);
    fireEvent.blur(trigger);
    expect(onHoverStart).toHaveBeenCalledOnce();
    expect(onHoverEnd).toHaveBeenCalledOnce();
    expect(onFocusEnter).toHaveBeenCalledOnce();
    expect(onFocusLeave).toHaveBeenCalledOnce();
  });
});

describe('StatusIslandReminderView', () => {
  it('shows the reminder subject and marks its lifecycle', () => {
    render(<StatusIslandReminderView
      reminder={reminder({ kind: 'event', event: event(), stage: 'reminder', reminderMinutes: 15 })}
      markers={[{ kind: 'conflict', count: 2, tone: 'red' }]}
    />);

    const trigger = screen.getByRole('button', { name: /产品评审/ });
    expect(trigger).toHaveAccessibleName('产品评审 · 14:30 开始 · 提前 15 分钟提醒 · 日程冲突 2 项');
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(document.querySelector('.status-island')).toHaveAttribute('data-lifecycle', 'unseen');
  });

  it('dismisses the current surface without activating the panel', () => {
    const onDismiss = vi.fn();
    const onActivate = vi.fn();
    render(<StatusIslandReminderView
      reminder={reminder({ kind: 'event', event: event(), stage: 'reminder', reminderMinutes: 15 })}
      markers={[]} onDismiss={onDismiss} onActivate={onActivate}
    />);

    fireEvent.click(screen.getByRole('button', { name: '暂时隐藏：产品评审' }));

    expect(onDismiss).toHaveBeenCalledOnce();
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('does not offer dismissal for focus state', () => {
    render(<StatusIslandReminderView
      reminder={reminder({ kind: 'focus', status: 'running', remainingSeconds: 600, plannedSeconds: 1500, sessionId: 'session-1' })}
      markers={[]} onDismiss={vi.fn()}
    />);

    expect(screen.queryByRole('button', { name: /暂时隐藏/ })).not.toBeInTheDocument();
  });

  it('summarises a conflict reminder by its participant count', () => {
    render(<StatusIslandReminderView
      reminder={reminder({ kind: 'conflict', events: [event(), event({ id: 'event-2', title: '客户电话' })] })}
      markers={[]}
    />);

    expect(screen.getByRole('button', { name: /日程冲突.*日程冲突 2 项/ })).toBeInTheDocument();
  });

  it('offers a retry action when the snapshot is stale', () => {
    const onRetryStatus = vi.fn();
    render(<StatusIslandReminderView
      reminder={reminder({ kind: 'task', task: task() })}
      markers={[]} onRetryStatus={onRetryStatus}
    />);

    fireEvent.click(screen.getByRole('button', { name: '状态读取失败，重试' }));
    expect(onRetryStatus).toHaveBeenCalledOnce();
  });
});

describe('StatusIslandPanel', () => {
  function renderPanel(context: StatusIslandPanelContext, overrides = {}) {
    const actions = panelActions(overrides);
    return { ...render(<StatusIslandPanel context={context} actions={actions} />), actions };
  }

  it('routes a focus context to pause and end actions, leaving progress to the head', () => {
    const { actions } = renderPanel({ kind: 'focus', focus: runningFocus });

    expect(screen.getByRole('region', { name: '此刻详情' })).toBeInTheDocument();
    expect(screen.getByText('专注')).toBeInTheDocument();
    expect(screen.getByText('10:00')).toBeInTheDocument();
    // The head one row above owns the progressbar role and is visible at both
    // sizes, so a second one here would announce the same session twice.
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '暂停专注' }));
    fireEvent.click(screen.getByRole('button', { name: '结束专注' }));
    expect(actions.onPauseFocus).toHaveBeenCalledOnce();
    expect(actions.onEndFocus).toHaveBeenCalledOnce();
  });

  it('offers resume for a paused session and restart after completion', () => {
    const paused = renderPanel({ kind: 'focus', focus: { ...runningFocus, status: 'paused' } });
    fireEvent.click(screen.getByRole('button', { name: '继续专注' }));
    expect(paused.actions.onResumeFocus).toHaveBeenCalledOnce();
    paused.unmount();

    const completed = renderPanel({
      kind: 'focus',
      focus: { ...runningFocus, status: 'completed', remainingSeconds: 0, remainingMinutes: 0, progressNow: 0 }
    });
    fireEvent.click(screen.getByRole('button', { name: '开始专注' }));
    expect(completed.actions.onStartFocus).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: '结束专注' })).not.toBeInTheDocument();
  });

  it('lists both conflicting events side by side', () => {
    const first = event();
    const second = event({ id: 'event-2', title: '客户电话', startAt: '2026-09-12T15:00' });
    const { actions } = renderPanel({ kind: 'conflict', events: [first, second] });

    expect(screen.getByText('日程冲突')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '打开日程：客户电话' }));
    expect(actions.onOpenEvent).toHaveBeenCalledWith(second);
  });

  it('shows the reminder lead time and the note for a reminder context', () => {
    renderPanel({ kind: 'eventReminder', event: event({ note: '带上季度数据' }), reminderMinutes: 15 });

    expect(screen.getByText('日程提醒')).toBeInTheDocument();
    expect(screen.getByText(/提前 15 分钟提醒/)).toBeInTheDocument();
    expect(screen.getByText(/带上季度数据/)).toBeInTheDocument();
  });

  it('shows the end time and elapsed progress for an ongoing event', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 12, 15, 0));
    renderPanel({ kind: 'ongoingEvent', event: event() });

    expect(screen.getByText('当前日程')).toBeInTheDocument();
    expect(screen.getByText('15:30 结束')).toBeInTheDocument();
    expect(screen.getByText('已进行 50%')).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('offers open and complete actions for an urgent task', () => {
    const { actions } = renderPanel({ kind: 'urgentTask', task: task() });

    expect(screen.getByText('紧急任务')).toBeInTheDocument();
    expect(screen.getByText('截止 2026-09-12')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '打开任务：发布检查' }));
    fireEvent.click(screen.getByRole('button', { name: '完成任务' }));
    expect(actions.onOpenTask).toHaveBeenCalledWith('task-1');
    expect(actions.onCompleteTask).toHaveBeenCalledWith('task-1');
  });

  it('lists every item in a marker group instead of truncating it', () => {
    renderPanel({
      kind: 'overview',
      groups: [
        { kind: 'event', count: 1, tone: 'yellow', events: [event()], tasks: [] },
        {
          kind: 'importantTask',
          count: 2,
          tone: 'yellow',
          events: [],
          tasks: [
            task({ id: 'task-2', priority: 'important_not_urgent', title: '阅读' }),
            task({ id: 'task-3', priority: 'important_not_urgent', title: '周报' })
          ]
        }
      ],
      markers: [{ kind: 'event', count: 1, tone: 'yellow' }, { kind: 'importantTask', count: 2, tone: 'yellow' }],
      totalCount: 3
    });

    expect(screen.getByText('今日概览')).toBeInTheDocument();
    expect(screen.getByText('今日汇总 · 共 3 项')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打开日程：产品评审' })).toBeInTheDocument();
    // "重要 2 项" has to open into both of those two, not the first one only.
    expect(screen.getByRole('button', { name: '打开任务：阅读' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打开任务：周报' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '重要任务 2 项' })).toBeInTheDocument();
  });

  it('labels an all-day event without formatting it as midnight', () => {
    renderPanel({
      kind: 'overview',
      groups: [{
        kind: 'allDay',
        count: 1,
        tone: 'info',
        events: [event({ allDay: true, startAt: '2026-09-12T00:00', title: '休假' })],
        tasks: []
      }],
      markers: [{ kind: 'allDay', count: 1, tone: 'info' }],
      totalCount: 1
    });

    expect(screen.getByText('全天')).toBeInTheDocument();
    expect(screen.queryByText('00:00')).not.toBeInTheDocument();
  });

  it('drops its own title inside the rail, where the head already carries it', () => {
    render(
      <StatusIslandPanel compact context={{ kind: 'urgentTask', task: task() }} actions={panelActions()} />
    );

    // The head one row above states the same title and summary; repeating them
    // would spend a third of the sheet saying it twice.
    expect(document.querySelector('.status-island__panel-title')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: '此刻详情' })).toHaveAttribute('data-compact', 'true');
    expect(screen.getByRole('button', { name: '打开任务：发布检查' })).toBeInTheDocument();
  });

  it('keeps an empty context free of any AI entry point', () => {
    renderPanel({ kind: 'empty' });

    expect(screen.getByText('暂无待处理状态')).toBeInTheDocument();
    expect(screen.queryByText('问 Nowly')).not.toBeInTheDocument();
  });
});
