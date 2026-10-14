import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AlarmEditor } from './AlarmEditor';
import type { Alarm } from './time-model';

const alarm: Alarm = { id: 'a', title: 'Water', hour: 9, minute: 0, enabled: true, repeat: { kind: 'weekly', weekdays: [1] }, effectiveFromUtc: '2026-10-14T00:00:00Z', createdAt: '', updatedAt: '' };

describe('AlarmEditor autosave', () => {
  it('uses three compact rows with hidden field labels and short weekday text', () => {
    const { container } = render(<AlarmEditor onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(container.querySelector('.time-alarm-editor__main')).toBeInTheDocument();
    expect(container.querySelector('.time-alarm-editor__repeat')).toBeInTheDocument();
    expect(container.querySelector('.time-alarm-editor__actions')).toBeInTheDocument();
    expect(screen.getByText('标题')).toHaveClass('visually-hidden');
    expect(screen.getByText('时间')).toHaveClass('visually-hidden');
    expect(screen.getByText('自选星期')).toHaveClass('visually-hidden');
    expect(Array.from(container.querySelectorAll('.time-weekday-chip__label')).map(item => item.textContent)).toEqual(['日', '一', '二', '三', '四', '五', '六']);
    expect(screen.queryByText(/周一、周二、周三、周四、周五/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '取消' })).toBeInTheDocument();
  });
  it('does not write on mount, autosaves valid edits and stays open without a save button', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn();
    render(<AlarmEditor alarm={alarm} onSave={save} onCancel={close} />);
    expect(save).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: 'Tea' } });
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ title: 'Tea' }), { title: 'Tea' }));
    expect(close).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '保存闹钟' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '结束编辑' }));
    expect(close).toHaveBeenCalledOnce();
  });

  it('defaults to 09:00 weekdays with Sunday-first native checkboxes and no date or repeat dropdown', () => {
    render(<AlarmEditor onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('button', { name: '时间' })).toHaveTextContent('09:00');
    expect(screen.getByRole('checkbox', { name: '重复闹钟' })).toBeChecked();
    expect(screen.getByRole('group', { name: '自选星期' }).querySelectorAll('input')).toHaveLength(7);
    expect(Array.from(screen.getByRole('group', { name: '自选星期' }).querySelectorAll('input')).map(input => input.getAttribute('aria-label'))).toEqual(['周日', '周一', '周二', '周三', '周四', '周五', '周六']);
    for (const day of ['周一', '周二', '周三', '周四', '周五']) expect(screen.getByLabelText(day)).toBeChecked();
    expect(screen.queryByRole('button', { name: '日期' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('blocks empty weekdays, stores Sunday as ISO 7 and saves once without a date', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<AlarmEditor alarm={alarm} onSave={save} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('周一'));
    expect(await screen.findByRole('alert')).toHaveTextContent('自选星期不能为空');
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('周日'));
    await waitFor(() => expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ repeat: { kind: 'weekly', weekdays: [7] } }), { repeat: { kind: 'weekly', weekdays: [7] } }));
    fireEvent.click(screen.getByLabelText('重复闹钟'));
    await waitFor(() => expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ repeat: { kind: 'once' } }), { repeat: { kind: 'once' } }));
  });

  it('does not autosave time panel drafts or cancellation, only a confirmed arbitrary minute', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<AlarmEditor alarm={alarm} onSave={save} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '时间' }));
    fireEvent.change(screen.getByRole('spinbutton', { name: '分钟' }), { target: { value: '17' } });
    expect(save).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('spinbutton', { name: '分钟' }), { key: 'Escape' });
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '时间' }));
    fireEvent.change(screen.getByRole('spinbutton', { name: '分钟' }), { target: { value: '17' } });
    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ hour: 9, minute: 17 }), { hour: 9, minute: 17 }));
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

  it('rejects clearing a required alarm time without saving', async () => {
    const save = vi.fn();
    render(<AlarmEditor alarm={alarm} onSave={save} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '时间' }));
    fireEvent.click(screen.getByRole('button', { name: '清除时间' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('请选择时间');
    expect(save).not.toHaveBeenCalled();
  });

  it('restores the time trigger focus when Escape cancels without closing the editor', async () => {
    const close = vi.fn();
    render(<AlarmEditor alarm={{ ...alarm, repeat: { kind: 'once' } }} onSave={vi.fn()} onCancel={close} />);
    const trigger = screen.getByRole('button', { name: '时间' });
    fireEvent.click(trigger);
    const hour = screen.getByRole('spinbutton', { name: '小时' });
    hour.focus();
    fireEvent.keyDown(hour, { key: 'Escape' });
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
    expect(screen.getByRole('button', { name: '时间' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: '重复闹钟' })).toBeDisabled();
    resolve();
    await waitFor(() => expect(screen.getByRole('button', { name: '创建闹钟' })).not.toBeDisabled());
  });
});
