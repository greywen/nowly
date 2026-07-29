import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { RepositoryProvider } from '../data/RepositoryContext';
import type { AppSettings, NowlyRepository } from '../data/nowly-repository';
import { useAppBootstrap } from './useAppBootstrap';

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

function repository(overrides: Partial<NowlyRepository> = {}): NowlyRepository {
  return {
    listEvents: vi.fn().mockResolvedValue([]),
    listTasks: vi.fn().mockResolvedValue([]),
    listNotes: vi.fn().mockResolvedValue([]),
    getSettings: vi.fn().mockResolvedValue(settings),
    ...overrides
  };
}

function wrapper(value: NowlyRepository) {
  return ({ children }: { children: ReactNode }) => (
    <RepositoryProvider repository={value}>{children}</RepositoryProvider>
  );
}

describe('useAppBootstrap', () => {
  it('loads empty data and settings independently', async () => {
    const { result } = renderHook(() => useAppBootstrap(), { wrapper: wrapper(repository()) });
    expect(result.current.events.status).toBe('loading');
    await waitFor(() => expect(result.current.settings.status).toBe('ready'));
    expect(result.current.events).toMatchObject({ status: 'ready', data: [] });
    expect(result.current.tasks).toMatchObject({ status: 'ready', data: [] });
    expect(result.current.notes).toMatchObject({ status: 'ready', data: [] });
  });

  it('keeps other modules ready when notes fail and retries notes only', async () => {
    const listNotes = vi
      .fn()
      .mockRejectedValueOnce({ code: 'database_error', message: '便签读取失败' })
      .mockResolvedValueOnce([]);
    const value = repository({ listNotes });
    const { result } = renderHook(() => useAppBootstrap(), { wrapper: wrapper(value) });

    await waitFor(() => expect(result.current.notes.status).toBe('error'));
    expect(result.current.events.status).toBe('ready');
    expect(result.current.tasks.status).toBe('ready');

    await act(() => result.current.retryNotes());
    await waitFor(() => expect(result.current.notes.status).toBe('ready'));
    expect(listNotes).toHaveBeenCalledTimes(2);
  });
});
