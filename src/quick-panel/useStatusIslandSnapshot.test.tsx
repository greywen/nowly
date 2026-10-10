import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { DEFAULT_BAR_MENU } from '../app/bar-menu';
import { useStatusIslandSnapshot, type NativeStatusIslandSnapshot } from './useStatusIslandSnapshot';

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
  vi.mocked(invoke).mockResolvedValue(snapshot);
  vi.mocked(listen).mockImplementation(async (_event, handler) => {
    invalidated = () => handler({} as never);
    return () => {};
  });
});

describe('status island menu snapshot', () => {
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
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
