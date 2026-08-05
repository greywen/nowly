import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useModuleLayout } from './useModuleLayout';

const STORAGE_KEY = 'nowly.module-layout';

describe('useModuleLayout', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts from the default layout when storage is empty', () => {
    const { result } = renderHook(() => useModuleLayout());
    expect(result.current.layout.map((item) => item.id)).toEqual(['calendar', 'matrix', 'notes']);
    expect(result.current.layout.find((item) => item.id === 'calendar')?.presetId).toBe('large');
  });

  it('falls back to the default layout when storage is malformed', () => {
    localStorage.setItem(STORAGE_KEY, 'not-json');
    const { result } = renderHook(() => useModuleLayout());
    expect(result.current.layout.map((item) => item.id)).toEqual(['calendar', 'matrix', 'notes']);
  });

  it('reorders modules and persists to localStorage', () => {
    const { result } = renderHook(() => useModuleLayout());
    act(() => result.current.reorder('calendar', 'notes'));
    expect(result.current.layout.map((item) => item.id)).toEqual(['matrix', 'calendar', 'notes']);
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as Array<{ id: string }>;
    expect(stored.map((item) => item.id)).toEqual(['matrix', 'calendar', 'notes']);
  });

  it('sets a specific preset and persists it', () => {
    const { result } = renderHook(() => useModuleLayout());
    act(() => result.current.setPreset('calendar', 'medium'));
    expect(result.current.layout.find((item) => item.id === 'calendar')?.presetId).toBe('medium');
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as Array<{ id: string; presetId: string }>;
    expect(stored.find((item) => item.id === 'calendar')?.presetId).toBe('medium');
  });

  it('cycles a preset to the next option', () => {
    const { result } = renderHook(() => useModuleLayout());
    act(() => result.current.cyclePreset('calendar'));
    expect(result.current.layout.find((item) => item.id === 'calendar')?.presetId).toBe('medium');
    act(() => result.current.cyclePreset('calendar'));
    expect(result.current.layout.find((item) => item.id === 'calendar')?.presetId).toBe('large');
  });

  it('restores the default layout on reset', () => {
    const { result } = renderHook(() => useModuleLayout());
    act(() => result.current.reorder('calendar', 'notes'));
    act(() => result.current.setPreset('calendar', 'medium'));
    act(() => result.current.reset());
    expect(result.current.layout).toEqual([
      { id: 'calendar', presetId: 'large' },
      { id: 'matrix', presetId: 'medium' },
      { id: 'notes', presetId: 'small' }
    ]);
  });

  it('rehydrates a persisted layout on next mount', () => {
    const first = renderHook(() => useModuleLayout());
    act(() => first.result.current.setPreset('notes', 'medium'));
    first.unmount();
    const second = renderHook(() => useModuleLayout());
    expect(second.result.current.layout.find((item) => item.id === 'notes')?.presetId).toBe('medium');
  });
});
