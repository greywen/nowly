import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BarMenuPanel } from './BarMenuPanel';
import { DEFAULT_BAR_MENU } from '../bar-menu';

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => undefined) }));

const shortcuts = {
  screenshot: { shortcut: 'Ctrl+Alt+A', registered: true, error: null },
  history: { shortcut: 'Ctrl+Alt+H', registered: false, error: 'Conflict' }
};

describe('Bar function menu', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation((command: string) =>
      Promise.resolve(command === 'screenshot_shortcut_status' ? shortcuts : null));
  });

  it('renders only visible entries in configured order and focuses the first one', async () => {
    render(<BarMenuPanel active items={[
      { id: 'assistant', visible: true },
      { id: 'screenshot', visible: false },
      { id: 'screenshotHistory', visible: true }
    ]} />);
    await waitFor(() => expect(screen.getAllByRole('menuitem')).toHaveLength(2));
    const items = screen.getAllByRole('menuitem');
    expect(items[0]).toHaveTextContent('AI 助手');
    expect(items[1]).toHaveTextContent('截图历史');
    expect(items[0]).toHaveFocus();
    expect(items[1]).toHaveTextContent('Ctrl+Alt+H');
    expect(items[1]).toHaveTextContent('快捷键不可用');
    fireEvent.keyDown(items[0], { key: 'ArrowDown' });
    expect(items[1]).toHaveFocus();
    fireEvent.keyDown(items[1], { key: 'Home' });
    expect(items[0]).toHaveFocus();
  });

  it('allows all entries to be hidden and explains where to enable them', () => {
    render(<BarMenuPanel active items={DEFAULT_BAR_MENU.map(item => ({ ...item, visible: false }))} />);
    expect(screen.queryByRole('menuitem')).toBeNull();
    expect(screen.getByText('暂无显示的功能，请在设置 → Nowly Bar 中启用。')).toBeVisible();
  });

  it('preserves keyboard selection across snapshots and repairs focus when an entry is hidden', async () => {
    const { rerender } = render(<BarMenuPanel active items={DEFAULT_BAR_MENU} />);
    await waitFor(() => expect(screen.getAllByRole('menuitem')[0]).toHaveFocus());
    const assistant = screen.getByRole('menuitem', { name: 'AI 助手' });
    assistant.focus();
    rerender(<BarMenuPanel active items={DEFAULT_BAR_MENU.map(item => ({ ...item }))} />);
    expect(assistant).toHaveFocus();
    rerender(<BarMenuPanel active items={DEFAULT_BAR_MENU.map(item => ({
      ...item, visible: item.id !== 'assistant'
    }))} />);
    expect(screen.getAllByRole('menuitem')[0]).toHaveFocus();
  });

  it('prevents duplicate capture starts and keeps failed actions retryable in the menu', async () => {
    let rejectCapture: (reason: Error) => void = () => undefined;
    invokeMock.mockImplementation((command: string) => {
      if (command === 'start_screen_capture') {
        return new Promise((_, reject) => { rejectCapture = reject; });
      }
      return Promise.resolve(command === 'screenshot_shortcut_status' ? shortcuts : null);
    });
    render(<BarMenuPanel active items={DEFAULT_BAR_MENU} />);
    const capture = screen.getByRole('menuitem', { name: /^截图(?!历史)/ });
    fireEvent.click(capture);
    fireEvent.click(capture);
    expect(invokeMock.mock.calls.filter(call => call[0] === 'start_screen_capture')).toHaveLength(1);
    expect(capture).toBeDisabled();
    await act(async () => rejectCapture(new Error('Capture failed')));
    expect(await screen.findByRole('alert')).toHaveTextContent('Capture failed');
    expect(capture).toBeEnabled();
    invokeMock.mockImplementation((command: string) => Promise.resolve(command === 'screenshot_shortcut_status' ? shortcuts : null));
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(screen.queryByText('Capture failed')).toBeNull());
  });

  it('reports shortcut status failure without disabling feature execution', async () => {
    invokeMock.mockImplementation((command: string) => command === 'screenshot_shortcut_status'
      ? Promise.reject(new Error('Unavailable')) : Promise.resolve(null));
    render(<BarMenuPanel active items={DEFAULT_BAR_MENU} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('无法读取快捷键');
    const history = screen.getByRole('menuitem', { name: /截图历史/ });
    expect(history).toBeEnabled();
    fireEvent.click(history);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('open_screenshot_history'));
  });
});
