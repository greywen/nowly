import { alarmToDraft, type Alarm, type AlarmDraft, type TimeRepository } from './time-model';

export type AlarmSaveState = {
  draft: AlarmDraft;
  persisted: Alarm;
  status: 'idle' | 'saving' | 'saved' | 'error' | 'deleting' | 'deleted';
  error: string | null;
  revision: number;
};

const stores = new WeakMap<TimeRepository, ReturnType<typeof createStore>>();

/** Repository-owned queues continue running after the editor unmounts. */
export function alarmAutosave(repository: TimeRepository) {
  let store = stores.get(repository);
  if (!store) { store = createStore(repository); stores.set(repository, store); }
  return store;
}

function createStore(repository: TimeRepository) {
  const entries = new Map<string, { state: AlarmSaveState; pending: boolean; running: Promise<void> | null; removing: boolean }>();
  const listeners = new Set<() => void>();
  let version = 0;
  function emit() { version++; listeners.forEach(listener => listener()); }
  function notify() { window.dispatchEvent(new Event('nowly:alarms-changed')); }
  function seed(alarm: Alarm) {
    let entry = entries.get(alarm.id);
    if (!entry) {
      entry = { state: { draft: alarmToDraft(alarm), persisted: alarm, status: 'idle', error: null, revision: 0 }, pending: false, running: null, removing: false };
      entries.set(alarm.id, entry);
    }
    return entry;
  }
  function pump(id: string) {
    const entry = entries.get(id)!;
    if (entry.running || entry.removing || !entry.pending) return;
    entry.running = Promise.resolve().then(async () => {
      while (entry.pending && !entry.removing) {
        entry.pending = false;
        const { draft, revision } = entry.state;
        try {
          const saved = await repository.updateAlarm(id, draft);
          if (entry.removing) {
            entry.state = { ...entry.state, persisted: saved };
            continue;
          }
          entry.state = { ...entry.state, persisted: saved, status: revision === entry.state.revision ? 'saved' : 'saving', error: null };
          emit();
          notify();
        } catch (error) {
          if (entry.removing) continue;
          if (revision !== entry.state.revision) continue;
          entry.state = { ...entry.state, status: 'error', error: error instanceof Error ? error.message : String(error) };
          emit();
          break;
        }
      }
    }).finally(() => { entry.running = null; if (entry.pending && !entry.removing) pump(id); });
  }
  function update(alarm: Alarm, patch: Partial<AlarmDraft>) {
    const entry = seed(alarm);
    if (entry.removing || entry.state.status === 'deleted') return;
    entry.state = { ...entry.state, draft: { ...entry.state.draft, ...patch }, revision: entry.state.revision + 1, status: 'saving', error: null };
    entry.pending = true;
    emit();
    pump(alarm.id);
  }
  function retry(id: string) {
    const entry = entries.get(id);
    if (!entry || entry.removing || entry.state.status === 'deleted') return;
    entry.state = { ...entry.state, status: 'saving', error: null };
    entry.pending = true;
    emit(); pump(id);
  }
  async function remove(alarm: Alarm) {
    const entry = seed(alarm);
    if (entry.removing || entry.state.status === 'deleted') return;
    const persistedBefore = entry.state.persisted;
    const resume = entry.pending || entry.state.status === 'saving' || entry.state.status === 'error';
    entry.removing = true;
    entry.pending = false;
    entry.state = { ...entry.state, status: 'deleting', error: null };
    emit();
    await entry.running;
    try {
      await repository.deleteAlarm(alarm.id);
      entry.state = { ...entry.state, status: 'deleted' };
      emit(); notify();
    } catch (error) {
      entry.removing = false;
      entry.state = { ...entry.state, status: resume ? 'error' : 'idle', error: error instanceof Error ? error.message : String(error) };
      emit();
      if (entry.state.persisted !== persistedBefore) notify();
      throw error;
    }
  }
  return {
    seed: (alarm: Alarm) => seed(alarm).state,
    get: (id: string) => entries.get(id)?.state,
    states: () => [...entries.values()].map(entry => entry.state),
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    version: () => version,
    update, retry, remove,
    created: (alarm: Alarm) => { seed(alarm); emit(); notify(); }
  };
}
