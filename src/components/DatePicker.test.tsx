import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DatePicker } from './DatePicker';

const today = new Date(2026, 6, 23, 9, 42);

function Harness({
  initialValue = '2026-07-23',
  initiallyOpen = false,
  onChange = vi.fn(),
  onOpenChange = vi.fn(),
  disabled = false
}: {
  initialValue?: string;
  initiallyOpen?: boolean;
  onChange?: (value: string) => void;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
} = {}) {
  const [value, setValue] = useState(initialValue);
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <DatePicker
      id="start-date"
      label="开始日期"
      value={value}
      disabled={disabled}
      open={open}
      today={today}
      onOpenChange={(next) => { setOpen(next); onOpenChange(next); }}
      onChange={(next) => { setValue(next); onChange(next); }}
    />
  );
}

describe('DatePicker', () => {
  it('uses an accessible button trigger instead of a native date input', async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness />);
    const trigger = screen.getByRole('button', { name: '开始日期' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveTextContent('2026 年 7 月 23 日');
    expect(container.querySelector('input[type="date"]')).toBeNull();

    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('dialog', { name: '选择开始日期' })).toBeInTheDocument();
  });

  it('renders Monday-first headings and an accessible 42-day grid', () => {
    render(<Harness initiallyOpen />);
    const dialog = screen.getByRole('dialog', { name: '选择开始日期' });
    const headings = within(dialog).getAllByRole('columnheader').map((heading) => heading.textContent);
    expect(headings).toEqual(['一', '二', '三', '四', '五', '六', '日']);
    expect(within(dialog).getAllByRole('gridcell')).toHaveLength(42);
    expect(within(dialog).getByRole('gridcell', { name: '2026年7月23日 星期四' })).toHaveAttribute('aria-selected', 'true');
    expect(within(dialog).getByRole('gridcell', { name: '2026年7月23日 星期四' })).toHaveAttribute('aria-current', 'date');
  });

  it('navigates months and selects leading or trailing dates directly', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initiallyOpen onChange={onChange} />);
    expect(screen.getByText('2026 年 7 月')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '下一个月' }));
    expect(screen.getByText('2026 年 8 月')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '上一个月' }));
    const trailingDate = screen.getByRole('gridcell', { name: '2026年8月1日 星期六' });
    await user.click(trailingDate);
    expect(onChange).toHaveBeenCalledWith('2026-08-01');
    expect(screen.queryByRole('dialog', { name: '选择开始日期' })).not.toBeInTheDocument();
  });

  it('supports today and clear actions and restores trigger focus', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initialValue="2026-07-10" initiallyOpen onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: '清除日期' }));
    expect(onChange).toHaveBeenLastCalledWith('');
    expect(screen.getByRole('button', { name: '开始日期' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: '开始日期' }));
    await user.click(screen.getByRole('button', { name: '今天' }));
    expect(onChange).toHaveBeenLastCalledWith('2026-07-23');
    expect(screen.getByRole('button', { name: '开始日期' })).toHaveFocus();
  });

  it('moves by day, week, and month with the keyboard and selects with Enter or Space', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initiallyOpen onChange={onChange} />);
    const selected = screen.getByRole('gridcell', { name: '2026年7月23日 星期四' });
    selected.focus();

    await user.keyboard('{ArrowRight}{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenLastCalledWith('2026-07-31');

    await user.click(screen.getByRole('button', { name: '开始日期' }));
    screen.getByRole('gridcell', { name: '2026年7月31日 星期五' }).focus();
    await user.keyboard('{PageDown} ');
    expect(onChange).toHaveBeenLastCalledWith('2026-08-31');
  });

  it('closes on Escape and outside pointer input with focus restoration', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<Harness initiallyOpen onOpenChange={onOpenChange} />);
    const trigger = screen.getByRole('button', { name: '开始日期' });

    await user.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog', { name: '选择开始日期' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('supports controlled parent closure and disabled state', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <DatePicker id="date" label="日期" value="" open onOpenChange={vi.fn()} onChange={vi.fn()} today={today} />
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    rerender(
      <DatePicker id="date" label="日期" value="" open={false} onOpenChange={vi.fn()} onChange={vi.fn()} today={today} />
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    rerender(
      <DatePicker id="date" label="日期" value="" disabled open={false} onOpenChange={vi.fn()} onChange={vi.fn()} today={today} />
    );
    const trigger = screen.getByRole('button', { name: '日期' });
    expect(trigger).toBeDisabled();
    await user.click(trigger);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
