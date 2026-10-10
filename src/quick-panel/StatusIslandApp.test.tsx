import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StatusIslandApp } from './StatusIslandApp';
import type { NativeStatusIslandSnapshot } from './useStatusIslandSnapshot';

const invokeMock = vi.hoisted(() => vi.fn());
const listenMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }));

const snapshot: NativeStatusIslandSnapshot = {
  sampledAt: '2026-09-12T14:18',
  localDate: '2026-09-12',
  events: [],
  externalEvents: [],
  tasks: [],
  focus: { status: 'idle', remainingSeconds: 0, plannedSeconds: 0, sessionId: null, stageSequence: 0, stageChangedAt: null },
  reminders: []
};

const reminderEvent = {
  id: 'event-1', title: '产品评审', startAt: '2026-09-12T14:30', endAt: '2026-09-12T15:30', allDay: false,
  category: 'work' as const, color: '#4FC9DA' as const, note: '', reminders: [15], createdAt: 'x', updatedAt: 'x',
  recurrence: null, startTz: null, endTz: null, rrule: null, seriesId: null, seriesStartAt: null,
  occurrenceStartAt: null, isOverridden: false, subscriptionId: null
};
const secondReminderEvent = {
  ...reminderEvent,
  id: 'event-2',
  title: '客户回访',
  startAt: '2026-09-12T14:32',
  endAt: '2026-09-12T15:00'
};

const urgentTask = {
  id: 'task-1', title: '发布检查', description: '', priority: 'important_urgent' as const,
  dueDate: '2026-09-12', completed: false, laneId: 'todo', boardPosition: 0,
  tagIds: [], collaboratorIds: [], views: ['matrix' as const], createdAt: 'x', updatedAt: '2026-09-01T00:00:00Z'
};

// Mirrors the reported defect: an undated task and an overdue one, both
// important+urgent, so they share a priority and only the due date separates them.
const undatedTask = { ...urgentTask, id: 'aaaa-undated', title: '文件测试', dueDate: null };
const overdueTask = { ...urgentTask, id: 'zzzz-overdue', title: '完善 Nowly', dueDate: '2026-09-09' };
const undatedIdentity = `task:${undatedTask.id}:${undatedTask.updatedAt}:2026-09-12`;
const overdueIdentity = `task:${overdueTask.id}:${overdueTask.updatedAt}:2026-09-12`;

function snapshotWith(overrides: Partial<NativeStatusIslandSnapshot>): NativeStatusIslandSnapshot {
  return { ...snapshot, ...overrides };
}

function respondWith(data: NativeStatusIslandSnapshot) {
  invokeMock.mockImplementation((command: string) =>
    command === 'get_status_island_snapshot' ? Promise.resolve(data) : Promise.resolve(null));
}

// Native decides whether there is anything to drag, so a test that means to move
// the island has to let it agree. `respondWith` answers every other command with
// null, which is the "nothing draggable here" answer.
function respondWithDraggable(data: NativeStatusIslandSnapshot) {
  invokeMock.mockImplementation((command: string) => {
    if (command === 'get_status_island_snapshot') return Promise.resolve(data);
    if (command === 'begin_status_island_drag') return Promise.resolve(true);
    return Promise.resolve(null);
  });
}

function invocations(command: string) {
  return invokeMock.mock.calls.filter(call => call[0] === command);
}

async function emitPanelEvent(name: string, payload: unknown) {
  await act(async () => { await Promise.resolve(); });
  const listener = listenMock.mock.calls.find(call => call[0] === name)?.[1];
  expect(listener).toBeTypeOf('function');
  await act(async () => listener({ payload }));
}

