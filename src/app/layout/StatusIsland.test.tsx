import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StatusIslandModel } from '../status-island-model';
import { StatusIsland } from './StatusIsland';

const model: StatusIslandModel = {
  primary: { kind: 'focus', status: 'running', remainingSeconds: 1122 },
  signals: [
    { kind: 'event', eventId: 'event-1', startAt: '2026-09-12T14:30' },
    { kind: 'conflict', count: 2 }
  ],
  details: {
    nextEvent: {
      id: 'event-1', title: '产品评审', startAt: '2026-09-12T14:30', endAt: '2026-09-12T15:30', allDay: false,
      category: 'work', color: '#4FC9DA', note: '', reminders: [], createdAt: 'x', updatedAt: 'x', recurrence: null,
      startTz: null, endTz: null, rrule: null, seriesId: null, seriesStartAt: null, occurrenceStartAt: null,
      isOverridden: false, subscriptionId: null
    },
    importantTask: {
      id: 'task-1', title: '发布检查', description: '', priority: 'important_urgent', dueDate: '2026-09-12', completed: false,
      laneId: 'todo', boardPosition: 0, tagIds: [], collaboratorIds: [], views: ['matrix'], createdAt: 'x', updatedAt: 'x'
    },
    focus: { status: 'running', remainingSeconds: 1122 }
  }
};

function renderIsland(overrides: Partial<React.ComponentProps<typeof StatusIsland>> = {}) {
  const props: React.ComponentProps<typeof StatusIsland> = {
    model,
    onOpenEvent: vi.fn(),
    onOpenTask: vi.fn(),
    onStartFocus: vi.fn(),
    onPauseFocus: vi.fn(),
    onResumeFocus: vi.fn(),
    onOpenQuickPanel: vi.fn(),
    ...overrides
  };
  return { ...render(<StatusIsland {...props} />), props };
}

