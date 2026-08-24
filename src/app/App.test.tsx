import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RepositoryProvider } from '../data/RepositoryContext';
import type { AppSettings, NowlyRepository } from '../data/nowly-repository';
import { App } from './App';
import { FocusTimerProvider } from '../focus/FocusTimerContext';

const invokeMock = vi.hoisted(() => vi.fn());
const listenMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: listenMock
}));

const settings: AppSettings = {
  wallpaperEnabled: false,
  launchAtLogin: false,
  targetMonitorId: null,
  density: 'balanced',
  weekStart: 'monday',
  dateFormat: 'localized',
  showWeekends: true
};

function createRepository(overrides: Partial<NowlyRepository> = {}): NowlyRepository {
  return {
    listEventsInRange: vi.fn().mockResolvedValue([]),
    createEvent: vi.fn().mockRejectedValue(new Error('unexpected write')),
    updateEvent: vi.fn().mockRejectedValue(new Error('unexpected write')),
    deleteEvent: vi.fn().mockRejectedValue(new Error('unexpected write')),
    listTasks: vi.fn().mockResolvedValue([]),
    createTask: vi.fn().mockRejectedValue(new Error('unexpected task write')),
    updateTask: vi.fn().mockRejectedValue(new Error('unexpected task write')),
    deleteTask: vi.fn().mockRejectedValue(new Error('unexpected task write')),
    setTaskCompleted: vi.fn().mockRejectedValue(new Error('unexpected task write')),
    listNotes: vi.fn().mockResolvedValue([]),
    createNote: vi.fn().mockRejectedValue(new Error('unexpected note write')),
    updateNote: vi.fn().mockRejectedValue(new Error('unexpected note write')),
    deleteNote: vi.fn().mockRejectedValue(new Error('unexpected note write')),
    getSettings: vi.fn().mockResolvedValue(settings),
    updateSettings: vi.fn().mockResolvedValue(settings),
    listMonitors: vi.fn().mockResolvedValue([]),
    listModuleLayout: vi.fn().mockResolvedValue([
      { id: 'calendar', x: 0, y: 0, w: 7, h: 8 },
      { id: 'matrix', x: 7, y: 0, w: 5, h: 5 },
      { id: 'notes', x: 7, y: 5, w: 5, h: 3 }
    ]),
    saveModuleLayout: vi.fn().mockImplementation((layout) => Promise.resolve(layout)),
    getModuleState: vi.fn().mockResolvedValue(null),
    setModuleState: vi.fn().mockResolvedValue(undefined), createFocusSession:vi.fn().mockImplementation((session)=>Promise.resolve(session)), listFocusSessions:vi.fn().mockResolvedValue([]), getFocusStatistics:vi.fn().mockResolvedValue({totalFocusedSeconds:0,completedCount:0,interruptedCount:0,completionRate:0,points:[]}),
    listExtensions: vi.fn().mockResolvedValue([]),
    installExtension: vi.fn().mockRejectedValue(new Error('unexpected extension write')),
    uninstallExtension: vi.fn().mockRejectedValue(new Error('unexpected extension write')),
    getKanbanSnapshot: vi.fn().mockResolvedValue({ lanes: [], cards: [], priorities: [], tags: [], collaborators: [] }),
    createKanbanLane: vi.fn(), updateKanbanLane: vi.fn(), deleteKanbanLane: vi.fn(), reorderKanbanLanes: vi.fn(),
    createKanbanCard: vi.fn(), updateKanbanCard: vi.fn(), deleteKanbanCard: vi.fn(), moveKanbanCard: vi.fn(),
    createKanbanPriority: vi.fn(), updateKanbanPriority: vi.fn(), deleteKanbanPriority: vi.fn(), reorderKanbanPriorities: vi.fn(),
    createKanbanTag: vi.fn(), updateKanbanTag: vi.fn(), deleteKanbanTag: vi.fn(),
    createKanbanCollaborator: vi.fn(), updateKanbanCollaborator: vi.fn(), deleteKanbanCollaborator: vi.fn(), proxyFetch: vi.fn(), fetchRegistry: vi.fn(), downloadModule: vi.fn(), listCalendarSubscriptions: vi.fn().mockResolvedValue([]), createCalendarSubscription: vi.fn(), updateCalendarSubscription: vi.fn(), deleteCalendarSubscription: vi.fn(), refreshCalendarSubscription: vi.fn(), listExternalEventsInRange: vi.fn().mockResolvedValue([]),
    ...overrides
  };
}

