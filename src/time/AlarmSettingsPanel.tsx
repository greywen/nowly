import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { alarmAutosave } from './alarm-autosave';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { t } from '../i18n';
import { Pencil, Plus, Trash2 } from '../components/icons';
import { useTimeRepository } from './useTimeSettings';
import { type Alarm, type AlarmDraft } from './time-model';
import { AlarmEditor } from './AlarmEditor';
import { tt } from './time-translations';

export function AlarmSettingsPanel({ onCountChange, createAlarm = false }: { onCountChange?: (count: number) => void; createAlarm?: boolean }) {
  const repository = useTimeRepository();
  const store = repository ? alarmAutosave(repository) : null;
  const version = useSyncExternalStore(store?.subscribe ?? (() => () => undefined), store?.version ?? (() => 0));
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<Alarm | null | 'new'>(createAlarm ? 'new' : null);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Alarm | null>(null);
  const [busy, setBusy] = useState(false);
  const deleteTrigger = useRef<HTMLElement | null>(null);
  const addTrigger = useRef<HTMLButtonElement | null>(null);

  const creating = useRef(false);

  function persistedAlarms(items: Alarm[]) {
    const result = new Map(items.map(item => [item.id, item]));
    store?.states().forEach(state => {
      if (state.status === 'deleted') result.delete(state.persisted.id);
      else result.set(state.persisted.id, state.persisted);
    });
    return [...result.values()];
  }

  useEffect(() => {
    setAlarms(current => persistedAlarms(current));
  }, [store, version]);

  useEffect(() => {
    let cancelled = false;
    repository?.listAlarms()
      .then((items) => {
        if (cancelled) return;
        setAlarms(persistedAlarms(items));
        setLoaded(true);
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : '闹钟加载失败');
      });
    return () => {
      cancelled = true;
    };
  }, [repository]);

  useEffect(() => {
    if (loaded) onCountChange?.(alarms.length);
  }, [alarms.length, loaded, onCountChange]);

  async function saveAlarm(draft: AlarmDraft) {
    if (!repository) throw new Error(tt('time.saveError'));
    if (!store) throw new Error(tt('time.saveError'));
    if (editing && editing !== 'new') {
      store.update(editing, draft);
      return;
    }
    if (creating.current) return;
    creating.current = true;
    try {
      const saved = await repository.createAlarm(draft);
      store.created(saved);
      setAlarms(current => persistedAlarms(current));
      setEditing(saved);
    } finally {
      creating.current = false;
    }
  }

  function toggleAlarm(alarm: Alarm, enabled: boolean) {
    if (!store || busy) return;
    store.update(alarm, { enabled });
  }

  async function deleteAlarm() {
    if (!repository || !deleteTarget || busy) return;
    setBusy(true);
    setError(null);
    try {
      await store!.remove(deleteTarget);
      setAlarms((current) => current.filter((item) => item.id !== deleteTarget.id));
      if (editing !== 'new' && editing?.id === deleteTarget.id) setEditing(null);
      deleteTrigger.current = addTrigger.current;
      setDeleteTarget(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : tt('time.saveError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="time-settings-section">
      {error ? <p className="time-error" role="alert">{error}</p> : null}
      {store?.states().filter(state => state.status === 'error' && (editing === 'new' || editing?.id !== state.persisted.id)).map(state => (
        <div key={state.persisted.id}>
          <p className="time-error" role="alert">{state.persisted.title}: {state.error}</p>
          <button type="button" className="time-action-button" onClick={() => store.retry(state.persisted.id)}>{tt('time.retry')}</button>
        </div>
      ))}
      {editing ? (
        <AlarmEditor key={editing === 'new' ? 'new' : editing.id} alarm={editing === 'new' ? null : editing}
          saveState={editing === 'new' ? undefined : store?.seed(editing)}
          onRetry={editing === 'new' ? undefined : () => store?.retry(editing.id)}
          onCancel={() => setEditing(null)} onSave={saveAlarm} />
      ) : (
        <button ref={addTrigger} type="button" className="time-action-button" onClick={() => setEditing('new')}>
          <Plus aria-hidden="true" />
          {tt('time.alarms.add')}
        </button>
      )}
      <div className="time-alarm-list">
        {alarms.length === 0 ? <p className="time-empty">{tt('time.alarms.empty')}</p> : null}
        {alarms.map((alarm) => (
          <article className="time-alarm-row" key={alarm.id}>
            <label className="form-check form-check-custom form-check-solid">
              <input className="form-check-input" type="checkbox" disabled={busy} checked={store?.get(alarm.id)?.draft.enabled ?? alarm.enabled} onChange={(event) => void toggleAlarm(alarm, event.target.checked)} />
              <span className="form-check-label">{tt(alarm.enabled ? 'time.alarms.enabledState' : 'time.alarms.disabledState')}</span>
            </label>
            <div className="time-alarm-row__copy">
              <strong>{alarm.title}</strong>
              <span>{String(alarm.hour).padStart(2, '0')}:{String(alarm.minute).padStart(2, '0')} · {repeatText(alarm)}</span>
            </div>
            <div className="time-alarm-row__actions">
              <button type="button" className="good-icon-button" aria-label={tt('time.alarms.editLabel', { title: alarm.title })} onClick={() => setEditing(alarm)}><Pencil aria-hidden="true" /></button>
              <button type="button" className="good-icon-button" aria-label={tt('time.alarms.deleteLabel', { title: alarm.title })} disabled={busy} onClick={(event) => { deleteTrigger.current = event.currentTarget; setError(null); setDeleteTarget(alarm); }}><Trash2 aria-hidden="true" /></button>
            </div>
          </article>
        ))}
      </div>
      {deleteTarget ? (
        <ConfirmDialog title={tt('time.alarms.confirmDelete')} description={deleteTarget.title}
          tone="danger" confirmLabel={t('common.permanentDelete')} busyLabel={t('common.deleting')}
          busy={busy} errorMessage={error ?? undefined} restoreFocusRef={deleteTrigger}
          onCancel={() => { setDeleteTarget(null); setError(null); }} onConfirm={() => void deleteAlarm()} />
      ) : null}
    </div>
  );
}

function repeatText(alarm: Alarm) {
  if (alarm.repeat.kind === 'once') return alarm.repeat.date;
  if (alarm.repeat.weekdays.length === 7) return tt('time.alarms.daily');
  if (alarm.repeat.weekdays.join(',') === '1,2,3,4,5') return tt('time.alarms.weekdays');
  return alarm.repeat.weekdays.map((weekday) => tt(`time.weekday.${weekday}` as Parameters<typeof tt>[0])).join('、');
}
