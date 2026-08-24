import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app/App';
import { RepositoryProvider } from './data/RepositoryContext';
import { tauriNowlyRepository } from './data/tauri-nowly-repository';
import { installBrowserTauriBackend } from './data/browser-tauri-shim';
import { FocusTimerProvider } from './focus/FocusTimerContext';
import './app/styles.css';

// Outside the Tauri desktop shell (e.g. the plain Vite page in a browser) there
// is no `window.__TAURI_INTERNALS__`, so every `invoke(...)` would throw
// "Cannot read properties of undefined (reading 'invoke')". Install a
// localStorage-backed in-memory backend so the UI runs for local development.
// When real Tauri IPC (or a test-injected one) is already present we leave it
// untouched.
if (!('__TAURI_INTERNALS__' in window)) {
  installBrowserTauriBackend();
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <RepositoryProvider repository={tauriNowlyRepository}>
      <FocusTimerProvider>
        <App />
      </FocusTimerProvider>
    </RepositoryProvider>
  </React.StrictMode>
);
