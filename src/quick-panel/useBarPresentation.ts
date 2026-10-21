import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { localizedRepositoryErrorMessage } from '../i18n/localize-error';

export type BarPresentation = { generation: number; strip: boolean };
type PresenceSurface = 'island' | 'keyboard' | 'details' | 'action';

export function useBarPresentation(ready: boolean) {
  const [presentation, setPresentation] = useState<BarPresentation | null>(null);
  const [error, setError] = useState('');
  const generation = useRef(-1);
  const accept = useCallback((next: BarPresentation | null) => {
    if (!next || typeof next.strip !== 'boolean' || next.generation < generation.current) return;
    generation.current = next.generation;
    setPresentation(current => current?.generation === next.generation && current.strip === next.strip ? current : next);
  }, []);
  const failed = useCallback((reason: unknown) => {
    console.error('Failed to update Nowly Bar presentation', reason);
    setError(localizedRepositoryErrorMessage(reason) ?? t('statusIsland.readError'));
  }, []);
  const refresh = useCallback(() => {
    setError('');
    void invoke<BarPresentation>('get_status_island_presentation').then(accept).catch(failed);
  }, [accept, failed]);
  const presence = useCallback((surface: PresenceSurface, present: boolean) => {
    void invoke<BarPresentation>('set_status_island_presence', { surface, present }).then(accept).catch(failed);
  }, [accept, failed]);

  useEffect(() => {
    let disposed = false;
    const removers: Array<() => void> = [];
    const keep = (remove: () => void) => disposed ? remove() : removers.push(remove);
    void listen<BarPresentation>('status-island-presentation', event => {
      if (!disposed) accept(event.payload);
    }).then(keep).catch(failed);
    void listen('tauri://blur', () => {
      if (!disposed) presence('keyboard', false);
    }, { target: { kind: 'Window', label: 'quick-panel-handle' } }).then(keep).catch(failed);
    return () => { disposed = true; removers.forEach(remove => remove()); };
  }, [accept, failed, presence]);

  useEffect(() => { if (ready) refresh(); }, [ready, refresh]);

  useEffect(() => {
    if (!presentation) return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      clearTimeout(timer);
      void invoke('finish_status_island_presentation', { generation: presentation.generation }).catch(failed);
    };
    if (media.matches) finish();
    else timer = setTimeout(finish, presentation.strip ? 260 : 320);
    const motionChanged = () => { if (media.matches) finish(); };
    media.addEventListener('change', motionChanged);
    return () => { clearTimeout(timer); media.removeEventListener('change', motionChanged); };
  }, [failed, presentation]);

  return { presentation, accept, presence, error, refresh, failed };
}
