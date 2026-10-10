import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ScreenshotHistoryApp } from './ScreenshotHistoryApp';
const ipc = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), convertFileSrc: vi.fn((id: string, protocol: string) => `${protocol}://${id}`) }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: ipc.invoke, convertFileSrc: ipc.convertFileSrc }));
vi.mock('@tauri-apps/api/event', () => ({ listen: ipc.listen }));
const entry = { id: 'image-1', fileName: 'Nowly.png', createdAt: '2026-10-09T10:00:00Z', width: 640, height: 480, byteSize: 1024, available: true };
function setup(items = [entry], nextCursor: string | null = null) {
  ipc.invoke.mockImplementation((command: string) => Promise.resolve(command === 'list_screenshot_history' ? { items, nextCursor } : command === 'get_app_settings' ? { iconStyle: 'outline' } : undefined));
  render(<ScreenshotHistoryApp />);
}
describe('screenshot history', () => {
  beforeEach(() => { ipc.invoke.mockReset(); ipc.listen.mockReset().mockResolvedValue(() => undefined); });
  it('shows only capture time and copies image by controlled id, without archiving', async () => {
    setup();
    const card = await screen.findByRole('article');
    expect(card.querySelector('time')).toHaveAttribute('dateTime', entry.createdAt);
    expect(screen.queryByText('640 × 480')).not.toBeInTheDocument();
    expect(card.querySelector('.screenshot-history-card__metadata')).not.toBeInTheDocument();
    expect(ipc.convertFileSrc).toHaveBeenCalledWith('image-1', 'screenshot-history');
    expect(screen.getByRole('img')).toHaveAttribute('loading', 'lazy');
    await waitFor(() => expect(screen.getByRole('img').closest('article')?.querySelector('svg')).toHaveAttribute('data-icon-style', 'outline'));
    fireEvent.click(screen.getByRole('button', { name: '复制图片' }));
    expect(await screen.findByText('图片已复制。')).toBeInTheDocument();
    expect(ipc.invoke).toHaveBeenCalledWith('copy_screenshot_history', { id: 'image-1' });
    expect(ipc.invoke).not.toHaveBeenCalledWith('copy_capture_to_clipboard', expect.anything());
  });
  it('keeps the compact folder action in the header and uses labelled compact tools', async () => {
    ipc.invoke.mockImplementation((command: string) => Promise.resolve(command === 'list_screenshot_history' ? { items: [entry], nextCursor: null } : undefined));
    render(<ScreenshotHistoryApp compact />);
    await screen.findByRole('article');
    const folder = screen.getByRole('button', { name: '打开文件夹' });
    expect(folder.closest('header')).not.toBeNull();
    expect(folder).toHaveAttribute('title', '打开文件夹');
    expect(folder.querySelector('svg')).toHaveAttribute('width', '16');
    const copy = screen.getByRole('button', { name: '复制图片' });
    expect(copy).toHaveAttribute('title', '复制图片');
    expect(copy.querySelector('svg')).toHaveAttribute('width', '16');
    const remove = screen.getByRole('button', { name: '删除截图' });
    expect(remove).toHaveAttribute('title', '删除截图');
    expect(remove.querySelector('svg')).toHaveAttribute('width', '16');
    fireEvent.click(folder);
    await waitFor(() => expect(ipc.invoke).toHaveBeenCalledWith('open_screenshot_folder'));
  });
  it('loads cursor pages and deduplicates repeated ids', async () => {
    setup([entry], 'older');
    await screen.findByRole('article');
    ipc.invoke.mockImplementation((command: string) => Promise.resolve(command === 'list_screenshot_history' ? { items: [entry, { ...entry, id: 'image-2', fileName: 'older.png' }], nextCursor: null } : undefined));
    fireEvent.click(screen.getByRole('button', { name: '加载更多' }));
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(2));
    expect(ipc.invoke).toHaveBeenCalledWith('list_screenshot_history', { cursor: 'older' });
    expect(screen.queryByRole('button', { name: '加载更多' })).not.toBeInTheDocument();
  });
  it('requires confirmation and restores focus on cancel, then deletes', async () => {
    setup();
    const trigger = await screen.findByRole('button', { name: '删除截图' });
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: '删除截图？' })).toBeInTheDocument();
    expect(ipc.invoke).not.toHaveBeenCalledWith('delete_screenshot_history', expect.anything());
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    ipc.invoke.mockImplementation((command: string) => Promise.resolve(command === 'list_screenshot_history' ? { items: [], nextCursor: null } : undefined));
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    expect(await screen.findByText('还没有截图。')).toBeInTheDocument();
    expect(ipc.invoke).toHaveBeenCalledWith('delete_screenshot_history', { id: 'image-1' });
  });
  it('keeps a failed deletion retryable and never claims success', async () => {
    setup();
    fireEvent.click(await screen.findByRole('button', { name: '删除截图' }));
    ipc.invoke.mockRejectedValueOnce(new Error('disk busy'));
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    expect(await screen.findByText('删除失败，请重试。')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('article')).toBeInTheDocument();
  });
  it('shows static unavailable thumbnails, retry and missing-file states', async () => {
    setup([{ ...entry, available: false }]);
    expect(await screen.findByText('原图不可用')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '复制图片' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '删除截图' })).not.toBeDisabled();
  });
  it('allows retrying a failed thumbnail', async () => {
    setup();
    fireEvent.error(await screen.findByRole('img'));
    fireEvent.click(screen.getByRole('button', { name: '重试缩略图' }));
    expect(screen.getByRole('img')).toHaveAttribute('src', 'screenshot-history://image-1?retry=1');
  });
  it('shows load errors and opens the folder without a path argument', async () => {
    ipc.invoke.mockImplementation((command: string) => command === 'list_screenshot_history' ? Promise.reject(new Error('offline')) : Promise.resolve(undefined));
    render(<ScreenshotHistoryApp />);
    expect(await screen.findByText('无法加载截图历史，请重试。')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '打开文件夹' }));
    await waitFor(() => expect(ipc.invoke).toHaveBeenCalledWith('open_screenshot_folder'));
  });
  it('ignores a pending old page after a change event reload', async () => {
    let oldPage!: (page: unknown) => void;
    setup([entry], 'older');
    await screen.findByRole('article');
    ipc.invoke.mockImplementation((command: string) => command === 'list_screenshot_history' ? new Promise(resolve => { oldPage = resolve; }) : Promise.resolve(undefined));
    fireEvent.click(screen.getByRole('button', { name: '加载更多' }));
    ipc.invoke.mockImplementation((command: string) => Promise.resolve(command === 'list_screenshot_history' ? { items: [], nextCursor: null } : undefined));
    const callback = ipc.listen.mock.calls.find(call => call[0] === 'screenshot-history-changed')![1];
    await act(async () => callback({ payload: null }));
    await screen.findByText('还没有截图。');
    await act(async () => oldPage({ items: [entry], nextCursor: null }));
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });
});
