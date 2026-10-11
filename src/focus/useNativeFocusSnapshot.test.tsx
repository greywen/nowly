import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useNativeFocusSnapshot } from './useNativeFocusSnapshot';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
const running = { status: 'running' as const, sessionId: 'one', plannedSeconds: 60, remainingSeconds: 60, focusedSeconds: 0, startedAt: '2026-10-11T00:00:00Z', stageSequence: 1 };
let update: (payload: typeof running) => void;
beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue(running);
  vi.mocked(listen).mockImplementation(async (_name, handler) => {
    update = payload => handler({ payload } as never);
    return () => {};
  });
});
afterEach(() => vi.useRealTimers());

it('displays native seconds without independently decrementing them', async () => {
  const { result } = renderHook(useNativeFocusSnapshot);
  await waitFor(() => expect(result.current?.remainingSeconds).toBe(60));
  vi.useFakeTimers();
  act(() => vi.advanceTimersByTime(3100));
  expect(result.current?.remainingSeconds).toBe(60);
  act(() => update({ ...running, remainingSeconds: 57, focusedSeconds: 3 }));
  expect(result.current?.remainingSeconds).toBe(57);
});

it('does not overwrite a newer broadcast with an in-flight startup read', async () => {
  let resolve!: (value: typeof running) => void;
  vi.mocked(invoke).mockReturnValue(new Promise(done => { resolve = done; }));
  const { result } = renderHook(useNativeFocusSnapshot);
  await act(async () => {});
  act(() => update({ ...running, remainingSeconds: 55, focusedSeconds: 5 }));
  await act(async () => resolve(running));
  expect(result.current?.remainingSeconds).toBe(55);
});

it('reads the current native snapshot again after wake', async () => {
  const { result } = renderHook(useNativeFocusSnapshot);
  await waitFor(() => expect(result.current?.remainingSeconds).toBe(60));
  vi.mocked(invoke).mockResolvedValue({ ...running, remainingSeconds: 40, focusedSeconds: 20 });
  await act(async () => window.dispatchEvent(new Event('pageshow')));
  expect(result.current?.remainingSeconds).toBe(40);
});