// `findBy*` polls on real timers, so tests that need one cannot freeze the clock.
// Those build their event relative to now instead of pinning a fixed time.
function localMinute(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

describe('screen status island windows', () => {
  afterEach(() => vi.useRealTimers());

  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();
    listenMock.mockResolvedValue(() => undefined);
    respondWith(snapshot);
  });

  it('opens screenshot history inside the Bar without opening or acknowledging status details', async () => {
    invokeMock.mockImplementation((command: string) => Promise.resolve(
      command === 'get_status_island_snapshot' ? snapshot
        : command === 'list_screenshot_history' ? { items: [], nextCursor: null } : null
    ));
    render(<StatusIslandApp />);
    await emitPanelEvent('status-island-details-open', { generation: 1, source: 'history', identity: null });
    expect(await screen.findByRole('heading', { name: '截图历史' })).toBeVisible();
    expect(document.querySelector('.status-rail')).toHaveAttribute('data-surface', 'history');
    expect(document.querySelector('.status-rail')).toHaveAttribute('data-status-open', 'false');
    expect(invocations('acknowledge_status_island_reminder')).toHaveLength(0);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(invocations('close_status_island_details')).toHaveLength(1);
    await emitPanelEvent('status-island-details-close', { generation: 2 });
    expect(screen.queryByRole('heading', { name: '截图历史' })).not.toBeInTheDocument();
    expect(document.querySelector('.status-rail')).toHaveAttribute('data-frame-anim', 'shrink');
  });

  it('keeps the capsule and says the day is empty when there is no business state', async () => {
    render(<StatusIslandApp />);
    await act(async () => { await Promise.resolve(); });

    // The rail is one object at a fixed size; an empty day is content, not a
    // third shape. It stays openable, so it stays a control.
    expect(screen.getByRole('button', { name: '今天没有安排 · 0 项日程 · 0 项待办' })).toBeInTheDocument();
    expect(document.querySelector('.status-rail')).toHaveAttribute('data-mode', 'idle');
    expect(document.querySelector('.status-rail')).toHaveAttribute('data-open', 'false');
    expect(invocations('toggle_status_island_details')).toHaveLength(0);
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('shows the Nowly logo as the assistant entry without opening it on mount', async () => {
    render(<StatusIslandApp />);
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByRole('button', { name: 'Nowly' })).toHaveAttribute('aria-expanded', 'false');
    expect(invocations('hover_nowly_panel')).toHaveLength(0);
    expect(invocations('toggle_nowly_panel')).toHaveLength(0);
    expect(invocations('toggle_status_island_details')).toHaveLength(0);
  });

  it('starts capture directly without a menu, prevents duplicate requests and allows retry after failure', async () => {
    let rejectStartup!: (reason: unknown) => void;
    const startup = new Promise<void>((_resolve, reject) => { rejectStartup = reject; });
    invokeMock.mockImplementation((command: string) => {
      if (command === 'get_status_island_snapshot') {
        return Promise.resolve(snapshotWith({ barButtons: ['screenshot'] }));
      }
      if (command === 'start_screen_capture') return startup;
      return Promise.resolve(null);
    });
    render(<StatusIslandApp />);
    const button = await screen.findByRole('button', { name: '截屏' });

    fireEvent.click(button);
    fireEvent.click(button);
    expect(invocations('start_screen_capture')).toHaveLength(1);
    expect(invocations('start_screen_capture')[0]).toEqual(['start_screen_capture']);
    expect(invocations('toggle_screenshot_menu')).toHaveLength(0);
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(invocations('toggle_nowly_panel')).toHaveLength(0);
    expect(invocations('toggle_status_island_details')).toHaveLength(0);

    await act(async () => rejectStartup({ message: '截图启动超时。' }));
    expect(button).not.toBeDisabled();
    expect(button).toHaveTextContent('重试');
    expect(button).toHaveAttribute('title', '截屏：截图启动超时。');
    fireEvent.click(button);
    expect(invocations('start_screen_capture')).toHaveLength(2);
    expect(invocations('toggle_screenshot_menu')).toHaveLength(0);
    await act(async () => { await Promise.resolve(); });
  });

  it('clears screenshot pending state when startup succeeds', async () => {
    let finishStartup!: () => void;
    const startup = new Promise<void>(resolve => { finishStartup = resolve; });
    invokeMock.mockImplementation((command: string) => {
      if (command === 'get_status_island_snapshot') {
        return Promise.resolve(snapshotWith({ barButtons: ['screenshot'] }));
      }
      if (command === 'start_screen_capture') return startup;
      return Promise.resolve(null);
    });
    render(<StatusIslandApp />);
    const button = await screen.findByRole('button', { name: '截屏' });
    fireEvent.click(button);
    expect(button).toBeDisabled();
    await act(async () => finishStartup());
    expect(button).not.toBeDisabled();
    expect(button).not.toHaveAttribute('aria-busy', 'true');
    expect(button).not.toHaveTextContent('重试');
  });

  it('shows the summary in the island when state exists but nothing is unseen', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T14:18:00'));
    respondWith(snapshotWith({
      // A later event today is passive information: it is counted, never announced.
      events: [{ ...reminderEvent, title: '晚间复盘', startAt: '2026-09-12T19:00', endAt: '2026-09-12T19:30', reminders: [] }]
    }));
    render(<StatusIslandApp />);
    await act(async () => { await Promise.resolve(); });

    // Still the capsule, at the same size: the summary is content, not a third shape.
    expect(document.querySelector('.status-rail')).toHaveAttribute('data-mode', 'summary');
    expect(screen.getByText('日程 1 项')).toBeInTheDocument();
    expect(screen.getByText('今日汇总 · 共 1 项')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^晚间复盘 ·/ })).not.toBeInTheDocument();
    // A summary is an aggregate, so there is no single reminder to acknowledge.
    expect(invokeMock).toHaveBeenCalledWith('set_status_island_primary', { identity: null });
    fireEvent.click(screen.getByRole('button', {
      name: '日程 1 项 · 今日汇总 · 共 1 项 · 今日日程 1 项'
    }));
    expect(invokeMock).toHaveBeenCalledWith('toggle_status_island_details', { identity: null });
  });

  it('expands to the island for an unacknowledged reminder and reports it as primary', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T14:18:00'));
    respondWith(snapshotWith({ events: [reminderEvent] }));
    render(<StatusIslandApp />);
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByRole('button', { name: /^产品评审 ·/ })).toBeInTheDocument();
    expect(document.querySelector('.status-rail')).toHaveAttribute('data-mode', 'detail');
    expect(invokeMock).toHaveBeenCalledWith('set_status_island_primary', {
      identity: 'event:event-1:2026-09-12T14:30:reminder:15'
    });
  });

  it('defers opening to native on hover so a quick pass neither opens nor acknowledges', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T14:18:00'));
    respondWith(snapshotWith({ events: [reminderEvent] }));
    render(<StatusIslandApp />);
    await act(async () => { await Promise.resolve(); });
    const trigger = screen.getByRole('button', { name: /^产品评审 ·/ });

    fireEvent.mouseEnter(trigger);
    expect(invokeMock).toHaveBeenCalledWith('set_status_island_presence', { surface: 'island', present: true });
    expect(invocations('hover_status_island_details')).toHaveLength(1);

    fireEvent.mouseLeave(trigger);
    expect(invokeMock).toHaveBeenCalledWith('set_status_island_presence', { surface: 'island', present: false });
    // The frontend never acknowledges; native does it when the panel appears.
    expect(invocations('acknowledge_status_island_reminder')).toHaveLength(0);
  });

  it('cancels the pending hover open as soon as a long press begins', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T14:18:00'));
    respondWithDraggable(snapshotWith({ events: [reminderEvent] }));
    render(<StatusIslandApp />);
    await act(async () => { await Promise.resolve(); });
    const trigger = screen.getByRole('button', { name: /^产品评审 ·/ });

    fireEvent.mouseEnter(trigger);
    fireEvent.pointerDown(trigger, { button: 0, pointerId: 1, screenX: 900, screenY: 10 });

    const presenceCalls = invocations('set_status_island_presence');
    expect(presenceCalls[presenceCalls.length - 1]?.[1]).toEqual({ surface: 'island', present: false });
    fireEvent.pointerUp(window, { pointerId: 1, screenX: 900, screenY: 10 });
  });

  it('keeps an open panel until native reports an outside click', async () => {
    vi.useFakeTimers();
    let openPanel: ((event: { payload: { source: 'island'; identity: string | null; hovered: boolean } }) => void) | undefined;
    listenMock.mockImplementation((name: string, callback: typeof openPanel) => {
      if (name === 'status-island-details-open') openPanel = callback;
      return Promise.resolve(() => undefined);
    });
    render(<StatusIslandApp />);
    await act(async () => { await Promise.resolve(); });
    const root = screen.getByLabelText('Nowly Bar');

    act(() => openPanel?.({ payload: { source: 'island', identity: null, hovered: true } }));
    fireEvent.mouseLeave(root);
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(invocations('close_status_island_details')).toHaveLength(0);

    act(() => openPanel?.({ payload: { source: 'island', identity: null, hovered: false } }));
    fireEvent.mouseLeave(root);
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(invocations('close_status_island_details')).toHaveLength(0);
  });

  it('keeps a delayed hover-open panel until native reports an outside click', async () => {
    vi.useFakeTimers();
    let openPanel: ((event: { payload: { source: 'island'; identity: string | null; hovered: boolean } }) => void) | undefined;
    listenMock.mockImplementation((name: string, callback: typeof openPanel) => {
      if (name === 'status-island-details-open') openPanel = callback;
      return Promise.resolve(() => undefined);
    });
    render(<StatusIslandApp />);
    await act(async () => { await Promise.resolve(); });
    const root = screen.getByLabelText('Nowly Bar');

    fireEvent.mouseEnter(root);
    fireEvent.mouseLeave(root);
    act(() => openPanel?.({ payload: { source: 'island', identity: null, hovered: true } }));
    await act(async () => { vi.advanceTimersByTime(300); });

    expect(invocations('close_status_island_details')).toHaveLength(0);
  });

  it('keeps notification-only island visible through hover expansion and acknowledgement', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T14:18:00'));
    const data = snapshotWith({ events: [reminderEvent], notificationMode: 'notification' });
    respondWith(data);
    render(<StatusIslandApp />);
    await act(async () => { await Promise.resolve(); });
    const trigger = screen.getByRole('button', { name: /^产品评审 ·/ });
    expect(invocations('set_status_island_visibility')[invocations('set_status_island_visibility').length - 1]?.[1]).toEqual({ visible: true });

    fireEvent.mouseEnter(trigger);
    fireEvent.mouseLeave(trigger);
    expect(invocations('dismiss_status_island_notification')).toHaveLength(0);
    const acknowledged = snapshotWith({ ...data, reminders: [{ identity: 'event:event-1:2026-09-12T14:30:reminder:15', acknowledgedAt: '2026-09-12T14:18:00+08:00', dismissed: false, consumed: false }] });
    respondWith(acknowledged);
    await act(async () => { await Promise.resolve(); });
    expect(invocations('set_status_island_visibility')[invocations('set_status_island_visibility').length - 1]?.[1]).not.toEqual({ visible: false });
  });

  it('hides notification-only mode after the last viewed reminder panel is collapsed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T14:18:00'));
    let open: (event: { payload: { source: 'island'; identity: string; hovered: boolean } }) => void = () => undefined;
    let close: () => void = () => undefined;
    let invalidate: () => void = () => undefined;
    listenMock.mockImplementation((name: string, callback: () => void) => {
      if (name === 'status-island-details-open') open = callback as typeof open;
      if (name === 'status-island-details-close') close = callback;
      if (name === 'status-island-invalidated') invalidate = callback;
      return Promise.resolve(() => undefined);
    });
    let data = snapshotWith({ events: [reminderEvent], notificationMode: 'notification' });
    invokeMock.mockImplementation((command: string) =>
      command === 'get_status_island_snapshot' ? Promise.resolve(data) : Promise.resolve(null));
    render(<StatusIslandApp />);
    await act(async () => { await Promise.resolve(); });
    invokeMock.mockClear();
    await act(async () => {
      open({
        payload: {
          source: 'island',
          identity: 'event:event-1:2026-09-12T14:30:reminder:15',
          hovered: false
        }
      });
    });

    data = snapshotWith({
      ...data,
      reminders: [{
        identity: 'event:event-1:2026-09-12T14:30:reminder:15',
        acknowledgedAt: '2026-09-12T14:18:00+08:00',
        dismissed: false,
        consumed: false
      }]
    });
    await act(async () => { invalidate(); });
    expect(invocations('set_status_island_visibility')).toHaveLength(0);
    await act(async () => { close(); });

    const visibilityCalls = invocations('set_status_island_visibility');
    expect(visibilityCalls[visibilityCalls.length - 1]?.[1]).toEqual({ visible: false });
  });

  it('lets native finish the collapse animation before hiding notification-only mode', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T14:18:00'));
    let close: (event: { payload: { hideAfterCollapse: boolean } }) => void = () => undefined;
    let invalidate: () => void = () => undefined;
    listenMock.mockImplementation((name: string, callback: () => void) => {
      if (name === 'status-island-details-close') close = callback as typeof close;
      if (name === 'status-island-invalidated') invalidate = callback;
      return Promise.resolve(() => undefined);
    });
    let data = snapshotWith({ events: [reminderEvent], notificationMode: 'notification' });
    invokeMock.mockImplementation((command: string) =>
      command === 'get_status_island_snapshot' ? Promise.resolve(data) : Promise.resolve(null));
    render(<StatusIslandApp />);
    await act(async () => { await Promise.resolve(); });
    invokeMock.mockClear();

    await act(async () => {
      close({ payload: { hideAfterCollapse: true } });
      data = snapshotWith({
        ...data,
        reminders: [{
          identity: 'event:event-1:2026-09-12T14:30:reminder:15',
          acknowledgedAt: null,
          dismissed: true,
          consumed: false
        }]
      });
      invalidate();
    });

    expect(invokeMock).not.toHaveBeenCalledWith('set_status_island_visibility', { visible: false });
  });

  it('releases the native hide hold after the collapse window has elapsed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T14:18:00'));
    let close: (event: { payload: { hideAfterCollapse: boolean } }) => void = () => undefined;
    let invalidate: () => void = () => undefined;
    listenMock.mockImplementation((name: string, callback: () => void) => {
      if (name === 'status-island-details-close') close = callback as typeof close;
      if (name === 'status-island-invalidated') invalidate = callback;
      return Promise.resolve(() => undefined);
    });
    let data = snapshotWith({ events: [reminderEvent], notificationMode: 'notification' });
    invokeMock.mockImplementation((command: string) =>
      command === 'get_status_island_snapshot' ? Promise.resolve(data) : Promise.resolve(null));
    render(<StatusIslandApp />);
    await act(async () => { await Promise.resolve(); });
    invokeMock.mockClear();

    await act(async () => {
      close({ payload: { hideAfterCollapse: true } });
      data = snapshotWith({ events: [], notificationMode: 'notification' });
      invalidate();
    });
    expect(invokeMock).not.toHaveBeenCalledWith('set_status_island_visibility', { visible: false });

    await act(async () => { vi.advanceTimersByTime(220); });
    expect(invokeMock).not.toHaveBeenCalledWith('set_status_island_visibility', { visible: false });
    await act(async () => { vi.advanceTimersByTime(80); });
    expect(invokeMock).toHaveBeenCalledWith('set_status_island_visibility', { visible: false });
  });

  it('orders a new-notification show after an already in-flight empty hide', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T14:18:00'));
    let invalidate: () => void = () => undefined;
    listenMock.mockImplementation((name: string, callback: () => void) => {
      if (name === 'status-island-invalidated') invalidate = callback;
      return Promise.resolve(() => undefined);
    });
    let releaseHide: () => void = () => undefined;
    const hidePending = new Promise<void>(resolve => { releaseHide = resolve; });
    let data = snapshotWith({ events: [], notificationMode: 'notification' });
    invokeMock.mockImplementation((command: string, args?: unknown) => {
      if (command === 'get_status_island_snapshot') return Promise.resolve(data);
      if (command === 'set_status_island_visibility' && args && (args as { visible: boolean }).visible === false) {
        return hidePending;
      }
      return Promise.resolve(null);
    });
    render(<StatusIslandApp />);
    await act(async () => { await Promise.resolve(); });
    expect(invokeMock).toHaveBeenCalledWith('set_status_island_visibility', { visible: false });

    invokeMock.mockClear();
    data = snapshotWith({ events: [reminderEvent], notificationMode: 'notification' });
    await act(async () => { invalidate(); });
    expect(invokeMock).not.toHaveBeenCalledWith('set_status_island_visibility', { visible: true });

    await act(async () => {
      releaseHide();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(invokeMock).toHaveBeenLastCalledWith('set_status_island_visibility', { visible: true });
  });

  it('shows the summary after an outside-click collapse until the notification batch changes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T14:18:00'));
    let open: (event: { payload: { source: 'island'; identity: string | null; hovered: boolean } }) => void = () => undefined;
    let close: (event: { payload: { collapseToSummary: boolean } }) => void = () => undefined;
    let invalidate: () => void = () => undefined;
    listenMock.mockImplementation((name: string, callback: () => void) => {
      if (name === 'status-island-details-open') open = callback as typeof open;
      if (name === 'status-island-details-close') close = callback as typeof close;
      if (name === 'status-island-invalidated') invalidate = callback;
      return Promise.resolve(() => undefined);
    });
    let data = snapshotWith({ events: [reminderEvent], notificationMode: 'persistent' });
    invokeMock.mockImplementation((command: string) =>
      command === 'get_status_island_snapshot' ? Promise.resolve(data) : Promise.resolve(null));
    render(<StatusIslandApp />);
    await act(async () => { await Promise.resolve(); });

    await act(async () => close({ payload: { collapseToSummary: true } }));
    expect(screen.getByText(/今日汇总/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^产品评审 ·/ })).not.toBeInTheDocument();

    await act(async () => open({
      payload: {
        source: 'island',
        identity: 'event:event-1:2026-09-12T14:30:reminder:15',
        hovered: true
      }
    }));
    expect(document.querySelector('.status-rail')).toHaveAttribute('data-mode', 'summary');
    expect(document.querySelector('.status-island__details')).toHaveAttribute('data-panel', 'overview');

    data = snapshotWith({ events: [reminderEvent, secondReminderEvent], notificationMode: 'persistent' });
    await act(async () => invalidate());
    expect(document.querySelector('.status-rail')).toHaveAttribute('data-mode', 'detail');
  });

  it('keeps a persistent summary and its overview aligned when native sends a stale reminder identity', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T14:18:00'));
    let open: (event: { payload: { source: 'island'; identity: string | null; hovered: boolean } }) => void = () => undefined;
    listenMock.mockImplementation((name: string, callback: () => void) => {
      if (name === 'status-island-details-open') open = callback as typeof open;
      return Promise.resolve(() => undefined);
    });
    respondWith(snapshotWith({
      events: [reminderEvent],
      notificationMode: 'persistent',
      reminders: [{
        identity: 'event:event-1:2026-09-12T14:30:reminder:15',
        acknowledgedAt: null,
        dismissed: true,
        consumed: false
      }]
    }));
    render(<StatusIslandApp />);
    await act(async () => { await Promise.resolve(); });
    expect(document.querySelector('.status-rail')).toHaveAttribute('data-mode', 'summary');

    await act(async () => open({
      payload: {
        source: 'island',
        identity: 'event:event-1:2026-09-12T14:30:reminder:15',
        hovered: true
      }
    }));

    expect(document.querySelector('.status-rail')).toHaveAttribute('data-mode', 'summary');
    expect(document.querySelector('.status-island__details')).toHaveAttribute('data-panel', 'overview');
  });

  it('does not hide a notification-only reminder after hover preview', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T14:18:00'));
    respondWith(snapshotWith({ events: [reminderEvent], notificationMode: 'notification' }));
    render(<StatusIslandApp />);
    await act(async () => { await Promise.resolve(); });
    const root = document.querySelector('.screen-status-island-root') as HTMLElement;

    fireEvent.mouseEnter(root);
    fireEvent.mouseLeave(root);
    await act(async () => { vi.advanceTimersByTime(300); });

    expect(invokeMock).not.toHaveBeenCalledWith('set_status_island_visibility', { visible: false });
  });

  it('keeps the island visible when the pointer comes back, and always in persistent mode', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T14:18:00'));
    respondWith(snapshotWith({ events: [reminderEvent], notificationMode: 'notification' }));
    const { unmount } = render(<StatusIslandApp />);
    await act(async () => { await Promise.resolve(); });
    const root = document.querySelector('.screen-status-island-root') as HTMLElement;

    fireEvent.mouseEnter(root);
    fireEvent.mouseLeave(root);
    fireEvent.mouseEnter(root);
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(invokeMock).not.toHaveBeenCalledWith('set_status_island_visibility', { visible: false });

    unmount();
    invokeMock.mockClear();
    respondWith(snapshotWith({ events: [reminderEvent], notificationMode: 'persistent' }));
    render(<StatusIslandApp />);
    await act(async () => { await Promise.resolve(); });
    const persistentRoot = document.querySelector('.screen-status-island-root') as HTMLElement;

    fireEvent.mouseEnter(persistentRoot);
    fireEvent.mouseLeave(persistentRoot);
    await act(async () => { vi.advanceTimersByTime(300); });

    // Persistent means the rail stays on screen; only the sheet may collapse.
    expect(invokeMock).not.toHaveBeenCalledWith('set_status_island_visibility', { visible: false });
  });

  it('keeps an existing unseen reminder visible when switching to notification-only', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T14:18:00'));
    let invalidate: () => void = () => undefined;
    listenMock.mockImplementation((name: string, callback: () => void) => {
      if (name === 'status-island-invalidated') invalidate = callback;
      return Promise.resolve(() => undefined);
    });
    let data = snapshotWith({ events: [reminderEvent], notificationMode: 'persistent' });
    invokeMock.mockImplementation((command: string) =>
      command === 'get_status_island_snapshot' ? Promise.resolve(data) : Promise.resolve(null));
    render(<StatusIslandApp />);
    await act(async () => { await Promise.resolve(); });
    invokeMock.mockClear();

    data = snapshotWith({ events: [reminderEvent], notificationMode: 'notification' });
    await act(async () => invalidate());

    expect(invocations('set_status_island_visibility')[0]?.[1]).toEqual({ visible: true });
  });

  it('opens the panel on click and reports keyboard presence on focus', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T14:18:00'));
    respondWith(snapshotWith({ events: [reminderEvent] }));
    render(<StatusIslandApp />);
    await act(async () => { await Promise.resolve(); });
    const trigger = screen.getByRole('button', { name: /^产品评审 ·/ });

    fireEvent.click(trigger);
    expect(invocations('toggle_status_island_details')).toHaveLength(1);
    expect(invokeMock).toHaveBeenCalledWith('toggle_status_island_details', {
      identity: 'event:event-1:2026-09-12T14:30:reminder:15'
    });

    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(invocations('toggle_status_island_details')).toHaveLength(2);

    fireEvent.focus(trigger);
    expect(invokeMock).toHaveBeenCalledWith('set_status_island_presence', { surface: 'keyboard', present: true });
    fireEvent.blur(trigger);
    expect(invokeMock).toHaveBeenCalledWith('set_status_island_presence', { surface: 'keyboard', present: false });
  });

  it('routes dismissal to native for the current stage only', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T14:18:00'));
    respondWith(snapshotWith({ events: [reminderEvent], tasks: [urgentTask] }));
    render(<StatusIslandApp />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole('button', { name: '暂时隐藏：产品评审' }));

    expect(invokeMock).toHaveBeenCalledWith('dismiss_status_island_reminder', {
      identity: 'event:event-1:2026-09-12T14:30:reminder:15'
    });
    expect(invocations('toggle_status_island_details')).toHaveLength(0);
  });

  // Parking the surface. A press that is held becomes a move; a press that is not
  // stays a click, because the same pixels carry both.
  it('parks the island along the top edge after a long press and reports x travel only', async () => {
    // Frames too: the drag coalesces its native calls to one per frame.
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date',
        'requestAnimationFrame', 'cancelAnimationFrame']
    });
    vi.setSystemTime(new Date('2026-09-12T14:18:00'));
    respondWithDraggable(snapshotWith({ events: [reminderEvent] }));
    render(<StatusIslandApp />);
    await act(async () => { await Promise.resolve(); });
    const trigger = screen.getByRole('button', { name: /^产品评审 ·/ });

    fireEvent.pointerDown(trigger, { button: 0, pointerId: 1, screenX: 900, screenY: 10 });
    // Nothing moves until the press has been held: a plain drag would fire on
    // every stray click-and-swipe across the surface.
    await act(async () => { vi.advanceTimersByTime(200); });
    fireEvent.pointerMove(window, { pointerId: 1, screenX: 960, screenY: 10 });
    expect(invocations('begin_status_island_drag')).toHaveLength(0);
    expect(invocations('drag_status_island')).toHaveLength(0);

    await act(async () => { vi.advanceTimersByTime(200); });
    expect(invocations('begin_status_island_drag')).toHaveLength(1);
    // The pointer travelled during the hold, so the drag re-anchors to where it
    // is now instead of jumping the surface by that travel.
    expect(trigger.closest('.status-island')).toHaveAttribute('data-dragging', 'true');

    fireEvent.pointerMove(window, { pointerId: 1, screenX: 1010, screenY: 40 });
    fireEvent.pointerMove(window, { pointerId: 1, screenX: 1040, screenY: 10 });
    // A pointer reports far faster than the window can be redrawn, and each
    // report would be a native window move on the main thread. Only the latest
    // position is carried, once per frame.
    expect(invocations('drag_status_island')).toHaveLength(0);
    await act(async () => { vi.advanceTimersToNextFrame(); });
    expect(invocations('drag_status_island')).toHaveLength(1);
    // Total travel since the drag started, x only: the surface belongs to the top
    // edge, so the 30px of y movement is not carried.
    expect(invokeMock).toHaveBeenLastCalledWith('drag_status_island', { deltaX: 80 });

    fireEvent.pointerUp(window, { pointerId: 1, screenX: 1040, screenY: 10 });
    expect(invocations('end_status_island_drag')).toHaveLength(1);
    expect(trigger.closest('.status-island')).not.toHaveAttribute('data-dragging');

    // Releasing over the island still fires a click. That click ended the move;
    // it is not a request to open the panel.
    fireEvent.click(trigger);
    expect(invocations('toggle_status_island_details')).toHaveLength(0);

    // The next real click opens it again.
    fireEvent.click(trigger);
    expect(invocations('toggle_status_island_details')).toHaveLength(1);
  });

  it('leaves a short press as a click and never starts a drag', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T14:18:00'));
    respondWithDraggable(snapshotWith({ events: [reminderEvent] }));
    render(<StatusIslandApp />);
    await act(async () => { await Promise.resolve(); });
    const trigger = screen.getByRole('button', { name: /^产品评审 ·/ });

    fireEvent.pointerDown(trigger, { button: 0, pointerId: 1, screenX: 900, screenY: 10 });
    await act(async () => { vi.advanceTimersByTime(120); });
    fireEvent.pointerUp(window, { pointerId: 1, screenX: 903, screenY: 10 });
    fireEvent.click(trigger);

    expect(invocations('begin_status_island_drag')).toHaveLength(0);
    expect(invocations('drag_status_island')).toHaveLength(0);
    expect(invocations('end_status_island_drag')).toHaveLength(0);
    expect(invocations('toggle_status_island_details')).toHaveLength(1);

    // The hold cannot fire after the release either.
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(invocations('begin_status_island_drag')).toHaveLength(0);
  });

  it('moves the island with the arrow keys, so parking it is not pointer-only', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T14:18:00'));
    respondWithDraggable(snapshotWith({ events: [reminderEvent] }));
    render(<StatusIslandApp />);
    await act(async () => { await Promise.resolve(); });
    const trigger = screen.getByRole('button', { name: /^产品评审 ·/ });

    await act(async () => { fireEvent.keyDown(trigger, { key: 'ArrowRight' }); });
    expect(invokeMock).toHaveBeenCalledWith('drag_status_island', { deltaX: 24 });

    await act(async () => { fireEvent.keyDown(trigger, { key: 'ArrowLeft' }); });
    expect(invokeMock).toHaveBeenCalledWith('drag_status_island', { deltaX: -24 });

    // Each nudge is a complete move, so the position is persisted rather than
    // left open as an unfinished drag.
    expect(invocations('end_status_island_drag')).toHaveLength(2);
    // Moving is not opening.
    expect(invocations('toggle_status_island_details')).toHaveLength(0);

    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(invocations('toggle_status_island_details')).toHaveLength(1);
  });

  it('never leaves native holding a drag when the surface goes away mid-press', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T14:18:00'));
    respondWithDraggable(snapshotWith({ events: [reminderEvent] }));
    const view = render(<StatusIslandApp />);
    await act(async () => { await Promise.resolve(); });
    const trigger = screen.getByRole('button', { name: /^产品评审 ·/ });

    fireEvent.pointerDown(trigger, { button: 0, pointerId: 1, screenX: 900, screenY: 10 });
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(invocations('begin_status_island_drag')).toHaveLength(1);

    // A drag left open natively refuses every hover-open from then on, so an
    // unmount has to close it.
    view.unmount();

    expect(invocations('end_status_island_drag')).toHaveLength(1);
  });

  it('shows the next queued reminder once native reports the current one dismissed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T14:18:00'));
    respondWith(snapshotWith({
      events: [reminderEvent],
      tasks: [urgentTask],
      reminders: [{
        identity: 'event:event-1:2026-09-12T14:30:reminder:15',
        acknowledgedAt: null,
        dismissed: true,
        consumed: false
      }]
    }));
    render(<StatusIslandApp />);
    await act(async () => { await Promise.resolve(); });

    expect(screen.queryByRole('button', { name: /^产品评审 ·/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^发布检查 ·/ })).toBeInTheDocument();
  });

  it('falls back to the summary once the user closes the detail', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T14:18:00'));
    respondWith(snapshotWith({
      events: [reminderEvent],
      reminders: [{
        identity: 'event:event-1:2026-09-12T14:30:reminder:15',
        acknowledgedAt: '2026-09-12T14:17:40+08:00',
        dismissed: true,
        consumed: false
      }]
    }));
    render(<StatusIslandApp />);
    await act(async () => { await Promise.resolve(); });

    expect(screen.queryByRole('button', { name: /^产品评审 ·/ })).not.toBeInTheDocument();
    // The event still exists, so the capsule keeps reporting the aggregate. It
    // must not drop to the idle copy.
    expect(document.querySelector('.status-rail')).toHaveAttribute('data-mode', 'summary');
    expect(screen.getByText('临近 1 项')).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith('set_status_island_primary', { identity: null });
  });

  it('drops a consumed focus completion but keeps an unseen one', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T15:00:00'));
    const completedFocus = {
      status: 'completed' as const,
      remainingSeconds: 0,
      plannedSeconds: 1500,
      sessionId: 'session-1',
      stageSequence: 2,
      stageChangedAt: '2026-09-12T14:30:00+08:00'
    };
    respondWith(snapshotWith({ sampledAt: '2026-09-12T15:00:00', focus: completedFocus }));
    const unseen = render(<StatusIslandApp />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole('button', { name: /专注完成/ })).toBeInTheDocument();
    unseen.unmount();

    respondWith(snapshotWith({
      sampledAt: '2026-09-12T15:00:00',
      focus: completedFocus,
      reminders: [{ identity: 'focus:session-1:completed:2', acknowledgedAt: null, dismissed: false, consumed: true }]
    }));
    render(<StatusIslandApp />);
    await act(async () => { await Promise.resolve(); });

    expect(screen.queryByRole('button', { name: /专注完成/ })).not.toBeInTheDocument();
  });

  it('ticks a native running focus snapshot every second', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T09:30:00'));
    respondWith(snapshotWith({
      sampledAt: '2026-09-12T09:30:00',
      focus: {
        status: 'running', remainingSeconds: 90, plannedSeconds: 1500,
        sessionId: 'focus-1', stageSequence: 1, stageChangedAt: '2026-09-12T09:00:00+08:00'
      }
    }));
    render(<StatusIslandApp />);
    await act(async () => { await Promise.resolve(); });

    // A running session the user started themselves counts as seen immediately,
    // and nothing collapses on a timer, so it stays on the island while it runs.
    // The countdown is still exposed as progress, wherever it is rendered.
    const progress = screen.getByRole('progressbar', { name: '专注进度' });
    expect(progress).toHaveAttribute('aria-valuenow', '90');
    expect(progress).toHaveAttribute('aria-valuetext', '专注进行中，剩余 2 分钟');

    // Advancing past the 30s snapshot refresh interval means the resulting
    // promise has to settle inside act.
    await act(async () => { vi.advanceTimersByTime(31_000); });

    expect(screen.getByRole('progressbar', { name: '专注进度' })).toHaveAttribute('aria-valuenow', '59');
  });
  it('refreshes on invalidation and keeps the last snapshot when refresh fails', async () => {
    let invalidate: () => void = () => undefined;
    listenMock.mockImplementation((name: string, callback: () => void) => {
      if (name === 'status-island-invalidated') invalidate = callback;
      return Promise.resolve(() => undefined);
    });
    const start = new Date(Date.now() + 10 * 60_000);
    const end = new Date(start.getTime() + 60 * 60_000);
    const liveEvent = { ...reminderEvent, startAt: localMinute(start), endAt: localMinute(end) };
    let snapshotRequests = 0;
    invokeMock.mockImplementation((command: string) => {
      if (command !== 'get_status_island_snapshot') return Promise.resolve(null);
      snapshotRequests += 1;
      return snapshotRequests === 1
        ? Promise.resolve(snapshotWith({ sampledAt: new Date().toISOString(), events: [liveEvent] }))
        : Promise.reject(new Error('offline'));
    });
    render(<StatusIslandApp />);

    expect(await screen.findByRole('button', { name: /^产品评审 ·/ })).toBeInTheDocument();

    await act(async () => invalidate());

    const retry = await screen.findByRole('button', { name: '状态读取失败，重试' });
    expect(retry).not.toHaveTextContent('状态读取失败');
    expect(retry.querySelector('svg')).toBeInTheDocument();
    // A failed refresh keeps the last good snapshot instead of clearing the island.
    expect(screen.getByRole('button', { name: /^产品评审 ·/ })).toBeInTheDocument();
  });

  it('ignores an older snapshot that resolves after a newer refresh', async () => {
    let invalidate: () => void = () => undefined;
    listenMock.mockImplementation((name: string, callback: () => void) => {
      if (name === 'status-island-invalidated') invalidate = callback;
      return Promise.resolve(() => undefined);
    });
    const pending: Array<(value: NativeStatusIslandSnapshot) => void> = [];
    invokeMock.mockImplementation((command: string) => command === 'get_status_island_snapshot'
      ? new Promise<NativeStatusIslandSnapshot>(resolve => pending.push(resolve))
      : Promise.resolve(null));
    render(<StatusIslandApp />);
    await waitFor(() => expect(pending).toHaveLength(1));
    act(() => invalidate());
    await waitFor(() => expect(pending).toHaveLength(2));
    const latest = snapshotWith({ tasks: [{ ...urgentTask, title: '最新关键任务' }] });

    await act(async () => pending[1](latest));
    expect(screen.getByRole('button', { name: /^最新关键任务 ·/ })).toBeInTheDocument();

    await act(async () => pending[0](snapshot));

    expect(screen.getByRole('button', { name: /^最新关键任务 ·/ })).toBeInTheDocument();
  });

  it('survives a snapshot without the native reminder fields', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T14:18:00'));
    // Corrupt or unavailable native storage degrades to no reminder state at all.
    const degraded = { ...snapshotWith({ events: [reminderEvent] }) } as NativeStatusIslandSnapshot;
    delete degraded.reminders;
    respondWith(degraded);
    render(<StatusIslandApp />);
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByRole('button', { name: /^产品评审 ·/ })).toBeInTheDocument();
  });

  it('ranks an overdue urgent task ahead of an undated one', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T14:18:00'));
    respondWith(snapshotWith({ tasks: [undatedTask, overdueTask] }));
    render(<StatusIslandApp />);
    await act(async () => { await Promise.resolve(); });

    // Both are important+urgent, so the tie used to fall to the uuid in the
    // identity and could surface the undated task first.
    expect(screen.getByRole('button', { name: /^完善 Nowly ·/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^文件测试 ·/ })).not.toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith('set_status_island_primary', { identity: overdueIdentity });
  });

  it('keeps a closed reminder closed and lets the next one take the island', async () => {
    // The reported defect, end to end. The overdue task was seen and collapsed, so
    // the island moved on to the undated one. Hovering that one used to flip the
    // collapsed task back into the queue, where it retook the head because it is
    // overdue — the island and the panel both jumped to a task the user had already
    // dismissed from view. There is no hold and no timer now: only the user closes
    // a notification, and it stays closed.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T14:18:00'));
    respondWith(snapshotWith({
      tasks: [undatedTask, overdueTask],
      reminders: [{
        identity: overdueIdentity,
        acknowledgedAt: '2026-09-12T14:00:00+08:00',
        dismissed: true,
        consumed: false
      }]
    }));
    render(<StatusIslandApp />);
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByRole('button', { name: /^文件测试 ·/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^完善 Nowly ·/ })).not.toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith('set_status_island_primary', { identity: undatedIdentity });
  });

  it('keeps a reminder collapsed by an older build collapsed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T14:18:00'));
    respondWith(snapshotWith({
      tasks: [overdueTask],
      reminders: [{
        identity: overdueIdentity,
        acknowledgedAt: '2026-09-12T14:00:00+08:00',
        // Written by a build that collapsed on a timer. Upgrading must not replay it.
        hidden: true,
        dismissed: false,
        consumed: false
      }]
    }));
    render(<StatusIslandApp />);
    await act(async () => { await Promise.resolve(); });

    expect(screen.queryByRole('button', { name: /^完善 Nowly ·/ })).not.toBeInTheDocument();
    expect(screen.getByText('紧急 1 项')).toBeInTheDocument();
  });
});

