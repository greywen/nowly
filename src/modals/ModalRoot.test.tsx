import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { RepositoryProvider } from '../data/RepositoryContext';
import type { NowlyRepository } from '../data/nowly-repository';
import { sampleEvents, sampleNotes, sampleTasks } from '../lib/sample-data';
import { TaskWorkspaceProvider } from '../tasks/TaskWorkspaceContext';
import type { TaskWorkspaceSnapshot } from '../tasks/task-model';
import { ModalRoot } from './ModalRoot';

// Task dialogs read the unified workspace. Without a repository provider the
// context default is the real Tauri repository, whose `invoke` fails in jsdom and
// leaves the workspace in its error state — so these tests would assert against a
// broken load. A stub keeps the workspace ready and the lane field populated.
const workspace: TaskWorkspaceSnapshot = {
  tasks: [],
  lanes: [{ id: 'lane-a', name: '待处理', color: '#4FC9DA', position: 0, createdAt: 'x', updatedAt: 'x' }],
  tags: [],
  collaborators: [],
  linkingEnabled: true,
  defaultLaneId: 'lane-a',
  completionLaneId: 'lane-a',
  viewPreferences: {}
};

const repository = {
  getTaskWorkspaceSnapshot: vi.fn().mockResolvedValue(workspace)
} as unknown as NowlyRepository;

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <RepositoryProvider repository={repository}>
      <TaskWorkspaceProvider>{children}</TaskWorkspaceProvider>
    </RepositoryProvider>
  );
}

const operations = {
  createEvent: vi.fn().mockResolvedValue(sampleEvents[0]),
  updateEvent: vi.fn().mockResolvedValue(sampleEvents[0]),
  deleteEvent: vi.fn().mockResolvedValue(undefined),
  onSaved: vi.fn(), onDeleted: vi.fn(),
  notes: sampleNotes,
  createNote: vi.fn().mockResolvedValue(sampleNotes[0]),
  updateNote: vi.fn().mockResolvedValue(sampleNotes[0]),
  deleteNote: vi.fn().mockResolvedValue(undefined),
  monitors: [],
  settings: {wallpaperEnabled:false,launchAtLogin:false,targetMonitorId:null,density:'balanced' as const,weekStart:'monday' as const,dateFormat:'localized' as const,showWeekends:true,iconStyle:'duotone' as const,hideTopbarInWallpaper:true,calendarEnabled:true,matrixEnabled:true,notesEnabled:true},
  saveSettings: vi.fn(),
  subscriptions: [],
  onSubscriptionsChanged: vi.fn(),
  createSubscription: vi.fn(),
  updateSubscription: vi.fn(),
  deleteSubscription: vi.fn(),
  refreshSubscription: vi.fn()
};

function base(overrides: Record<string, unknown> = {}) {
  return { modal:null, events:sampleEvents, onClose:vi.fn(), onChangeModal:vi.fn(), ...operations, ...overrides };
}

describe('ModalRoot', () => {
  it('renders date detail and routes create and edit to layered event dialogs', async () => {
    const user=userEvent.setup(); const onChangeModal=vi.fn();
    const { rerender }=render(<ModalRoot {...base({ modal:{type:'date',isoDate:'2026-07-23',trigger:null},onChangeModal })}/>, { wrapper: Wrapper });
    expect(screen.getByRole('dialog',{name:/2026年7月23日/})).toBeInTheDocument();
    await user.click(screen.getByRole('button',{name:'新建日程'}));
    expect(onChangeModal).toHaveBeenCalledWith(expect.objectContaining({type:'event-create',dateIso:'2026-07-23',parentDate:'2026-07-23'}));

    rerender(<ModalRoot {...base({modal:{type:'event-edit',event:sampleEvents[0],trigger:null,parentDate:'2026-07-23'},onChangeModal})}/>);
    expect(screen.getByRole('dialog',{name:/2026年7月23日/})).toBeInTheDocument();
    expect(screen.getByRole('dialog',{name:'编辑日程'})).toBeInTheDocument();
  });

  it('returns event cancellation to its parent date or closes a standalone event', async () => {
    const user=userEvent.setup(); const onChangeModal=vi.fn(); const onClose=vi.fn();
    const { rerender }=render(<ModalRoot {...base({modal:{type:'event-create',dateIso:'2026-07-23',trigger:null,parentDate:'2026-07-23'},onChangeModal,onClose})}/>, { wrapper: Wrapper });
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
      <ModalRoot {...base({ modal:{type:'date',isoDate:'2026-07-23',trigger:null}, onChangeModal })} />,
      { wrapper: Wrapper }
    );

    // Let the workspace finish loading before a task dialog mounts, which is the
    // order a user sees. The form seeds its lane from the workspace default and
    // keeps that value for its lifetime, so a dialog mounted mid-load holds a lane
    // that is absent once the real ones arrive.
    await act(async () => {});

    rerender(<ModalRoot {...base({ modal:{type:'task-create',dueDate:'2026-07-23',trigger:null,parentDate:'2026-07-23'}, onChangeModal })} />);
    expect(screen.getByRole('dialog', { name:/2026年7月23日/ })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name:'新建任务' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name:'截止日期' })).toHaveTextContent('2026 年 7 月 23 日');
    expect(screen.getByRole('combobox', { name:'看板泳道' })).toHaveTextContent('待处理');
    await user.click(screen.getByRole('button', { name:'取消' }));
    expect(onChangeModal).toHaveBeenLastCalledWith(expect.objectContaining({ type:'date', isoDate:'2026-07-23' }));
  });

  it('routes standalone task editing and closes it without a parent', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { rerender } = render(
      <ModalRoot {...base({ modal:null, onClose })} />,
      { wrapper: Wrapper }
    );
    await act(async () => {});

    rerender(<ModalRoot {...base({ modal:{type:'task-edit',task:sampleTasks[0],trigger:null}, onClose })} />);
    expect(screen.getByRole('dialog', { name:'编辑任务' })).toBeInTheDocument();
    // A matrix task carries no lane, so it maps onto the workspace default.
    expect(screen.getByRole('combobox', { name:'看板泳道' })).toHaveTextContent('待处理');
    await user.click(screen.getByRole('button', { name:'取消' }));
    expect(onClose).toHaveBeenCalledOnce();

    rerender(<ModalRoot {...base({modal:{type:'note-edit',note:sampleNotes[0],trigger:null}})}/>);
    expect(screen.getByRole('dialog', {name:'编辑便签'})).toBeInTheDocument();
  });
});
