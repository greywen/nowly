import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BarMenuPanel } from './BarMenuPanel';
import { DEFAULT_BAR_MENU, type BarMenuItem } from '../bar-menu';
import { getLanguage, setLanguage } from '../../i18n/store';
import { t } from '../../i18n';

const originalLanguage = getLanguage();
afterEach(() => {
  act(() => setLanguage(originalLanguage));
  document.documentElement.removeAttribute('dir');
});

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => undefined) }));

const shortcuts = {
  screenshot: { shortcut: 'Ctrl+Alt+A', registered: true, error: null },
  history: { shortcut: 'Ctrl+Alt+H', registered: false, error: 'Conflict' },
  createEvent: { shortcut: '', registered: false, error: null },
  createTask: { shortcut: 'Ctrl+Alt+T', registered: true, error: null },
  createNote: { shortcut: 'Ctrl+Alt+N', registered: false, error: 'conflict' }
};
const names = (items: HTMLElement[]) => items.map(item => item.querySelector('.bar-menu-panel__label')?.textContent);

describe('Bar function menu', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation((command: string) =>
      Promise.resolve(command === 'screenshot_shortcut_status' ? shortcuts : null));
  });

  it('hides the AI entry even when an existing preference enables it', async () => {
    render(<BarMenuPanel active items={[{ id: 'assistant', visible: true }]} />);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('screenshot_shortcut_status'));
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
    expect(screen.getByText('暂无显示的功能，请在设置 → Nowly Bar 中启用。')).toBeVisible();
    expect(invokeMock).not.toHaveBeenCalledWith('toggle_nowly_panel');
  });

  it('groups quick-create tiles before the capture entries and focuses the first tile', async () => {
    render(<BarMenuPanel active items={DEFAULT_BAR_MENU} />);
    const create = await screen.findByRole('group', { name: '快速创建' });
    const capture = screen.getByRole('group', { name: '截图' });
    expect(names(within(create).getAllByRole('menuitem'))).toEqual(['日程', '四象限任务', '便签']);
    expect(names(within(capture).getAllByRole('menuitem'))).toEqual(['截图', '截图历史']);
    expect(create.compareDocumentPosition(capture) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByRole('menuitem')).toHaveLength(5);
    expect(screen.getByRole('menuitem', { name: /日程/ })).toHaveFocus();
  });

  it('keeps the configured order inside each group', () => {
    const items: BarMenuItem[] = [
      { id: 'screenshotHistory', visible: true }, { id: 'createNote', visible: true },
      { id: 'screenshot', visible: true }, { id: 'createEvent', visible: true }, { id: 'createTask', visible: false }
    ];
    render(<BarMenuPanel active items={items} />);
    expect(names(within(screen.getByRole('group', { name: '快速创建' })).getAllByRole('menuitem'))).toEqual(['便签', '日程']);
    expect(names(within(screen.getByRole('group', { name: '截图' })).getAllByRole('menuitem'))).toEqual(['截图历史', '截图']);
  });

  it('hides a group and its label when every item in it is hidden', () => {
    render(<BarMenuPanel active items={DEFAULT_BAR_MENU.map(item => ({ ...item, visible: !item.id.startsWith('create') }))} />);
    expect(screen.queryByRole('group', { name: '快速创建' })).toBeNull();
    expect(screen.queryByText('快速创建')).toBeNull();
    expect(screen.getAllByRole('menuitem')).toHaveLength(2);
  });

  it('opens the quick-create window for the chosen kind', async () => {
    render(<BarMenuPanel active items={DEFAULT_BAR_MENU} />);
    fireEvent.click(screen.getByRole('menuitem', { name: /四象限任务/ }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('open_quick_create', { kind: 'task' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /便签/ }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('open_quick_create', { kind: 'note' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /日程/ }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('open_quick_create', { kind: 'event' }));
  });

  it('shows a tile shortcut only when one is set', async () => {
    render(<BarMenuPanel active items={DEFAULT_BAR_MENU} />);
    const task = screen.getByRole('menuitem', { name: /四象限任务/ });
    await waitFor(() => expect(task).toHaveTextContent('Ctrl+Alt+T'));
    expect(task).not.toHaveTextContent('快捷键不可用');
    const note = screen.getByRole('menuitem', { name: /便签/ });
    expect(note).toHaveTextContent('Ctrl+Alt+N');
    expect(note).toHaveTextContent('快捷键不可用');
    expect(screen.getByRole('menuitem', { name: /日程/ })).toHaveTextContent(/^日程$/);
  });

  it('moves focus through every visible entry in visual order', async () => {
    render(<BarMenuPanel active items={DEFAULT_BAR_MENU} />);
    const items = screen.getAllByRole('menuitem');
    await waitFor(() => expect(items[0]).toHaveFocus());
    fireEvent.keyDown(items[0], { key: 'ArrowRight' });
    expect(items[1]).toHaveFocus();
    fireEvent.keyDown(items[1], { key: 'ArrowDown' });
    expect(items[2]).toHaveFocus();
    fireEvent.keyDown(items[2], { key: 'ArrowRight' });
    expect(items[3]).toHaveFocus();
    fireEvent.keyDown(items[3], { key: 'ArrowLeft' });
    expect(items[2]).toHaveFocus();
    fireEvent.keyDown(items[2], { key: 'End' });
    expect(items[4]).toHaveFocus();
    fireEvent.keyDown(items[4], { key: 'ArrowDown' });
    expect(items[0]).toHaveFocus();
    fireEvent.keyDown(items[0], { key: 'ArrowUp' });
    expect(items[4]).toHaveFocus();
    fireEvent.keyDown(items[4], { key: 'Home' });
    expect(items[0]).toHaveFocus();
  });

  it('swaps the horizontal arrow keys for right-to-left layouts', async () => {
    document.documentElement.setAttribute('dir', 'rtl');
    render(<BarMenuPanel active items={DEFAULT_BAR_MENU} />);
    const items = screen.getAllByRole('menuitem');
    await waitFor(() => expect(items[0]).toHaveFocus());
    fireEvent.keyDown(items[0], { key: 'ArrowLeft' });
    expect(items[1]).toHaveFocus();
    fireEvent.keyDown(items[1], { key: 'ArrowRight' });
    expect(items[0]).toHaveFocus();
  });

  it('renders only visible entries in configured order and focuses the first one', async () => {
    render(<BarMenuPanel active items={[
      { id: 'assistant', visible: true },
      { id: 'screenshotHistory', visible: true },
      { id: 'screenshot', visible: true }
    ]} />);
    await waitFor(() => expect(screen.getAllByRole('menuitem')).toHaveLength(2));
    const items = screen.getAllByRole('menuitem');
    expect(items[0]).toHaveTextContent('截图历史');
    expect(items[1]).toHaveTextContent('截图');
    expect(items[0]).toHaveFocus();
    expect(items[0]).toHaveTextContent('Ctrl+Alt+H');
    expect(items[0]).toHaveTextContent('快捷键不可用');
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
    const history = screen.getByRole('menuitem', { name: /截图历史/ });
    history.focus();
    rerender(<BarMenuPanel active items={DEFAULT_BAR_MENU.map(item => ({ ...item }))} />);
    expect(history).toHaveFocus();
    rerender(<BarMenuPanel active items={DEFAULT_BAR_MENU.map(item => ({
      ...item, visible: item.id !== 'screenshotHistory'
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
    expect(await screen.findByRole('alert')).toHaveTextContent(t('barMenu.actionFailed'));
    expect(capture).toBeEnabled();
    invokeMock.mockImplementation((command: string) => Promise.resolve(command === 'screenshot_shortcut_status' ? shortcuts : null));
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('localizes a native action rejection before showing it in the menu', async () => {
    setLanguage('fr');
    invokeMock.mockImplementation((command: string) => command === 'start_screen_capture'
      ? Promise.reject({ code: 'system_error', message: '截图启动失败，请重试。' })
      : Promise.resolve(command === 'screenshot_shortcut_status' ? shortcuts : null));
    render(<BarMenuPanel active items={DEFAULT_BAR_MENU} />);
    fireEvent.click(screen.getByRole('menuitem', { name: /Capture d’écran/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(t('nativeError.system_error'));
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
