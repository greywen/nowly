import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { DEFAULT_BAR_MENU } from '../app/bar-menu';
import { useStatusIslandSnapshot, type NativeStatusIslandSnapshot } from './useStatusIslandSnapshot';
import { setLanguage } from '../i18n';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));

const snapshot: NativeStatusIslandSnapshot = {
  sampledAt: '2026-10-10T03:00:00Z', events: [], externalEvents: [], tasks: [],
  focus: { status: 'idle', remainingSeconds: 0, sessionId: null }
};
let invalidated: (() => void) | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  invalidated = undefined;
  vi.mocked(invoke).mockImplementation(async command => command === 'get_focus_timer_snapshot' ? null : snapshot);
  vi.mocked(listen).mockImplementation(async (_event, handler) => {
    if (_event === 'status-island-invalidated') invalidated = () => handler({} as never);
    return () => {};
  });
});

describe('status island menu snapshot', () => {
  it('updates derived status text immediately when the UI language changes', async () => {
    setLanguage('zh');
    const { result } = renderHook(useStatusIslandSnapshot);
    await waitFor(() => expect(result.current.status).toBe('ready'));
    try {
      act(() => setLanguage('en'));
      expect(JSON.stringify(result.current.model)).not.toMatch(/[\u4e00-\u9fff]/);
    } finally {
      act(() => setLanguage('zh'));
    }
  });

  it('derives notices and removes them after native invalidation without replay', async () => {
    const notice = { id: 'n1', kind: 'alarm' as const, title: 'Tea', dueAt: new Date().toISOString(), alarmId: 'a1', count: 1, rangeStart: '', rangeEnd: '' };
    vi.mocked(invoke).mockImplementation(async command => command === 'get_focus_timer_snapshot' ? null : { ...snapshot, alarmNotices: [notice] });
    const { result } = renderHook(useStatusIslandSnapshot);
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.model.panelContext).toEqual({ kind: 'alarm', notice, expiredNotices: [] });
    vi.mocked(invoke).mockImplementation(async command => command === 'get_focus_timer_snapshot' ? null : snapshot);
    await act(async () => invalidated?.());
    await waitFor(() => expect(result.current.model.attentionQueue).toEqual([]));
  });
  it('defaults older snapshots to the complete visible feature menu', async () => {
    const { result } = renderHook(useStatusIslandSnapshot);
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.barMenu).toEqual(DEFAULT_BAR_MENU);
  });
  it('refreshes hidden ordered menu choices after native settings invalidation', async () => {
    const { result } = renderHook(useStatusIslandSnapshot);
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const barMenu = DEFAULT_BAR_MENU.map(item=>({...item,visible:false})).reverse();
    vi.mocked(invoke).mockResolvedValue({ ...snapshot, barMenu });
    await act(async () => { invalidated?.(); });
    await waitFor(() => expect(result.current.barMenu).toEqual(barMenu));
    expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === 'get_status_island_snapshot')).toHaveLength(2);
  });
});
