import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useEffect, useState } from 'react';
import type { FocusStatus } from './focus-model';

export type NativeFocusStatusSnapshot = {
  status: FocusStatus;
  sessionId: string | null;
  plannedSeconds: number;
  remainingSeconds: number;
  focusedSeconds: number;
  startedAt: string | null;
  stageSequence: number;
  stageChangedAt?: string | null;
};

export function useNativeFocusSnapshot(): NativeFocusStatusSnapshot | null {
  const [snapshot, setSnapshot] = useState<NativeFocusStatusSnapshot | null>(null);
  useEffect(() => {
    let disposed = false;
    let revision = 0;
    let remove = () => {};
    const refresh = async () => {
      const request = ++revision;
      try {
        const current = await invoke<NativeFocusStatusSnapshot>('get_focus_timer_snapshot');
        if (!disposed && request === revision) setSnapshot(current);
      } catch { /* Keep the last authoritative snapshot until the next event or resume. */ }
    };
    void listen<NativeFocusStatusSnapshot>('focus-timer-updated', event => {
      revision += 1;
      if (!disposed) setSnapshot(event.payload);
    }).then(unlisten => {
      if (disposed) unlisten();
      else { remove = unlisten; void refresh(); }
    });
    window.addEventListener('pageshow', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      disposed = true;
      revision += 1;
      remove();
      window.removeEventListener('pageshow', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  return snapshot;
}
