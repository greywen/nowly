import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useRecentColors } from './useRecentColors';

const STORAGE_KEY = 'nowly.recentColors';

describe('useRecentColors', () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
  });

  it('starts empty and persists a remembered color to localStorage', () => {
    const { result } = renderHook(() => useRecentColors());
    expect(result.current.recentColors).toEqual([]);

    act(() => result.current.rememberColor('#7c5cfc'));
    expect(result.current.recentColors).toEqual(['#7C5CFC']);
    expect(JSON.parse(globalThis.localStorage.getItem(STORAGE_KEY) ?? '[]')).toEqual(['#7C5CFC']);
  });

  it('hydrates from localStorage on mount', () => {
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(['#123456', '#ABCDEF']));
    const { result } = renderHook(() => useRecentColors());
    expect(result.current.recentColors).toEqual(['#123456', '#ABCDEF']);
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
