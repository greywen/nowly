import { invoke } from '@tauri-apps/api/core';
import { useEffect } from 'react';
import './quick-panel.css';

export function QuickPanelHandle() {
  useEffect(() => {
    for (const element of [document.documentElement, document.body, document.getElementById('root')]) {
      element?.style.setProperty('background', 'transparent', 'important');
      element?.style.setProperty('background-color', 'transparent', 'important');
    }
  }, []);

  function open() {
    void invoke('open_quick_panel');
  }

  return (
    <main className="quick-panel-handle-root">
      <button
        type="button"
        className="quick-panel-handle"
        aria-label="打开 AI 快捷面板"
        onMouseEnter={open}
        onFocus={open}
        onClick={open}
      >
        <span aria-hidden="true" />
      </button>
    </main>
  );
}
