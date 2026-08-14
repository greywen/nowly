import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { RepositoryProvider } from '../data/RepositoryContext';
import type { NowlyRepository } from '../data/nowly-repository';
import { useNotes } from './useNotes';

const note = { id:'n1', title:'原则', content:'简单', color:'purple' as const, pinned:true, createdAt:'x', updatedAt:'x' };
function repository(overrides: Partial<NowlyRepository> = {}): NowlyRepository {
  return {
    listEventsInRange:vi.fn().mockResolvedValue([]), createEvent:vi.fn(), updateEvent:vi.fn(), deleteEvent:vi.fn(),
    listTasks:vi.fn().mockResolvedValue([]), createTask:vi.fn(), updateTask:vi.fn(), deleteTask:vi.fn(), setTaskCompleted:vi.fn(),
    listNotes:vi.fn().mockResolvedValue([note]), createNote:vi.fn().mockResolvedValue(note), updateNote:vi.fn().mockResolvedValue(note), deleteNote:vi.fn().mockResolvedValue(undefined),
    getSettings:vi.fn(), updateSettings:vi.fn(), listMonitors:vi.fn(),
    listModuleLayout:vi.fn().mockResolvedValue([]), saveModuleLayout:vi.fn().mockImplementation((l)=>Promise.resolve(l)),
    getModuleState:vi.fn().mockResolvedValue(null), setModuleState:vi.fn().mockResolvedValue(undefined), createFocusSession:vi.fn().mockImplementation((session)=>Promise.resolve(session)), listFocusSessions:vi.fn().mockResolvedValue([]), getFocusStatistics:vi.fn().mockResolvedValue({totalFocusedSeconds:0,completedCount:0,interruptedCount:0,completionRate:0,points:[]}), listExtensions:vi.fn().mockResolvedValue([]), installExtension:vi.fn(), uninstallExtension:vi.fn(),
    getKanbanSnapshot:vi.fn().mockResolvedValue({ lanes:[], cards:[], priorities:[], tags:[], collaborators:[] }),
    createKanbanLane:vi.fn(), updateKanbanLane:vi.fn(), deleteKanbanLane:vi.fn(), reorderKanbanLanes:vi.fn(),
    createKanbanCard:vi.fn(), updateKanbanCard:vi.fn(), deleteKanbanCard:vi.fn(), moveKanbanCard:vi.fn(),
    createKanbanPriority:vi.fn(), updateKanbanPriority:vi.fn(), deleteKanbanPriority:vi.fn(), reorderKanbanPriorities:vi.fn(),
    createKanbanTag:vi.fn(), updateKanbanTag:vi.fn(), deleteKanbanTag:vi.fn(),
    createKanbanCollaborator:vi.fn(), updateKanbanCollaborator:vi.fn(), deleteKanbanCollaborator:vi.fn(), ...overrides
  };
}
function wrapper(value: NowlyRepository) { return ({children}:{children:ReactNode}) => <RepositoryProvider repository={value}>{children}</RepositoryProvider>; }

describe('useNotes', () => {
  it('loads and refreshes after every successful write', async () => {
    const value = repository();
    const { result } = renderHook(() => useNotes(), { wrapper:wrapper(value) });
    await waitFor(() => expect(result.current.notes.status).toBe('ready'));
    await act(() => result.current.createNote({ title:'原则', content:'', color:'yellow', pinned:false }));
    await act(() => result.current.updateNote(note, { title:'原则', content:'简单', color:'purple', pinned:true }));
    await act(() => result.current.deleteNote(note));
    expect(value.listNotes).toHaveBeenCalledTimes(4);
  });

  it('retains data on read failure and retries', async () => {
    const listNotes = vi.fn().mockResolvedValueOnce([note]).mockRejectedValueOnce({message:'读取失败'}).mockResolvedValueOnce([note]);
    const { result } = renderHook(() => useNotes(), { wrapper:wrapper(repository({listNotes})) });
    await waitFor(() => expect(result.current.notes.status).toBe('ready'));
    await act(() => result.current.retryNotes());
    expect(result.current.notes).toMatchObject({status:'error', data:[note], message:'读取失败'});
    await act(() => result.current.retryNotes());
    expect(result.current.notes.status).toBe('ready');
  });
});
