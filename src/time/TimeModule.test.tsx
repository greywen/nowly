import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RepositoryProvider } from '../data/RepositoryContext';
import { tauriNowlyRepository } from '../data/tauri-nowly-repository';
import { defaultTimeSettings, type TimeSettings } from './time-model';
import { TimeModule } from './TimeModule';

const focus = vi.hoisted(() => ({
  state: { status: 'running', plannedSeconds: 1500 },
  remainingSeconds: 1200, todayFocusedSeconds: 300,
  start: vi.fn(), pause: vi.fn(), resume: vi.fn(), interrupt: vi.fn()
}));
vi.mock('../focus/FocusTimerContext', () => ({ useFocusTimer: () => focus }));

describe('unified time module', () => {
  it('switches display from the header icon group and shows statistics only for focus', async () => {
    let settings = defaultTimeSettings();
    const repo = {
      ...tauriNowlyRepository,
      getTimeSettings: vi.fn(async () => settings),
      saveTimeSettings: vi.fn(async (next: TimeSettings) => { settings = next; return next; }),
      listAlarms: vi.fn(async () => [])
    };
    render(<RepositoryProvider repository={repo}><TimeModule mode="foreground" onOpenSettings={vi.fn()} onOpenStatistics={vi.fn()} /></RepositoryProvider>);
    expect(await screen.findByTestId('time-widget')).toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '时间' })).toBeVisible();
    expect(screen.getByRole('button', { name: '世界时钟' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: '专注统计' })).not.toBeInTheDocument();
    expect(screen.getByText('专注中 · 20:00')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '显示专注时段' }));
    expect(screen.getByRole('button', { name: '专注统计' })).toBeVisible();
    expect(screen.getByRole('button', { name: '专注时段' })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(repo.saveTimeSettings).toHaveBeenCalledWith(expect.objectContaining({ displayContent: 'focus' })));
    await user.click(screen.getByRole('button', { name: '世界时钟' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: '专注统计' })).not.toBeInTheDocument());
    await waitFor(() => expect(repo.saveTimeSettings).toHaveBeenCalledWith(expect.objectContaining({ displayContent: 'clocks' })));
    expect(focus.interrupt).not.toHaveBeenCalled();
    expect(focus.start).not.toHaveBeenCalled();
  });
});
