import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { sampleEvents, sampleNotes, sampleTasks } from '../lib/sample-data';
import { ModalRoot } from './ModalRoot';

const operations = {
  createEvent: vi.fn().mockResolvedValue(sampleEvents[0]),
  updateEvent: vi.fn().mockResolvedValue(sampleEvents[0]),
  deleteEvent: vi.fn().mockResolvedValue(undefined),
  onSaved: vi.fn(), onDeleted: vi.fn(),
  createTask: vi.fn().mockResolvedValue(sampleTasks[0]),
  updateTask: vi.fn().mockResolvedValue(sampleTasks[0]),
  deleteTask: vi.fn().mockResolvedValue(undefined),
  onTaskSaved: vi.fn(), onTaskDeleted: vi.fn()
};

function base(overrides: Record<string, unknown> = {}) {
  return { modal:null, events:sampleEvents, tasks:sampleTasks, onClose:vi.fn(), onChangeModal:vi.fn(), ...operations, ...overrides };
}

describe('ModalRoot', () => {
  it('renders date detail and routes create and edit to layered event dialogs', async () => {
    const user=userEvent.setup(); const onChangeModal=vi.fn();
    const { rerender }=render(<ModalRoot {...base({ modal:{type:'date',isoDate:'2026-07-23',trigger:null},onChangeModal })}/>);
    expect(screen.getByRole('dialog',{name:/2026年7月23日/})).toBeInTheDocument();
    await user.click(screen.getByRole('button',{name:'新建日程'}));
    expect(onChangeModal).toHaveBeenCalledWith(expect.objectContaining({type:'event-create',dateIso:'2026-07-23',parentDate:'2026-07-23'}));

    rerender(<ModalRoot {...base({modal:{type:'event-edit',event:sampleEvents[0],trigger:null,parentDate:'2026-07-23'},onChangeModal})}/>);
    expect(screen.getByRole('dialog',{name:/2026年7月23日/})).toBeInTheDocument();
    expect(screen.getByRole('dialog',{name:'编辑日程'})).toBeInTheDocument();
  });

  it('returns event cancellation to its parent date or closes a standalone event', async () => {
    const user=userEvent.setup(); const onChangeModal=vi.fn(); const onClose=vi.fn();
    const { rerender }=render(<ModalRoot {...base({modal:{type:'event-create',dateIso:'2026-07-23',trigger:null,parentDate:'2026-07-23'},onChangeModal,onClose})}/>);
    await user.click(screen.getByRole('button',{name:'取消'}));
    expect(onChangeModal).toHaveBeenCalledWith(expect.objectContaining({type:'date',isoDate:'2026-07-23'}));
    rerender(<ModalRoot {...base({modal:{type:'event-create',dateIso:'2026-07-23',trigger:null},onChangeModal,onClose})}/>);
    await user.click(screen.getByRole('button',{name:'取消'}));
    expect(onClose).toHaveBeenCalled();
  });

  it('layers date-prefilled task creation and returns cancellation to its parent date', async () => {
    const user = userEvent.setup();
    const onChangeModal = vi.fn();
    const { rerender } = render(
      <ModalRoot {...base({ modal:{type:'date',isoDate:'2026-07-23',trigger:null}, onChangeModal })} />
    );
    const taskButton = screen.getByRole('button', { name:'新建任务' });
    await user.click(taskButton);
    expect(onChangeModal).toHaveBeenCalledWith({
      type:'task-create', dueDate:'2026-07-23', trigger:taskButton, parentDate:'2026-07-23'
    });

    rerender(<ModalRoot {...base({ modal:{type:'task-create',dueDate:'2026-07-23',trigger:taskButton,parentDate:'2026-07-23'}, onChangeModal })} />);
    expect(screen.getByRole('dialog', { name:/2026年7月23日/ })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name:'新建任务' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name:'截止日期' })).toHaveTextContent('2026 年 7 月 23 日');
    await user.click(screen.getByRole('button', { name:'取消' }));
    expect(onChangeModal).toHaveBeenLastCalledWith(expect.objectContaining({ type:'date', isoDate:'2026-07-23' }));
  });

  it('routes standalone task editing and closes it without a parent', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { rerender } = render(
      <ModalRoot {...base({ modal:{type:'task-edit',task:sampleTasks[0],trigger:null}, onClose })} />
    );
    expect(screen.getByRole('dialog', { name:'编辑任务' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name:'取消' }));
    expect(onClose).toHaveBeenCalledOnce();

    rerender(<ModalRoot {...base({modal:{type:'note',note:sampleNotes[0]}})}/>);
    expect(screen.getByText('便签编辑')).toBeInTheDocument();
  });
});
