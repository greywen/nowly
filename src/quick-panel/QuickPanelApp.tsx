import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useEffect, useRef } from 'react';
import { AssistantDock } from '../assistant/AssistantDock';
import { assistantClient } from '../assistant/client';
import './quick-panel.css';

export function QuickPanelApp() {
  const hostRef = useRef<HTMLElement>(null);
  useEffect(() => {
    let disposed = false;
    const removers: Array<() => void> = [];
    void listen('quick-panel-open', () => {
      window.setTimeout(() => hostRef.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus(), 0);
    }).then(remove => {
      if (disposed) remove();
      else removers.push(remove);
    });
    window.setTimeout(() => hostRef.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus(), 0);
    return () => {
      disposed = true;
      removers.forEach(remove => remove());
    };
  }, []);
  function hide() { void invoke('close_quick_panel'); }
  return <main ref={hostRef} className="quick-panel-root" aria-label="AI 快捷面板" onKeyDown={event => { if (event.key === 'Escape') hide(); }}>
    <h1 className="quick-panel-title">AI 快捷面板</h1>
    <AssistantDock active client={assistantClient} onRefresh={() => undefined} />
  </main>;
}
