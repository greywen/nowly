import { defaultTimeSettings } from '../time/time-model';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { RepositoryProvider } from '../data/RepositoryContext';
import type { NowlyRepository } from '../data/nowly-repository';
import { TaskWorkspaceProvider } from '../tasks/TaskWorkspaceContext';
import type { Task, TaskLane, TaskWorkspaceSnapshot } from '../tasks/task-model';
import { KanbanWidget } from './KanbanWidget';
import { useWorkspaceTasks } from '../tasks/useWorkspaceTasks';

function MatrixErrorProbe() {
  const matrix = useWorkspaceTasks();
  return <output data-testid="matrix-error">{matrix.dragError}</output>;
}

function lane(id: string, name: string, position: number): TaskLane {
  return { id, name, color: '#4FC9DA', position, createdAt: 'x', updatedAt: 'x' };
}

function task(id: string, laneId: string, boardPosition: number, overrides: Partial<Task> = {}): Task {
  return {
    id, title: id, description: '', priority: null, dueDate: null, completed: false,
    laneId, boardPosition, tagIds: [], collaboratorIds: [], views: ['kanban'],
    createdAt: 'x', updatedAt: 'x', ...overrides
  };
}

const snapshot: TaskWorkspaceSnapshot = {
  lanes: [lane('lane-a', '待处理', 0), lane('lane-b', '进行中', 1), lane('lane-c', '已完成', 2)],
  tasks: [
    task('c1', 'lane-a', 0, { title: '写文档' }),
    task('c2', 'lane-a', 1, { title: '修 bug' }),
    task('c3', 'lane-b', 0, { title: '评审' })
  ],
  tags: [],
  collaborators: [],
  linkingEnabled: true,
  defaultLaneId: 'lane-a',
  completionLaneId: 'lane-c',
  viewPreferences: {}
};

const emptySnapshot: TaskWorkspaceSnapshot = { ...snapshot, lanes: [], tasks: [] };

function repository(overrides: Partial<NowlyRepository> = {}): NowlyRepository {
  return {
    getTimeSettings: vi.fn().mockResolvedValue(defaultTimeSettings()),
    saveTimeSettings: vi.fn().mockImplementation(settings => Promise.resolve(settings)),
    listAlarms: vi.fn().mockResolvedValue([]),
    createAlarm: vi.fn().mockRejectedValue(new Error('unexpected alarm write')),
    updateAlarm: vi.fn().mockRejectedValue(new Error('unexpected alarm write')),
    deleteAlarm: vi.fn().mockRejectedValue(new Error('unexpected alarm write')),
    listEventsInRange: vi.fn().mockResolvedValue([]), createEvent: vi.fn(), updateEvent: vi.fn(), deleteEvent: vi.fn(),
    listTasks: vi.fn().mockResolvedValue([]), createTask: vi.fn(), updateTask: vi.fn(), deleteTask: vi.fn(), setTaskCompleted: vi.fn(),
    listNotes: vi.fn().mockResolvedValue([]), createNote: vi.fn(), updateNote: vi.fn(), deleteNote: vi.fn(),
    getSettings: vi.fn(), updateSettings: vi.fn(), listMonitors: vi.fn(),
    listModuleLayout: vi.fn().mockResolvedValue([]), saveModuleLayout: vi.fn(),
    createFocusSession:vi.fn().mockImplementation((session)=>Promise.resolve(session)), listFocusSessions:vi.fn().mockResolvedValue([]), getFocusStatistics:vi.fn().mockResolvedValue({totalFocusedSeconds:0,completedCount:0,interruptedCount:0,completionRate:0,points:[]}),
    getKanbanSnapshot: vi.fn().mockResolvedValue({ lanes: [], cards: [], priorities: [], tags: [], collaborators: [] }),
    createKanbanLane: vi.fn(), updateKanbanLane: vi.fn(), deleteKanbanLane: vi.fn().mockResolvedValue(undefined),
    reorderKanbanLanes: vi.fn().mockResolvedValue([]),
    createKanbanCard: vi.fn(), updateKanbanCard: vi.fn(), deleteKanbanCard: vi.fn().mockResolvedValue(undefined),
    moveKanbanCard: vi.fn().mockResolvedValue(undefined),
    createKanbanPriority: vi.fn(), updateKanbanPriority: vi.fn(), deleteKanbanPriority: vi.fn(), reorderKanbanPriorities: vi.fn(),
    createKanbanTag: vi.fn(), updateKanbanTag: vi.fn(), deleteKanbanTag: vi.fn(),
    createKanbanCollaborator: vi.fn(), updateKanbanCollaborator: vi.fn(), deleteKanbanCollaborator: vi.fn(), listCategories: vi.fn().mockResolvedValue([]), createCategory: vi.fn(), updateCategory: vi.fn(), deleteCategory: vi.fn(), listCalendarSubscriptions: vi.fn().mockResolvedValue([]), createCalendarSubscription: vi.fn(), updateCalendarSubscription: vi.fn(), deleteCalendarSubscription: vi.fn(), refreshCalendarSubscription: vi.fn(), startOAuthLogin: vi.fn(), listOAuthAccounts: vi.fn().mockResolvedValue([]), disconnectOAuthAccount: vi.fn(), listRemoteCalendars: vi.fn().mockResolvedValue([]), subscribeRemoteCalendar: vi.fn(), updateSubscriptionDisplay: vi.fn(), listExternalEventsInRange: vi.fn().mockResolvedValue([]),
    // The board reads the unified task workspace. Mocking this rather than the
    // legacy pair keeps the fixture on the same path production takes, and gives
    // exact control over lanes — `workspaceFromLegacy` substitutes three default
    // lanes when a legacy snapshot has none, which would mask the empty state.
    getTaskWorkspaceSnapshot: vi.fn().mockResolvedValue(snapshot),
    deleteTaskLane: vi.fn().mockResolvedValue(emptySnapshot),
    ...overrides
  };
}

