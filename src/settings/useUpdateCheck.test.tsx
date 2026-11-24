import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useUpdateCheck } from './useUpdateCheck';

const repository = vi.hoisted(() => ({
  getAppVersionInfo: vi.fn(), checkForUpdate: vi.fn(), openStorePage: vi.fn(),
}));
vi.mock('../data/RepositoryContext', () => ({ useNowlyRepository: () => repository }));

beforeEach(() => {
  vi.resetAllMocks();
  repository.getAppVersionInfo.mockResolvedValue({ currentVersion: '1.1.11.0', distribution: 'msix' });
  repository.checkForUpdate.mockResolvedValue({ status: 'available', updateAvailable: true });
  repository.openStorePage.mockResolvedValue({ openedInBrowser: false });
});

describe('useUpdateCheck', () => {
  it('retains the installed package version after a Store failure and retries', async () => {
    repository.checkForUpdate.mockRejectedValueOnce(new Error('Store offline'));
    const { result } = renderHook(useUpdateCheck);
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.version?.currentVersion).toBe('1.1.11.0');
    expect(result.current.updateAvailable).toBe(false);
    expect(result.current.error).toBe('Store offline');
    await act(() => result.current.retry());
    expect(result.current.status).toBe('available');
    expect(result.current.updateAvailable).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('does not query updates for unpackaged apps but still opens the Store', async () => {
    repository.getAppVersionInfo.mockResolvedValue({ currentVersion: '0.1.5', distribution: 'unpackaged' });
    const { result } = renderHook(useUpdateCheck);
    await waitFor(() => expect(result.current.status).toBe('unsupported'));
    expect(result.current.version?.currentVersion).toBe('0.1.5');
    expect(repository.checkForUpdate).not.toHaveBeenCalled();
    await act(() => result.current.openStore());
    expect(repository.openStorePage).toHaveBeenCalledOnce();
  });

  it('does not substitute a build version when package identity lookup fails', async () => {
    repository.getAppVersionInfo.mockRejectedValue(new Error('Package unavailable'));
    const { result } = renderHook(useUpdateCheck);
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.version).toBeNull();
    expect(repository.checkForUpdate).not.toHaveBeenCalled();
  });

  it('reports Store opening failures independently of the update result', async () => {
    repository.openStorePage.mockRejectedValue(new Error('Cannot open Store'));
    const { result } = renderHook(useUpdateCheck);
    await waitFor(() => expect(result.current.status).toBe('available'));
    await act(() => result.current.openStore());
    expect(result.current.openError).toBe('Cannot open Store');
    expect(result.current.status).toBe('available');
  });

  it('finishes opening the Store even if an update retry starts meanwhile', async () => {
    let finish!: (value: { openedInBrowser: boolean }) => void;
    repository.openStorePage.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const { result } = renderHook(useUpdateCheck);
    await waitFor(() => expect(result.current.status).toBe('available'));
    let opening!: void | Promise<void>;
    act(() => { opening = result.current.openStore(); });
    await act(() => result.current.retry());
    await act(async () => { finish({ openedInBrowser: true }); await opening; });
    expect(result.current.opening).toBe(false);
    expect(result.current.openedInBrowser).toBe(true);
  });

  it('keeps the package version when the native query times out', async () => {
    repository.checkForUpdate.mockRejectedValueOnce(new Error('Timed out'));
    const { result } = renderHook(useUpdateCheck);
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.version?.currentVersion).toBe('1.1.11.0');
    expect(result.current.updateAvailable).toBe(false);
  });

  it('does not start duplicate checks while a Store request is pending', async () => {
    let finish!: (value: { status: 'upToDate'; updateAvailable: false }) => void;
    repository.checkForUpdate.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const { result } = renderHook(useUpdateCheck);
    await waitFor(() => expect(result.current.status).toBe('checking'));
    await act(() => result.current.retry());
    expect(repository.checkForUpdate).toHaveBeenCalledOnce();
    await act(async () => { finish({ status: 'upToDate', updateAvailable: false }); });
    expect(result.current.status).toBe('upToDate');
    expect(result.current.updateAvailable).toBe(false);
  });
});
