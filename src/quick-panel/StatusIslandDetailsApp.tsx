import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useEffect, useState } from 'react';
import { StatusIsland } from '../app/layout/StatusIsland';
import { useStatusIslandSnapshot } from './useStatusIslandSnapshot';

export function StatusIslandDetailsApp() {
  const { model, status, refresh } = useStatusIslandSnapshot();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const removers: Array<() => void> = [];
    let disposed = false;
    const keep = (remove: () => void) => disposed ? remove() : removers.push(remove);
    void listen('status-island-details-open', () => setVisible(true)).then(keep);
    void listen('status-island-details-close', () => setVisible(false)).then(keep);
    return () => { disposed = true; removers.forEach(remove => remove()); };
  }, []);
  return (
    <main className="screen-status-island-details-root" data-visible={visible}>
      <StatusIsland
        model={model}
        surface="details"
        onDismissDetails={() => void invoke('close_status_island_details')}
        onOpenEvent={event => void invoke('open_status_island_event', {
          target: { id: event.id, occurrenceStartAt: event.occurrenceStartAt },
          startAt: event.startAt
        })}
        onOpenTask={id => void invoke('open_status_island_task', { id })}
        onStartFocus={() => void invoke('start_status_island_focus', { minutes: 25 })}
        onPauseFocus={() => void invoke('pause_status_island_focus')}
        onResumeFocus={() => void invoke('resume_status_island_focus')}
        onOpenQuickPanel={() => void invoke('open_quick_panel')}
        onRetryStatus={status === 'error' ? () => void refresh() : undefined}
      />
    </main>
  );
}
