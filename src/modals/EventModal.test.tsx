import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { CalendarEvent } from '../calendar/calendar-model';
import type { MatrixTask } from '../matrix/matrix-model';
import { EventModal } from './EventModal';

const now = () => new Date(2026, 6, 23, 9, 42);
const task: MatrixTask = { id:'t1', title:'发布 Nowly', quadrant:'important_urgent', dueAt:null, priority:1, completed:false, linkedEventId:null, note:'', createdAt:'x', updatedAt:'x' };
const existing: CalendarEvent = { id:'e1', title:'设计评审', startAt:'2026-07-23T14:00', endAt:'2026-07-23T15:00', allDay:false, category:'important', color:'red', linkedTaskId:'t1', note:'确认范围', createdAt:'x', updatedAt:'x' };

function props(overrides: Record<string, unknown> = {}) {
  return {
    mode: { type:'create' as const, dateIso:'2026-07-23' }, tasks:[task], onClose:vi.fn(), onSaved:vi.fn(), onDeleted:vi.fn(),
    createEvent:vi.fn().mockResolvedValue({ ...existing, linkedTaskId:null }), updateEvent:vi.fn().mockResolvedValue(existing), deleteEvent:vi.fn().mockResolvedValue(undefined), now,
    ...overrides
  };
}

describe('EventModal', () => {
  it('renders create defaults and every controlled field', () => {
    const { container } = render(<EventModal {...props()} />);
    expect(screen.getByRole('dialog', { name:'新建日程' })).toBeInTheDocument();
    expect(screen.getByLabelText('日程标题')).toHaveValue('');
    expect(screen.getByLabelText('全天事件')).not.toBeChecked();
    expect(screen.getByRole('button', { name:'开始日期' })).toHaveTextContent('2026 年 7 月 23 日');
    expect(screen.getByRole('button', { name:'开始时间' })).toHaveTextContent('09:45');
    expect(screen.getByRole('button', { name:'结束时间' })).toHaveTextContent('10:45');
    expect(screen.getByRole('combobox', { name:'分类' })).toHaveTextContent('工作');
    expect(screen.getByRole('combobox', { name:'关联任务' })).toHaveTextContent('无关联');
    expect(screen.getAllByRole('radio')).toHaveLength(6);
    expect(screen.getByLabelText('备注')).toHaveValue('');
    expect(screen.queryByRole('button', { name:'删除日程' })).not.toBeInTheDocument();
    expect(container.querySelector('input[type="date"],input[type="time"],select')).toBeNull();
  });

  it('renders edit values and restores ordinary times around all-day mode', async () => {
    const user = userEvent.setup();
    render(<EventModal {...props({ mode:{ type:'edit', event:existing } })} />);
    expect(screen.getByRole('dialog', { name:'编辑日程' })).toBeInTheDocument();
    expect(screen.getByLabelText('日程标题')).toHaveValue('设计评审');
    expect(screen.getAllByRole('radio')).toHaveLength(6);
    expect(screen.getByRole('button', { name:'删除日程' })).toBeInTheDocument();
    await user.click(screen.getByLabelText('全天事件'));
    expect(screen.queryByRole('button', { name:'开始时间' })).not.toBeInTheDocument();
    await user.click(screen.getByLabelText('全天事件'));
    expect(screen.getByRole('button', { name:'开始时间' })).toHaveTextContent('14:00');
  });

  it('keeps pickers mutually exclusive', async () => {
    const user = userEvent.setup(); render(<EventModal {...props()} />);
    await user.click(screen.getByRole('button', { name:'开始日期' }));
    expect(screen.getByRole('dialog', { name:'选择开始日期' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name:'开始时间' }));
    expect(screen.queryByRole('dialog', { name:'选择开始日期' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name:'选择开始时间' })).toBeInTheDocument();
  });

  it('validates fields and maps server field errors without closing', async () => {
    const user = userEvent.setup(); const createEvent = vi.fn().mockRejectedValue({ code:'validation_error', field:'linkedTaskId', message:'关联任务不存在。' });
    render(<EventModal {...props({ createEvent })} />);
    await user.click(screen.getByRole('button', { name:'保存' }));
    expect(screen.getByText('请输入日程标题。')).toBeInTheDocument();
    expect(createEvent).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('日程标题'), '评审');
    await user.click(screen.getByRole('button', { name:'保存' }));
    expect(await screen.findByText('关联任务不存在。')).toBeInTheDocument();
    expect(screen.getByLabelText('日程标题')).toHaveValue('评审');
  });

  it('saves in order with static busy state and reports unfielded failures', async () => {
    const user = userEvent.setup(); let resolve!: (e:CalendarEvent)=>void;
    const createEvent = vi.fn(() => new Promise<CalendarEvent>((r)=>{resolve=r;})); const onSaved=vi.fn(); const onClose=vi.fn();
    const { unmount } = render(<EventModal {...props({ createEvent, onSaved, onClose })} />);
    await user.type(screen.getByLabelText('日程标题'), '评审');
    await user.click(screen.getByRole('button', { name:'保存' }));
    expect(screen.getByRole('button', { name:'正在保存' })).toBeDisabled();
    resolve({ ...existing, title:'评审', linkedTaskId:null });
    await waitFor(()=>expect(onSaved).toHaveBeenCalled()); expect(onClose).toHaveBeenCalled();
    unmount();

    const failing=vi.fn().mockRejectedValue({ code:'database_error', message:'保存失败。' });
    render(<EventModal {...props({ createEvent:failing })} />);
    await user.type(screen.getByLabelText('日程标题'), '草稿');
    await user.click(screen.getByRole('button', { name:'保存' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('保存失败。');
  });

  it('confirms dirty close and permanent deletion while preserving failures', async () => {
    const user=userEvent.setup(); const onClose=vi.fn();
    const { rerender }=render(<EventModal {...props({ onClose })} />);
    await user.type(screen.getByLabelText('日程标题'), '草稿');
    await user.click(screen.getByRole('button', { name:'取消' }));
    expect(screen.getByRole('dialog', { name:'放弃更改？' })).toBeInTheDocument();
    await user.keyboard('{Escape}'); expect(screen.getByRole('dialog', { name:'新建日程' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name:'取消' }));
    await user.click(screen.getByRole('button', { name:'放弃更改' })); expect(onClose).toHaveBeenCalled();

    const deleteEvent=vi.fn().mockRejectedValue({ message:'删除失败。' });
    rerender(<EventModal {...props({ mode:{type:'edit',event:existing}, deleteEvent })} />);
    await user.click(screen.getByRole('button', { name:'删除日程' }));
    expect(screen.getByRole('dialog', { name:'永久删除“设计评审”？' })).toHaveTextContent('若存在关联，只解除关联，不删除关联任务。');
    await user.click(screen.getByRole('button', { name:'永久删除' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('删除失败。');
  });
});
