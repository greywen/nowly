import { useEffect, useSyncExternalStore } from 'react';
import { useNowlyRepository } from '../data/RepositoryContext';
import { type TimeRepository } from './time-model';
import { timeSettingsStore } from './time-settings-store';

function isTimeRepository(repository: Partial<TimeRepository>): repository is TimeRepository {
  return typeof repository.getTimeSettings === 'function'
    && typeof repository.saveTimeSettings === 'function'
    && typeof repository.listAlarms === 'function'
    && typeof repository.createAlarm === 'function'
    && typeof repository.updateAlarm === 'function'
    && typeof repository.deleteAlarm === 'function';
}

export function useTimeRepository(): TimeRepository | null {
  const repository = useNowlyRepository() as unknown as Partial<TimeRepository>;
  return isTimeRepository(repository) ? repository : null;
}

export function useTimeSettings() {
  const repository = useTimeRepository();
  const store = timeSettingsStore(repository);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => { store.initialize(); }, [store]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      const status = store.getSnapshot().saveStatus;
      if (status === 'saving' || status === 'error') {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [store]);
  return { ...snapshot, load: store.load, save: store.save, retry: store.retry, flush: store.flush, repository };
}
