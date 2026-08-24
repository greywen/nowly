import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ExternalEventDialog } from './ExternalEventDialog';
import type { CalendarEvent } from './calendar-model';

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'x1', title: '团队周会', startAt: '2026-08-10T18:00', endAt: '2026-08-10T19:00',
    allDay: false, category: 'personal', color: '#4FC9DA', linkedTaskId: null,
    note: '', reminders: [], createdAt: '', updatedAt: '',
    recurrence: null, startTz: 'Asia/Shanghai', endTz: 'Asia/Shanghai', rrule: null,
    seriesId: null, seriesStartAt: null, occurrenceStartAt: null, isOverridden: false,
    subscriptionId: 's1', externalLocation: '会议室 A', externalDescription: '请提前十分钟', ...overrides
  };
}

describe('ExternalEventDialog', () => {
  it('shows title, time, timezone, location, description and source name read-only', () => {
    render(<ExternalEventDialog event={event()} sourceName="家庭日历" onClose={vi.fn()} />);
    expect(screen.getByText('团队周会')).toBeInTheDocument();
    expect(screen.getByText(/会议室 A/)).toBeInTheDocument();
    expect(screen.getByText(/请提前十分钟/)).toBeInTheDocument();
    expect(screen.getByText('家庭日历')).toBeInTheDocument();
    expect(screen.getByText('Asia/Shanghai')).toBeInTheDocument();
    // 只读：没有编辑/删除按钮。
    expect(screen.queryByRole('button', { name: /编辑|删除/ })).toBeNull();
  });

  it('shows a description even when there is no location', () => {
    render(
      <ExternalEventDialog
        event={event({ externalLocation: null, externalDescription: '项目讨论' })}
        sourceName="家庭日历"
        onClose={vi.fn()}
      />
    );
    // 没有地点时不应把描述误当成地点。
    expect(screen.getByText(/项目讨论/)).toBeInTheDocument();
    expect(screen.queryByText(/会议室/)).toBeNull();
  });

  it('shows the end date for a cross-day timed event', () => {
    render(
      <ExternalEventDialog
        event={event({ startAt: '2026-08-10T23:00', endAt: '2026-08-11T01:00' })}
        sourceName="家庭日历"
        onClose={vi.fn()}
      />
    );
    // 跨日：结束应显示日期，而不是看起来像负时长。
    expect(screen.getByText(/2026-08-11/)).toBeInTheDocument();
  });

  it('renders a multi-day all-day event as a date range', () => {
    render(
      <ExternalEventDialog
        event={event({ allDay: true, startTz: null, endTz: null, startAt: '2026-08-10T00:00', endAt: '2026-08-13T00:00' })}
        sourceName="家庭日历"
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText('团队周会')).toBeInTheDocument();
    // DTEND 排他：8/10–8/13 展示为到 8/12 的多日全天。
    expect(screen.getByText(/2026-08-10/)).toBeInTheDocument();
  });
});
