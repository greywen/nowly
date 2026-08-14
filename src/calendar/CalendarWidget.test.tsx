import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../app/styles.css';
import { sampleEvents } from '../lib/sample-data';
import { CalendarWidget } from './CalendarWidget';

const baseProps = {
  year: 2026,
  monthIndex: 6,
  todayIso: '2026-07-23',
  anchorIso: '2026-07-23',
  view: 'month' as const,
  events: sampleEvents,
  status: 'ready' as const,
  onRetry: vi.fn(),
  onCreateEvent: vi.fn(),
  onSetView: vi.fn(),
  onPreviousMonth: vi.fn(),
  onNextMonth: vi.fn(),
  onToday: vi.fn(),
  onCreateEventForDate: vi.fn(),
  onOpenDate: vi.fn(),
  onOpenEvent: vi.fn(),
  onMoveEvent: vi.fn(),
  onMoveEventToHour: vi.fn(),
  onResizeEvent: vi.fn()
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('CalendarWidget', () => {
  it('renders overflow dots in the dedicated event-row container', () => {
    const overflowEvent = {
      ...sampleEvents[0],
      id: 'overflow-alignment',
      startAt: '2026-07-23T20:00:00',
      endAt: '2026-07-23T20:30:00'
    };
    render(<CalendarWidget {...baseProps} events={[...sampleEvents, overflowEvent]} />);

    const row = screen.getByRole('button', { name: '另有 1 个日程' });
    expect(row).toHaveClass('event-overflow-dots');
    expect(row.querySelector('.event-overflow-dot')).toHaveStyle({ '--selected-color': '#4FC9DA' });
  });

  it('renders a 42-day month and invokes all header navigation callbacks', async () => {
    const user = userEvent.setup();
    const onPreviousMonth = vi.fn();
    const onNextMonth = vi.fn();
    const onToday = vi.fn();
    const { container } = render(
      <CalendarWidget {...baseProps} onPreviousMonth={onPreviousMonth} onNextMonth={onNextMonth} onToday={onToday} />
    );

    expect(container.querySelectorAll('.calendar-grid [data-calendar-day]')).toHaveLength(42);
    await user.click(screen.getByRole('button', { name: '上一个月' }));
    await user.click(screen.getByRole('button', { name: '今天' }));
    await user.click(screen.getByRole('button', { name: '下一个月' }));
    expect(onPreviousMonth).toHaveBeenCalledOnce();
    expect(onToday).toHaveBeenCalledOnce();
    expect(onNextMonth).toHaveBeenCalledOnce();
  });

  it('reorders weekday labels and drops weekend columns per calendar settings', () => {
    const { container, rerender } = render(
      <CalendarWidget
        {...baseProps}
        calendarSettings={{ weekStart: 'monday', dateFormat: 'localized', showWeekends: true }}
        onChangeCalendarSettings={vi.fn()}
      />
    );
    // Monday-first, weekends shown: 7 columns, first label is 一.
    let weekdayCells = container.querySelectorAll('.weekdays span');
    expect(weekdayCells).toHaveLength(7);
    expect(weekdayCells[0]).toHaveTextContent('一');
    expect(container.querySelectorAll('.calendar-grid [data-calendar-day]')).toHaveLength(42);

    // Sunday-first: first label becomes 日.
    rerender(
      <CalendarWidget
        {...baseProps}
        calendarSettings={{ weekStart: 'sunday', dateFormat: 'localized', showWeekends: true }}
        onChangeCalendarSettings={vi.fn()}
      />
    );
    weekdayCells = container.querySelectorAll('.weekdays span');
    expect(weekdayCells[0]).toHaveTextContent('日');

    // Weekends hidden: five weekday columns and 30 rendered day cells (6 rows × 5).
    rerender(
      <CalendarWidget
        {...baseProps}
        calendarSettings={{ weekStart: 'monday', dateFormat: 'localized', showWeekends: false }}
        onChangeCalendarSettings={vi.fn()}
      />
    );
    weekdayCells = container.querySelectorAll('.weekdays span');
    expect(weekdayCells).toHaveLength(5);
    expect([...weekdayCells].map((cell) => cell.textContent)).toEqual(['一', '二', '三', '四', '五']);
    expect(container.querySelectorAll('.calendar-grid [data-calendar-day]')).toHaveLength(30);
  });

  it('renders an ISO-formatted title when the date format is iso', () => {
    render(
      <CalendarWidget
        {...baseProps}
        calendarSettings={{ weekStart: 'monday', dateFormat: 'iso', showWeekends: true }}
        onChangeCalendarSettings={vi.fn()}
      />
    );
    expect(screen.getByRole('heading', { name: '2026-07' })).toBeInTheDocument();
  });

  it('opens date detail about 250 ms after a single day click', () => {
    vi.useFakeTimers();
    const onOpenDate = vi.fn();
    render(<CalendarWidget {...baseProps} onOpenDate={onOpenDate} />);

    fireEvent.click(screen.getByRole('button', { name: /2026年7月23日/ }));
    expect(onOpenDate).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(249));
    expect(onOpenDate).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onOpenDate).toHaveBeenCalledOnce();
    expect(onOpenDate).toHaveBeenCalledWith('2026-07-23');
  });

  it('cancels the single click when a day is double-clicked and creates exactly once', () => {
    vi.useFakeTimers();
    const onOpenDate = vi.fn();
    const onCreateEventForDate = vi.fn();
    render(
      <CalendarWidget {...baseProps} onOpenDate={onOpenDate} onCreateEventForDate={onCreateEventForDate} />
    );
    const day = screen.getByRole('button', { name: /2026年7月23日/ });

    fireEvent.click(day);
    fireEvent.click(day);
    fireEvent.doubleClick(day);
    act(() => vi.advanceTimersByTime(300));
    expect(onCreateEventForDate).toHaveBeenCalledOnce();
    expect(onCreateEventForDate).toHaveBeenCalledWith('2026-07-23');
    expect(onOpenDate).not.toHaveBeenCalled();
  });

  it('isolates event activation from the date and supports keyboard activation', async () => {
    const user = userEvent.setup();
    const onOpenDate = vi.fn();
    const onOpenEvent = vi.fn();
    render(<CalendarWidget {...baseProps} onOpenDate={onOpenDate} onOpenEvent={onOpenEvent} />);

    const eventButton = screen.getByRole('button', { name: '09:30 站会，工作' });
    await user.click(eventButton);
    expect(onOpenEvent).toHaveBeenCalledWith(sampleEvents[0]);
    expect(onOpenDate).not.toHaveBeenCalled();

    onOpenEvent.mockClear();
    eventButton.focus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onOpenEvent).toHaveBeenCalledTimes(2);
  });

  it('labels all-day events and opens detail from the overflow button', async () => {
    const user = userEvent.setup();
    const onOpenDate = vi.fn();
    const events = [
      { ...sampleEvents[0], id: 'all-day', title: '产品发布日', allDay: true, category: 'important' as const },
      ...sampleEvents
    ];
    render(<CalendarWidget {...baseProps} events={events} onOpenDate={onOpenDate} />);

    expect(screen.getByRole('button', { name: '全天 产品发布日，重要' })).toBeInTheDocument();
    expect(screen.queryByText('健身')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '另有 1 个日程' }));
    expect(onOpenDate).toHaveBeenCalledWith('2026-07-23');
  });

  it('renders hidden month events as left-aligned dots with matching event colors', async () => {
    const user = userEvent.setup();
    const onOpenDate = vi.fn();
    const colors = ['#4FC9DA', '#F06445', '#B8D935', '#4F55DA'] as const;
    const overflowEvents = colors.map((color, index) => ({
      ...sampleEvents[0],
      id: `overflow-${color}`,
      title: `隐藏日程 ${index + 1}`,
      startAt: `2026-07-23T${20 + index}:00:00`,
      endAt: `2026-07-23T${20 + index}:30:00`,
      color
    }));
    render(
      <CalendarWidget
        {...baseProps}
        events={[...sampleEvents, ...overflowEvents]}
        onOpenDate={onOpenDate}
      />
    );

    const overflowButton = screen.getByRole('button', { name: '另有 4 个日程' });
    expect(overflowButton.querySelectorAll('.event-overflow-dot')).toHaveLength(4);
    const dots = [...overflowButton.querySelectorAll<HTMLElement>('.event-overflow-dot')];
    expect(dots.map((dot) => dot.style.getPropertyValue('--selected-color'))).toEqual([
      '#4FC9DA', '#F06445', '#B8D935', '#4F55DA'
    ]);

    await user.click(overflowButton);
    expect(onOpenDate).toHaveBeenCalledWith('2026-07-23');
  });

  it('uses only real sibling buttons without nested or simulated controls', () => {
    const { container } = render(<CalendarWidget {...baseProps} />);
    expect(container.querySelector('button button')).toBeNull();
    expect(container.querySelector('[role="button"]')).toBeNull();
  });

  it('preserves empty, loading, and retryable error states', () => {
    const retry = vi.fn();
    const { rerender } = render(<CalendarWidget {...baseProps} events={[]} status="ready" onRetry={retry} />);
    expect(screen.getByText('本月暂无日程')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新建日程' })).toBeInTheDocument();

    rerender(<CalendarWidget {...baseProps} events={[]} status="loading" onRetry={retry} />);
    expect(screen.getByText('正在读取本地日程')).toBeInTheDocument();

    rerender(
      <CalendarWidget {...baseProps} events={[]} status="error" errorMessage="日程读取失败" onRetry={retry} />
    );
    screen.getByRole('button', { name: '重试读取日程' }).click();
    expect(screen.getByRole('alert')).toHaveTextContent('日程读取失败');
    expect(retry).toHaveBeenCalledOnce();
  });

  it('switches between month, week, day, and list views', async () => {
    const user = userEvent.setup();
    const onSetView = vi.fn();
    render(<CalendarWidget {...baseProps} onSetView={onSetView} />);

    const group = screen.getByRole('group', { name: '切换视图' });
    expect(group).toBeInTheDocument();
    for (const label of ['月', '周', '天', '列表']) {
      await user.click(screen.getByRole('button', { name: label, pressed: undefined }));
    }
    expect(onSetView).toHaveBeenCalledTimes(4);
    expect(onSetView).toHaveBeenNthCalledWith(1, 'month');
    expect(onSetView).toHaveBeenNthCalledWith(2, 'week');
    expect(onSetView).toHaveBeenNthCalledWith(3, 'day');
    expect(onSetView).toHaveBeenNthCalledWith(4, 'list');
  });

  it('provides a persistent vertical scroll region in every calendar view', () => {
    const { container, rerender } = render(<CalendarWidget {...baseProps} view="month" />);
    const viewSelectors = {
      month: '.calendar-grid',
      week: '.calendar-week',
      day: '.calendar-day-view',
      list: '.calendar-list-view'
    } as const;

    for (const view of ['month', 'week', 'day', 'list'] as const) {
      rerender(<CalendarWidget {...baseProps} view={view} />);
      const scrollRegion = container.querySelector(viewSelectors[view]);
      expect(scrollRegion).not.toBeNull();
      expect(scrollRegion).toHaveClass('calendar-scroll-region');
    }
  });

  it('marks the active view and adapts navigation labels per view', () => {
    const { rerender } = render(<CalendarWidget {...baseProps} view="month" />);
    expect(screen.getByRole('button', { name: '月' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '上一个月' })).toBeInTheDocument();

    rerender(<CalendarWidget {...baseProps} view="week" />);
    expect(screen.getByRole('button', { name: '周' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '上一周' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下一周' })).toBeInTheDocument();

    rerender(<CalendarWidget {...baseProps} view="day" />);
    expect(screen.getByRole('button', { name: '天' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '前一天' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '后一天' })).toBeInTheDocument();
  });

  it('renders a 7-column week view with movable events', () => {
    const { container } = render(<CalendarWidget {...baseProps} view="week" />);
    expect(container.querySelectorAll('.calendar-week__cells > [data-calendar-day]')).toHaveLength(7);
    // Events use pointer-driven move/resize (native HTML5 DnD is unreliable in
    // the Tauri webview), signalled by the .event--movable affordance class.
    const chip = screen.getByRole('button', { name: '09:30 站会，工作' });
    expect(chip.className).toContain('event--movable');
  });

  it('renders the day view as a scrollable 24-hour time grid with movable events', () => {
    const { container } = render(<CalendarWidget {...baseProps} view="day" />);
    const dayView = container.querySelector('.calendar-day-view');
    const dayGrid = container.querySelector('.day-grid');

    expect(container.querySelectorAll('.day-grid__row')).toHaveLength(24);
    expect(dayView).toHaveClass('calendar-scroll-region');
    expect(dayGrid).toHaveClass('day-grid--full-day');
    const chip = screen.getByRole('button', { name: '09:30 站会，工作' });
    expect(chip).toHaveTextContent('09:30 – 10:00');
    expect(chip.className).toContain('event--movable');
  });

  // Pointer-driven move/resize (drag a chip to another day/hour, resize from the
  // handle) can't be exercised in jsdom because the gesture hit-tests with
  // document.elementFromPoint and real element geometry, neither of which jsdom
  // provides. That behavior is covered end-to-end in tests/nowly-event-resize.spec.ts.

  it('groups the list view by date', () => {
    render(<CalendarWidget {...baseProps} view="list" />);
    expect(screen.getByRole('heading', { name: /7 月 23 日/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '09:30 站会，工作' })).toBeInTheDocument();
  });

});
