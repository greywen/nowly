import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useBarPresentation } from './useBarPresentation';
import { getLanguage, setLanguage } from '../i18n/store';
import { t } from '../i18n';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(null) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));

const originalLanguage = getLanguage();
afterEach(() => {
  setLanguage(originalLanguage);
  vi.restoreAllMocks();
});

describe('Bar presentation errors', () => {
  it('localizes structured native errors while retaining the original error in diagnostics', () => {
    setLanguage('fr');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = { code: 'system_error', message: '状态栏切换失败。' };
    const { result } = renderHook(() => useBarPresentation(false));
    act(() => result.current.failed(error));
    expect(result.current.error).toBe(t('nativeError.system_error'));
    expect(log).toHaveBeenCalledWith('Failed to update Nowly Bar presentation', error);
  });

  it('does not render raw IPC rejection strings', () => {
    setLanguage('ar');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useBarPresentation(false));
    act(() => result.current.failed('Unknown IPC exception'));
    expect(result.current.error).toBe(t('statusIsland.readError'));
  });
});
