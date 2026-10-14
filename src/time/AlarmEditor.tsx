import { useEffect, useRef, useState } from 'react';
import type { AlarmSaveState } from './alarm-autosave';
import { alarmText, alarmWeekdayText } from './alarm-autosave-translations';
import { TimePicker } from '../components/TimePicker';
import { t } from '../i18n';
import type { Alarm, AlarmDraft } from './time-model';
import { tt } from './time-translations';

type Props = {
  alarm?: Alarm | null;
  onCancel: () => void;
  onSave: (draft: AlarmDraft, patch?: Partial<AlarmDraft>) => Promise<void>;
  saveState?: AlarmSaveState;
  onRetry?: () => void;
};

const weekdays = [7, 1, 2, 3, 4, 5, 6];

function baseDraft(alarm?: Alarm | null): AlarmDraft {
  return alarm
    ? { title: alarm.title, hour: alarm.hour, minute: alarm.minute, repeat: alarm.repeat, enabled: alarm.enabled }
    : { title: '', hour: 9, minute: 0, repeat: { kind: 'weekly', weekdays: [1, 2, 3, 4, 5] }, enabled: true };
}

export function AlarmEditor({ alarm, onCancel, onSave, saveState, onRetry }: Props) {
  const initial = saveState?.draft ?? baseDraft(alarm);
  const [title, setTitle] = useState(initial.title);
  const [time, setTime] = useState(`${String(initial.hour).padStart(2, '0')}:${String(initial.minute).padStart(2, '0')}`);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [repeating, setRepeating] = useState(initial.repeat.kind === 'weekly');
  const [customWeekdays, setCustomWeekdays] = useState(initial.repeat.kind === 'weekly' ? initial.repeat.weekdays : [1, 2, 3, 4, 5]);
  const [timeOpen, setTimeOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editRevision, setEditRevision] = useState(0);
  const requestRevision = useRef(0);
  const creating = useRef(false);
  const dirtyFields = useRef(new Set<keyof AlarmDraft>());
  const changed = (...fields: (keyof AlarmDraft)[]) => {
    fields.forEach(field => dirtyFields.current.add(field));
    requestRevision.current++;
    setEditRevision(value => value + 1);
  };

  useEffect(() => {
    if (!saveState) return;
    const draft = saveState.draft;
    if (!dirtyFields.current.has('title')) setTitle(draft.title);
    if (!dirtyFields.current.has('hour') && !dirtyFields.current.has('minute')) {
      setTime(`${String(draft.hour).padStart(2, '0')}:${String(draft.minute).padStart(2, '0')}`);
    }
    if (!dirtyFields.current.has('enabled')) setEnabled(draft.enabled);
    if (!dirtyFields.current.has('repeat')) {
      setRepeating(draft.repeat.kind === 'weekly');
      if (draft.repeat.kind === 'weekly') setCustomWeekdays(draft.repeat.weekdays);
    }
  }, [saveState?.draft]);

  useEffect(() => {
    if (alarm && editRevision > 0) void submit();
  }, [editRevision]);

  async function submit() {
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      setError(tt('time.alarms.timeError'));
      return;
    }
    const [parsedHour, parsedMinute] = time.split(':').map(Number);
    const repeat = repeating
      ? { kind: 'weekly' as const, weekdays: [...customWeekdays].sort((a, b) => a - b) }
      : { kind: 'once' as const };
    if (repeat.kind === 'weekly' && repeat.weekdays.length === 0) {
      setError(tt('time.alarms.weekdaysError'));
      return;
    }
    if (!alarm && creating.current) return;
    if (!alarm) creating.current = true;
    const revision = requestRevision.current;
    setSaving(true);
    setError(null);
    try {
      const draft = { title: title.trim() || alarmText('defaultTitle'), hour: parsedHour, minute: parsedMinute, repeat, enabled };
      const fields = [...dirtyFields.current];
      const patch = Object.fromEntries(fields.map(field => [field, draft[field]])) as Partial<AlarmDraft>;
      await onSave(draft, alarm ? patch : undefined);
      if (revision === requestRevision.current) dirtyFields.current.clear();
    } catch (saveError) {
      if (revision === requestRevision.current) setError(saveError instanceof Error ? saveError.message : tt('time.saveError'));
    } finally {
      creating.current = false;
      if (revision === requestRevision.current) setSaving(false);
    }
  }

  const disabled = (!alarm && saving) || saveState?.status === 'deleting' || saveState?.status === 'deleted';

  return (
    <section className="time-alarm-editor">
      <div className="time-alarm-editor__main">
        <label className="form-check form-check-custom form-check-solid">
          <input disabled={disabled} className="form-check-input" type="checkbox" checked={enabled} onChange={(event) => { setEnabled(event.target.checked); changed('enabled'); }} />
          <span className="form-check-label">{tt('time.alarms.enabled')}</span>
        </label>
        <label className="time-field">
          <span className="visually-hidden">{tt('time.alarms.title')}</span>
          <input disabled={disabled} className="good-input" placeholder={tt('time.alarms.title')} value={title} onChange={(event) => { setTitle(event.target.value); changed('title'); }} />
        </label>
        <TimePicker id="alarm-time" label={tt('time.alarms.time')} hideLabel disabled={disabled} value={time}
          open={timeOpen} onOpenChange={setTimeOpen} onChange={value => { setTime(value); changed('hour', 'minute'); }} />
      </div>
      <div className="time-alarm-editor__repeat">
      <label className="form-check form-check-custom form-check-solid">
        <input disabled={disabled} className="form-check-input" type="checkbox" checked={repeating}
          aria-describedby={!repeating ? 'alarm-once-hint' : undefined}
          onChange={event => { setRepeating(event.target.checked); changed('repeat'); }} />
        <span className="form-check-label">{tt('time.alarms.repeat')}</span>
      </label>
      {repeating ? (
        <fieldset className="time-weekday-fieldset">
          <legend className="visually-hidden">{tt('time.alarms.custom')}</legend>
          <div className="time-weekday-group">
            {weekdays.map((weekday) => (
              <label className="time-weekday-chip" key={weekday}>
                <input disabled={disabled} className="time-weekday-chip__input" type="checkbox"
                  aria-label={tt(`time.weekday.${weekday}` as Parameters<typeof tt>[0])}
                  checked={customWeekdays.includes(weekday)}
                  onChange={(event) => {
                    setCustomWeekdays(current => event.target.checked ? [...current, weekday] : current.filter(item => item !== weekday));
                    changed('repeat');
                  }} />
                <span className="time-weekday-chip__label" aria-hidden="true">{alarmWeekdayText(weekday)}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : <span id="alarm-once-hint" className="visually-hidden">{tt('time.alarms.onceHint')}</span>}
      </div>
      {error || saveState?.error ? <p className="time-error" role="alert">{error ?? saveState?.error}</p> : null}
      <div className="time-dialog-actions time-alarm-editor__actions">
        {alarm ? <p className="time-alarm-editor__status" role="status" aria-live="polite">
          {saveState?.status === 'saving' || (!saveState && saving) ? alarmText('saving') : saveState?.status === 'saved' ? tt('time.saved') : ''}
        </p> : null}
        <button type="button" className="time-action-button" disabled={!alarm && saving} onClick={onCancel}>{alarm ? alarmText('done') : t('common.cancel')}</button>
        {!alarm ? <button type="button" className="time-primary-button" disabled={saving} onClick={submit}>{alarmText('create')}</button> : null}
        {(saveState?.status === 'error' || error) ? <button type="button" className="time-action-button" onClick={() => { if (saveState?.status === 'error' && !error && onRetry) onRetry(); else void submit(); }}>{tt('time.retry')}</button> : null}
      </div>
    </section>
  );
}
