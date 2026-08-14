import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  BLUR_STORAGE_KEY,
  DEFAULT_BLUR,
  MAX_BLUR,
  MIN_BLUR,
  clampBlur,
  useBlur
} from './useBlur';

describe('clampBlur', () => {
  it('keeps values within the supported range', () => {
    expect(clampBlur(-5)).toBe(MIN_BLUR);
    expect(clampBlur(100)).toBe(MAX_BLUR);
    expect(clampBlur(8)).toBe(8);
  });

  it('falls back to the default for non-numbers', () => {
    expect(clampBlur(Number.NaN)).toBe(DEFAULT_BLUR);
  });
});

describe('useBlur', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts crisp when nothing is stored', () => {
    const { result } = renderHook(() => useBlur());
    expect(result.current.blur).toBe(DEFAULT_BLUR);
  });

  it('persists and clamps a new blur amount', () => {
    const { result } = renderHook(() => useBlur());

    act(() => result.current.setBlur(8));
    expect(result.current.blur).toBe(8);
    expect(localStorage.getItem(BLUR_STORAGE_KEY)).toBe('8');

    act(() => result.current.setBlur(100));
    expect(result.current.blur).toBe(MAX_BLUR);
  });

  it('restores a stored blur amount on mount', () => {
    localStorage.setItem(BLUR_STORAGE_KEY, '12');
    const { result } = renderHook(() => useBlur());
    expect(result.current.blur).toBe(12);
  });
});
