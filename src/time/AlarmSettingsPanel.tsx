import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { alarmAutosave } from './alarm-autosave';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { t } from '../i18n';
import { Pencil, Plus, Trash2 } from '../components/icons';
import { useTimeRepository } from './useTimeSettings';
import { type Alarm, type AlarmDraft } from './time-model';
import { AlarmEditor } from './AlarmEditor';
import { tt } from './time-translations';

export function AlarmSettingsPanel({ createAlarm = false }: { createAlarm?: boolean }) {
  const repository = useTimeRepository();
  const store = repository ? alarmAutosave(repository) : null;
  const version = useSyncExternalStore(store?.subscribe ?? (() => () => undefined), store?.version ?? (() => 0));
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const editTrigger = useRef<HTMLElement | null>(null);
  const [editing, setEditing] = useState<Alarm | null | 'new'>(createAlarm ? 'new' : null);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Alarm | null>(null);
  const [busy, setBusy] = useState(false);
  const deleteTrigger = useRef<HTMLElement | null>(null);
  const addTrigger = useRef<HTMLButtonElement | null>(null);

  const creating = useRef(false);
  const focusAddAfterCreate = useRef(false);

  useEffect(() => {
    if (editing === null && focusAddAfterCreate.current) {
      focusAddAfterCreate.current = false;
      addTrigger.current?.focus();
    }
  }, [editing]);

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
    let request = 0;
    function load() {
      const currentRequest = ++request;
      repository?.listAlarms()
        .then((items) => {
          if (cancelled || currentRequest !== request) return;
          store?.reconcile(items);
          setAlarms(persistedAlarms(items));
        })
        .catch((loadError) => {
          if (!cancelled) setError(loadError instanceof Error ? loadError.message : tt('time.loadError'));
        });
    }
    load();
    window.addEventListener('nowly:alarms-changed', load);
    return () => {
      cancelled = true;
      window.removeEventListener('nowly:alarms-changed', load);
    };
  }, [repository, store]);

  function closeEditor() {
    setEditing(null);
    editTrigger.current?.focus();
  }

  async function saveAlarm(draft: AlarmDraft, patch?: Partial<AlarmDraft>) {
    if (!repository) throw new Error(tt('time.saveError'));
    if (!store) throw new Error(tt('time.saveError'));
    if (editing && editing !== 'new') {
      store.update(editing, patch ?? draft);
      return;
    }
    if (creating.current) return;
    creating.current = true;
    try {
      const saved = await repository.createAlarm(draft);
      store.created(saved);
      setAlarms(current => persistedAlarms(current));
      focusAddAfterCreate.current = true;
      setEditing(null);
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
      {editing === 'new' ? (
        <AlarmEditor key="new" onCancel={closeEditor} onSave={saveAlarm} />
      ) : (
        <button ref={addTrigger} type="button" className="time-action-button" onClick={event => { editTrigger.current = event.currentTarget; setEditing('new'); }}>
          <Plus aria-hidden="true" />
          {tt('time.alarms.add')}
        </button>
      )}
      <div className="time-alarm-list">
        {alarms.length === 0 ? <p className="time-empty">{tt('time.alarms.empty')}</p> : null}
        {alarms.map((alarm) => (
          <article className="time-alarm-row" key={alarm.id}>
            <div className="time-alarm-row__header">
            <label className="form-check form-check-custom form-check-solid">
              <input className="form-check-input" type="checkbox" disabled={busy} checked={store?.get(alarm.id)?.draft.enabled ?? alarm.enabled} onChange={(event) => void toggleAlarm(alarm, event.target.checked)} />
              <span className="form-check-label">{tt(alarm.enabled ? 'time.alarms.enabledState' : 'time.alarms.disabledState')}</span>
            </label>
            <div className="time-alarm-row__copy">
              <strong>{alarm.title}</strong>
              <span>{String(alarm.hour).padStart(2, '0')}:{String(alarm.minute).padStart(2, '0')} · {repeatText(alarm)}</span>
            </div>
            <div className="time-alarm-row__actions">
              <button ref={element => { if (element && editing !== 'new' && editing?.id === alarm.id) editTrigger.current = element; }} type="button" className="good-icon-button" aria-label={tt('time.alarms.editLabel', { title: alarm.title })} aria-expanded={editing !== 'new' && editing?.id === alarm.id} aria-controls={`alarm-editor-${alarm.id}`} onClick={event => { editTrigger.current = event.currentTarget; if (editing !== 'new' && editing?.id === alarm.id) closeEditor(); else setEditing(alarm); }}><Pencil aria-hidden="true" /></button>
              <button type="button" className="good-icon-button" aria-label={tt('time.alarms.deleteLabel', { title: alarm.title })} disabled={busy} onClick={(event) => { deleteTrigger.current = event.currentTarget; setError(null); setDeleteTarget(alarm); }}><Trash2 aria-hidden="true" /></button>
            </div>
            </div>
            {editing !== 'new' && editing?.id === alarm.id ? (
              <div id={`alarm-editor-${alarm.id}`}>
                <AlarmEditor key={alarm.id} alarm={alarm} saveState={store?.seed(alarm)}
                  onRetry={() => store?.retry(alarm.id)} onCancel={closeEditor} onSave={saveAlarm} />
              </div>
            ) : null}
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
  if (alarm.repeat.kind === 'once') return tt('time.alarms.once');
  if (alarm.repeat.weekdays.length === 7) return tt('time.alarms.daily');
  if (alarm.repeat.weekdays.join(',') === '1,2,3,4,5') return tt('time.alarms.weekdays');
  return alarm.repeat.weekdays.map((weekday) => tt(`time.weekday.${weekday}` as Parameters<typeof tt>[0])).join('、');
}