function renderWidget(repo: NowlyRepository) {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <RepositoryProvider repository={repo}>
        <TaskWorkspaceProvider>{children}</TaskWorkspaceProvider>
      </RepositoryProvider>
    );
  }
  return render(<><KanbanWidget todayIso="2026-08-12" /><MatrixErrorProbe /></>, { wrapper: Wrapper });
}

describe('KanbanWidget', () => {
  it('keeps lane deletion errors in the dialog without duplicating module banners', async () => {
    const user = userEvent.setup();
    const { container } = renderWidget(repository({
      deleteTaskLane: vi.fn().mockRejectedValue({
        code: 'validation_error', field: 'id', message: '至少保留一个泳道。'
      })
    }));
    await screen.findByRole('region', { name: '泳道：待处理' });
    await user.click(screen.getByRole('button', { name: '待处理' }));
    await user.click(screen.getByRole('button', { name: '删除泳道' }));
    await user.click(screen.getByRole('button', { name: '永久删除' }));
    expect(await screen.findByText('至少保留一个泳道。')).toBeInTheDocument();
    expect(container.querySelector('.module-message')).toBeNull();
    expect(screen.getByTestId('matrix-error')).toBeEmptyDOMElement();
    const confirmation = screen.getByRole('button', { name: '永久删除' }).closest('[role="dialog"]') as HTMLElement;
    await user.click(within(confirmation).getByRole('button', { name: '取消' }));
    expect(container.querySelector('.module-message')).toBeNull();
    expect(screen.getByTestId('matrix-error')).toBeEmptyDOMElement();
  });
  it('dismisses move errors with an icon-only close button', async () => {
    const user = userEvent.setup();
    renderWidget(repository({
      moveTaskToLane: vi.fn().mockRejectedValue(new Error('请选择替代泳道。'))
    }));
    const card = await screen.findByLabelText('任务：写文档');
    const target = screen.getByRole('region', { name: '泳道：进行中' });
    const dataTransfer = { effectAllowed: '', dropEffect: '', setData: vi.fn(), getData: vi.fn() };
    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.dragOver(target, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });
    const alert = await screen.findByRole('alert');
    const close = within(alert).getByRole('button', { name: '关闭拖放错误' });
    expect(close.textContent).toBe('');
    expect(close.querySelector('svg')).not.toBeNull();
    expect(close).toHaveClass('module-message__close');
    await user.click(close);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('shows the header with add-lane and a settings button that opens task settings', async () => {
    const user = userEvent.setup();
    renderWidget(repository());
    expect(await screen.findByRole('button', { name: '添加泳道' })).toBeInTheDocument();
    // The settings gear opens the field dialog directly; there is no intermediate menu.
    await user.click(screen.getByRole('button', { name: '看板设置' }));
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: '任务设置' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '标签(0)' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('tab', { name: /视图联动/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /优先级/ })).not.toBeInTheDocument();
  });

  it('renders each lane with an accessible add-card button and a single scroll viewport', async () => {
    renderWidget(repository());
    expect(await screen.findByRole('region', { name: '泳道：待处理' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '在待处理新增任务' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '在进行中新增任务' })).toBeInTheDocument();
    expect(screen.getAllByTestId('kanban-scroll')).toHaveLength(1);
  });

  it('preselects the current lane when adding a task from a lane', async () => {
    const user = userEvent.setup();
    renderWidget(repository());
    await screen.findByRole('region', { name: '泳道：进行中' });
    await user.click(screen.getByRole('button', { name: '在进行中新增任务' }));
    // The unified dialog carries one title for every origin and states the lane in
    // a field, where it stays editable, rather than baking it into the heading.
    expect(screen.getByRole('dialog', { name: '新建任务' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '看板泳道' })).toHaveTextContent('进行中');
    await user.click(screen.getByRole('combobox', { name: '所属象限' }));
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      '无优先级',
      '重要且紧急',
      '重要不紧急',
      '不重要但紧急',
      '不重要不紧急'
    ]);
  });

  it('does not offer a priority filter on the board', async () => {
    renderWidget(repository());
    await screen.findByRole('region', { name: '泳道：待处理' });
    expect(screen.queryByRole('combobox', { name: '按优先级筛选' })).not.toBeInTheDocument();
  });

  it('opens the lane editor by clicking the lane name', async () => {
    const user = userEvent.setup();
    renderWidget(repository());
    await screen.findByRole('region', { name: '泳道：待处理' });
    await user.click(screen.getByRole('button', { name: '待处理' }));
    expect(screen.getByRole('button', { name: '删除泳道' })).toBeInTheDocument();
  });

  it('does not render a lane action menu', async () => {
    renderWidget(repository());
    await screen.findByRole('region', { name: '泳道：待处理' });
    expect(screen.queryByRole('button', { name: '泳道操作：待处理' })).not.toBeInTheDocument();
  });

  it('does not render the removed task-card action menu', async () => {
    renderWidget(repository());
    await screen.findByRole('region', { name: '泳道：待处理' });
    expect(screen.queryByRole('button', { name: '任务操作：写文档' })).not.toBeInTheDocument();
  });

  it('confirms lane deletion showing the card count and cascades', async () => {
    const user = userEvent.setup();
    const repo = repository();
    renderWidget(repo);
    await screen.findByRole('region', { name: '泳道：待处理' });
    await user.click(screen.getByRole('button', { name: '待处理' }));
    await user.click(screen.getByRole('button', { name: '删除泳道' }));
    expect(screen.getByText(/该泳道包含 2 张任务/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '永久删除' }));
    // Cards move to the first surviving lane rather than being orphaned.
    expect(repo.deleteTaskLane).toHaveBeenCalledWith('lane-a', 'lane-b');
  });

  it('shows an empty state when there are no lanes', async () => {
    renderWidget(repository({
      getTaskWorkspaceSnapshot: vi.fn().mockResolvedValue(emptySnapshot)
    }));
    expect(await screen.findByText(/还没有泳道/)).toBeInTheDocument();
  });

  it('does not render optional field regions for a bare card', async () => {
    renderWidget(repository());
    const laneRegion = await screen.findByRole('region', { name: '泳道：待处理' });
    const bare = within(laneRegion).getByLabelText('任务：写文档');
    // No priority / tag badges and no due/collaborator meta on a bare card.
    expect(bare.querySelector('.kanban-card__badges')).toBeNull();
    expect(bare.querySelector('.kanban-card__meta')).toBeNull();
  });
});
