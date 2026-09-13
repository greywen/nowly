import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { StatusIsland } from '../app/layout/StatusIsland';
import { RefreshCw } from '../components/icons';
import { QuickPanelHandle } from './QuickPanelHandle';
import { useStatusIslandSnapshot } from './useStatusIslandSnapshot';

const DISMISSED_PRIMARY_STORAGE_KEY = 'nowly.status-island.dismissed-primary';

type DismissedPrimaryState = {
  date: string;
  keys: string[];
};

function localDate(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function readDismissedPrimary(): DismissedPrimaryState {
  try {
    const parsed = JSON.parse(localStorage.getItem(DISMISSED_PRIMARY_STORAGE_KEY) ?? 'null') as Partial<DismissedPrimaryState> | null;
    if (parsed?.date === localDate() && Array.isArray(parsed.keys) && parsed.keys.every(key => typeof key === 'string')) {
      return { date: parsed.date, keys: parsed.keys };
    }
  } catch {
    // A corrupt or unavailable cache must not block the status surface.
  }
  return { date: localDate(), keys: [] };
}

function writeDismissedPrimary(state: DismissedPrimaryState): void {
  try {
    localStorage.setItem(DISMISSED_PRIMARY_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Dismissal still applies to the live window when persistence is unavailable.
  }
}

export function StatusIslandApp() {
  const [dismissedPrimary, setDismissedPrimary] = useState(readDismissedPrimary);
  const today = localDate();
  const dismissedPrimaryKeys = dismissedPrimary.date === today ? dismissedPrimary.keys : [];
  const { model, status, refresh } = useStatusIslandSnapshot(dismissedPrimaryKeys);
  const expanded = model.primary.kind !== 'loading' && model.primary.kind !== 'summary';
  useEffect(() => {
    void invoke('set_top_surface_expanded', { expanded });
  }, [expanded]);
  if (!expanded) return <QuickPanelHandle />;
  const noop = () => undefined;
  return (
    <main className="screen-status-island-root" aria-label="Nowly 状态岛">
      <StatusIsland
        model={model}
        surface="trigger"
        onToggleDetails={() => void invoke('toggle_status_island_details')}
        onDismissPrimary={status === 'error' ? undefined : key => {
          const keys = dismissedPrimary.date === today ? dismissedPrimary.keys : [];
          const next = { date: today, keys: keys.includes(key) ? keys : [...keys, key] };
          setDismissedPrimary(next);
          writeDismissedPrimary(next);
        }}
        onOpenEvent={noop}
        onOpenTask={noop}
        onStartFocus={noop}
        onPauseFocus={noop}
        onResumeFocus={noop}
        onOpenQuickPanel={noop}
      />
      {status === 'error' ? <button type="button" className="screen-status-island-error" aria-label="状态读取失败，重试" onClick={() => void refresh()}><RefreshCw aria-hidden="true" /></button> : null}
    </main>
  );
}
