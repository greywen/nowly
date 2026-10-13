import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTimeSnapshot } from './useTimeSnapshot';

describe('useTimeSnapshot', () => {
  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  });

  it('ticks once per second while visible and cleans up on unmount', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-11T00:00:00Z'));
    const { result, unmount } = renderHook(() => useTimeSnapshot());
    expect(result.current.toISOString()).toBe('2026-10-11T00:00:00.000Z');
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.toISOString()).toBe('2026-10-11T00:00:01.000Z');
    unmount();
    act(() => {
      vi.setSystemTime(new Date('2026-10-11T00:00:02Z'));
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.toISOString()).toBe('2026-10-11T00:00:01.000Z');
  });

  it('pauses while hidden and refreshes from the real current time when visible again', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-11T00:00:00Z'));
    const { result } = renderHook(() => useTimeSnapshot());
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current.toISOString()).toBe('2026-10-11T00:00:00.000Z');
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(result.current.toISOString()).toBe('2026-10-11T00:01:00.000Z');
  });
});
