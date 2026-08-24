import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CalendarSettingsDialog, type CalendarSettings } from './CalendarSettingsDialog';

const settings: CalendarSettings = { weekStart: 'monday', dateFormat: 'localized', showWeekends: true };

function props(overrides = {}) {
  return {
    settings,
    onChange: vi.fn(),
    onClose: vi.fn(),
    subscriptions: [],
    onSubscriptionsChanged: vi.fn(),
    createSubscription: vi.fn(),
    updateSubscription: vi.fn(),
    deleteSubscription: vi.fn(),
    refreshSubscription: vi.fn(),
    ...overrides
  };
}

describe('CalendarSettingsDialog', () => {
  it('lands on the basic tab and persists changes immediately', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<CalendarSettingsDialog {...props({ onChange })} />);
    expect(screen.getByRole('dialog', { name: '日历设置' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '基础设置' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('每周开始日')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: '显示周末' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ showWeekends: false }));
  });

  it('moves calendar subscriptions into their own tab', async () => {
    const user = userEvent.setup();
    render(<CalendarSettingsDialog {...props()} />);
    expect(screen.queryByRole('button', { name: '添加订阅' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: '日历订阅(0)' }));
    expect(screen.getByRole('button', { name: '添加订阅' })).toBeInTheDocument();
    expect(screen.queryByText('每周开始日')).not.toBeInTheDocument();
  });
});
