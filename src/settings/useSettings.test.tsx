import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { RepositoryProvider } from '../data/RepositoryContext';
import type { AppSettings, NowlyRepository } from '../data/nowly-repository';
import { useSettings } from './useSettings';
import { DEFAULT_BAR_MENU } from '../app/bar-menu';

const settings: AppSettings = { wallpaperEnabled:false, launchAtLogin:false, targetMonitorId:null, density:'balanced', weekStart:'monday', dateFormat:'localized', showWeekends:true, iconStyle:'duotone', hideTopbarInWallpaper:true, barMenu:DEFAULT_BAR_MENU.map(item=>({...item})) };

function repository(updateSettings = vi.fn().mockResolvedValue(settings)): NowlyRepository {
  return { listEventsInRange:vi.fn(), createEvent:vi.fn(), updateEvent:vi.fn(), deleteEvent:vi.fn(), listTasks:vi.fn(), createTask:vi.fn(), updateTask:vi.fn(), deleteTask:vi.fn(), setTaskCompleted:vi.fn(), listNotes:vi.fn(), createNote:vi.fn(), updateNote:vi.fn(), deleteNote:vi.fn(), getSettings:vi.fn().mockResolvedValue(settings), updateSettings, listMonitors:vi.fn().mockResolvedValue([]), listModuleLayout:vi.fn().mockResolvedValue([]), saveModuleLayout:vi.fn(), createFocusSession:vi.fn().mockImplementation((session)=>Promise.resolve(session)), listFocusSessions:vi.fn().mockResolvedValue([]), getFocusStatistics:vi.fn().mockResolvedValue({totalFocusedSeconds:0,completedCount:0,interruptedCount:0,completionRate:0,points:[]}), getKanbanSnapshot:vi.fn().mockResolvedValue({ lanes:[], cards:[], priorities:[], tags:[], collaborators:[] }), createKanbanLane:vi.fn(), updateKanbanLane:vi.fn(), deleteKanbanLane:vi.fn(), reorderKanbanLanes:vi.fn(), createKanbanCard:vi.fn(), updateKanbanCard:vi.fn(), deleteKanbanCard:vi.fn(), moveKanbanCard:vi.fn(), createKanbanPriority:vi.fn(), updateKanbanPriority:vi.fn(), deleteKanbanPriority:vi.fn(), reorderKanbanPriorities:vi.fn(), createKanbanTag:vi.fn(), updateKanbanTag:vi.fn(), deleteKanbanTag:vi.fn(), createKanbanCollaborator:vi.fn(), updateKanbanCollaborator:vi.fn(), deleteKanbanCollaborator:vi.fn(), listCategories:vi.fn().mockResolvedValue([]), createCategory:vi.fn(), updateCategory:vi.fn(), deleteCategory:vi.fn(), listCalendarSubscriptions:vi.fn().mockResolvedValue([]), createCalendarSubscription:vi.fn(), updateCalendarSubscription:vi.fn(), deleteCalendarSubscription:vi.fn(), refreshCalendarSubscription:vi.fn(), startOAuthLogin:vi.fn(), listOAuthAccounts:vi.fn().mockResolvedValue([]), disconnectOAuthAccount:vi.fn(), listRemoteCalendars:vi.fn().mockResolvedValue([]), subscribeRemoteCalendar:vi.fn(), updateSubscriptionDisplay:vi.fn(), listExternalEventsInRange:vi.fn().mockResolvedValue([]) } as NowlyRepository;
}

function wrapper(repo: NowlyRepository) { return ({children}:{children:ReactNode}) => <RepositoryProvider repository={repo}>{children}</RepositoryProvider>; }

describe('useSettings', () => {
  it('normalizes missing menu data from an older settings document', async () => {
    const repo = repository();
    vi.mocked(repo.getSettings).mockResolvedValue({ ...settings, barMenu: undefined });
    const {result} = renderHook(useSettings, {wrapper:wrapper(repo)});
    await waitFor(() => expect(result.current.settings.status).toBe('ready'));
    expect(result.current.settings.data.barMenu).toEqual(DEFAULT_BAR_MENU);
  });
  it('saves a detached normalized menu and retains all hidden positions', async () => {
    const repo = repository(vi.fn().mockImplementation(async value=>value));
    const {result} = renderHook(useSettings, {wrapper:wrapper(repo)});
    await waitFor(() => expect(result.current.settings.status).toBe('ready'));
    const barMenu = DEFAULT_BAR_MENU.map(item=>({...item,visible:false})).reverse();
    await act(() => result.current.saveSettings({...settings,barMenu}));
    const saved = vi.mocked(repo.updateSettings).mock.calls[0][0];
    expect(saved.barMenu).toEqual(barMenu);
    expect(saved.barMenu).not.toBe(barMenu);
    expect(result.current.settings.data.barMenu).toEqual(barMenu);
  });
  it('updates settings in memory before persistence resolves', async () => {
    let resolveSave!: (value: AppSettings) => void;
    const updateSettings = vi.fn(() => new Promise<AppSettings>((resolve) => { resolveSave = resolve; }));
    const repo = repository(updateSettings);
    const {result} = renderHook(useSettings, {wrapper:wrapper(repo)});
    await waitFor(() => expect(result.current.settings.status).toBe('ready'));
    const changed = {...settings, recentColors:['#7C5CFC']};
    act(() => { void result.current.saveSettings(changed); });
    expect(result.current.settings.data.recentColors).toEqual(['#7C5CFC']);
    resolveSave(changed);
    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith(changed));
  });

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
      try { await result.current.saveSettings({...settings, showWeekends:false}); } catch { /* expected */ }
    });
    expect(result.current.settings.data.showWeekends).toBe(true);
    await waitFor(() => expect(result.current.writeError).toBe('保存失败'));
  });
});
