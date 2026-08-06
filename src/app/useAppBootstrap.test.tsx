import { renderHook, waitFor } from '@testing-library/react';
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
  showWeekends: true
};

function repository(overrides: Partial<NowlyRepository> = {}): NowlyRepository {
  return {
    listEventsInRange: vi.fn().mockResolvedValue([]),
    createEvent: vi.fn().mockRejectedValue(new Error('unexpected write')),
    updateEvent: vi.fn().mockRejectedValue(new Error('unexpected write')),
    deleteEvent: vi.fn().mockRejectedValue(new Error('unexpected write')),
    listTasks: vi.fn().mockResolvedValue([]),
    createTask: vi.fn().mockRejectedValue(new Error('unexpected task write')),
    updateTask: vi.fn().mockRejectedValue(new Error('unexpected task write')),
    deleteTask: vi.fn().mockRejectedValue(new Error('unexpected task write')),
    setTaskCompleted: vi.fn().mockRejectedValue(new Error('unexpected task write')),
    listNotes: vi.fn().mockResolvedValue([]),
    createNote: vi.fn().mockRejectedValue(new Error('unexpected note write')),
    updateNote: vi.fn().mockRejectedValue(new Error('unexpected note write')),
    deleteNote: vi.fn().mockRejectedValue(new Error('unexpected note write')),
    getSettings: vi.fn().mockResolvedValue(settings),
    updateSettings: vi.fn().mockResolvedValue(settings),
    listMonitors: vi.fn().mockResolvedValue([]),
    listModuleLayout: vi.fn().mockResolvedValue([]),
    saveModuleLayout: vi.fn().mockImplementation((layout) => Promise.resolve(layout)),
    getModuleState: vi.fn().mockResolvedValue(null),
    setModuleState: vi.fn().mockResolvedValue(undefined),
    listExtensions: vi.fn().mockResolvedValue([]),
    installExtension: vi.fn().mockRejectedValue(new Error('unexpected extension write')),
    uninstallExtension: vi.fn().mockRejectedValue(new Error('unexpected extension write')),
    ...overrides
  };
}

function wrapper(value: NowlyRepository) {
  return ({ children }: { children: ReactNode }) => (
    <RepositoryProvider repository={value}>{children}</RepositoryProvider>
  );
}

describe('useAppBootstrap', () => {
  it('loads only settings', async () => {
    const value = repository();
    const { result } = renderHook(() => useAppBootstrap(), { wrapper: wrapper(value) });
    await waitFor(() => expect(result.current.settings.status).toBe('ready'));
    expect(result.current).not.toHaveProperty('events');
    expect(result.current).not.toHaveProperty('retryEvents');
    expect(result.current).not.toHaveProperty('tasks');
    expect(result.current).not.toHaveProperty('retryTasks');
    expect(result.current).not.toHaveProperty('notes');
    expect(result.current).not.toHaveProperty('retryNotes');
    expect(value.listNotes).not.toHaveBeenCalled();
    expect(value.listEventsInRange).not.toHaveBeenCalled();
    expect(value.listTasks).not.toHaveBeenCalled();
  });
});
