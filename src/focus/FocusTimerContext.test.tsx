import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RepositoryProvider } from '../data/RepositoryContext';
import type { NowlyRepository } from '../data/nowly-repository';
import { FocusTimerProvider, useFocusTimer } from './FocusTimerContext';

const invoke = vi.hoisted(() => vi.fn());
const listen = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen }));

function repository(): NowlyRepository {
  return {
    getModuleState: vi.fn().mockResolvedValue(null), setModuleState:vi.fn(),
    createFocusSession:vi.fn().mockImplementation((session)=>Promise.resolve(session)),
    listFocusSessions:vi.fn().mockResolvedValue([]),
    getFocusStatistics:vi.fn().mockResolvedValue({totalFocusedSeconds:0,completedCount:0,interruptedCount:0,completionRate:0,points:[]})
  } as unknown as NowlyRepository;
}

function wrapper(repo: NowlyRepository) {
  return ({children}:{children:ReactNode}) => <RepositoryProvider repository={repo}><FocusTimerProvider>{children}</FocusTimerProvider></RepositoryProvider>;
}

describe('FocusTimerProvider', () => {
  beforeEach(() => { invoke.mockReset().mockResolvedValue(null); listen.mockReset().mockResolvedValue(()=>undefined); });

  it('shares start pause and resume state with the native coordinator', async () => {
    const {result} = renderHook(useFocusTimer,{wrapper:wrapper(repository())});
    await act(async()=>result.current.start(25));
    expect(result.current.state.status).toBe('running');
    expect(invoke).toHaveBeenCalledWith('start_focus_timer',expect.objectContaining({remainingSeconds:1500}));
    await act(result.current.pause);
    expect(result.current.state.status).toBe('paused');
    await act(result.current.resume);
    expect(result.current.state.status).toBe('running');
  });

  it('records an effective interrupted session', async () => {
    vi.useFakeTimers();
    const repo=repository();
    const {result}=renderHook(useFocusTimer,{wrapper:wrapper(repo)});
    await act(async()=>result.current.start(25));
    await act(async()=>vi.advanceTimersByTime(2000));
    await act(result.current.interrupt);
    expect(repo.createFocusSession).toHaveBeenCalledWith(expect.objectContaining({status:'interrupted',focusedSeconds:2}));
    vi.useRealTimers();
  });

  it('loads seven-day statistics on startup', async () => {
    const repo=repository();
    renderHook(useFocusTimer,{wrapper:wrapper(repo)});
    await waitFor(()=>expect(repo.getFocusStatistics).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({period:expect.any(String)})])));
  });
});
