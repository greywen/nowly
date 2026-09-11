import { listen } from '@tauri-apps/api/event';
import { useEffect, useRef } from 'react';
import { AssistantDock } from '../assistant/AssistantDock';
import { assistantClient } from '../assistant/client';
import './quick-panel.css';

export function QuickPanelApp() {
  const hostRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const removers: Array<() => void> = [];
    void listen('quick-panel-open', () => {
      window.setTimeout(() => hostRef.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus(), 0);
    }).then(remove => removers.push(remove));
    window.setTimeout(() => hostRef.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus(), 0);
    return () => removers.forEach(remove => remove());
  }, []);
  return <main ref={hostRef} className="quick-panel-root">
    <AssistantDock active client={assistantClient} onRefresh={() => undefined} />
  </main>;
}
