import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ModuleLayoutEntry, NowlyRepository } from '../../data/nowly-repository';
import { RepositoryProvider } from '../../data/RepositoryContext';
import { DesktopShell } from './DesktopShell';

function mountPending() {
  let resolve!: (entries: ModuleLayoutEntry[]) => void;
  let reject!: (error: Error) => void;
  const pending = new Promise<ModuleLayoutEntry[]>((yes, no) => { resolve = yes; reject = no; });
  const save = vi.fn(async (entries: ModuleLayoutEntry[]) => entries);
  const repository = { listModuleLayout: () => pending, saveModuleLayout: save } as unknown as NowlyRepository;
  render(<RepositoryProvider repository={repository}><DesktopShell time="09:41" dateText="today" summary="" modules={{
    calendar: <div>calendar region</div>, matrix: <div>matrix region</div>, notes: <div>notes region</div>
  }} /></RepositoryProvider>);
  return { resolve, reject, save };
}

describe('DesktopShell initial layout loading', () => {
  it('replaces initial default modules with readonly welcome artwork and blocks layout writes', async () => {
    const { resolve, save } = mountPending();
    expect(screen.getByTestId('welcome-sticker')).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('calendar region')).not.toBeInTheDocument();
    expect(screen.queryByText('matrix region')).not.toBeInTheDocument();
    expect(screen.queryByText('notes region')).not.toBeInTheDocument();
    const edit = screen.getByRole('button', { name: '编辑布局' });
    expect(edit).toBeDisabled();
    fireEvent.click(edit);
    expect(screen.queryByRole('button', { name: '添加模块' })).not.toBeInTheDocument();
    await act(async () => resolve([{ id: 'notes', x: 0, y: 0, w: 12, h: 8 }]));
    expect(screen.queryByTestId('welcome-sticker')).not.toBeInTheDocument();
    expect(screen.getByText('notes region')).toBeInTheDocument();
    expect(screen.queryByText('calendar region')).not.toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'false');
    expect(edit).toBeEnabled();
    expect(save).not.toHaveBeenCalled();
  });

  it('shows welcome artwork and an addition guide for a loaded empty layout without writes', async () => {
    const { resolve, save } = mountPending();
    await act(async () => resolve([]));
    expect(screen.getByTestId('welcome-sticker')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('点击编辑布局，添加你的第一个模块');
    expect(screen.queryByText('正在加载你的工作区…')).not.toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'false');
    expect(screen.getByRole('button', { name: '编辑布局' })).toBeEnabled();
    expect(save).not.toHaveBeenCalled();
  });

  it('replaces the empty welcome artwork when adding a module and restores it after removing the last module', async () => {
    const { resolve, save } = mountPending();
    await act(async () => resolve([]));
    fireEvent.click(screen.getByRole('button', { name: '编辑布局' }));
    expect(screen.getByTestId('welcome-sticker')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '添加模块' }));
    fireEvent.click(screen.getByRole('button', { name: '添加日历' }));
    expect(screen.queryByTestId('welcome-sticker')).not.toBeInTheDocument();
    expect(screen.getByText('calendar region')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    fireEvent.click(screen.getByRole('button', { name: '移除日历' }));
    expect(screen.getByTestId('welcome-sticker')).toBeInTheDocument();
    expect(screen.queryByText('calendar region')).not.toBeInTheDocument();
    expect(save).toHaveBeenLastCalledWith([]);
  });

  it('ends loading and preserves the existing default fallback on read failure', async () => {
    const { reject, save } = mountPending();
    await act(async () => reject(new Error('read failed')));
    expect(screen.queryByTestId('welcome-sticker')).not.toBeInTheDocument();
    expect(screen.getByText('calendar region')).toBeInTheDocument();
    expect(screen.getByText('matrix region')).toBeInTheDocument();
    expect(screen.getByText('notes region')).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });
});
