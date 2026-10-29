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
import { TaskDragProvider, useTaskDrag } from '../tasks/TaskDragContext';

function MatrixErrorProbe() {
  const matrix = useWorkspaceTasks();
  return <output data-testid="matrix-error">{matrix.dragError}</output>;
}

function lane(id: string, name: string, position: number): TaskLane {
  return { id, name, color: '#4FC9DA', position, createdAt: 'x', updatedAt: 'x' };
}

function task(id: string, laneId: string, boardPosition: number, overrides: Partial<Task> = {}): Task {
  return {
    id, title: id, description: '', priority: 'not_important_not_urgent', dueDate: null, completed: false,
    completedAt: null, laneId, boardPosition, tagIds: [], steps: [],
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
  defaultLaneId: 'lane-a',
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
    getKanbanSnapshot: vi.fn().mockResolvedValue({ lanes: [], cards: [], priorities: [], tags: [] }),
    createKanbanLane: vi.fn(), updateKanbanLane: vi.fn(), deleteKanbanLane: vi.fn().mockResolvedValue(undefined),
    reorderKanbanLanes: vi.fn().mockResolvedValue([]),
    createKanbanCard: vi.fn(), updateKanbanCard: vi.fn(), deleteKanbanCard: vi.fn().mockResolvedValue(undefined),
    moveKanbanCard: vi.fn().mockResolvedValue(undefined),
    createKanbanPriority: vi.fn(), updateKanbanPriority: vi.fn(), deleteKanbanPriority: vi.fn(), reorderKanbanPriorities: vi.fn(),
    createKanbanTag: vi.fn(), updateKanbanTag: vi.fn(), deleteKanbanTag: vi.fn(),
    listCategories: vi.fn().mockResolvedValue([]), createCategory: vi.fn(), updateCategory: vi.fn(), deleteCategory: vi.fn(), listCalendarSubscriptions: vi.fn().mockResolvedValue([]), createCalendarSubscription: vi.fn(), updateCalendarSubscription: vi.fn(), deleteCalendarSubscription: vi.fn(), refreshCalendarSubscription: vi.fn(), startOAuthLogin: vi.fn(), listOAuthAccounts: vi.fn().mockResolvedValue([]), disconnectOAuthAccount: vi.fn(), listRemoteCalendars: vi.fn().mockResolvedValue([]), subscribeRemoteCalendar: vi.fn(), updateSubscriptionDisplay: vi.fn(), listExternalEventsInRange: vi.fn().mockResolvedValue([]),
    // The board reads the unified task workspace. Mocking this rather than the
    // legacy pair keeps the fixture on the same path production takes and gives
    // exact control over lanes and completion.
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
        code: 'not_found', field: 'id', message: '泳道不存在。'
      })
    }));
    await screen.findByRole('region', { name: '泳道：待处理' });
    await user.click(screen.getByRole('button', { name: '待处理泳道操作' }));
    await user.click(screen.getByRole('menuitem', { name: '删除泳道' }));
    await user.click(screen.getByRole('button', { name: '永久删除' }));
    expect(await screen.findByText('泳道不存在。')).toBeInTheDocument();
    expect(container.querySelector('.module-message')).toBeNull();
    expect(screen.getByTestId('matrix-error')).toBeEmptyDOMElement();
    const confirmation = screen.getByRole('button', { name: '永久删除' }).closest('[role="dialog"]') as HTMLElement;
    await user.click(within(confirmation).getByRole('button', { name: '取消' }));
    expect(container.querySelector('.module-message')).toBeNull();
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
    await user.click(close);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('uses the toolbar + for a new task in the default lane and the gear for tags', async () => {
    const user = userEvent.setup();
    renderWidget(repository());
    await screen.findByRole('region', { name: '泳道：待处理' });
    expect(screen.queryByRole('button', { name: '添加泳道' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '新建任务' }));
    expect(screen.getByRole('dialog', { name: '新建任务' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '看板泳道' })).toHaveTextContent('待处理');
    expect(screen.getByRole('radio', { name: '不重要不紧急' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: '取消' }));

    await user.click(screen.getByRole('button', { name: '管理标签' }));
    expect(screen.getByRole('dialog', { name: '管理标签' })).toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  });

  it('renders an inline add row in each lane and a single scroll viewport', async () => {
    renderWidget(repository());
    expect(await screen.findByRole('region', { name: '泳道：待处理' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '在待处理添加任务' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '在进行中添加任务' })).toBeInTheDocument();
    expect(screen.getAllByTestId('kanban-scroll')).toHaveLength(1);
  });

  it('adds tasks inline to that lane under the default quadrant and keeps the input open', async () => {
    const user = userEvent.setup();
    const createWorkspaceTask = vi.fn().mockImplementation((draft) =>
      Promise.resolve(task(`new-${draft.title}`, draft.laneId, 9, draft))
    );
    renderWidget(repository({ createWorkspaceTask }));
    await screen.findByRole('region', { name: '泳道：进行中' });
    await user.click(screen.getByRole('button', { name: '在进行中添加任务' }));
    const input = screen.getByRole('textbox', { name: '在进行中添加任务' });
    await user.type(input, '买咖啡豆{Enter}');
    expect(createWorkspaceTask).toHaveBeenCalledWith(expect.objectContaining({
      title: '买咖啡豆', laneId: 'lane-b', priority: 'not_important_not_urgent', completed: false
    }));
    expect(input).toHaveValue('');
    expect(input).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('textbox', { name: '在进行中添加任务' })).not.toBeInTheDocument();
  });

  it('keeps tasks added inline to any lane open, since lanes do not imply completion', async () => {
    const user = userEvent.setup();
    const createWorkspaceTask = vi.fn().mockImplementation((draft) =>
      Promise.resolve(task('new', draft.laneId, 0, draft))
    );
    renderWidget(repository({ createWorkspaceTask }));
    await screen.findByRole('region', { name: '泳道：已完成' });
    await user.click(screen.getByRole('button', { name: '在已完成添加任务' }));
    await user.type(screen.getByRole('textbox', { name: '在已完成添加任务' }), '归档{Enter}');
    expect(createWorkspaceTask).toHaveBeenCalledWith(expect.objectContaining({ laneId: 'lane-c', completed: false }));
  });

  it('takes completed tasks out of their lanes and lists them behind the done button', async () => {
    const user = userEvent.setup();
    const recent = new Date().toISOString();
    renderWidget(repository({
      getTaskWorkspaceSnapshot: vi.fn().mockResolvedValue({
        ...snapshot,
        tasks: [
          task('done', 'lane-a', 0, { title: '已勾选', completed: true, completedAt: recent }),
          task('old', 'lane-b', 1, { title: '很久以前', completed: true, completedAt: '2020-01-01T08:00:00.000Z' }),
          task('loose', 'lane-a', 2, { title: '无泳道', completed: true, completedAt: recent, laneId: null }),
          task('open', 'lane-c', 0, { title: '未勾选' })
        ]
      })
    }));
    expect(await screen.findByRole('article', { name: /未勾选/ })).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: /已勾选/ })).not.toBeInTheDocument();

    const button = screen.getByRole('button', { name: '已完成：最近 7 天 1 件' });
    await user.click(button);
    const popup = screen.getByRole('dialog', { name: '已完成' });
    expect(within(popup).getByText('已勾选')).toBeInTheDocument();
    expect(within(popup).getByText('待处理 · 今天')).toBeInTheDocument();
    expect(within(popup).queryByText('很久以前')).not.toBeInTheDocument();
    expect(within(popup).queryByText('无泳道')).not.toBeInTheDocument();

    await user.click(within(popup).getByRole('button', { name: '查看全部（2）' }));
    expect(within(popup).getByText('很久以前')).toBeInTheDocument();
    expect(within(popup).getByRole('region', { name: '更早' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: '已完成' })).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it('reopens a task from the done list back into its lane', async () => {
    const user = userEvent.setup();
    const setWorkspaceTaskCompleted = vi.fn().mockImplementation((id: string) =>
      Promise.resolve(task(id, 'lane-b', 0, { title: '已勾选', completed: false }))
    );
    renderWidget(repository({
      setWorkspaceTaskCompleted,
      getTaskWorkspaceSnapshot: vi.fn().mockResolvedValue({
        ...snapshot,
        tasks: [...snapshot.tasks, task('done', 'lane-b', 1, { title: '已勾选', completed: true, completedAt: new Date().toISOString() })]
      })
    }));
    await user.click(await screen.findByRole('button', { name: '已完成：最近 7 天 1 件' }));
    await user.click(screen.getByRole('checkbox', { name: '标记任务为未完成：已勾选' }));
    expect(setWorkspaceTaskCompleted).toHaveBeenCalledWith('done', false);
    const laneB = screen.getByRole('region', { name: '泳道：进行中' });
    expect(await within(laneB).findByRole('article', { name: /已勾选/ })).toBeInTheDocument();
    const cards = within(laneB).getAllByRole('article');
    expect(cards[0]).toHaveAccessibleName(/已勾选/);
    expect(screen.getByRole('button', { name: '已完成：最近 7 天 0 件' })).toBeInTheDocument();
  });

  it('shows the done drop zone only while a card is dragged and completes the dropped card', async () => {
    const setWorkspaceTaskCompleted = vi.fn().mockImplementation((id: string) =>
      Promise.resolve(task(id, 'lane-a', 0, { title: '写文档', completed: true, completedAt: new Date().toISOString() }))
    );
    renderWidget(repository({ setWorkspaceTaskCompleted }));
    const card = await screen.findByLabelText('任务：写文档');
    expect(screen.queryByTestId('kanban-done-drop')).not.toBeInTheDocument();

    const dataTransfer = { effectAllowed: '', dropEffect: '', setData: vi.fn(), getData: vi.fn() };
    fireEvent.dragStart(card, { dataTransfer });
    const zone = await screen.findByTestId('kanban-done-drop');
    expect(zone).toHaveTextContent('拖到这里标记完成');
    fireEvent.dragOver(zone, { dataTransfer });
    expect(zone).toHaveClass('kanban-done-drop--over');
    fireEvent.drop(zone, { dataTransfer });

    expect(setWorkspaceTaskCompleted).toHaveBeenCalledWith('c1', true);
    expect(await screen.findByTestId('task-done-announcer')).toHaveTextContent('已完成：写文档');
    expect(await screen.findByRole('button', { name: '已完成：最近 7 天 1 件' })).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: /写文档/ })).not.toBeInTheDocument();
  });

  it('accepts an open matrix task dragged into a lane, without offering the done zone', async () => {
    const moveTaskToLane = vi.fn().mockImplementation((id: string, laneId: string) =>
      Promise.resolve(task(id, laneId, 0, { title: '四象限任务' })));
    const repo = repository({
      moveTaskToLane,
      getTaskWorkspaceSnapshot: vi.fn().mockResolvedValue({
        ...snapshot,
        tasks: [...snapshot.tasks, task('m1', 'lane-a', 0, { title: '四象限任务', laneId: null })]
      })
    });
    function StartMatrixDrag() {
      const drag = useTaskDrag();
      return <button type="button" onClick={() => drag.startMatrixDrag('m1')}>start matrix drag</button>;
    }
    render(
      <RepositoryProvider repository={repo}>
        <TaskWorkspaceProvider>
          <TaskDragProvider>
            <KanbanWidget todayIso="2026-08-12" />
            <StartMatrixDrag />
          </TaskDragProvider>
        </TaskWorkspaceProvider>
      </RepositoryProvider>
    );
    const target = await screen.findByRole('region', { name: '泳道：进行中' });
    fireEvent.click(screen.getByRole('button', { name: 'start matrix drag' }));
    expect(screen.queryByTestId('kanban-done-drop')).not.toBeInTheDocument();

    const dataTransfer = { effectAllowed: '', dropEffect: '', setData: vi.fn(), getData: vi.fn() };
    fireEvent.dragOver(target, { dataTransfer });
    expect(within(target).getByTestId('kanban-drop-line')).toBeInTheDocument();
    fireEvent.drop(target, { dataTransfer });
    expect(moveTaskToLane).toHaveBeenCalledWith('m1', 'lane-b', 1);
    expect(await within(target).findByRole('article', { name: /四象限任务/ })).toBeInTheDocument();
  });

  it('hides the done button until the board has a lane', async () => {
    renderWidget(repository({ getTaskWorkspaceSnapshot: vi.fn().mockResolvedValue(emptySnapshot) }));
    expect(await screen.findByText(/还没有泳道/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^已完成/ })).not.toBeInTheDocument();
  });

  it('renames a lane from its menu, without a delete action in the editor', async () => {
    const user = userEvent.setup();
    renderWidget(repository());
    await screen.findByRole('region', { name: '泳道：待处理' });
    expect(screen.queryByRole('button', { name: '待处理' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '待处理泳道操作' }));
    await user.click(screen.getByRole('menuitem', { name: '重命名与颜色' }));
    expect(screen.getByRole('dialog', { name: '编辑泳道' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '删除泳道' })).not.toBeInTheDocument();
  });

  it('creates a lane to the right of the chosen lane', async () => {
    const user = userEvent.setup();
    const createTaskLane = vi.fn().mockResolvedValue(lane('lane-new', '等待', 3));
    const reorderTaskLanes = vi.fn().mockResolvedValue(undefined);
    renderWidget(repository({ createTaskLane, reorderTaskLanes }));
    await screen.findByRole('region', { name: '泳道：待处理' });
    await user.click(screen.getByRole('button', { name: '待处理泳道操作' }));
    await user.click(screen.getByRole('menuitem', { name: '在右侧新建泳道' }));
    await user.type(screen.getByLabelText('泳道名称'), '等待');
    await user.click(screen.getByRole('button', { name: '保存泳道' }));
    expect(createTaskLane).toHaveBeenCalledWith(expect.objectContaining({ name: '等待' }));
    expect(reorderTaskLanes).toHaveBeenCalledWith(['lane-a', 'lane-new', 'lane-b', 'lane-c']);
  });

  it('confirms lane deletion showing the card count and keeps those tasks in the matrix', async () => {
    const user = userEvent.setup();
    const repo = repository();
    renderWidget(repo);
    await screen.findByRole('region', { name: '泳道：待处理' });
    await user.click(screen.getByRole('button', { name: '待处理泳道操作' }));
    await user.click(screen.getByRole('menuitem', { name: '删除泳道' }));
    expect(screen.getByText('删除后，该泳道的 2 张任务会离开看板，仍保留在四象限中。')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '永久删除' }));
    expect(repo.deleteTaskLane).toHaveBeenCalledWith('lane-a');
  });

  it('lets the last lane be deleted', async () => {
    const user = userEvent.setup();
    renderWidget(repository({
      getTaskWorkspaceSnapshot: vi.fn().mockResolvedValue({ ...snapshot, lanes: [lane('lane-a', '待处理', 0)], tasks: [] })
    }));
    await user.click(await screen.findByRole('button', { name: '待处理泳道操作' }));
    expect(screen.getByRole('menuitem', { name: '删除泳道' })).toBeInTheDocument();
  });

  it('offers a create-lane button in the empty state', async () => {
    const user = userEvent.setup();
    renderWidget(repository({
      getTaskWorkspaceSnapshot: vi.fn().mockResolvedValue(emptySnapshot)
    }));
    expect(await screen.findByText(/还没有泳道/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新建任务' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '新建泳道' }));
    expect(screen.getByRole('dialog', { name: '新建泳道' })).toBeInTheDocument();
  });

  it('filters by tag only', async () => {
    renderWidget(repository({
      getTaskWorkspaceSnapshot: vi.fn().mockResolvedValue({
        ...snapshot,
        tags: [{ id: 't1', name: '工作', color: '#4FC9DA', archivedAt: null, createdAt: 'x', updatedAt: 'x' }]
      })
    }));
    await screen.findByRole('region', { name: '泳道：待处理' });
    expect(screen.getByRole('button', { name: '按标签筛选' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '按成员筛选' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '按优先级筛选' })).not.toBeInTheDocument();
  });

  it('does not render a meta line for a bare card', async () => {
    renderWidget(repository());
    const laneRegion = await screen.findByRole('region', { name: '泳道：待处理' });
    const bare = within(laneRegion).getByLabelText('任务：写文档');
    expect(bare.querySelector('.kanban-card__meta')).toBeNull();
    expect(within(bare).getByRole('img', { name: '不重要不紧急' })).toBeInTheDocument();
  });
});