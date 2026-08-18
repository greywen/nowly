import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ONBOARDING_STORAGE_KEY, useOnboarding } from './useOnboarding';

describe('useOnboarding', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('shows the tour on the first launch', () => {
    const { result } = renderHook(() => useOnboarding());
    expect(result.current.shouldShow).toBe(true);
  });

  it('hides the tour once dismissed and persists the choice', () => {
    const { result } = renderHook(() => useOnboarding());

    act(() => result.current.dismiss());

    expect(result.current.shouldShow).toBe(false);
    expect(localStorage.getItem(ONBOARDING_STORAGE_KEY)).toBe('true');
  });

  it('stays hidden on subsequent launches', () => {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, 'true');
    const { result } = renderHook(() => useOnboarding());
    expect(result.current.shouldShow).toBe(false);
  });
});
