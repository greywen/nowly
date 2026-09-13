import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StatusIslandApp } from './StatusIslandApp';
import { StatusIslandDetailsApp } from './StatusIslandDetailsApp';
import type { NativeStatusIslandSnapshot } from './useStatusIslandSnapshot';

const invokeMock = vi.hoisted(() => vi.fn());
const listenMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }));

const snapshot: NativeStatusIslandSnapshot = {
  sampledAt: '2026-09-12T14:18',
  events: [],
  externalEvents: [],
  tasks: [],
  focus: { status: 'idle', remainingSeconds: 0, sessionId: null }
};

function localMinute(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

describe('screen status island windows', () => {
  afterEach(() => vi.useRealTimers());

  beforeEach(() => {
    localStorage.clear();
    invokeMock.mockReset();
    listenMock.mockReset();
    listenMock.mockResolvedValue(() => undefined);
    invokeMock.mockImplementation((command: string) => {
      if (command === 'get_status_island_snapshot') return Promise.resolve(snapshot);
      return Promise.resolve(null);
    });
  });

  it('shows the Home Indicator and opens the quick panel when there is no prompt', async () => {
    render(<StatusIslandApp />);

    const trigger = await screen.findByRole('button', { name: '打开 AI 快捷面板' });
    fireEvent.click(trigger);

    expect(invokeMock).toHaveBeenCalledWith('set_top_surface_expanded', { expanded: false });
    expect(invokeMock).toHaveBeenCalledWith('open_quick_panel');
  });

  it('dismisses the current event instance and reveals the next prompt', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T14:18:00'));
    invokeMock.mockResolvedValueOnce({
      ...snapshot,
      events: [{
        id: 'event-1', title: '产品评审', startAt: '2026-09-12T14:30', endAt: '2026-09-12T15:30', allDay: false,
        category: 'work', color: '#4FC9DA', note: '', reminders: [15], createdAt: 'x', updatedAt: 'x', recurrence: null,
        startTz: null, endTz: null, rrule: null, seriesId: null, seriesStartAt: null, occurrenceStartAt: null,
        isOverridden: false, subscriptionId: null
      }],
      tasks: [{
        id: 'task-1', title: '发布检查', description: '', priority: 'important_urgent' as const,
        dueDate: '2026-09-12', completed: false, laneId: 'todo', boardPosition: 0,
        tagIds: [], collaboratorIds: [], views: ['matrix' as const], createdAt: 'x', updatedAt: 'x'
      }]
    });
    render(<StatusIslandApp />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole('button', { name: '暂时隐藏：产品评审' }));

    expect(screen.getByRole('button', { name: /^发布检查 ·/ })).toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalledWith('toggle_status_island_details');
  });

  it('keeps a dismissed event stage hidden after the status window restarts', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T14:18:00'));
    const eventSnapshot = {
      ...snapshot,
      events: [{
        id: 'event-1', title: '产品评审', startAt: '2026-09-12T14:30', endAt: '2026-09-12T15:30', allDay: false,
        category: 'work' as const, color: '#4FC9DA' as const, note: '', reminders: [15], createdAt: 'x', updatedAt: 'x', recurrence: null,
        startTz: null, endTz: null, rrule: null, seriesId: null, seriesStartAt: null, occurrenceStartAt: null,
        isOverridden: false, subscriptionId: null
      }]
    };
    invokeMock.mockImplementation((command: string) => command === 'get_status_island_snapshot'
      ? Promise.resolve(eventSnapshot)
      : Promise.resolve(null));
    const firstWindow = render(<StatusIslandApp />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole('button', { name: '暂时隐藏：产品评审' }));
    expect(screen.getByRole('button', { name: '打开 AI 快捷面板' })).toBeInTheDocument();
    firstWindow.unmount();
    render(<StatusIslandApp />);
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByRole('button', { name: '打开 AI 快捷面板' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^产品评审 ·/ })).not.toBeInTheDocument();
  });

  it('keeps a dismissed external event hidden after startup sync replaces its cache id', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T14:18:00'));
    let cacheId = 'cache-row-1';
    invokeMock.mockImplementation((command: string) => command === 'get_status_island_snapshot'
      ? Promise.resolve({
          ...snapshot,
          externalEvents: [{
            id: cacheId, subscriptionId: 'calendar-1', remoteEventId: 'remote-event-1', provider: 'google' as const,
            writable: true, title: '外部评审', startAt: '2026-09-12T14:30', endAt: '2026-09-12T15:30',
            startTz: null, endTz: null, allDay: false, location: null, description: null,
            color: '#4FC9DA' as const, reminders: [15]
          }]
        })
      : Promise.resolve(null));
    const firstWindow = render(<StatusIslandApp />);
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getByRole('button', { name: '暂时隐藏：外部评审' }));
    firstWindow.unmount();

    cacheId = 'cache-row-2';
    render(<StatusIslandApp />);
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByRole('button', { name: '打开 AI 快捷面板' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^外部评审 ·/ })).not.toBeInTheDocument();
  });

  it('keeps a dismissed task hidden after the status window restarts', async () => {
    const taskSnapshot = {
      ...snapshot,
      tasks: [{
        id: 'task-1', title: '发布检查', description: '', priority: 'important_urgent' as const,
        dueDate: '2026-09-12', completed: false, laneId: 'todo', boardPosition: 0,
        tagIds: [], collaboratorIds: [], views: ['matrix' as const], createdAt: 'x', updatedAt: 'x'
      }]
    };
    invokeMock.mockImplementation((command: string) => command === 'get_status_island_snapshot'
      ? Promise.resolve(taskSnapshot)
      : Promise.resolve(null));
    const firstWindow = render(<StatusIslandApp />);
    fireEvent.click(await screen.findByRole('button', { name: '暂时隐藏：发布检查' }));
    firstWindow.unmount();
    render(<StatusIslandApp />);

    expect(await screen.findByRole('button', { name: '打开 AI 快捷面板' })).toBeInTheDocument();
  });

  it('expires persisted dismissals when the local date changes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T23:59:59'));
    localStorage.setItem('nowly.status-island.dismissed-primary', JSON.stringify({
      date: '2026-09-12',
      keys: ['event:event-1:2026-09-13T00:10:reminder:15']
    }));
    invokeMock.mockResolvedValueOnce({
      ...snapshot,
      events: [{
        id: 'event-1', title: '跨日发布', startAt: '2026-09-13T00:10', endAt: '2026-09-13T01:00', allDay: false,
        category: 'work', color: '#4FC9DA', note: '', reminders: [15], createdAt: 'x', updatedAt: 'x', recurrence: null,
        startTz: null, endTz: null, rrule: null, seriesId: null, seriesStartAt: null, occurrenceStartAt: null,
        isOverridden: false, subscriptionId: null
      }]
    });
    render(<StatusIslandApp />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole('button', { name: '打开 AI 快捷面板' })).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(2_000));

    expect(screen.getByRole('button', { name: /^跨日发布 ·/ })).toBeInTheDocument();
  });

  it('ignores corrupt storage and keeps a live dismissal when storage is unavailable', async () => {
    localStorage.setItem('nowly.status-island.dismissed-primary', '{invalid');
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('disabled'); });
    invokeMock.mockResolvedValueOnce({
      ...snapshot,
      tasks: [{
        id: 'task-1', title: '发布检查', description: '', priority: 'important_urgent' as const,
        dueDate: '2026-09-12', completed: false, laneId: 'todo', boardPosition: 0,
        tagIds: [], collaboratorIds: [], views: ['matrix' as const], createdAt: 'x', updatedAt: 'x'
      }]
    });
    render(<StatusIslandApp />);

    fireEvent.click(await screen.findByRole('button', { name: '暂时隐藏：发布检查' }));

    expect(screen.getByRole('button', { name: '打开 AI 快捷面板' })).toBeInTheDocument();
    setItem.mockRestore();
  });

  it('renders details and routes focus and AI actions through native commands', async () => {
    render(<StatusIslandDetailsApp />);

    fireEvent.click(await screen.findByRole('button', { name: '开始专注' }));
    fireEvent.click(screen.getByRole('button', { name: '问 Nowly' }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('start_status_island_focus', { minutes: 25 }));
    expect(invokeMock).toHaveBeenCalledWith('open_quick_panel');
  });

  it('places a snapshot retry action inside the details footer', async () => {
    invokeMock.mockRejectedValueOnce(new Error('offline'));
    render(<StatusIslandDetailsApp />);

    const retry = await screen.findByRole('button', { name: '状态读取失败，重试' });

    expect(retry.closest('.status-island__footer')).not.toBeNull();
  });

  it('refreshes on invalidation and keeps the last snapshot when refresh fails', async () => {
    let invalidate: () => void = () => undefined;
    listenMock.mockImplementation((name: string, callback: () => void) => {
      if (name === 'status-island-invalidated') invalidate = callback;
      return Promise.resolve(() => undefined);
    });
    const start = new Date(Date.now() + 10 * 60_000);
    const end = new Date(start.getTime() + 60 * 60_000);
    const eventSnapshot = {
      ...snapshot,
      sampledAt: new Date().toISOString(),
      events: [{
        id: 'event-1', title: '产品评审', startAt: localMinute(start), endAt: localMinute(end), allDay: false,
        category: 'work' as const, color: '#4FC9DA' as const, note: '', reminders: [15], createdAt: 'x', updatedAt: 'x', recurrence: null,
        startTz: null, endTz: null, rrule: null, seriesId: null, seriesStartAt: null, occurrenceStartAt: null,
        isOverridden: false, subscriptionId: null
      }]
    };
    let snapshotRequests = 0;
    invokeMock.mockImplementation((command: string) => {
      if (command !== 'get_status_island_snapshot') return Promise.resolve(null);
      snapshotRequests += 1;
      return snapshotRequests === 1 ? Promise.resolve(eventSnapshot) : Promise.reject(new Error('offline'));
    });
    render(<StatusIslandApp />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole('button', { name: /^产品评审 ·/ })).toBeInTheDocument();

    await act(async () => invalidate());

    const retry = await screen.findByRole('button', { name: '状态读取失败，重试' });
    expect(retry).not.toHaveTextContent('状态读取失败');
    expect(retry.querySelector('svg')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^产品评审 ·/ })).toBeInTheDocument();
  });

  it('ticks a native running focus snapshot every second', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T09:30:00'));
    invokeMock.mockResolvedValueOnce({
      ...snapshot,
      sampledAt: '2026-09-12T09:30:00',
      focus: { status: 'running', remainingSeconds: 90, sessionId: 'focus-1' }
    });
    render(<StatusIslandApp />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole('button', { name: /01:30/ })).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1_000));

    expect(screen.getByRole('button', { name: /01:29/ })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(89_000));
    expect(screen.getByRole('button', { name: /专注完成/ })).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('ignores an older snapshot that resolves after a newer refresh', async () => {
    let invalidate: () => void = () => undefined;
    listenMock.mockImplementation((name: string, callback: () => void) => {
      if (name === 'status-island-invalidated') invalidate = callback;
      return Promise.resolve(() => undefined);
    });
    const pending: Array<(value: typeof snapshot) => void> = [];
    invokeMock.mockImplementation((command: string) => command === 'get_status_island_snapshot'
      ? new Promise<typeof snapshot>(resolve => pending.push(resolve))
      : Promise.resolve(null));
    render(<StatusIslandApp />);
    await waitFor(() => expect(pending).toHaveLength(1));
    act(() => invalidate());
    await waitFor(() => expect(pending).toHaveLength(2));
    const latest = {
      ...snapshot,
      tasks: [{
        id: 'task-1', title: '最新关键任务', description: '', priority: 'important_urgent' as const,
        dueDate: '2026-09-12', completed: false, laneId: 'todo', boardPosition: 0,
        tagIds: [], collaboratorIds: [], views: ['matrix' as const], createdAt: 'x', updatedAt: 'x'
      }]
    };
    await act(async () => pending[1](latest));
    expect(screen.getByRole('button', { name: /^最新关键任务 ·/ })).toBeInTheDocument();

    await act(async () => pending[0](snapshot));

    expect(screen.getByRole('button', { name: /^最新关键任务 ·/ })).toBeInTheDocument();
  });
});
