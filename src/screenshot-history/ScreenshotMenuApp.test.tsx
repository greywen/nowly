import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ScreenshotMenuApp } from './ScreenshotMenuApp';
const ipc = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: ipc.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: ipc.listen }));
const status = { screenshot: { shortcut: 'Alt+S', registered: true, error: null }, history: { shortcut: 'Alt+H', registered: false, error: 'conflict' } };
describe('screenshot menu', () => {
  beforeEach(() => { ipc.listen.mockReset().mockResolvedValue(() => undefined); ipc.invoke.mockReset().mockImplementation((command: string) => Promise.resolve(command === 'screenshot_shortcut_status' ? status : null)); });
  it('uses native shortcut labels and keyboard navigation without opening other panels', async () => {
    render(<ScreenshotMenuApp />);
    expect(await screen.findByText('Alt+S')).toBeInTheDocument();
    expect(screen.getByText('Alt+H')).toBeInTheDocument();
    const capture = screen.getByRole('menuitem', { name: /截图 Alt\+S/ });
    expect(capture).toHaveFocus();
    fireEvent.keyDown(capture, { key: 'ArrowDown' });
    const history = screen.getByRole('menuitem', { name: /截图历史 Alt\+H/ });
    expect(history).toHaveFocus();
    fireEvent.keyDown(history, { key: 'Enter' });
    await waitFor(() => expect(ipc.invoke).toHaveBeenCalledWith('open_screenshot_history'));
    expect(ipc.invoke.mock.calls.findIndex(call => call[0] === 'close_screenshot_menu')).toBeLessThan(ipc.invoke.mock.calls.findIndex(call => call[0] === 'open_screenshot_history'));
  });
  it('starts capture only after hiding menu and supports retry on action failure', async () => {
    render(<ScreenshotMenuApp />);
    await screen.findByText('Alt+S');
    ipc.invoke.mockImplementation((command: string) => command === 'start_screen_capture' ? Promise.reject(new Error('offline')) : Promise.resolve(undefined));
    fireEvent.click(screen.getByRole('menuitem', { name: /截图 Alt\+S/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('操作失败，请重试。');
    expect(ipc.invoke).toHaveBeenCalledWith('start_screen_capture');
  });
  it('closes on Escape and native/window blur', async () => {
    render(<ScreenshotMenuApp />);
    await screen.findByText('Alt+S');
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    await waitFor(() => expect(ipc.invoke).toHaveBeenCalledWith('close_screenshot_menu'));
    ipc.invoke.mockClear();
    fireEvent(window, new Event('blur'));
    await waitFor(() => expect(ipc.invoke).toHaveBeenCalledWith('close_screenshot_menu'));
  });
  it('shows unavailable visibly when native registration failed', async () => {
    render(<ScreenshotMenuApp />);
    await screen.findByText('Alt+H');
    const unavailable = screen.getByText('快捷键不可用');
    expect(unavailable).not.toHaveClass('visually-hidden');
    expect(screen.queryByText('正在读取…')).not.toBeInTheDocument();
  });

  it('accepts browser flat shortcut status without endless reading', async () => {
    ipc.invoke.mockImplementation((command: string) => Promise.resolve(command === 'screenshot_shortcut_status' ? { screenshotShortcut: 'Ctrl+Alt+A', screenshotHistoryShortcut: 'Ctrl+Alt+H', screenshotRegistered: false, screenshotHistoryRegistered: false, error: 'Desktop only' } : null));
    render(<ScreenshotMenuApp />);
    expect(await screen.findByText('Ctrl+Alt+A')).toBeInTheDocument();
    expect(screen.getByText('Ctrl+Alt+H')).toBeInTheDocument();
    expect(screen.queryByText('正在读取…')).not.toBeInTheDocument();
    expect(screen.getAllByText('快捷键不可用')).toHaveLength(2);
  });

  it('treats malformed status as unavailable instead of perpetual reading', async () => {
    ipc.invoke.mockResolvedValue(null);
    render(<ScreenshotMenuApp />);
    expect(await screen.findByRole('alert')).toHaveTextContent('无法读取快捷键，请重试。');
    expect(screen.queryByText('正在读取…')).not.toBeInTheDocument();
    expect(screen.getAllByText('快捷键不可用')).toHaveLength(2);
  });

  it('reports shortcut loading failures and retries without guessed labels', async () => {
    ipc.invoke.mockImplementation((command: string) => command === 'screenshot_shortcut_status' ? Promise.reject(new Error('offline')) : Promise.resolve(null));
    render(<ScreenshotMenuApp />);
    expect(await screen.findByRole('alert')).toHaveTextContent('无法读取快捷键，请重试。');
    expect(screen.queryByText('Ctrl+Alt+A')).not.toBeInTheDocument();
    ipc.invoke.mockImplementation((command: string) => Promise.resolve(command === 'screenshot_shortcut_status' ? status : null));
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('Alt+S')).toBeInTheDocument();
  });

  it('refreshes shortcuts when the persistent menu is opened again', async () => {
    render(<ScreenshotMenuApp />);
    await screen.findByText('Alt+S');
    ipc.invoke.mockImplementation((command: string) => Promise.resolve(command === 'screenshot_shortcut_status' ? { ...status, screenshot: { ...status.screenshot, shortcut: 'Ctrl+K' } } : null));
    const callback = ipc.listen.mock.calls.find(call => call[0] === 'screenshot-menu-opened')![1];
    await act(async () => callback({ payload: null }));
    expect(await screen.findByText('Ctrl+K')).toBeInTheDocument();
  });
});
