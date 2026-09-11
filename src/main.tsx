import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app/App';
import { RepositoryProvider } from './data/RepositoryContext';
import { tauriNowlyRepository } from './data/tauri-nowly-repository';
import { installBrowserTauriBackend } from './data/browser-tauri-shim';
import { FocusTimerProvider } from './focus/FocusTimerContext';
import './app/styles.css';
import { QuickPanelApp } from './quick-panel/QuickPanelApp';
import { QuickPanelHandle } from './quick-panel/QuickPanelHandle';
import { getCurrentWindow } from '@tauri-apps/api/window';

// Outside the Tauri desktop shell (e.g. the plain Vite page in a browser) there
// is no `window.__TAURI_INTERNALS__`, so every `invoke(...)` would throw
// "Cannot read properties of undefined (reading 'invoke')". Install a
// localStorage-backed in-memory backend so the UI runs for local development.
// When real Tauri IPC (or a test-injected one) is already present we leave it
// untouched.
if (!('__TAURI_INTERNALS__' in window)) {
  installBrowserTauriBackend();
}

// Which window this document is depends on the Tauri metadata, which only the
// real desktop shell provides. A test-injected IPC stub, or any future host that
// supplies `invoke` without full metadata, satisfies the `in` check above while
// leaving `getCurrentWindow()` to throw on `metadata.currentWindow`.
//
// This runs at module top level, so an unguarded throw here happens before
// `render` and leaves a blank page rather than a degraded feature. Falling back
// to the main app is the right answer either way: the quick panel is the special
// case, so anything we cannot identify should be the app.
function currentWindowLabel(): string {
  if (!('__TAURI_INTERNALS__' in window)) return 'main';
  try {
    return getCurrentWindow().label;
  } catch {
    return 'main';
  }
}

const windowLabel = currentWindowLabel();
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    {windowLabel === 'quick-panel' ? <QuickPanelApp /> : windowLabel === 'quick-panel-handle' ? <QuickPanelHandle /> : <RepositoryProvider repository={tauriNowlyRepository}>
      <FocusTimerProvider><App /></FocusTimerProvider>
    </RepositoryProvider>}
  </React.StrictMode>
);
