import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { defaultLayout, type LayoutState } from './widget-registry';
import { useModuleLayout } from './useModuleLayout';

const STORAGE_KEY = 'nowly.module-layout';

// A layout with free space so moves/resizes have somewhere to go.
const sparse: LayoutState = [
  { id: 'calendar', x: 0, y: 0, w: 5, h: 4 },
  { id: 'matrix', x: 5, y: 0, w: 4, h: 4 },
  { id: 'notes', x: 0, y: 4, w: 4, h: 3 }
];

function seed(layout: LayoutState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
}

function rectOf(layout: LayoutState, id: string) {
  return layout.find((item) => item.id === id);
}

describe('useModuleLayout', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts from the default layout when storage is empty', () => {
    const { result } = renderHook(() => useModuleLayout());
    expect(result.current.layout).toEqual(defaultLayout);
  });

  it('falls back to the default layout when storage is malformed', () => {
    localStorage.setItem(STORAGE_KEY, 'not-json');
    const { result } = renderHook(() => useModuleLayout());
    expect(result.current.layout).toEqual(defaultLayout);
  });

  it('moves a module into free space and persists it', () => {
    seed(sparse);
    const { result } = renderHook(() => useModuleLayout());
    act(() => result.current.move('notes', { x: 5, y: 4 }));
    expect(rectOf(result.current.layout, 'notes')).toMatchObject({ x: 5, y: 4, w: 4, h: 3 });
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as LayoutState;
    expect(rectOf(stored, 'notes')).toMatchObject({ x: 5, y: 4 });
  });

  it('rejects a move that would overlap another module', () => {
    seed(sparse);
    const { result } = renderHook(() => useModuleLayout());
    act(() => result.current.move('notes', { x: 0, y: 0 }));
    expect(rectOf(result.current.layout, 'notes')).toMatchObject({ x: 0, y: 4 });
  });

  it('clamps a move so the module stays inside the grid', () => {
    seed(sparse);
    const { result } = renderHook(() => useModuleLayout());
    act(() => result.current.move('notes', { x: 20, y: 20 }));
    const notes = rectOf(result.current.layout, 'notes');
    expect(notes).toMatchObject({ x: 8, y: 5, w: 4, h: 3 });
  });

  it('resizes a module into free space and persists it', () => {
    seed(sparse);
    const { result } = renderHook(() => useModuleLayout());
    act(() => result.current.resize('notes', { w: 5, h: 4 }));
    expect(rectOf(result.current.layout, 'notes')).toMatchObject({ x: 0, y: 4, w: 5, h: 4 });
  });

  it('rejects a resize that would overlap another module', () => {
    seed(sparse);
    const { result } = renderHook(() => useModuleLayout());
    act(() => result.current.resize('calendar', { w: 5, h: 8 }));
    expect(rectOf(result.current.layout, 'calendar')).toMatchObject({ w: 5, h: 4 });
  });

  it('rejects a resize below the module minimum size', () => {
    seed(sparse);
    const { result } = renderHook(() => useModuleLayout());
    act(() => result.current.resize('calendar', { w: 2, h: 2 }));
    expect(rectOf(result.current.layout, 'calendar')).toMatchObject({ w: 5, h: 4 });
  });

  it('restores the default layout on reset', () => {
    seed(sparse);
    const { result } = renderHook(() => useModuleLayout());
    act(() => result.current.move('notes', { x: 5, y: 4 }));
    act(() => result.current.reset());
    expect(result.current.layout).toEqual(defaultLayout);
  });

  it('rehydrates a persisted layout on next mount', () => {
    seed(sparse);
    const first = renderHook(() => useModuleLayout());
    act(() => first.result.current.move('notes', { x: 5, y: 4 }));
    first.unmount();
    const second = renderHook(() => useModuleLayout());
    expect(rectOf(second.result.current.layout, 'notes')).toMatchObject({ x: 5, y: 4 });
  });
});
