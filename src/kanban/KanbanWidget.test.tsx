import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { RepositoryProvider } from '../data/RepositoryContext';
import type { NowlyRepository } from '../data/nowly-repository';
import type { KanbanCard, KanbanLane, KanbanSnapshot } from './kanban-model';
import { KanbanWidget } from './KanbanWidget';

function lane(id: string, name: string, position: number): KanbanLane {
  return { id, name, color: 'primary', position, createdAt: 'x', updatedAt: 'x' };
}

function card(id: string, laneId: string, position: number, overrides: Partial<KanbanCard> = {}): KanbanCard {
  return {
    id, laneId, title: id, description: null, dueDate: null, priorityId: null,
    position, tagIds: [], collaboratorIds: [], createdAt: 'x', updatedAt: 'x', ...overrides
  };
}

const snapshot: KanbanSnapshot = {
  lanes: [lane('lane-a', '待处理', 0), lane('lane-b', '进行中', 1), lane('lane-c', '已完成', 2)],
  cards: [
    card('c1', 'lane-a', 0, { title: '写文档' }),
    card('c2', 'lane-a', 1, { title: '修 bug' }),
    card('c3', 'lane-b', 0, { title: '评审' })
  ],
  priorities: [],
  tags: [],
  collaborators: []
};

function repository(overrides: Partial<NowlyRepository> = {}): NowlyRepository {
  return {
    listEventsInRange: vi.fn().mockResolvedValue([]), createEvent: vi.fn(), updateEvent: vi.fn(), deleteEvent: vi.fn(),
    listTasks: vi.fn().mockResolvedValue([]), createTask: vi.fn(), updateTask: vi.fn(), deleteTask: vi.fn(), setTaskCompleted: vi.fn(),
    listNotes: vi.fn().mockResolvedValue([]), createNote: vi.fn(), updateNote: vi.fn(), deleteNote: vi.fn(),
    getSettings: vi.fn(), updateSettings: vi.fn(), listMonitors: vi.fn(),
    listModuleLayout: vi.fn().mockResolvedValue([]), saveModuleLayout: vi.fn(),
    getModuleState: vi.fn().mockResolvedValue(null), setModuleState: vi.fn().mockResolvedValue(undefined), createFocusSession:vi.fn().mockImplementation((session)=>Promise.resolve(session)), listFocusSessions:vi.fn().mockResolvedValue([]), getFocusStatistics:vi.fn().mockResolvedValue({totalFocusedSeconds:0,completedCount:0,interruptedCount:0,completionRate:0,points:[]}),
    listExtensions: vi.fn().mockResolvedValue([]), installExtension: vi.fn(), uninstallExtension: vi.fn(),
    getKanbanSnapshot: vi.fn().mockResolvedValue(snapshot),
    createKanbanLane: vi.fn(), updateKanbanLane: vi.fn(), deleteKanbanLane: vi.fn().mockResolvedValue(undefined),
    reorderKanbanLanes: vi.fn().mockResolvedValue([]),
    createKanbanCard: vi.fn(), updateKanbanCard: vi.fn(), deleteKanbanCard: vi.fn().mockResolvedValue(undefined),
    moveKanbanCard: vi.fn().mockResolvedValue(undefined),
    createKanbanPriority: vi.fn(), updateKanbanPriority: vi.fn(), deleteKanbanPriority: vi.fn(), reorderKanbanPriorities: vi.fn(),
    createKanbanTag: vi.fn(), updateKanbanTag: vi.fn(), deleteKanbanTag: vi.fn(),
    createKanbanCollaborator: vi.fn(), updateKanbanCollaborator: vi.fn(), deleteKanbanCollaborator: vi.fn(), proxyFetch: vi.fn(), fetchRegistry: vi.fn(), downloadModule: vi.fn(), listCalendarSubscriptions: vi.fn().mockResolvedValue([]), createCalendarSubscription: vi.fn(), updateCalendarSubscription: vi.fn(), deleteCalendarSubscription: vi.fn(),
    ...overrides
  };
}

function renderWidget(repo: NowlyRepository) {
  function Wrapper({ children }: { children: ReactNode }) {
    return <RepositoryProvider repository={repo}>{children}</RepositoryProvider>;
  }
  return render(<KanbanWidget todayIso="2026-08-12" />, { wrapper: Wrapper });
}

describe('KanbanWidget', () => {
  it('shows the header with add-lane and a settings menu carrying manage-fields', async () => {
    const user = userEvent.setup();
    renderWidget(repository());
    expect(await screen.findByText('3 张任务')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '添加泳道' })).toBeInTheDocument();
    // Manage-fields lives in the board settings menu, not directly in the header.
    expect(screen.queryByRole('button', { name: '管理字段' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '看板设置' }));
    expect(screen.getByRole('menuitem', { name: '管理字段' })).toBeInTheDocument();
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
    expect(screen.getByRole('heading', { name: '在“进行中”新建任务' })).toBeInTheDocument();
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
    expect(repo.deleteKanbanLane).toHaveBeenCalledWith('lane-a');
  });

  it('shows an empty state when there are no lanes', async () => {
    renderWidget(repository({
      getKanbanSnapshot: vi.fn().mockResolvedValue({ lanes: [], cards: [], priorities: [], tags: [], collaborators: [] })
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
