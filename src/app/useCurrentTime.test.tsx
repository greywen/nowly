import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCurrentTime } from './useCurrentTime';

describe('useCurrentTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('updates at the next minute boundary', () => {
    vi.setSystemTime(new Date(2026, 6, 23, 9, 41, 40, 250));
    const { result } = renderHook(() => useCurrentTime());

    expect(result.current).toEqual(new Date(2026, 6, 23, 9, 41, 40, 250));

    act(() => vi.advanceTimersByTime(19_749));
    expect(result.current.getMinutes()).toBe(41);

    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toEqual(new Date(2026, 6, 23, 9, 42, 0, 0));
  });

  it('provides the new local date after midnight', () => {
    vi.setSystemTime(new Date(2026, 6, 23, 23, 59, 59, 500));
    const { result } = renderHook(() => useCurrentTime());

    act(() => vi.advanceTimersByTime(500));

    expect(result.current).toEqual(new Date(2026, 6, 24, 0, 0, 0, 0));
  });

  it('synchronizes immediately when the page becomes visible', () => {
    let visibilityState: DocumentVisibilityState = 'hidden';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibilityState);
    vi.setSystemTime(new Date(2026, 6, 23, 9, 41, 0));
    const { result } = renderHook(() => useCurrentTime());

    vi.setSystemTime(new Date(2026, 6, 23, 11, 7, 30));
    visibilityState = 'visible';
    act(() => document.dispatchEvent(new Event('visibilitychange')));

    expect(result.current).toEqual(new Date(2026, 6, 23, 11, 7, 30));
    expect(vi.getTimerCount()).toBe(1);
  });

  it('synchronizes immediately when the window gains focus', () => {
    vi.setSystemTime(new Date(2026, 6, 23, 9, 41, 0));
    const { result } = renderHook(() => useCurrentTime());

    vi.setSystemTime(new Date(2026, 6, 23, 12, 18, 45));
    act(() => window.dispatchEvent(new Event('focus')));

    expect(result.current).toEqual(new Date(2026, 6, 23, 12, 18, 45));
    expect(vi.getTimerCount()).toBe(1);
  });

  it('removes its timer and event listeners on unmount', () => {
    const documentRemoveSpy = vi.spyOn(document, 'removeEventListener');
    const windowRemoveSpy = vi.spyOn(window, 'removeEventListener');
    vi.setSystemTime(new Date(2026, 6, 23, 9, 41, 0));
    const { unmount } = renderHook(() => useCurrentTime());

    expect(vi.getTimerCount()).toBe(1);
    unmount();

    expect(vi.getTimerCount()).toBe(0);
    expect(documentRemoveSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    expect(windowRemoveSpy).toHaveBeenCalledWith('focus', expect.any(Function));
  });
});