describe('sheet pinning', () => {
  // Every test here pins the clock, because a task reminder identity embeds the
  // local date. Without restoring real timers the next describe block's
  // `findBy*`/`waitFor` polling would hang.
  afterEach(() => vi.useRealTimers());

  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();
    listenMock.mockResolvedValue(() => undefined);
    respondWith(snapshot);
  });

  type OpenPayload = { source: 'island' | 'nowly'; identity: string | null };

  function openWith(identity: string | null) {
    let open: (event: { payload: OpenPayload }) => void = () => undefined;
    listenMock.mockImplementation((name: string, callback: (event: { payload: OpenPayload }) => void) => {
      if (name === 'status-island-details-open') open = callback;
      return Promise.resolve(() => undefined);
    });
    return () => act(async () => open({ payload: { source: 'island', identity } }));
  }

  it('keeps showing the reminder it was opened for after the queue head moves on', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T14:18:00'));
    // The sheet was opened for the undated task. The user has since closed that
    // reminder, so the queue head is now the overdue task. The open sheet must not
    // follow it.
    respondWith(snapshotWith({
      tasks: [undatedTask, overdueTask],
      reminders: [{
        identity: undatedIdentity,
        acknowledgedAt: '2026-09-12T14:17:00+08:00',
        dismissed: true,
        consumed: false
      }]
    }));
    const open = openWith(undatedIdentity);
    render(<StatusIslandApp />);
    await act(async () => { await Promise.resolve(); });
    await open();

    expect(document.querySelector('.status-rail')).toHaveAttribute('data-open', 'true');
    expect(document.querySelector('.status-rail__header .status-island__copy strong'))
      .toHaveTextContent('文件测试');
    expect(screen.getByRole('button', { name: '打开任务：文件测试' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '打开任务：完善 Nowly' })).not.toBeInTheDocument();
  });

  it('acts on the pinned task, never on whatever is now at the queue head', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T14:18:00'));
    respondWith(snapshotWith({
      tasks: [undatedTask, overdueTask],
      reminders: [{
        identity: undatedIdentity,
        acknowledgedAt: '2026-09-12T14:17:00+08:00',
        dismissed: true,
        consumed: false
      }]
    }));
    const open = openWith(undatedIdentity);
    render(<StatusIslandApp />);
    await act(async () => { await Promise.resolve(); });
    await open();

    fireEvent.click(screen.getByRole('button', { name: '完成任务' }));
    // `withActionHold` invokes synchronously before its first await, so the
    // command is already recorded here. `waitFor` would poll on frozen timers.
    await act(async () => { await Promise.resolve(); });

    // Completing the wrong task is destructive, so this is the assertion that
    // matters most about pinning.
    expect(invokeMock).toHaveBeenCalledWith('set_task_completed', {
      id: undatedTask.id,
      completed: true
    });
    expect(invokeMock).toHaveBeenCalledWith('close_status_island_details');
    expect(invokeMock).toHaveBeenCalledWith('dismiss_status_island_reminder', {
      identity: undatedIdentity
    });
    expect(invokeMock).not.toHaveBeenCalledWith('set_task_completed', {
      id: overdueTask.id,
      completed: true
    });
  });

  it('falls back to live context when opened without an identity', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T14:18:00'));
    respondWith(snapshotWith({ tasks: [undatedTask, overdueTask] }));
    const open = openWith(null);
    render(<StatusIslandApp />);
    await act(async () => { await Promise.resolve(); });
    await open();

    expect(screen.getByRole('button', { name: '打开任务：完善 Nowly' })).toBeInTheDocument();
  });

  it('falls back to live context when the pinned reminder no longer exists at all', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T14:18:00'));
    // The pinned task was completed elsewhere, so it is gone from the snapshot.
    respondWith(snapshotWith({ tasks: [overdueTask] }));
    const open = openWith(undatedIdentity);
    render(<StatusIslandApp />);
    await act(async () => { await Promise.resolve(); });
    await open();

    expect(screen.getByRole('button', { name: '打开任务：完善 Nowly' })).toBeInTheDocument();
  });

  it('retains outgoing detail during collapse, then releases it after native close', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T14:18:00'));
    let open: (event: { payload: OpenPayload }) => void = () => undefined;
    let close: (event: { payload: { generation: number } }) => void = () => undefined;
    listenMock.mockImplementation((name: string, callback: (event: { payload: OpenPayload }) => void) => {
      if (name === 'status-island-details-open') open = callback;
      if (name === 'status-island-details-close') close = callback as unknown as typeof close;
      return Promise.resolve(() => undefined);
    });
    respondWith(snapshotWith({ tasks: [undatedTask, overdueTask] }));
    render(<StatusIslandApp />);
    await act(async () => { await Promise.resolve(); });

    await act(async () => open({ payload: { source: 'island', identity: undatedIdentity } }));
    expect(screen.getByRole('button', { name: '打开任务：文件测试' })).toBeInTheDocument();

    await act(async () => close({ payload: { generation: 2 } }));

    // Shrinking, not unmounting: the sheet is the capsule, so closing it changes
    // the rail's size rather than taking the surface away.
    expect(document.querySelector('.status-rail')).toHaveAttribute('data-open', 'false');
    expect(document.querySelector('.status-rail__status-presence')).toHaveAttribute('data-anim', 'shrink');
    expect(screen.getByRole('button', { name: '打开任务：文件测试', hidden: true })).toBeInTheDocument();
    expect(document.querySelector('.status-rail__panel')).toHaveAttribute('inert');
    await emitPanelEvent('status-island-details-closed', { generation: 2 });
    expect(screen.getByRole('button', { name: '打开任务：完善 Nowly', hidden: true })).toBeInTheDocument();
  });
});

