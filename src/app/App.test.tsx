import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RepositoryProvider } from '../data/RepositoryContext';
import type { AppSettings, NowlyRepository } from '../data/nowly-repository';
import { App } from './App';

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
  showWeekends: true,
  calendarEnabled: true,
  matrixEnabled: true,
  notesEnabled: true
};

function createRepository(overrides: Partial<NowlyRepository> = {}): NowlyRepository {
  return {
    listEventsInRange: vi.fn().mockResolvedValue([]),
    createEvent: vi.fn().mockRejectedValue(new Error('unexpected write')),
    updateEvent: vi.fn().mockRejectedValue(new Error('unexpected write')),
    deleteEvent: vi.fn().mockRejectedValue(new Error('unexpected write')),
    listTasks: vi.fn().mockResolvedValue([]),
    listNotes: vi.fn().mockResolvedValue([]),
    getSettings: vi.fn().mockResolvedValue(settings),
    ...overrides
  };
}

function renderApp(repository = createRepository()) {
  return render(
    <RepositoryProvider repository={repository}>
      <App />
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

  it('starts in foreground without automatically entering wallpaper mode', () => {
    renderApp();

    expect(screen.getByRole('button', { name: '设为壁纸' })).toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalled();
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
    listenMock.mockImplementation((_eventName, listener) => {
      modeListener = listener;
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
