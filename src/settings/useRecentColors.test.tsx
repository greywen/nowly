import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useRecentColors } from './useRecentColors';

describe('useRecentColors', () => {
  it('starts empty and remembers a color in memory', () => {
    const { result } = renderHook(() => useRecentColors());
    expect(result.current.recentColors).toEqual([]);

    act(() => result.current.rememberColor('#7c5cfc'));
    expect(result.current.recentColors).toEqual(['#7C5CFC']);
  });

  it('does not persist colors across fresh mounts (no caching)', () => {
    const first = renderHook(() => useRecentColors());
    act(() => first.result.current.rememberColor('#123456'));
    expect(first.result.current.recentColors).toEqual(['#123456']);

    // A brand-new hook instance starts empty; nothing is restored from storage.
    const second = renderHook(() => useRecentColors());
    expect(second.result.current.recentColors).toEqual([]);
  });

  it('moves a repeated color to the front and caps the list at five', () => {
    const { result } = renderHook(() => useRecentColors());
    act(() => result.current.rememberColor('#111111'));
    act(() => result.current.rememberColor('#222222'));
    act(() => result.current.rememberColor('#333333'));
    act(() => result.current.rememberColor('#444444'));
    act(() => result.current.rememberColor('#555555'));
    act(() => result.current.rememberColor('#111111'));
    expect(result.current.recentColors).toEqual(['#111111', '#555555', '#444444', '#333333', '#222222']);
    act(() => result.current.rememberColor('#666666'));
    expect(result.current.recentColors).toEqual(['#666666', '#111111', '#555555', '#444444', '#333333']);
  });

  it('ignores invalid colors', () => {
    const { result } = renderHook(() => useRecentColors());
    act(() => result.current.rememberColor('not-a-color'));
    expect(result.current.recentColors).toEqual([]);
  });
});
