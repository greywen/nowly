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
        status="ready"
        onRetry={vi.fn()}
        onCreateEvent={vi.fn()}
        onOpenDate={vi.fn()}
        onOpenEvent={vi.fn()}
      />
    );

    expect(screen.getByText('2026 年 7 月')).toBeInTheDocument();
    expect(screen.getByText('一')).toBeInTheDocument();
    expect(screen.getByText('站会')).toBeInTheDocument();
    expect(screen.getByText('设计评审')).toBeInTheDocument();
    expect(screen.getByLabelText('上一个月')).toBeInTheDocument();
    expect(screen.getByLabelText('下一个月')).toBeInTheDocument();
  });

  it('shows an empty month summary and a retryable read error', () => {
    const retry = vi.fn();
    const { rerender } = render(
      <CalendarWidget
        year={2026}
        monthIndex={6}
        todayIso="2026-07-23"
        events={[]}
        status="ready"
        onRetry={retry}
        onCreateEvent={vi.fn()}
        onOpenDate={vi.fn()}
        onOpenEvent={vi.fn()}
      />
    );
    expect(screen.getByText('本月暂无日程')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新建日程' })).toBeInTheDocument();

    rerender(
      <CalendarWidget
        year={2026}
        monthIndex={6}
        todayIso="2026-07-23"
        events={[]}
        status="error"
        errorMessage="日程读取失败"
        onRetry={retry}
        onCreateEvent={vi.fn()}
        onOpenDate={vi.fn()}
        onOpenEvent={vi.fn()}
      />
    );
    screen.getByRole('button', { name: '重试读取日程' }).click();
    expect(screen.getByRole('alert')).toHaveTextContent('日程读取失败');
    expect(retry).toHaveBeenCalledOnce();
  });

  it('shows a static loading message without spinners', () => {
    render(
      <CalendarWidget
        year={2026}
        monthIndex={6}
        todayIso="2026-07-23"
        events={[]}
        status="loading"
        onRetry={vi.fn()}
        onCreateEvent={vi.fn()}
        onOpenDate={vi.fn()}
        onOpenEvent={vi.fn()}
      />
    );

    expect(screen.getByText('正在读取本地日程')).toBeInTheDocument();
  });
});