function renderApp(repository = createRepository()) {
  return render(
    <RepositoryProvider repository={repository}>
      <FocusTimerProvider>
        <App />
      </FocusTimerProvider>
    </RepositoryProvider>
  );
}

describe('App startup and window behavior', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();
    listenMock.mockResolvedValue(() => undefined);
    invokeMock.mockResolvedValue('ok');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders persisted empty startup data instead of samples', async () => {
    renderApp();
    expect(screen.getByText('正在读取本地日程')).toBeInTheDocument();
    expect(screen.getByText('正在读取本地任务')).toBeInTheDocument();
    expect(screen.getByText('正在读取本地便签')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('本月暂无日程')).toBeInTheDocument());
    expect(screen.getAllByText('暂无任务')).toHaveLength(4);
    expect(screen.getByText('还没有便签')).toBeInTheDocument();
    expect(screen.queryByText('设计评审')).not.toBeInTheDocument();
    expect(screen.queryByText('产品原则')).not.toBeInTheDocument();
  });

  it('keeps healthy modules visible when one read fails', async () => {
    renderApp(createRepository({ listNotes: vi.fn().mockRejectedValue({ message: '便签读取失败' }) }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('便签读取失败'));
    expect(screen.getByText('本月暂无日程')).toBeInTheDocument();
    expect(screen.getAllByText('暂无任务')).toHaveLength(4);
  });

  it('queries month ranges, navigates, and creates an event from the header', async () => {
    const user = userEvent.setup();
    const created = { id:'e1', title:'评审', startAt:'2026-07-23T09:45', endAt:'2026-07-23T10:45', allDay:false, category:'work' as const, color:'blue' as const, linkedTaskId:null, note:'', createdAt:'x', updatedAt:'x' };
    const listEventsInRange = vi.fn().mockResolvedValue([]);
    const createEvent = vi.fn().mockResolvedValue(created);
    const repository = createRepository({ listEventsInRange, createEvent });
    renderApp(repository);
    await waitFor(() => expect(listEventsInRange).toHaveBeenCalled());
    expect(listEventsInRange.mock.calls[0][0].startAt).toMatch(/-01T00:00$/);
    await user.click(screen.getByRole('button', { name:'下一个月' }));
    await waitFor(() => expect(listEventsInRange).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole('button', { name:'上一个月' }));
    await user.click(screen.getByRole('button', { name:'新建日程' }));
    expect(screen.getByRole('dialog', { name:'新建日程' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('日程标题'), '评审');
    await user.click(screen.getByRole('button', { name:'保存' }));
    await waitFor(() => expect(createEvent).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole('dialog', { name:'新建日程' })).not.toBeInTheDocument());
  });

  it('creates and edits tasks through the task feature without duplicate startup reads', async () => {
    const user = userEvent.setup();
    const existing = {
      id:'t1', title:'发布 Nowly', quadrant:'important_urgent' as const, dueAt:null, priority:1 as const,
      completed:false, linkedEventId:null, note:'', createdAt:'x', updatedAt:'x'
    };
    const created = { ...existing, id:'t2', title:'新任务' };
    const listTasks = vi.fn().mockResolvedValueOnce([existing]).mockResolvedValue([existing, created]);
    const createTask = vi.fn().mockResolvedValue(created);
    const repository = createRepository({ listTasks, createTask });
    renderApp(repository);
    await waitFor(() => expect(screen.getByRole('button', { name:'编辑任务：发布 Nowly' })).toBeInTheDocument());
    expect(listTasks).toHaveBeenCalledOnce();

    await user.click(screen.getByRole('button', { name:'新增任务' }));
    expect(screen.getByRole('dialog', { name:'新建任务' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name:'截止日期' })).toHaveTextContent('请选择日期');
    await user.type(screen.getByLabelText('任务标题'), '新任务');
    await user.click(screen.getByRole('button', { name:'保存任务' }));
    await waitFor(() => expect(createTask).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole('dialog', { name:'新建任务' })).not.toBeInTheDocument());
    expect(listTasks).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole('button', { name:'编辑任务：发布 Nowly' }));
    expect(screen.getByRole('dialog', { name:'编辑任务' })).toBeInTheDocument();
  });

  it('refreshes the current event month after creating a linked task', async () => {
    const user = userEvent.setup();
    const event = { id:'e1', title:'设计评审', startAt:'2026-07-23T14:00', endAt:'2026-07-23T15:00', allDay:false, category:'work' as const, color:'blue' as const, linkedTaskId:null, note:'', createdAt:'x', updatedAt:'x' };
    const linked = { id:'t1', title:'关联任务', quadrant:'important_urgent' as const, dueAt:null, priority:2 as const, completed:false, linkedEventId:'e1', note:'', createdAt:'x', updatedAt:'x' };
    const listEventsInRange = vi.fn().mockResolvedValue([event]);
    const createTask = vi.fn().mockResolvedValue(linked);
    renderApp(createRepository({ listEventsInRange, createTask }));
    await waitFor(() => expect(listEventsInRange).toHaveBeenCalledOnce());

    await user.click(screen.getByRole('button', { name:'新增任务' }));
    await user.type(screen.getByLabelText('任务标题'), '关联任务');
    await user.click(screen.getByRole('combobox', { name:'关联日程' }));
    await user.click(screen.getByRole('option', { name:'设计评审' }));
    await user.click(screen.getByRole('button', { name:'保存任务' }));
    await waitFor(() => expect(listEventsInRange).toHaveBeenCalledTimes(2));
  });

  it('creates notes and opens the all-notes manager', async () => {
    const user = userEvent.setup();
    const note = { id:'n1', title:'产品原则', content:'保持简单', color:'purple' as const, pinned:true, createdAt:'x', updatedAt:'x' };
    const listNotes = vi.fn().mockResolvedValueOnce([]).mockResolvedValue([note]);
    const createNote = vi.fn().mockResolvedValue(note);
    renderApp(createRepository({listNotes, createNote}));
    await waitFor(() => expect(screen.getByText('还没有便签')).toBeInTheDocument());
    await user.click(screen.getByRole('button', {name:'新增便签'}));
    expect(screen.getByRole('dialog', {name:'新建便签'})).toBeInTheDocument();
    await user.type(screen.getByLabelText('便签标题'), '产品原则');
    await user.click(screen.getByRole('button', {name:'保存便签'}));
    await waitFor(() => expect(createNote).toHaveBeenCalled());
    expect(listNotes).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole('button', {name:'查看全部便签'}));
    expect(screen.getByRole('dialog', {name:'全部便签'})).toBeInTheDocument();
  });

  it('reflects the persisted interface density on the document root', async () => {
    renderApp(createRepository({ getSettings: vi.fn().mockResolvedValue({ ...settings, density: 'comfortable' }) }));
    await waitFor(() => expect(document.documentElement.dataset.density).toBe('comfortable'));
  });

  it('starts in foreground without automatically entering wallpaper mode', () => {
    renderApp();

    expect(screen.getByRole('button', { name: '设为壁纸' })).toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalledWith('enter_wallpaper_mode');
  });

  it('enters wallpaper from the content action and returns on wallpaper double click', async () => {
    renderApp();

    fireEvent.click(screen.getByRole('button', { name: '设为壁纸' }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('enter_wallpaper_mode'));
    await waitFor(() => expect(screen.queryByRole('button', { name: '设为壁纸' })).not.toBeInTheDocument());

    fireEvent.doubleClick(screen.getByTestId('desktop-root'));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('enter_foreground_mode'));
    await waitFor(() => expect(screen.getByRole('button', { name: '设为壁纸' })).toBeInTheDocument());
  });

  it('updates the wallpaper action when the tray changes window mode', async () => {
    let modeListener: ((event: { payload: 'foreground' | 'wallpaper' }) => void) | undefined;
    listenMock.mockImplementation((eventName, listener) => {
      if (eventName === 'window-mode-changed') modeListener = listener;
      return Promise.resolve(() => undefined);
    });
    renderApp();
    await waitFor(() => expect(modeListener).toBeDefined());

    modeListener?.({ payload: 'wallpaper' });
    await waitFor(() => expect(screen.queryByRole('button', { name: '设为壁纸' })).not.toBeInTheDocument());
    modeListener?.({ payload: 'foreground' });
    await waitFor(() => expect(screen.getByRole('button', { name: '设为壁纸' })).toBeInTheDocument());
  });
});
