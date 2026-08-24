import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ExternalEventDialog } from './ExternalEventDialog';
import type { CalendarEvent } from './calendar-model';

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'x1', title: '团队周会', startAt: '2026-08-10T18:00', endAt: '2026-08-10T19:00',
    allDay: false, category: 'personal', color: '#4FC9DA', linkedTaskId: null,
    note: '会议室 A\n请提前十分钟', reminders: [], createdAt: '', updatedAt: '',
    recurrence: null, startTz: 'Asia/Shanghai', endTz: 'Asia/Shanghai', rrule: null,
    seriesId: null, seriesStartAt: null, occurrenceStartAt: null, isOverridden: false,
    subscriptionId: 's1', ...overrides
  };
}

describe('ExternalEventDialog', () => {
  it('shows title, time, timezone, note and source name read-only', () => {
    render(<ExternalEventDialog event={event()} sourceName="家庭日历" onClose={vi.fn()} />);
    expect(screen.getByText('团队周会')).toBeInTheDocument();
    expect(screen.getByText(/会议室 A/)).toBeInTheDocument();
    expect(screen.getByText('家庭日历')).toBeInTheDocument();
    expect(screen.getByText('Asia/Shanghai')).toBeInTheDocument();
    // 只读：没有编辑/删除按钮。
    expect(screen.queryByRole('button', { name: /编辑|删除/ })).toBeNull();
  });

  it('renders all-day events without a time range', () => {
    render(
      <ExternalEventDialog
        event={event({ allDay: true, startTz: null, endTz: null })}
        sourceName="家庭日历"
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText('团队周会')).toBeInTheDocument();
  });
});
