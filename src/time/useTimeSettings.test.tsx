import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RepositoryProvider } from '../data/RepositoryContext';
import type { NowlyRepository } from '../data/nowly-repository';
import { defaultTimeSettings, type TimeSettings } from './time-model';
import { useTimeSettings } from './useTimeSettings';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
function setup(save = vi.fn(async (settings: TimeSettings) => settings)) {
  const repository = { getTimeSettings: vi.fn(async () => defaultTimeSettings()), saveTimeSettings: save,
    listAlarms: vi.fn(), createAlarm: vi.fn(), updateAlarm: vi.fn(), deleteAlarm: vi.fn() } as unknown as NowlyRepository;
  const wrapper = ({ children }: { children: React.ReactNode }) => <RepositoryProvider repository={repository}>{children}</RepositoryProvider>;
  return { repository, wrapper };
}
function changed(label: string): TimeSettings { return { ...defaultTimeSettings(), appearance: { ...defaultTimeSettings().appearance, showLabel: true }, clocks: [{ ...defaultTimeSettings().clocks[0], label }] }; }

describe('shared time settings', () => {
  it('publishes edits to every subscriber before persistence completes', async () => {
    const pending = deferred<TimeSettings>();
    const { wrapper } = setup(vi.fn(() => pending.promise));
    const { result } = renderHook(() => [useTimeSettings(), useTimeSettings()], { wrapper });
    await waitFor(() => expect(result.current[0].state.status).toBe('ready'));
    act(() => { void result.current[0].save(changed('即时')); });
    expect(result.current[1].state.data.clocks[0].label).toBe('即时');
    await act(async () => pending.resolve(changed('即时')));
  });

  it('continues saving a newer snapshot when an obsolete write fails', async () => {
    const first = deferred<TimeSettings>();
    const save = vi.fn().mockImplementationOnce(() => first.promise).mockImplementation(async (settings: TimeSettings) => settings);
    const { wrapper } = setup(save);
    const { result } = renderHook(() => useTimeSettings(), { wrapper });
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    act(() => result.current.save(changed('旧')));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    act(() => result.current.save(changed('新')));
    await act(async () => first.reject(new Error('过期失败')));
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    expect(result.current.writeError).toBeNull();
    expect(result.current.state.data.clocks[0].label).toBe('新');
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('coalesces continuous input without delaying the live state', async () => {
    const save = vi.fn(async (settings: TimeSettings) => settings);
    const { wrapper } = setup(save);
    const { result } = renderHook(() => useTimeSettings(), { wrapper });
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    act(() => { result.current.save(changed('字')); result.current.save(changed('字号')); result.current.save(changed('字号设置')); });
    expect(result.current.state.data.clocks[0].label).toBe('字号设置');
    expect(save).not.toHaveBeenCalled();
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0].clocks[0].label).toBe('字号设置');
  });

  it('serializes writes and ignores stale responses while preserving the latest edit', async () => {
    const first = deferred<TimeSettings>();
    const save = vi.fn().mockImplementationOnce(() => first.promise).mockImplementation(async (settings: TimeSettings) => settings);
    const { wrapper } = setup(save);
    const { result } = renderHook(() => useTimeSettings(), { wrapper });
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    act(() => { void result.current.save(changed('A')); });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    act(() => { void result.current.save(changed('B')); void result.current.save(changed('C')); });
    expect(result.current.state.data.clocks[0].label).toBe('C');
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => first.resolve(changed('A')));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1][0].clocks[0].label).toBe('C');
    expect(result.current.state.data.clocks[0].label).toBe('C');
  });

  it('retains failed edits across unmount and allows retrying the latest snapshot', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('磁盘错误')).mockImplementation(async (settings: TimeSettings) => settings);
    const { wrapper } = setup(save);
    const first = renderHook(() => useTimeSettings(), { wrapper });
    await waitFor(() => expect(first.result.current.state.status).toBe('ready'));
    act(() => { void first.result.current.save(changed('保留')); });
    await waitFor(() => expect(first.result.current.writeError).toBe('磁盘错误'));
    first.unmount();
    const second = renderHook(() => useTimeSettings(), { wrapper });
    expect(second.result.current.state.data.clocks[0].label).toBe('保留');
    expect(second.result.current.writeError).toBe('磁盘错误');
    act(() => { void second.result.current.save(second.result.current.state.data); });
    await waitFor(() => expect(second.result.current.writeError).toBeNull());
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  });

  it('ignores an old load response after a newer edit and drains writes after unmount', async () => {
    const pending = deferred<TimeSettings>();
    const save = vi.fn(async (settings: TimeSettings) => settings);
    const { repository, wrapper } = setup(save);
    vi.mocked(repository.getTimeSettings).mockReturnValue(pending.promise);
    const hook = renderHook(() => useTimeSettings(), { wrapper });
    act(() => { void hook.result.current.save(changed('最新')); });
    await act(async () => pending.resolve(changed('旧读取')));
    expect(hook.result.current.state.data.clocks[0].label).toBe('最新');
    act(() => { void hook.result.current.save(changed('关闭前')); });
    hook.unmount();
    await waitFor(() => expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ clocks: [expect.objectContaining({ label: '关闭前' })] })));
  });

  it('does not overwrite an empty label while typing or share different repositories', async () => {
    const a = setup(); const b = setup();
    const first = renderHook(() => useTimeSettings(), { wrapper: a.wrapper });
    const second = renderHook(() => useTimeSettings(), { wrapper: b.wrapper });
    await waitFor(() => expect(first.result.current.state.status).toBe('ready'));
    await waitFor(() => expect(second.result.current.state.status).toBe('ready'));
    act(() => { void first.result.current.save(changed('')); });
    expect(first.result.current.state.data.clocks[0].label).toBe('');
    expect(second.result.current.state.data.clocks[0].label).not.toBe('');
    await waitFor(() => expect(a.repository.saveTimeSettings).toHaveBeenCalled());
    expect(first.result.current.state.data.clocks[0].label).toBe('');
  });
});
