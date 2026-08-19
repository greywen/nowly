import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TimePicker } from './TimePicker';

const now = () => new Date(2026, 6, 23, 9, 42);

function Harness({
  initialValue = '09:30',
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
    <TimePicker
      id="start-time"
      label="开始时间"
      value={value}
      open={open}
      disabled={disabled}
      now={now}
      onOpenChange={(next) => { setOpen(next); onOpenChange(next); }}
      onChange={(next) => { setValue(next); onChange(next); }}
    />
  );
}

describe('TimePicker', () => {
  it('uses an accessible button trigger instead of a native time input', async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness />);
    const trigger = screen.getByRole('button', { name: '开始时间' });
    expect(trigger).toHaveTextContent('09:30');
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(container.querySelector('input[type="time"]')).toBeNull();

    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('dialog', { name: '选择开始时间' })).toBeInTheDocument();
  });

  it('exposes 24-hour and five-minute spinbutton semantics', () => {
    render(<Harness initiallyOpen />);
    const hour = screen.getByRole('spinbutton', { name: '小时' });
    const minute = screen.getByRole('spinbutton', { name: '分钟' });
    expect(hour).toHaveAttribute('aria-valuemin', '0');
    expect(hour).toHaveAttribute('aria-valuemax', '23');
    expect(hour).toHaveAttribute('aria-valuenow', '9');
    expect(minute).toHaveAttribute('aria-valuemin', '0');
    expect(minute).toHaveAttribute('aria-valuemax', '55');
    expect(minute).toHaveAttribute('aria-valuenow', '30');
  });

  it('supports all spinbutton keyboard commands and emits on Enter', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initiallyOpen onChange={onChange} />);
    const hour = screen.getByRole('spinbutton', { name: '小时' });
    hour.focus();
    await user.keyboard('{ArrowUp}{PageUp}{Home}{End}{Enter}');
    expect(onChange).toHaveBeenLastCalledWith('23:30');

    await user.click(screen.getByRole('button', { name: '开始时间' }));
    const minute = screen.getByRole('spinbutton', { name: '分钟' });
    await user.click(minute);
    await user.keyboard('{ArrowDown}{PageDown}{Home}{End}{Enter}');
    expect(onChange).toHaveBeenLastCalledWith('23:55');
  });

  it('wraps hour and minute independently with stepper buttons', async () => {
    const user = userEvent.setup();
    render(<Harness initialValue="23:55" initiallyOpen />);
    await user.click(screen.getByRole('button', { name: '增加小时' }));
    expect(screen.getByRole('spinbutton', { name: '小时' })).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByRole('spinbutton', { name: '分钟' })).toHaveAttribute('aria-valuenow', '55');
    await user.click(screen.getByRole('button', { name: '增加分钟' }));
    expect(screen.getByRole('spinbutton', { name: '分钟' })).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByRole('spinbutton', { name: '小时' })).toHaveAttribute('aria-valuenow', '0');
  });

  it('provides the six exact quick times and chooses one', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initiallyOpen onChange={onChange} />);
    for (const time of ['09:00', '09:30', '12:00', '14:00', '15:00', '18:00']) {
      expect(screen.getByRole('button', { name: time })).toBeInTheDocument();
    }
    await user.click(screen.getByRole('button', { name: '14:00' }));
    expect(onChange).toHaveBeenLastCalledWith('14:00');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('clears and chooses injected now rounded down to five minutes', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initiallyOpen onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: '清除时间' }));
    expect(onChange).toHaveBeenLastCalledWith('');
    expect(screen.getByRole('button', { name: '开始时间' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: '开始时间' }));
    await user.click(screen.getByRole('button', { name: '现在' }));
    expect(onChange).toHaveBeenLastCalledWith('09:40');
    expect(screen.getByRole('button', { name: '开始时间' })).toHaveFocus();
  });

  it('commits stepper adjustments when the popup is closed', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initiallyOpen onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: '增加小时' }));
    await user.click(screen.getByRole('button', { name: '增加分钟' }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.pointerDown(document.body);
    expect(onChange).toHaveBeenLastCalledWith('10:35');

    onChange.mockClear();
    await user.click(screen.getByRole('button', { name: '开始时间' }));
    await user.click(screen.getByRole('button', { name: '减少小时' }));
    await user.keyboard('{Escape}');
    expect(onChange).toHaveBeenLastCalledWith('09:35');

    onChange.mockClear();
    await user.click(screen.getByRole('button', { name: '开始时间' }));
    await user.click(screen.getByRole('button', { name: '增加分钟' }));
    await user.click(screen.getByRole('button', { name: '开始时间' }));
    expect(onChange).toHaveBeenLastCalledWith('09:40');
  });

  it('does not emit when the popup closes without adjustments', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initiallyOpen onChange={onChange} />);
    await user.keyboard('{Escape}');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('closes on Escape and outside pointer input with focus restoration', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<Harness initiallyOpen onOpenChange={onOpenChange} />);
    const trigger = screen.getByRole('button', { name: '开始时间' });
    await user.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('supports controlled parent closure and disabled state', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <TimePicker id="time" label="时间" value="" open onOpenChange={vi.fn()} onChange={vi.fn()} now={now} />
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    rerender(
      <TimePicker id="time" label="时间" value="" open={false} onOpenChange={vi.fn()} onChange={vi.fn()} now={now} />
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    rerender(
      <TimePicker id="time" label="时间" value="" disabled open={false} onOpenChange={vi.fn()} onChange={vi.fn()} now={now} />
    );
    const trigger = screen.getByRole('button', { name: '时间' });
    expect(trigger).toBeDisabled();
    await user.click(trigger);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
