import { invoke } from '@tauri-apps/api/core';
import { useEffect, useRef } from 'react';
import './quick-panel.css';

const OPEN_DELAY_MS = 300;

export function QuickPanelHandle() {
  const openTimer = useRef<number | null>(null);

  function cancelOpen() {
    if (openTimer.current !== null) window.clearTimeout(openTimer.current);
    openTimer.current = null;
  }

  function scheduleOpen() {
    cancelOpen();
    openTimer.current = window.setTimeout(() => {
      openTimer.current = null;
      void invoke('open_quick_panel');
    }, OPEN_DELAY_MS);
  }

  function openImmediately() {
    cancelOpen();
    void invoke('open_quick_panel');
  }

  useEffect(() => cancelOpen, []);

  return (
    <main className="quick-panel-handle-root">
      <button
        type="button"
        className="quick-panel-handle"
        aria-label="打开 AI 快捷面板"
        onMouseEnter={scheduleOpen}
        onMouseLeave={cancelOpen}
        onFocus={scheduleOpen}
        onBlur={cancelOpen}
        onClick={openImmediately}
      >
        <span aria-hidden="true" />
      </button>
    </main>
  );
}