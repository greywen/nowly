import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CalendarWidget } from './CalendarWidget';
import { sampleEvents } from '../lib/sample-data';

describe('CalendarWidget', () => {
  it('renders month, weekdays, today events, and navigation controls', () => {
    render(
      <CalendarWidget
        year={2026}
        monthIndex={6}
        todayIso="2026-07-23"
        events={sampleEvents}
        onOpenDate={vi.fn()}
        onOpenEvent={vi.fn()}
      />
    );

    expect(screen.getByText('July 2026')).toBeInTheDocument();
    expect(screen.getByText('一')).toBeInTheDocument();
    expect(screen.getByText('站会')).toBeInTheDocument();
    expect(screen.getByText('设计评审')).toBeInTheDocument();
    expect(screen.getByLabelText('上一月')).toBeInTheDocument();
    expect(screen.getByLabelText('下一月')).toBeInTheDocument();
  });
});
