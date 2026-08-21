import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { CalendarEvent, Recurrence } from '../calendar/calendar-model';
import type { MatrixTask } from '../matrix/matrix-model';
import { EventModal } from './EventModal';

const now = () => new Date(2026, 6, 23, 9, 42);
const task: MatrixTask = { id:'t1', title:'发布 Nowly', quadrant:'important_urgent', dueAt:null, priority:1, completed:false, linkedEventId:null, note:'', createdAt:'x', updatedAt:'x' };
const existing: CalendarEvent = { id:'e1', title:'设计评审', startAt:'2026-07-23T14:00', endAt:'2026-07-23T15:00', allDay:false, category:'important', color:'red', linkedTaskId:'t1', note:'确认范围', reminders:[], createdAt:'x', updatedAt:'x', recurrence:null, startTz:null, endTz:null, rrule:null, seriesId:null, seriesStartAt:null, occurrenceStartAt:null, isOverridden:false };
// 既有 fixture 的 `color:'red'` 已通不过十六进制校验，编辑保存需要一个合法颜色。
const editable: CalendarEvent = { ...existing, color:'#F06445' };
const weeklyRule: Recurrence = { freq:'weekly', interval:1, byDay:['MO'], end:{ kind:'never' } };
// 系列 dtstart 就是 2026-08-10（周一），所以这条是首个实例。
const recurring: CalendarEvent = { ...editable, startAt:'2026-08-10T10:00', endAt:'2026-08-10T11:00', recurrence:weeklyRule, seriesId:'e1', seriesStartAt:'2026-08-10T10:00', occurrenceStartAt:'2026-08-10T10:00' };
// 同一系列的第二次，未被覆盖：occurrenceStartAt 仍等于 startAt，但它不是首个实例。
const laterOccurrence: CalendarEvent = { ...recurring, startAt:'2026-08-17T10:00', endAt:'2026-08-17T11:00', occurrenceStartAt:'2026-08-17T10:00' };

async function pick(user: ReturnType<typeof userEvent.setup>, select: string, option: string) {
  await user.click(screen.getByRole('combobox', { name:select }));
  await user.click(screen.getByRole('option', { name:option }));
}

