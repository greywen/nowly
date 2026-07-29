import { invoke } from '@tauri-apps/api/core';

export async function enterWallpaperMode(): Promise<string> {
  return await invoke<string>('enter_wallpaper_mode');
}

export async function enterForegroundMode(): Promise<string> {
  return await invoke<string>('enter_foreground_mode');
}
