import { defaultTimeSettings, normalizeTimeSettings, type TimeRepository, type TimeSettings } from './time-model';

export type TimeSettingsSnapshot = {
  state: { status: 'loading' | 'ready' | 'error'; data: TimeSettings; error: string | null };
  writeError: string | null;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
};

function message(error: unknown) { return error instanceof Error ? error.message : String(error); }

export class TimeSettingsStore {
  private snapshot: TimeSettingsSnapshot = { state: { status: 'loading', data: defaultTimeSettings(), error: null }, writeError: null, saveStatus: 'idle' };
  private listeners = new Set<() => void>();
  private initialized = false;
  private revision = 0;
  private loadVersion = 0;
  private pending: TimeSettings | null = null;
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private repository: TimeRepository | null) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(snapshot: TimeSettingsSnapshot) {
    this.snapshot = snapshot;
    this.listeners.forEach(listener => listener());
  }
  initialize = () => { if (!this.initialized) { this.initialized = true; void this.load(); } };
  load = async () => {
    const version = ++this.loadVersion;
    const revision = this.revision;
    this.publish({ ...this.snapshot, state: { ...this.snapshot.state, status: 'loading', error: null } });
    try {
      const data = normalizeTimeSettings(this.repository ? await this.repository.getTimeSettings() : defaultTimeSettings());
      if (version === this.loadVersion && revision === this.revision) {
        this.publish({ ...this.snapshot, state: { status: 'ready', data, error: null } });
      }
    } catch (error) {
      if (version === this.loadVersion && revision === this.revision) {
        this.publish({ ...this.snapshot, state: { ...this.snapshot.state, status: 'error', error: message(error) } });
      }
    }
  };
  save = (settings: TimeSettings) => {
    const normalized = normalizeTimeSettings(settings);
    const data = { ...normalized, clocks: normalized.clocks.map((clock, index) => ({ ...clock, label: settings.clocks[index]?.label ?? clock.label })) };
    ++this.revision;
    this.pending = data;
    this.publish({ state: { status: 'ready', data, error: null }, writeError: null, saveStatus: 'saving' });
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.drain(); }, 200);
  };
  flush = () => {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    void this.drain();
  };
  retry = () => { this.save(this.snapshot.state.data); this.flush(); };
  private async drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.pending) {
        const settings = this.pending;
        const revision = this.revision;
        this.pending = null;
        try {
          await this.repository?.saveTimeSettings(normalizeTimeSettings(settings));
          if (revision === this.revision) {
            this.publish({ ...this.snapshot, writeError: null, saveStatus: 'saved' });
          }
        } catch (error) {
          if (revision === this.revision) {
            this.publish({ ...this.snapshot, writeError: message(error), saveStatus: 'error' });
            break;
          }
        }
      }
    } finally {
      this.running = false;
    }
  }
}

const stores = new WeakMap<TimeRepository, TimeSettingsStore>();
const fallback = new TimeSettingsStore(null);
export function timeSettingsStore(repository: TimeRepository | null) {
  if (!repository) return fallback;
  let store = stores.get(repository);
  if (!store) { store = new TimeSettingsStore(repository); stores.set(repository, store); }
  return store;
}