describe('the sheet inside the rail', () => {
  afterEach(() => vi.useRealTimers());
  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();
    listenMock.mockResolvedValue(() => undefined);
    respondWith(snapshot);
  });

  it('does not downgrade status reminders or start a status animation when AI closes', async () => {
    respondWith(snapshotWith({ tasks: [urgentTask] }));
    render(<StatusIslandApp />);
    await act(async () => { await Promise.resolve(); });
    expect(document.querySelector('.status-rail')).toHaveAttribute('data-mode', 'detail');
    await emitPanelEvent('status-island-details-open', { generation: 1, source: 'nowly', identity: null });
    expect(document.querySelector('.status-rail__sheet')).toHaveAttribute('inert');
    expect(document.querySelector('.status-rail__status-presence')).not.toHaveAttribute('data-anim');
    expect(document.querySelector('.status-rail__assistant')).toHaveAttribute('data-anim', 'grow');

    await emitPanelEvent('status-island-details-close', { generation: 2, collapseToSummary: true });
    expect(document.querySelector('.status-rail')).toHaveAttribute('data-mode', 'detail');
    expect(document.querySelector('.status-rail__status-presence')).not.toHaveAttribute('data-anim');
    expect(document.querySelector('.status-rail__assistant')).toHaveAttribute('data-anim', 'shrink');
    expect(document.querySelector('.status-rail__panel')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('button', { name: '完成任务' })).not.toBeInTheDocument();

    await emitPanelEvent('status-island-details-closed', { generation: 2 });
    expect(document.querySelector('.status-rail')).toHaveAttribute('data-mode', 'detail');
    expect(document.querySelector('.status-rail__assistant')).not.toHaveAttribute('data-anim');
  });

  it('switches native panel ownership without carrying the other panel animation or controls', async () => {
    render(<StatusIslandApp />);
    await emitPanelEvent('status-island-details-open', { generation: 1, source: 'nowly', identity: null });
    await emitPanelEvent('status-island-details-open', { generation: 2, source: 'island', identity: null });
    expect(document.querySelector('.status-rail__status-presence')).toHaveAttribute('data-anim', 'grow');
    expect(document.querySelector('.status-rail__assistant')).not.toHaveAttribute('data-anim');
    expect(document.querySelector('.status-rail__assistant')).toHaveAttribute('inert');
    expect(screen.queryByRole('textbox', { name: '告诉 Nowly 你想做什么' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '收起' })).toHaveAttribute('data-owner', 'status');
    await emitPanelEvent('status-island-details-close', { generation: 1 });
    expect(document.querySelector('.status-rail')).toHaveAttribute('data-status-open', 'true');
  });

  it('ignores status hover while the AI panel is opening', async () => {
    render(<StatusIslandApp />);
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getByRole('button', { name: 'Nowly' }));
    fireEvent.mouseEnter(document.querySelector('.status-island__trigger')!);
    expect(invocations('hover_status_island_details')).toHaveLength(0);
  });

  it('stays collapsed until native reports it open, and grows rather than appearing', async () => {
    let open: (event: { payload: { source: 'island' | 'nowly'; identity: string | null } }) => void = () => undefined;
    listenMock.mockImplementation((name: string, callback: (event: { payload: unknown }) => void) => {
      if (name === 'status-island-details-open') open = callback as typeof open;
      return Promise.resolve(() => undefined);
    });
    render(<StatusIslandApp />);
    await act(async () => { await Promise.resolve(); });
    const rail = document.querySelector('.status-rail')!;
    expect(rail).toHaveAttribute('data-open', 'false');
    // Nothing animates on mount: the rail must not grow itself into existence.
    expect(rail).not.toHaveAttribute('data-anim');

    await act(async () => open({ payload: { source: 'island', identity: null } }));

    expect(rail).toHaveAttribute('data-open', 'true');
    expect(document.querySelector('.status-rail__status-presence')).toHaveAttribute('data-anim', 'grow');
    expect(rail).toHaveAttribute('data-source', 'island');
  });

  it('collapses on Escape only while the sheet is open', async () => {
    let open: (event: { payload: { source: 'island' | 'nowly'; identity: string | null } }) => void = () => undefined;
    listenMock.mockImplementation((name: string, callback: (event: { payload: unknown }) => void) => {
      if (name === 'status-island-details-open') open = callback as typeof open;
      return Promise.resolve(() => undefined);
    });
    render(<StatusIslandApp />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(invocations('close_status_island_details')).toHaveLength(0);

    await act(async () => open({ payload: { source: 'island', identity: null } }));
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(invocations('close_status_island_details')).toHaveLength(1);
  });

  it('reports pointer presence so the hold survives the gap between the halves', async () => {
    render(<StatusIslandApp />);
    await act(async () => { await Promise.resolve(); });
    const root = document.querySelector('.screen-status-island-root')!;

    fireEvent.mouseEnter(root);
    expect(invokeMock).toHaveBeenCalledWith('set_status_island_presence', { surface: 'details', present: true });

    fireEvent.mouseLeave(root);
    expect(invokeMock).toHaveBeenCalledWith('set_status_island_presence', { surface: 'details', present: false });
  });

  it('holds the surface open for the duration of an action', async () => {
    respondWith(snapshotWith({ tasks: [urgentTask] }));
    render(<StatusIslandApp />);
    await emitPanelEvent('status-island-details-open', { source: 'island', identity: null });

    fireEvent.click(await screen.findByRole('button', { name: '完成任务' }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('set_task_completed', { id: 'task-1', completed: true }));
    expect(invokeMock).toHaveBeenCalledWith('set_status_island_presence', { surface: 'action', present: true });
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('set_status_island_presence', { surface: 'action', present: false }));
  });

  it('routes focus actions through native commands', async () => {
    render(<StatusIslandApp />);
    await emitPanelEvent('status-island-details-open', { source: 'island', identity: null });

    fireEvent.click(await screen.findByRole('button', { name: '开始专注' }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('start_status_island_focus', { minutes: 25 }));
  });

  it('opens an event by its occurrence identity', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T14:18:00'));
    respondWith(snapshotWith({
      events: [{ ...reminderEvent, occurrenceStartAt: '2026-09-12T14:00' }]
    }));
    render(<StatusIslandApp />);
    await act(async () => { await Promise.resolve(); });

    await emitPanelEvent('status-island-details-open', { source: 'island', identity: null });
    fireEvent.click(screen.getByRole('button', { name: '打开日程：产品评审' }));

    await act(async () => { await Promise.resolve(); });
    expect(invokeMock).toHaveBeenCalledWith('acknowledge_status_island_reminder', {
      identity: 'event:event-1:2026-09-12T14:00:reminder:15'
    });
    expect(invokeMock).toHaveBeenCalledWith('open_status_island_event', {
      target: { id: 'event-1', occurrenceStartAt: '2026-09-12T14:00' },
      startAt: '2026-09-12T14:30'
    });
    vi.useRealTimers();
  });

  it('reports a snapshot failure once, on the head that is visible at both sizes', async () => {
    invokeMock.mockImplementation((command: string) => command === 'get_status_island_snapshot'
      ? Promise.reject(new Error('offline'))
      : Promise.resolve(null));
    render(<StatusIslandApp />);

    const retry = await screen.findByRole('button', { name: '状态读取失败，重试' });

    // The sheet is hidden while collapsed, so a copy in its footer would be a
    // second report of the same failure that the user cannot see when it matters.
    expect(retry).toHaveClass('screen-status-island-error');
    expect(document.querySelector('.status-island__retry')).not.toBeInTheDocument();
  });

  it('opens the full assistant panel directly from the logo without a compact composer state', async () => {
    let openPanel: ((event: { payload: { generation: number; source: 'nowly'; identity: null; hovered: false } }) => void) | null = null;
    listenMock.mockImplementation((name: string, callback: typeof openPanel) => {
      if (name === 'status-island-details-open') openPanel = callback;
      return Promise.resolve(() => undefined);
    });
    invokeMock.mockImplementation((command: string) => {
      if (command === 'get_status_island_snapshot') return Promise.resolve(snapshot);
      if (command === 'assistant_get_config') return Promise.resolve({
        endpoint: 'https://example.com/v1',
        model: 'fixture-model',
        hasKey: true,
        permissions: { calendar: true, tasks: true, external: false }
      });
      return Promise.resolve(null);
    });
    render(<StatusIslandApp />);
    await act(async () => { await Promise.resolve(); });

    const nowly = screen.getByRole('button', { name: 'Nowly' });
    fireEvent.click(nowly);

    expect(invocations('toggle_nowly_panel')).toHaveLength(1);
    expect(document.querySelector('.status-rail')).toHaveAttribute('data-surface', 'status');
    expect(screen.queryByRole('textbox', { name: '告诉 Nowly 你想做什么' })).not.toBeInTheDocument();

    await act(async () => openPanel?.({ payload: { generation: 7, source: 'nowly', identity: null, hovered: false } }));

    const input = await screen.findByRole('textbox', { name: '告诉 Nowly 你想做什么' });
    await waitFor(() => expect(input).toHaveFocus());
    expect(nowly).toHaveAttribute('aria-expanded', 'true');
    expect(nowly).toHaveAttribute('aria-hidden', 'true');
    expect(document.querySelector('.status-rail')).toHaveAttribute('data-surface', 'assistant');
    expect(document.querySelector('.status-rail__assistant')).toHaveAttribute('data-anim', 'grow');
    expect(document.querySelector('.status-rail')).toHaveAttribute('data-open', 'true');
    expect(document.querySelector('.assistant-panel')).toHaveAttribute('data-open', 'true');
    expect(document.querySelector('.status-rail')).not.toHaveAttribute('data-surface', 'composer');
  });

  it('submits from the already-open Nowly sheet and shows the user message while waiting', async () => {
    let openPanel: ((event: { payload: { generation: number; source: 'nowly'; identity: null; hovered: false } }) => void) | null = null;
    let closePanel: ((event: { payload: { generation: number; hideAfterCollapse: false; collapseToSummary: false } }) => void) | null = null;
    let finishClose: ((event: { payload: { generation: number } }) => void) | null = null;
    listenMock.mockImplementation((name: string, callback: typeof openPanel | typeof closePanel | typeof finishClose) => {
      if (name === 'status-island-details-open') openPanel = callback as typeof openPanel;
      if (name === 'status-island-details-close') closePanel = callback as typeof closePanel;
      if (name === 'status-island-details-closed') finishClose = callback as typeof finishClose;
      return Promise.resolve(() => undefined);
    });
    let resolveInterpret!: (value: unknown) => void;
    invokeMock.mockImplementation((command: string) => {
      if (command === 'get_status_island_snapshot') return Promise.resolve(snapshot);
      if (command === 'assistant_get_config') return Promise.resolve({
        endpoint: 'https://example.com/v1',
        model: 'fixture-model',
        hasKey: true,
        permissions: { calendar: true, tasks: true, external: false }
      });
      if (command === 'assistant_interpret') return new Promise(resolve => { resolveInterpret = resolve; });
      return Promise.resolve(null);
    });
    render(<StatusIslandApp />);
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getByRole('button', { name: 'Nowly' }));
    expect(invokeMock).toHaveBeenCalledWith('toggle_nowly_panel');
    await act(async () => openPanel?.({ payload: { generation: 7, source: 'nowly', identity: null, hovered: false } }));
    const input = await screen.findByRole('textbox', { name: '告诉 Nowly 你想做什么' });
    await waitFor(() => expect(input).toHaveFocus());

    fireEvent.change(input, { target: { value: '明天下午三点创建产品评审' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(document.querySelector('.status-rail')).toHaveAttribute('data-surface', 'assistant');
    expect(document.querySelector('.status-rail')).toHaveAttribute('data-open', 'true');
    expect(screen.getByText('明天下午三点创建产品评审', { selector: '.assistant-chat-message p' })).toBeInTheDocument();
    expect(screen.getByText('正在理解与查询…尚未执行任何变更。')).toBeInTheDocument();

    await act(async () => closePanel?.({ payload: { generation: 6, hideAfterCollapse: false, collapseToSummary: false } }));
    expect(document.querySelector('.status-rail')).toHaveAttribute('data-surface', 'assistant');
    expect(document.querySelector('.status-rail')).toHaveAttribute('data-open', 'true');

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(invocations('close_status_island_details')).toHaveLength(1);
    await act(async () => closePanel?.({ payload: { generation: 8, hideAfterCollapse: false, collapseToSummary: false } }));
    expect(document.querySelector('.status-rail')).toHaveAttribute('data-assistant-closing', 'true');
    expect(document.querySelector('.status-rail')).toHaveAttribute('data-surface', 'status');
    fireEvent(window, new Event('resize'));
    expect(document.querySelector('.status-rail')).toHaveAttribute('data-assistant-closing', 'true');
    await act(async () => finishClose?.({ payload: { generation: 7 } }));
    expect(document.querySelector('.status-rail')).toHaveAttribute('data-assistant-closing', 'true');
    await act(async () => finishClose?.({ payload: { generation: 8 } }));
    expect(document.querySelector('.status-rail')).toHaveAttribute('data-assistant-closing', 'false');

    await act(async () => resolveInterpret({ kind: 'clarify', message: '需要提醒吗？', records: [], plan: null }));
  });
});
