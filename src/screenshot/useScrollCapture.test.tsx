import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useScrollCapture } from './useScrollCapture';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), receive: null as null | ((event: { payload: unknown }) => void) }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((_event, callback) => {
    mocks.receive = callback;
    return Promise.resolve(() => {});
  })
}));
afterEach(() => vi.clearAllMocks());

const region = { x: 10, y: 20, width: 300, height: 400 };
const state = { sessionId: '1', revision: 0, sequence: 1, phase: 'capturing', width: 300, height: 0, region, hint: null };

describe('useScrollCapture', () => {
  it('starts immediately with the selection and follows native updates', async () => {
    mocks.invoke.mockResolvedValueOnce(state);
    const { result } = renderHook(() => useScrollCapture(160));
    expect(mocks.invoke).not.toHaveBeenCalled();
    await act(() => result.current.start(region));
    expect(mocks.invoke).toHaveBeenCalledWith('scroll_capture', { action: 'start', region });
    expect(result.current.state?.phase).toBe('capturing');

    mocks.invoke.mockResolvedValue(new ArrayBuffer(8));
    act(() => mocks.receive?.({ payload: { ...state, sequence: 3, revision: 1, height: 400 } }));
    // An older event arriving late must not roll the state back.
    act(() => mocks.receive?.({ payload: { ...state, sequence: 2 } }));
    expect(result.current.state?.height).toBe(400);
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith('scroll_capture_image', expect.objectContaining({ revision: 1 }))
    );
    const call = mocks.invoke.mock.calls.find(([command]) => command === 'scroll_capture_image');
    expect((call?.[1] as { maxWidth: number }).maxWidth).toBeGreaterThanOrEqual(160);
  });

  it('keeps a completed preview visible while newer capture revisions arrive', async () => {
    const first = new ArrayBuffer(8);
    let complete: ((value: ArrayBuffer) => void) | undefined;
    mocks.invoke.mockImplementation((command) => command === 'scroll_capture_image'
      ? new Promise<ArrayBuffer>((resolve) => { complete ??= resolve; })
      : Promise.resolve(state));
    const { result } = renderHook(() => useScrollCapture(160));
    await act(() => result.current.start(region));
    act(() => mocks.receive?.({ payload: { ...state, sequence: 2, revision: 1, height: 400 } }));
    act(() => mocks.receive?.({ payload: { ...state, sequence: 3, revision: 2, height: 432 } }));
    await act(async () => { complete?.(first); });
    await waitFor(() => expect(result.current.preview).not.toBeNull());
  });

  it('finishes with the native result so the output uses its final size', async () => {
    const { result } = renderHook(() => useScrollCapture(160));
    mocks.invoke.mockResolvedValueOnce({ ...state, sequence: 9, revision: 4, height: 1200, phase: 'finished' });
    let finished: unknown;
    await act(async () => {
      finished = await result.current.finish();
    });
    expect(mocks.invoke).toHaveBeenCalledWith('scroll_capture', { action: 'finish' });
    expect(finished).toMatchObject({ height: 1200, phase: 'finished' });
  });

  it('surfaces a start failure to the caller', async () => {
    mocks.invoke.mockRejectedValueOnce({ code: 'scroll_too_small', message: 'Choose a larger scrolling region' });
    const { result } = renderHook(() => useScrollCapture(160));
    await expect(result.current.start(region)).rejects.toMatchObject({ code: 'scroll_too_small' });
    expect(result.current.state).toBeNull();
  });
});
