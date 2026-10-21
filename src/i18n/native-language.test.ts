import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLanguage, setLanguage, SUPPORTED_LANGUAGES } from './store';
import { startNativeLanguageSync } from './native-language';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), getCurrentWindow: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: mocks.getCurrentWindow }));

const originalLanguage = getLanguage();
let stop: (() => void) | undefined;
beforeEach(() => {
  mocks.invoke.mockReset().mockResolvedValue(undefined);
  mocks.getCurrentWindow.mockReset().mockReturnValue({ label: 'main' });
});
afterEach(() => {
  stop?.();
  stop = undefined;
  setLanguage(originalLanguage);
  vi.restoreAllMocks();
});

describe('native tray language sync', () => {
  it('sends the selected language at startup and each subsequent language change', () => {
    setLanguage('en');
    stop = startNativeLanguageSync(false);
    expect(mocks.invoke).toHaveBeenLastCalledWith('set_native_language', { language: 'en' });
    for (const language of SUPPORTED_LANGUAGES) {
      setLanguage(language);
      expect(mocks.invoke).toHaveBeenLastCalledWith('set_native_language', { language });
    }
    stop();
    mocks.invoke.mockClear();
    setLanguage('en');
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('never calls native IPC from the browser backend', () => {
    stop = startNativeLanguageSync(true);
    setLanguage('fr');
    expect(mocks.getCurrentWindow).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it.each(['quick-panel-handle', 'screenshot-history', 'screenshot-overlay-1', 'screenshot-pin-1'])(
    'does not sync from the %s surface', (label) => {
      mocks.getCurrentWindow.mockReturnValue({ label });
      stop = startNativeLanguageSync(false);
      setLanguage('fr');
      expect(mocks.invoke).not.toHaveBeenCalled();
    },
  );

  it('does not infer a main native window when injected IPC lacks window metadata', () => {
    mocks.getCurrentWindow.mockImplementation(() => { throw new Error('Missing metadata'); });
    expect(() => { stop = startNativeLanguageSync(false); }).not.toThrow();
    setLanguage('fr');
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('handles IPC rejection without blocking startup or later changes', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.invoke.mockRejectedValueOnce(new Error('Unavailable'));
    stop = startNativeLanguageSync(false);
    await Promise.resolve();
    expect(warning).toHaveBeenCalled();
    setLanguage('ar');
    expect(mocks.invoke).toHaveBeenLastCalledWith('set_native_language', { language: 'ar' });
  });
});
