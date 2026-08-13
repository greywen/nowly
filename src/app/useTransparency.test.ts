import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_OPACITY,
  MAX_OPACITY,
  MIN_OPACITY,
  TRANSPARENCY_STORAGE_KEY,
  clampOpacity,
  useTransparency
} from './useTransparency';

describe('clampOpacity', () => {
  it('keeps values within the readable range', () => {
    expect(clampOpacity(0)).toBe(MIN_OPACITY);
    expect(clampOpacity(2)).toBe(MAX_OPACITY);
    expect(clampOpacity(0.5)).toBe(0.5);
  });

  it('falls back to the default for non-numbers', () => {
    expect(clampOpacity(Number.NaN)).toBe(DEFAULT_OPACITY);
  });
});

describe('useTransparency', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts fully opaque when nothing is stored', () => {
    const { result } = renderHook(() => useTransparency());
    expect(result.current.opacity).toBe(DEFAULT_OPACITY);
  });

  it('persists and clamps a new opacity', () => {
    const { result } = renderHook(() => useTransparency());

    act(() => result.current.setOpacity(0.6));
    expect(result.current.opacity).toBe(0.6);
    expect(localStorage.getItem(TRANSPARENCY_STORAGE_KEY)).toBe('0.6');

    act(() => result.current.setOpacity(0));
    expect(result.current.opacity).toBe(MIN_OPACITY);
  });

  it('restores a stored opacity on mount', () => {
    localStorage.setItem(TRANSPARENCY_STORAGE_KEY, '0.4');
    const { result } = renderHook(() => useTransparency());
    expect(result.current.opacity).toBe(0.4);
  });
});
