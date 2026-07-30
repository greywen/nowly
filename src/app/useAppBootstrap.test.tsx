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

function wrapper(value: NowlyRepository) {
  return ({ children }: { children: ReactNode }) => (
    <RepositoryProvider repository={value}>{children}</RepositoryProvider>
  );
}

describe('useAppBootstrap', () => {
  it('loads only tasks, notes, and settings independently', async () => {
    const value = repository();
    const { result } = renderHook(() => useAppBootstrap(), { wrapper: wrapper(value) });
    await waitFor(() => expect(result.current.settings.status).toBe('ready'));
    expect(result.current).not.toHaveProperty('events');
    expect(result.current).not.toHaveProperty('retryEvents');
    expect(result.current.tasks).toMatchObject({ status: 'ready', data: [] });
    expect(result.current.notes).toMatchObject({ status: 'ready', data: [] });
    expect(value.listEventsInRange).not.toHaveBeenCalled();
  });

  it('keeps other modules ready when notes fail and retries notes only', async () => {
    const listNotes = vi
      .fn()
      .mockRejectedValueOnce({ code: 'database_error', message: '便签读取失败' })
      .mockResolvedValueOnce([]);
    const value = repository({ listNotes });
    const { result } = renderHook(() => useAppBootstrap(), { wrapper: wrapper(value) });

    await waitFor(() => expect(result.current.notes.status).toBe('error'));
    expect(result.current.tasks.status).toBe('ready');

    await act(() => result.current.retryNotes());
    await waitFor(() => expect(result.current.notes.status).toBe('ready'));
    expect(listNotes).toHaveBeenCalledTimes(2);
  });
});
