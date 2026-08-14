import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app/App';
import { RepositoryProvider } from './data/RepositoryContext';
import { tauriNowlyRepository } from './data/tauri-nowly-repository';
import { FocusTimerProvider } from './focus/FocusTimerContext';
import './app/styles.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <RepositoryProvider repository={tauriNowlyRepository}>
      <FocusTimerProvider>
        <App />
      </FocusTimerProvider>
    </RepositoryProvider>
  </React.StrictMode>
);
