import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { sampleEvents, sampleNotes, sampleTasks } from '../lib/sample-data';
import { ModalRoot } from './ModalRoot';

const operations = {
  createEvent: vi.fn().mockResolvedValue(sampleEvents[0]),
  updateEvent: vi.fn().mockResolvedValue(sampleEvents[0]),
  deleteEvent: vi.fn().mockResolvedValue(undefined),
  onSaved: vi.fn(), onDeleted: vi.fn()
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

  it('keeps existing task and note routing functional', () => {
    const { rerender }=render(<ModalRoot {...base({modal:{type:'task',task:sampleTasks[0]}})}/>);
    expect(screen.getByRole('dialog', { name:'编辑任务' })).toBeInTheDocument();
    rerender(<ModalRoot {...base({modal:{type:'note',note:sampleNotes[0]}})}/>);
    expect(screen.getByText('便签编辑')).toBeInTheDocument();
  });
});