function props(overrides: Record<string, unknown> = {}) {
  return {
    mode: { type:'create' as const, dateIso:'2026-07-23' }, tasks:[task], onClose:vi.fn(), onSaved:vi.fn(), onDeleted:vi.fn(),
    createEvent:vi.fn().mockResolvedValue({ ...existing, linkedTaskId:null }), updateEvent:vi.fn().mockResolvedValue(undefined), deleteEvent:vi.fn().mockResolvedValue(undefined), now,
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
    expect(screen.getAllByRole('radio')).toHaveLength(4);
    expect(screen.getByLabelText('备注')).toHaveValue('');
    expect(screen.queryByRole('button', { name:'删除日程' })).not.toBeInTheDocument();
    expect(container.querySelector('input[type="date"],input[type="time"],select')).toBeNull();
  });

  it('renders edit values and restores ordinary times around all-day mode', async () => {
    const user = userEvent.setup();
    render(<EventModal {...props({ mode:{ type:'edit', event:existing } })} />);
    expect(screen.getByRole('dialog', { name:'编辑日程' })).toBeInTheDocument();
    expect(screen.getByLabelText('日程标题')).toHaveValue('设计评审');
    expect(screen.getAllByRole('radio')).toHaveLength(4);
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

  it('edits and deletes a single event on the whole-series scope', async () => {
    const user=userEvent.setup();
    const updateEvent=vi.fn().mockResolvedValue(undefined); const deleteEvent=vi.fn().mockResolvedValue(undefined);
    render(<EventModal {...props({ mode:{type:'edit',event:editable}, updateEvent, deleteEvent })} />);
    await user.type(screen.getByLabelText('日程标题'), '改');
    await user.click(screen.getByRole('button', { name:'保存' }));
    await waitFor(()=>expect(updateEvent).toHaveBeenCalledTimes(1));
    expect(updateEvent.mock.calls[0][0]).toBe(editable);
    expect(updateEvent.mock.calls[0][1]).toMatchObject({ title:'设计评审改', recurrence:null });
    expect(updateEvent.mock.calls[0][2]).toBe('all');

    await user.click(screen.getByRole('button', { name:'删除日程' }));
    await user.click(screen.getByRole('button', { name:'永久删除' }));
    await waitFor(()=>expect(deleteEvent).toHaveBeenCalledWith(editable, 'all'));
  });

  it('sends a weekly recurrence built from the chosen preset', async () => {
    const user=userEvent.setup(); const createEvent=vi.fn().mockResolvedValue(existing);
    render(<EventModal {...props({ createEvent })} />);
    await user.type(screen.getByLabelText('日程标题'), '健身');
    await pick(user, '重复', '每周');
    await user.click(screen.getByRole('button', { name:'保存' }));
    await waitFor(()=>expect(createEvent).toHaveBeenCalledTimes(1));
    // 2026-07-23 是周四，预设的 byDay 跟随开始日期。
    expect(createEvent.mock.calls[0][0].recurrence).toEqual({ freq:'weekly', interval:1, byDay:['TH'], end:{ kind:'never' } });
  });

  it('keeps the custom panel open and clears the rule when repeating is turned off', async () => {
    const user=userEvent.setup(); render(<EventModal {...props()} />);
    await pick(user, '重复', '自定义');
    // 预设是本地状态：种子规则是普通周规则，不得被 recurrenceToPreset 反推成「每周」而收起面板。
    expect(screen.getByRole('combobox', { name:'重复' })).toHaveTextContent('自定义');
    expect(screen.getByLabelText('重复间隔')).toHaveValue(1);
    await pick(user, '重复', '不重复');
    expect(screen.queryByLabelText('重复间隔')).toBeNull();
  });

  it('sends the custom interval, weekdays, and count end condition', async () => {
    const user=userEvent.setup(); const createEvent=vi.fn().mockResolvedValue(existing);
    render(<EventModal {...props({ createEvent })} />);
    await user.type(screen.getByLabelText('日程标题'), '周会');
    await pick(user, '重复', '自定义');
    fireEvent.change(screen.getByLabelText('重复间隔'), { target:{ value:'2' } });
    await user.click(screen.getByRole('checkbox', { name:'一' }));
    await user.click(screen.getByRole('radio', { name:'按次数结束' }));
    fireEvent.change(screen.getByLabelText('重复次数'), { target:{ value:'5' } });
    await user.click(screen.getByRole('button', { name:'保存' }));
    await waitFor(()=>expect(createEvent).toHaveBeenCalledTimes(1));
    expect(createEvent.mock.calls[0][0].recurrence).toEqual({ freq:'weekly', interval:2, byDay:['MO','TH'], end:{ kind:'count', count:5 } });
  });

  it('blocks saving an invalid recurrence and surfaces the error', async () => {
    const user=userEvent.setup(); const createEvent=vi.fn().mockResolvedValue(existing);
    const { container }=render(<EventModal {...props({ createEvent })} />);
    await user.type(screen.getByLabelText('日程标题'), '健身');
    await pick(user, '重复', '自定义');
    fireEvent.change(screen.getByLabelText('重复间隔'), { target:{ value:'0' } });
    await user.click(screen.getByRole('button', { name:'保存' }));
    expect(createEvent).not.toHaveBeenCalled();
    // 不断言文案：校验文案键由 Task 17 补齐，现在 t() 会回退为键名。
    expect(container.querySelector('#event-recurrence-error')).not.toBeNull();
  });

  it('keeps the recurrence rule when only a non-time field changes', async () => {
    const user=userEvent.setup(); const updateEvent=vi.fn().mockResolvedValue(undefined);
    render(<EventModal {...props({ mode:{type:'edit',event:recurring}, updateEvent })} />);
    await user.type(screen.getByLabelText('日程标题'), '改');
    await user.click(screen.getByRole('button', { name:'保存' }));
    await user.click(await screen.findByRole('radio', { name:'全部' }));
    expect(screen.queryByText('该日程已有的单次调整将被清除。')).toBeNull();
    await user.click(screen.getByRole('button', { name:'确定' }));
    await waitFor(()=>expect(updateEvent).toHaveBeenCalledTimes(1));
    expect(updateEvent.mock.calls[0][1]).toMatchObject({ title:'设计评审改' });
    expect(updateEvent.mock.calls[0][1].recurrence).toEqual(weeklyRule);
    expect(updateEvent.mock.calls[0][2]).toBe('all');
  });

  it('asks for a scope before saving an edit to a recurring instance', async () => {
    const user=userEvent.setup(); const updateEvent=vi.fn().mockResolvedValue(undefined);
    render(<EventModal {...props({ mode:{type:'edit',event:recurring}, updateEvent })} />);
    await user.type(screen.getByLabelText('日程标题'), '改');
    await user.click(screen.getByRole('button', { name:'保存' }));
    expect(await screen.findByRole('dialog', { name:'编辑重复日程' })).toBeInTheDocument();
    expect(updateEvent).not.toHaveBeenCalled();
    await user.click(screen.getByRole('radio', { name:'仅此次' }));
    await user.click(screen.getByRole('button', { name:'确定' }));
    await waitFor(()=>expect(updateEvent).toHaveBeenCalledTimes(1));
    expect(updateEvent.mock.calls[0][0]).toBe(recurring);
    expect(updateEvent.mock.calls[0][2]).toBe('occurrence');
  });

  it('warns about cleared adjustments only when the whole series really moves', async () => {
    const user=userEvent.setup();
    const { container }=render(<EventModal {...props({ mode:{type:'edit',event:recurring} })} />);
    await user.click(screen.getByRole('button', { name:'开始日期' }));
    // 同为周一 10:00，只有日期变了：只比 HH:MM 的判定会漏报。
    await user.click(container.querySelector('[data-date="2026-08-03"]') as HTMLElement);
    await user.click(screen.getByRole('button', { name:'保存' }));
    await user.click(await screen.findByRole('radio', { name:'全部' }));
    expect(screen.getByText('该日程已有的单次调整将被清除。')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name:'仅此次' }));
    expect(screen.queryByText('该日程已有的单次调整将被清除。')).toBeNull();
  });

  it('asks for a scope before deleting a recurring instance', async () => {
    const user=userEvent.setup(); const deleteEvent=vi.fn().mockResolvedValue(undefined);
    render(<EventModal {...props({ mode:{type:'edit',event:recurring}, deleteEvent })} />);
    await user.click(screen.getByRole('button', { name:'删除日程' }));
    expect(await screen.findByRole('dialog', { name:'删除重复日程' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name:'永久删除“设计评审”？' })).toBeNull();
    await user.click(screen.getByRole('radio', { name:'仅此次' }));
    await user.click(screen.getByRole('button', { name:'确定' }));
    await waitFor(()=>expect(deleteEvent).toHaveBeenCalledWith(recurring, 'occurrence'));
  });

  it('never asks for a scope on a single event', async () => {
    const user=userEvent.setup();
    const updateEvent=vi.fn().mockResolvedValue(undefined); const deleteEvent=vi.fn().mockResolvedValue(undefined);
    render(<EventModal {...props({ mode:{type:'edit',event:editable}, updateEvent, deleteEvent })} />);
    await user.type(screen.getByLabelText('日程标题'), '改');
    await user.click(screen.getByRole('button', { name:'保存' }));
    expect(screen.queryByRole('dialog', { name:'编辑重复日程' })).toBeNull();
    await waitFor(()=>expect(updateEvent).toHaveBeenCalledTimes(1));
    expect(updateEvent.mock.calls[0][2]).toBe('all');

    await user.click(screen.getByRole('button', { name:'删除日程' }));
    expect(screen.queryByRole('dialog', { name:'删除重复日程' })).toBeNull();
    expect(screen.getByRole('dialog', { name:'永久删除“设计评审”？' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name:'永久删除' }));
    await waitFor(()=>expect(deleteEvent).toHaveBeenCalledWith(editable, 'all'));
  });

  it('hides the this-and-following scope on the first occurrence of the series', async () => {
    const user=userEvent.setup();
    render(<EventModal {...props({ mode:{type:'edit',event:recurring} })} />);
    await user.click(screen.getByRole('button', { name:'删除日程' }));
    expect(await screen.findByRole('dialog', { name:'删除重复日程' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name:'此后所有' })).toBeNull();
  });

  it('shows the this-and-following scope on a later, untouched occurrence', async () => {
    const user=userEvent.setup();
    render(<EventModal {...props({ mode:{type:'edit',event:laterOccurrence} })} />);
    await user.click(screen.getByRole('button', { name:'删除日程' }));
    expect(await screen.findByRole('radio', { name:'此后所有' })).toBeInTheDocument();
  });

  // 被覆盖不改变「是第几次」：身份键仍是 dtstart，「此后所有」依旧等价于「全部」。
  it('keeps the first occurrence narrowed after it has been overridden', async () => {
    const user=userEvent.setup();
    const moved: CalendarEvent={ ...recurring, startAt:'2026-08-11T10:00', endAt:'2026-08-11T11:00', isOverridden:true };
    render(<EventModal {...props({ mode:{type:'edit',event:moved} })} />);
    await user.click(screen.getByRole('button', { name:'删除日程' }));
    expect(await screen.findByRole('dialog', { name:'删除重复日程' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name:'此后所有' })).toBeNull();
  });

  it('adds a reminder and submits it as minutes before start', async () => {
    const user=userEvent.setup(); const createEvent=vi.fn().mockResolvedValue({ ...existing, linkedTaskId:null });
    render(<EventModal {...props({ createEvent })} />);
    // 默认没有提醒。
    expect(screen.getByText('无提醒')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name:'添加提醒' }));
    // 新提醒默认 10 分钟前。
    expect(screen.getByLabelText('提前数量')).toHaveValue(10);
    await user.type(screen.getByLabelText('日程标题'), '会议');
    await user.click(screen.getByRole('button', { name:'保存' }));
    await waitFor(()=>expect(createEvent).toHaveBeenCalledTimes(1));
    expect(createEvent.mock.calls[0][0].reminders).toEqual([10]);
  });

  it('converts the unit into stored minutes and loads them back', async () => {
    const user=userEvent.setup(); const createEvent=vi.fn().mockResolvedValue({ ...existing, linkedTaskId:null });
    render(<EventModal {...props({ createEvent })} />);
    await user.click(screen.getByRole('button', { name:'添加提醒' }));
    await user.click(screen.getByRole('combobox', { name:'提前单位' }));
    await user.click(screen.getByRole('option', { name:'小时' }));
    await user.type(screen.getByLabelText('日程标题'), '会议');
    await user.click(screen.getByRole('button', { name:'保存' }));
    await waitFor(()=>expect(createEvent).toHaveBeenCalledTimes(1));
    // 10 小时 = 600 分钟。
    expect(createEvent.mock.calls[0][0].reminders).toEqual([600]);
  });

  it('shows an existing reminder in its coarsest unit and removes it', async () => {
    const user=userEvent.setup();
    const withReminder: CalendarEvent={ ...editable, reminders:[1440] };
    render(<EventModal {...props({ mode:{type:'edit',event:withReminder} })} />);
    // 1440 分钟应显示为 1 天。
    expect(screen.getByLabelText('提前数量')).toHaveValue(1);
    expect(screen.getByRole('combobox', { name:'提前单位' })).toHaveTextContent('天');
    await user.click(screen.getByRole('button', { name:'删除提醒' }));
    expect(screen.getByText('无提醒')).toBeInTheDocument();
  });
});
