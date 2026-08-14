import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  BLUR_STORAGE_KEY,
  DEFAULT_BLUR_RADIUS,
  MAX_BLUR_RADIUS,
  MIN_BLUR_RADIUS,
  clampBlurRadius,
  useBlurRadius
} from './useTransparency';

describe('clampBlurRadius', () => {
  it('keeps values within the 0–24px range', () => {
    expect(clampBlurRadius(MIN_BLUR_RADIUS)).toBe(0);
    expect(clampBlurRadius(MAX_BLUR_RADIUS + 10)).toBe(MAX_BLUR_RADIUS);
    expect(clampBlurRadius(-4)).toBe(MIN_BLUR_RADIUS);
    expect(clampBlurRadius(8)).toBe(8);
  });

  it('falls back to the default for non-numbers', () => {
    expect(clampBlurRadius(Number.NaN)).toBe(DEFAULT_BLUR_RADIUS);
  });
});

describe('useBlurRadius', () => {
  beforeEach(() => localStorage.clear());

  it('starts clear when nothing is stored', () => {
    const { result } = renderHook(() => useBlurRadius());
    expect(result.current.blurRadius).toBe(DEFAULT_BLUR_RADIUS);
  });

  it('persists and clamps a new blur radius', () => {
    const { result } = renderHook(() => useBlurRadius());
    act(() => result.current.setBlurRadius(12));
    expect(result.current.blurRadius).toBe(12);
    expect(localStorage.getItem(BLUR_STORAGE_KEY)).toBe('12');
    act(() => result.current.setBlurRadius(30));
    expect(result.current.blurRadius).toBe(MAX_BLUR_RADIUS);
  });

  it('restores a stored blur radius on mount', () => {
    localStorage.setItem(BLUR_STORAGE_KEY, '6');
    const { result } = renderHook(() => useBlurRadius());
    expect(result.current.blurRadius).toBe(6);
  });
});
