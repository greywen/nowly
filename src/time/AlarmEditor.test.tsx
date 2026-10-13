import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AlarmEditor } from './AlarmEditor';
import type { Alarm } from './time-model';

const alarm: Alarm = { id: 'a', title: 'Water', hour: 9, minute: 0, enabled: true, repeat: { kind: 'weekly', weekdays: [1] }, createdAt: '', updatedAt: '' };

describe('AlarmEditor autosave', () => {
  it('does not write on mount, autosaves valid edits and stays open without a save button', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn();
    render(<AlarmEditor alarm={alarm} onSave={save} onCancel={close} />);
    expect(save).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: 'Tea' } });
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ title: 'Tea' })));
    expect(close).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '保存闹钟' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '结束编辑' }));
    expect(close).toHaveBeenCalledOnce();
  });

  it.each([['小时', ''], ['小时', '24'], ['小时', '-1'], ['分钟', ''], ['分钟', '60']])('blocks invalid %s %s', async (name, value) => {
    const save = vi.fn();
    render(<AlarmEditor alarm={alarm} onSave={save} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(name), { target: { value } });
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });

  it('blocks empty weekdays and past once dates', async () => {
    const save = vi.fn();
    const { unmount } = render(<AlarmEditor alarm={alarm} onSave={save} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('周一'));
    expect(await screen.findByRole('alert')).toHaveTextContent('自选星期不能为空');
    expect(save).not.toHaveBeenCalled();
    unmount();
    render(<AlarmEditor alarm={{ ...alarm, repeat: { kind: 'once', date: '2000-01-01' } }} onSave={save} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: 'Past' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('一次性闹钟不能早于当前时间');
    expect(save).not.toHaveBeenCalled();
  });

  it('retains the draft after failure and retries visibly', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    render(<AlarmEditor alarm={alarm} onSave={save} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: 'Tea' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('offline');
    expect(screen.getByLabelText('标题')).toHaveValue('Tea');
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  });

  it('shows the exact minute validation message when confirming an invalid new alarm', async () => {
    const save = vi.fn();
    render(<AlarmEditor onSave={save} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '喝水' } });
    fireEvent.change(screen.getByLabelText('分钟'), { target: { value: '61' } });
    expect(screen.getByRole('button', { name: '创建闹钟' })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '创建闹钟' }));
    expect(screen.getByText('分钟必须是 0 到 59')).toHaveAttribute('role', 'alert');
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByLabelText('分钟')).toHaveValue('61');
  });

  it('restores the date trigger focus when Escape closes its picker without closing the editor', async () => {
    const close = vi.fn();
    render(<AlarmEditor alarm={{ ...alarm, repeat: { kind: 'once', date: '2099-01-15' } }} onSave={vi.fn()} onCancel={close} />);
    const trigger = screen.getByRole('button', { name: /^日期$/ });
    fireEvent.click(trigger);
    const picker = screen.getByRole('dialog');
    const day = picker.querySelector<HTMLElement>('[data-date="2099-01-15"]')!;
    day.focus();
    fireEvent.keyDown(day, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
    expect(close).not.toHaveBeenCalled();
  });

  it('retains a failed creation draft and exposes retry', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    render(<AlarmEditor onSave={save} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: 'Tea' } });
    fireEvent.click(screen.getByRole('button', { name: '创建闹钟' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('offline');
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText('标题')).toHaveValue('Tea');
  });

  it('requires explicit creation and blocks duplicate submission while pending', async () => {
    let resolve!: () => void;
    const save = vi.fn(() => new Promise<void>(r => { resolve = r; }));
    render(<AlarmEditor onSave={save} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: 'Tea' } });
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '创建闹钟' }));
    fireEvent.click(screen.getByRole('button', { name: '创建闹钟' }));
    expect(save).toHaveBeenCalledOnce();
    expect(screen.getByLabelText('标题')).toBeDisabled();
    expect(screen.getByLabelText('小时')).toBeDisabled();
    expect(screen.getByRole('combobox', { name: '重复' })).toBeDisabled();
    resolve();
    await waitFor(() => expect(screen.getByRole('button', { name: '创建闹钟' })).not.toBeDisabled());
  });
});
