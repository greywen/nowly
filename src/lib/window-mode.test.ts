import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enterForegroundMode, enterWallpaperMode } from './window-mode';

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock
}));

describe('window mode commands', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
  });

  it('invokes enter_wallpaper_mode', async () => {
    await enterWallpaperMode();

    expect(invokeMock).toHaveBeenCalledWith('enter_wallpaper_mode');
  });

  it('invokes enter_foreground_mode', async () => {
    await enterForegroundMode();

    expect(invokeMock).toHaveBeenCalledWith('enter_foreground_mode');
  });
});
