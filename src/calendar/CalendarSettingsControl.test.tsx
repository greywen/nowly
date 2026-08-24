import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CalendarSettingsControl, type CalendarSettings } from './CalendarSettingsControl';

const settings: CalendarSettings = { weekStart: 'monday', dateFormat: 'localized', showWeekends: true };

describe('CalendarSettingsControl', () => {
  it('opens the popover and edits calendar-scoped settings', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<CalendarSettingsControl settings={settings} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: '日历设置' }));
    await user.click(screen.getByRole('checkbox', { name: '显示周末' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ showWeekends: false }));
  });

  it('opens subscription management from the popover and closes it', async () => {
    const user = userEvent.setup();
    const onOpenSubscriptions = vi.fn();
    render(<CalendarSettingsControl settings={settings} onChange={vi.fn()} onOpenSubscriptions={onOpenSubscriptions} />);
    await user.click(screen.getByRole('button', { name: '日历设置' }));
    await user.click(screen.getByRole('button', { name: '管理订阅' }));
    expect(onOpenSubscriptions).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: '日历设置' })).not.toBeInTheDocument();
  });

  it('omits the subscription entry when no handler is provided', async () => {
    const user = userEvent.setup();
    render(<CalendarSettingsControl settings={settings} onChange={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: '日历设置' }));
    expect(screen.queryByRole('button', { name: '管理订阅' })).not.toBeInTheDocument();
  });
});
