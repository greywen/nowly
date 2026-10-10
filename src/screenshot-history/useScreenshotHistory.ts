import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useRef, useState } from 'react';
import { listScreenshotHistory, type ScreenshotHistoryEntry } from './client';

export function useScreenshotHistory() {
  const [items, setItems] = useState<ScreenshotHistoryEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const generation = useRef(0);
  const busy = useRef(false);
  const load = useCallback(async (cursor: string | null, reset: boolean) => {
    if (!reset && busy.current) return;
    const request = reset ? ++generation.current : generation.current;
    busy.current = true;
    setLoading(true);
    setError(false);
    try {
      const page = await listScreenshotHistory(cursor);
      if (request !== generation.current) return;
      setItems(current => {
        const unique = new Map((reset ? [] : current).map(item => [item.id, item]));
        for (const item of page.items) unique.set(item.id, item);
        return [...unique.values()];
      });
      setNextCursor(page.nextCursor);
    } catch {
      if (request === generation.current) setError(true);
    } finally {
      if (request === generation.current) { busy.current = false; setLoading(false); }
    }
  }, []);
  const refresh = useCallback(() => void load(null, true), [load]);
  useEffect(() => {
    let disposed = false;
    let remove: (() => void) | undefined;
    const reload = () => { if (!disposed) refresh(); };
    void listen('screenshot-history-changed', reload).then(unlisten => disposed ? unlisten() : remove = unlisten).catch(() => undefined);
    window.addEventListener('focus', reload);
    refresh();
    return () => { disposed = true; generation.current++; remove?.(); window.removeEventListener('focus', reload); };
  }, [refresh]);
  const removeItem = useCallback((id: string) => {
    generation.current++;
    busy.current = false;
    setLoading(false);
    setItems(current => current.filter(item => item.id !== id));
  }, []);
  return { items, nextCursor, loading, error, refresh, loadMore: () => void load(nextCursor, false), removeItem };
}
