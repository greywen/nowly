import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { RepositoryProvider } from '../data/RepositoryContext';
import type { AppSettings, NowlyRepository } from '../data/nowly-repository';
import { useSettings } from './useSettings';

const settings: AppSettings = { wallpaperEnabled:false, launchAtLogin:false, targetMonitorId:null, density:'balanced', weekStart:'monday', dateFormat:'localized', showWeekends:true, calendarEnabled:true, matrixEnabled:true, notesEnabled:true };

function repository(updateSettings = vi.fn().mockResolvedValue(settings)): NowlyRepository {
  return { listEventsInRange:vi.fn(), createEvent:vi.fn(), updateEvent:vi.fn(), deleteEvent:vi.fn(), listTasks:vi.fn(), createTask:vi.fn(), updateTask:vi.fn(), deleteTask:vi.fn(), setTaskCompleted:vi.fn(), listNotes:vi.fn(), createNote:vi.fn(), updateNote:vi.fn(), deleteNote:vi.fn(), getSettings:vi.fn().mockResolvedValue(settings), updateSettings } as NowlyRepository;
}

function wrapper(repo: NowlyRepository) { return ({children}:{children:ReactNode}) => <RepositoryProvider repository={repo}>{children}</RepositoryProvider>; }

describe('useSettings', () => {
  it('loads and replaces settings after a successful save', async () => {
    const repo = repository(vi.fn().mockImplementation(async (value) => value));
    const {result} = renderHook(useSettings, {wrapper:wrapper(repo)});
    await waitFor(() => expect(result.current.settings.status).toBe('ready'));
    const changed = {...settings, showWeekends:false};
    await act(() => result.current.saveSettings(changed));
    expect(repo.updateSettings).toHaveBeenCalledWith(changed);
    await waitFor(() => expect(result.current.settings.data.showWeekends).toBe(false));
  });

  it('keeps prior settings and exposes a write error', async () => {
    const repo = repository(vi.fn().mockRejectedValue({message:'保存失败'}));
    const {result} = renderHook(useSettings, {wrapper:wrapper(repo)});
    await waitFor(() => expect(result.current.settings.status).toBe('ready'));
    await act(async () => {
      try { await result.current.saveSettings({...settings, notesEnabled:false}); } catch { /* expected */ }
    });
    expect(result.current.settings.data.notesEnabled).toBe(true);
    await waitFor(() => expect(result.current.writeError).toBe('保存失败'));
  });
});
