import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { RepositoryProvider } from '../data/RepositoryContext';
import type { ModuleLayoutEntry, NowlyRepository } from '../data/nowly-repository';
import { buildDefinitions, defaultLayout, type LayoutState } from './widget-registry';
import { useModuleLayout } from './useModuleLayout';

const definitions = buildDefinitions();

// A layout with free space so moves/resizes/adds have somewhere to go.
const sparse: LayoutState = [
  { id: 'calendar', x: 0, y: 0, w: 5, h: 4 },
  { id: 'matrix', x: 5, y: 0, w: 4, h: 4 },
  { id: 'notes', x: 0, y: 4, w: 4, h: 3 }
];

function fakeRepository(initial: LayoutState): {
  repository: NowlyRepository;
  saved: () => ModuleLayoutEntry[];
} {
  let store: ModuleLayoutEntry[] = initial.map((item) => ({ ...item }));
  const repository = {
    listModuleLayout: vi.fn(async () => store.map((item) => ({ ...item }))),
    saveModuleLayout: vi.fn(async (layout: ModuleLayoutEntry[]) => {
      store = layout.map((item) => ({ ...item }));
      return store.map((item) => ({ ...item }));
    })
  } as unknown as NowlyRepository;
  return { repository, saved: () => store };
}

function wrapperFor(repository: NowlyRepository) {
  return ({ children }: { children: ReactNode }) => (
    <RepositoryProvider repository={repository}>{children}</RepositoryProvider>
  );
}

async function mountLoaded(initial: LayoutState) {
  const { repository, saved } = fakeRepository(initial);
  const view = renderHook(() => useModuleLayout(definitions), { wrapper: wrapperFor(repository) });
  await waitFor(() => expect(view.result.current.loaded).toBe(true));
  return { ...view, saved };
}

function rectOf(layout: LayoutState, id: string) {
  return layout.find((item) => item.id === id);
}

describe('useModuleLayout', () => {
  it('loads the persisted layout from the repository', async () => {
    const { result } = await mountLoaded(sparse);
    expect(result.current.layout).toEqual(sparse);
    expect(result.current.presentIds).toEqual(new Set(['calendar', 'matrix', 'notes']));
  });

  it('moves a module into free space and persists it', async () => {
    const { result, saved } = await mountLoaded(sparse);
    act(() => result.current.move('notes', { x: 5, y: 4 }));
    expect(rectOf(result.current.layout, 'notes')).toMatchObject({ x: 5, y: 4, w: 4, h: 3 });
    expect(rectOf(saved(), 'notes')).toMatchObject({ x: 5, y: 4 });
  });

  it('rejects a move that would overlap another module', async () => {
    const { result } = await mountLoaded(sparse);
    act(() => result.current.move('notes', { x: 0, y: 0 }));
    expect(rectOf(result.current.layout, 'notes')).toMatchObject({ x: 0, y: 4 });
  });

  it('clamps a move so the module stays inside the grid', async () => {
    const { result } = await mountLoaded(sparse);
    act(() => result.current.move('notes', { x: 20, y: 20 }));
    expect(rectOf(result.current.layout, 'notes')).toMatchObject({ x: 8, y: 5, w: 4, h: 3 });
  });

  it('resizes a module into free space and persists it', async () => {
    const { result } = await mountLoaded(sparse);
    act(() => result.current.resize('notes', { w: 5, h: 4 }));
    expect(rectOf(result.current.layout, 'notes')).toMatchObject({ x: 0, y: 4, w: 5, h: 4 });
  });

  it('rejects a resize that would overlap another module', async () => {
    const { result } = await mountLoaded(sparse);
    act(() => result.current.resize('calendar', { w: 5, h: 8 }));
    expect(rectOf(result.current.layout, 'calendar')).toMatchObject({ w: 5, h: 4 });
  });

  it('rejects a resize below the module minimum size', async () => {
    const { result } = await mountLoaded(sparse);
    act(() => result.current.resize('calendar', { w: 2, h: 2 }));
    expect(rectOf(result.current.layout, 'calendar')).toMatchObject({ w: 5, h: 4 });
  });

  it('adds an extension module into the first free slot and persists it', async () => {
    const { result, saved } = await mountLoaded(sparse);
    act(() => result.current.addWidget('focusTimer'));
    expect(rectOf(result.current.layout, 'focusTimer')).toBeDefined();
    expect(rectOf(saved(), 'focusTimer')).toBeDefined();
  });

  it('falls back to the minimum size when the default size does not fit', async () => {
    // Fill the grid so only a small pocket of free cells remains: a 3x3 hole
    // at the bottom-right. focusTimer's default is 4x4 (too big) but its
    // minimum is 2x2 (fits), so it should still be placed at its smallest size.
    const packed: LayoutState = [
      { id: 'calendar', x: 0, y: 0, w: 12, h: 5 },
      { id: 'matrix', x: 0, y: 5, w: 9, h: 3 }
    ];
    const { result, saved } = await mountLoaded(packed);
    act(() => result.current.addWidget('focusTimer'));
    const placed = rectOf(result.current.layout, 'focusTimer');
    expect(placed).toMatchObject({ w: 2, h: 2 });
    expect(rectOf(saved(), 'focusTimer')).toMatchObject({ w: 2, h: 2 });
  });

  it('ignores adding a module that is already present', async () => {
    const { result } = await mountLoaded(sparse);
    act(() => result.current.addWidget('calendar'));
    expect(result.current.layout.filter((item) => item.id === 'calendar')).toHaveLength(1);
  });

  it('removes a module and persists the smaller layout', async () => {
    const { result, saved } = await mountLoaded(sparse);
    act(() => result.current.removeWidget('notes'));
    expect(rectOf(result.current.layout, 'notes')).toBeUndefined();
    expect(rectOf(saved(), 'notes')).toBeUndefined();
  });

  it('restores the default layout on reset', async () => {
    const { result } = await mountLoaded(sparse);
    act(() => result.current.removeWidget('notes'));
    act(() => result.current.reset());
    expect(result.current.layout).toEqual(defaultLayout);
  });

  it('drops entries whose definition is unknown after load', async () => {
    const withUnknown: LayoutState = [
      ...sparse,
      { id: 'custom:gone', x: 8, y: 4, w: 4, h: 3 }
    ];
    const { result } = await mountLoaded(withUnknown);
    expect(rectOf(result.current.layout, 'custom:gone')).toBeUndefined();
  });
});
