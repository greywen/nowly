import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RepositoryProvider } from '../data/RepositoryContext';
import type { NowlyRepository } from '../data/nowly-repository';
import { setLanguage } from '../i18n';
import { FocusTimerProvider, useFocusTimer } from './FocusTimerContext';
import { useStatusIslandSnapshot } from '../quick-panel/useStatusIslandSnapshot';

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
  afterEach(() => vi.useRealTimers());
  beforeEach(() => { setLanguage('zh'); invoke.mockReset().mockResolvedValue(null); listen.mockReset().mockResolvedValue(()=>undefined); });

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

  it('sends a Chinese completion notification to the native timer', async () => {
    const {result} = renderHook(useFocusTimer,{wrapper:wrapper(repository())});
    await act(async()=>result.current.start(25));
    expect(invoke).toHaveBeenCalledWith('start_focus_timer',expect.objectContaining({snapshot:expect.objectContaining({notificationTitle:'专注完成',notificationBody:'你已完成 25 分钟专注，休息一下吧。'})}));
  });

  it('sends an English completion notification to the native timer', async () => {
    setLanguage('en');
    const {result} = renderHook(useFocusTimer,{wrapper:wrapper(repository())});
    await act(async()=>result.current.start(25));
    expect(invoke).toHaveBeenCalledWith('start_focus_timer',expect.objectContaining({snapshot:expect.objectContaining({notificationTitle:'Focus complete',notificationBody:'You completed a 25-minute focus session. Take a break.'})}));
  });

  it('records an effective interrupted session', async () => {
    vi.useFakeTimers();
    const repo=repository();
    let updated!: (payload: unknown) => void;
    listen.mockImplementation(async (name, handler) => {
      if (name === 'focus-timer-updated') updated = payload => handler({ payload });
      return () => {};
    });
    const {result}=renderHook(useFocusTimer,{wrapper:wrapper(repo)});
    await act(async()=>result.current.start(25));
    await act(async()=>vi.advanceTimersByTime(2000));
    expect(result.current.remainingSeconds).toBe(1500);
    act(() => updated({ status: 'running', sessionId: result.current.state.sessionId, startedAt: result.current.state.startedAt, plannedSeconds: 1500, remainingSeconds: 1498, focusedSeconds: 2, stageSequence: 1 }));
    expect(result.current.remainingSeconds).toBe(1498);
    await act(result.current.interrupt);
    expect(repo.createFocusSession).toHaveBeenCalledWith(expect.objectContaining({status:'interrupted',focusedSeconds:2}));
    vi.useRealTimers();
  });

  it('records a completed native broadcast once even when the next snapshot repeats it', async () => {
    const repo = repository();
    let updated!: (payload: unknown) => void;
    listen.mockImplementation(async (name, handler) => {
      if (name === 'focus-timer-updated') updated = payload => handler({ payload });
      return () => {};
    });
    const { result } = renderHook(useFocusTimer, { wrapper: wrapper(repo) });
    await act(async () => {});
    const completed = { status: 'completed', sessionId: 'native-finished', plannedSeconds: 60, remainingSeconds: 0, focusedSeconds: 60, startedAt: '2026-10-11T00:00:00Z', stageSequence: 2 };
    await act(async () => updated(completed));
    await act(async () => updated({ ...completed }));
    expect(result.current.state.status).toBe('completed');
    expect(result.current.remainingSeconds).toBe(0);
    expect(repo.createFocusSession).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('acknowledge_focus_completion', { id: 'native-finished' });
  });

  it('keeps the page and Bar on the exact same native countdown through pause and resume', async () => {
    const handlers: Array<(payload: unknown) => void> = [];
    listen.mockImplementation(async (name, handler) => {
      if (name === 'focus-timer-updated') handlers.push(payload => handler({ payload }));
      return () => {};
    });
    invoke.mockImplementation(async command => command === 'get_status_island_snapshot'
      ? { sampledAt: new Date().toISOString(), events: [], externalEvents: [], tasks: [], focus: { status: 'idle', sessionId: null, remainingSeconds: 0 } }
      : null);
    const { result } = renderHook(() => ({ page: useFocusTimer(), bar: useStatusIslandSnapshot() }), { wrapper: wrapper(repository()) });
    await act(async () => {});
    vi.useFakeTimers();
    for (const [status, remainingSeconds, focusedSeconds] of [['running', 60, 0], ['running', 59, 1], ['paused', 59, 1], ['running', 58, 2]] as const) {
      await act(async () => handlers.forEach(update => update({ status, remainingSeconds, focusedSeconds, sessionId: 'shared', plannedSeconds: 60, startedAt: '2026-10-11T00:00:00Z', stageSequence: 1 })));
      act(() => vi.advanceTimersByTime(1250));
      expect(result.current.page.remainingSeconds).toBe(remainingSeconds);
      expect(result.current.bar.model.primary).toEqual({ kind: 'focus', status, remainingSeconds });
    }
  });

  it('uses a fresh native sample when recording an interruption between broadcasts', async () => {
    const repo = repository();
    const { result } = renderHook(useFocusTimer, { wrapper: wrapper(repo) });
    await act(async () => result.current.start(25));
    invoke.mockImplementation(async command => command === 'get_focus_timer_snapshot'
      ? { status: 'running', sessionId: result.current.state.sessionId, remainingSeconds: 1497, focusedSeconds: 3, plannedSeconds: 1500, startedAt: result.current.state.startedAt, stageSequence: 1 }
      : null);
    await act(result.current.interrupt);
    expect(repo.createFocusSession).toHaveBeenCalledWith(expect.objectContaining({ status: 'interrupted', focusedSeconds: 3 }));
  });

  it('loads seven-day statistics on startup', async () => {
    const repo=repository();
    renderHook(useFocusTimer,{wrapper:wrapper(repo)});
    await waitFor(()=>expect(repo.getFocusStatistics).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({period:expect.any(String)})])));
  });

  it('recovers and acknowledges a completion that occurred while the webview was suspended', async () => {
    invoke.mockImplementation((command:string)=>command==='get_pending_focus_completion'?Promise.resolve({id:'native-1',plannedSeconds:1500,startedAt:'2026-08-14T09:00:00.000Z'}):Promise.resolve(null));
    const repo=repository();
    renderHook(useFocusTimer,{wrapper:wrapper(repo)});
    await waitFor(()=>expect(repo.createFocusSession).toHaveBeenCalledWith(expect.objectContaining({id:'native-1',status:'completed',focusedSeconds:1500})));
    expect(invoke).toHaveBeenCalledWith('acknowledge_focus_completion',{id:'native-1'});
  });
});
