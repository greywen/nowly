import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { RepositoryProvider } from '../data/RepositoryContext';
import type { NowlyRepository } from '../data/nowly-repository';
import { createModuleHost, useModuleState } from './extension-module';

function repository(overrides: Partial<NowlyRepository> = {}): NowlyRepository {
  return {
    getModuleState: vi.fn().mockResolvedValue(null),
    setModuleState: vi.fn().mockResolvedValue(undefined),
    ...overrides
  } as unknown as NowlyRepository;
}

describe('createModuleHost', () => {
  it('parses stored JSON state and returns null when unset', async () => {
    const repo = repository({ getModuleState: vi.fn().mockResolvedValue('{"n":3}') });
    const host = createModuleHost(repo, 'focusTimer', '2026-07-23');
    expect(host.moduleId).toBe('focusTimer');
    expect(host.todayIso).toBe('2026-07-23');
    expect(await host.loadState<{ n: number }>()).toEqual({ n: 3 });
  });

  it('returns null for corrupt stored state instead of throwing', async () => {
    const repo = repository({ getModuleState: vi.fn().mockResolvedValue('not json') });
    const host = createModuleHost(repo, 'focusTimer', '2026-07-23');
    expect(await host.loadState()).toBeNull();
  });

  it('serializes state to JSON when saving', async () => {
    const setModuleState = vi.fn().mockResolvedValue(undefined);
    const host = createModuleHost(repository({ setModuleState }), 'vocabulary', '2026-07-23');
    await host.saveState({ starred: ['nuance'] });
    expect(setModuleState).toHaveBeenCalledWith('vocabulary', '{"starred":["nuance"]}');
  });
});

function wrapper(repo: NowlyRepository) {
  return ({ children }: { children: ReactNode }) => (
    <RepositoryProvider repository={repo}>{children}</RepositoryProvider>
  );
}

describe('useModuleState', () => {
  it('loads stored state over the fallback, then persists updates', async () => {
    const setModuleState = vi.fn().mockResolvedValue(undefined);
    const repo = repository({
      getModuleState: vi.fn().mockResolvedValue('10'),
      setModuleState
    });
    const host = createModuleHost(repo, 'focusTimer', '2026-07-23');
    const { result } = renderHook(() => useModuleState(host, 25), { wrapper: wrapper(repo) });

    // Fallback until the stored value loads.
    expect(result.current[0]).toBe(25);
    await waitFor(() => expect(result.current[0]).toBe(10));
    expect(result.current[2]).toBe(true);

    act(() => result.current[1](5));
    expect(result.current[0]).toBe(5);
    expect(setModuleState).toHaveBeenCalledWith('focusTimer', '5');
  });

  it('supports functional updates against the current value', async () => {
    const repo = repository({ getModuleState: vi.fn().mockResolvedValue('2') });
    const host = createModuleHost(repo, 'focusTimer', '2026-07-23');
    const { result } = renderHook(() => useModuleState(host, 0), { wrapper: wrapper(repo) });
    await waitFor(() => expect(result.current[0]).toBe(2));
    act(() => result.current[1]((current) => current + 3));
    expect(result.current[0]).toBe(5);
  });
});