describe('StatusIsland', () => {
  afterEach(() => vi.useRealTimers());

  it('renders the primary state and two compact signals while collapsed', () => {
    renderIsland();

    const trigger = screen.getByRole('button', { name: /专注中.*18:42/ });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveAccessibleName(/14:30.*冲突 2/);
    expect(trigger).toHaveTextContent('14:30');
    expect(screen.getByText('冲突 2')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '此刻详情' })).not.toBeInTheDocument();
  });

  it('opens from keyboard and returns focus after Escape', () => {
    renderIsland();
    const trigger = screen.getByRole('button', { name: /专注中.*18:42/ });

    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(screen.getByRole('region', { name: '此刻详情' })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: '此刻详情' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('opens with Space', () => {
    renderIsland();
    const trigger = screen.getByRole('button', { name: /专注中.*18:42/ });

    fireEvent.keyDown(trigger, { key: ' ' });
    expect(screen.getByRole('region', { name: '此刻详情' })).toBeInTheDocument();
  });

  it('closes when pointer interaction moves outside the island', () => {
    renderIsland();
    fireEvent.click(screen.getByRole('button', { name: /专注中.*18:42/ }));

    fireEvent.pointerDown(document.body);

    expect(screen.queryByRole('region', { name: '此刻详情' })).not.toBeInTheDocument();
  });

  it('keeps the detail surface mounted but inert so closing can animate safely', () => {
    renderIsland();
    const details = document.getElementById('status-island-details');

    expect(details).toHaveAttribute('aria-hidden', 'true');
    expect(details).toHaveAttribute('inert');

    fireEvent.click(screen.getByRole('button', { name: /专注中.*18:42/ }));
    expect(details).toHaveAttribute('aria-hidden', 'false');
    expect(details).not.toHaveAttribute('inert');
  });

  it('routes detail actions to their owning features', () => {
    const { props } = renderIsland();
    fireEvent.click(screen.getByRole('button', { name: /专注中.*18:42/ }));

    fireEvent.click(screen.getByRole('button', { name: '打开日程：产品评审' }));
    fireEvent.click(screen.getByRole('button', { name: '打开任务：发布检查' }));
    fireEvent.click(screen.getByRole('button', { name: '暂停专注' }));
    fireEvent.click(screen.getByRole('button', { name: '问 Nowly' }));

    expect(props.onOpenEvent).toHaveBeenCalledWith(model.details.nextEvent);
    expect(props.onOpenTask).toHaveBeenCalledWith('task-1');
    expect(props.onPauseFocus).toHaveBeenCalledOnce();
    expect(props.onOpenQuickPanel).toHaveBeenCalledOnce();
  });

  it('labels an all-day event without formatting it as midnight', () => {
    renderIsland({
      surface: 'details',
      model: {
        ...model,
        details: { ...model.details, nextEvent: { ...model.details.nextEvent!, allDay: true, startAt: '2026-09-12T00:00' } }
      }
    });

    expect(screen.getByText('全天')).toBeInTheDocument();
    expect(screen.queryByText('00:00')).not.toBeInTheDocument();
  });

  it('renders a non-interactive summary in wallpaper mode', () => {
    renderIsland({ readOnly: true });

    expect(screen.getByRole('status', { name: /专注中.*18:42/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /专注中.*18:42/ })).not.toBeInTheDocument();
    expect(screen.queryByText('问 Nowly')).not.toBeInTheDocument();
  });

  it('dismisses an event prompt without opening details', () => {
    const eventModel: StatusIslandModel = {
      ...model,
      primary: { kind: 'event', eventId: 'event-1', title: '产品评审', startAt: '2026-09-12T14:30', endAt: '2026-09-12T15:30', phase: 'imminent' }
    };
    const onDismissPrimary = vi.fn();
    const onToggleDetails = vi.fn();
    renderIsland({ model: eventModel, surface: 'trigger', onDismissPrimary, onToggleDetails });

    fireEvent.click(screen.getByRole('button', { name: '暂时隐藏：产品评审' }));

    expect(onDismissPrimary).toHaveBeenCalledWith('event:event-1:2026-09-12T14:30:imminent');
    expect(onToggleDetails).not.toHaveBeenCalled();
  });

  it('does not offer dismissal for focus status', () => {
    renderIsland({ surface: 'trigger', onDismissPrimary: vi.fn() });

    expect(screen.queryByRole('button', { name: /暂时隐藏/ })).not.toBeInTheDocument();
  });

  it('delays a lower-priority replacement until the current state has remained stable', () => {
    vi.useFakeTimers();
    const imminent: StatusIslandModel = {
      ...model,
      primary: { kind: 'event', eventId: 'event-1', title: '产品评审', startAt: '2026-09-12T14:30', endAt: '2026-09-12T15:30', phase: 'imminent' }
    };
    const urgentTask: StatusIslandModel = {
      ...model,
      primary: { kind: 'task', taskId: 'task-1', title: '发布检查', dueDate: '2026-09-12', priority: 'important_urgent' }
    };
    const view = renderIsland({ model: imminent });

    view.rerender(<StatusIsland {...view.props} model={urgentTask} />);
    expect(screen.getByRole('button', { name: /产品评审/ })).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(4000));
    expect(screen.getByRole('button', { name: /发布检查/ })).toBeInTheDocument();
  });

  it('keeps a same-rank primary while it remains a valid candidate', () => {
    vi.useFakeTimers();
    const first: StatusIslandModel = {
      ...model,
      primary: { kind: 'event', eventId: 'event-1', title: '产品评审', startAt: '2026-09-12T14:30', endAt: '2026-09-12T15:30', phase: 'next' },
      candidateKeys: ['event:event-1:2026-09-12T14:30:next', 'event:event-2:2026-09-12T15:00:next']
    };
    const reordered: StatusIslandModel = {
      ...first,
      primary: { kind: 'event', eventId: 'event-2', title: '客户电话', startAt: '2026-09-12T15:00', endAt: '2026-09-12T15:30', phase: 'next' }
    };
    const view = renderIsland({ model: first });

    view.rerender(<StatusIsland {...view.props} model={reordered} />);
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.getByRole('button', { name: /产品评审/ })).toBeInTheDocument();

    view.rerender(<StatusIsland {...view.props} model={{ ...reordered, candidateKeys: ['event:event-2:2026-09-12T15:00:next'] }} />);
    expect(screen.getByRole('button', { name: /客户电话/ })).toBeInTheDocument();
  });
});