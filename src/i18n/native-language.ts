import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getLanguage, subscribe } from './store';

// Call once from the application entry, not a React effect. The original
// browserOnly flag must be captured before installing the browser IPC shim.
export function startNativeLanguageSync(browserOnly: boolean): () => void {
  if (browserOnly) return () => {};
  try {
    if (getCurrentWindow().label !== 'main') return () => {};
  } catch {
    // An injected IPC bridge without native window metadata is not the shell.
    return () => {};
  }
  const sync = () => {
    void invoke('set_native_language', { language: getLanguage() }).catch(error => {
      console.warn('Unable to update native menu language', error);
    });
  };
  sync();
  return subscribe(sync);
}
