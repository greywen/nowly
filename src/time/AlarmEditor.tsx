import { useEffect, useMemo, useRef, useState } from 'react';
import type { AlarmSaveState } from './alarm-autosave';
import { alarmText } from './alarm-autosave-translations';
import { DatePicker } from '../components/DatePicker';
import { Select } from '../components/Select';
import type { Alarm, AlarmDraft, AlarmRepeat } from './time-model';
import { tt } from './time-translations';

type Props = {
  alarm?: Alarm | null;
  onCancel: () => void;
  onSave: (draft: AlarmDraft) => Promise<void>;
  saveState?: AlarmSaveState;
  onRetry?: () => void;
};

type RepeatKind = 'once' | 'daily' | 'weekdays' | 'custom';

const weekdays = [1, 2, 3, 4, 5, 6, 7];

function repeatKind(repeat: AlarmRepeat): RepeatKind {
  if (repeat.kind === 'once') return 'once';
  if (repeat.weekdays.length === 7) return 'daily';
  if (repeat.weekdays.join(',') === '1,2,3,4,5') return 'weekdays';
  return 'custom';
}

function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function baseDraft(alarm?: Alarm | null): AlarmDraft {
  return alarm
    ? { title: alarm.title, hour: alarm.hour, minute: alarm.minute, repeat: alarm.repeat, enabled: alarm.enabled }
    : { title: '', hour: 9, minute: 0, repeat: { kind: 'weekly', weekdays: [1, 2, 3, 4, 5] }, enabled: true };
}

export function AlarmEditor({ alarm, onCancel, onSave, saveState, onRetry }: Props) {
  const initial = saveState?.draft ?? baseDraft(alarm);
  const [title, setTitle] = useState(initial.title);
  const [hour, setHour] = useState(String(initial.hour));
  const [minute, setMinute] = useState(String(initial.minute));
  const [enabled, setEnabled] = useState(initial.enabled);
  const [kind, setKind] = useState<RepeatKind>(repeatKind(initial.repeat));
  const [date, setDate] = useState(initial.repeat.kind === 'once' ? initial.repeat.date : todayIso());
  const [customWeekdays, setCustomWeekdays] = useState(
    initial.repeat.kind === 'weekly' && repeatKind(initial.repeat) === 'custom' ? initial.repeat.weekdays : [1, 2, 3, 4, 5]
  );
  const [dateOpen, setDateOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editRevision, setEditRevision] = useState(0);
  const requestRevision = useRef(0);
  const creating = useRef(false);
  const changed = () => { requestRevision.current++; setEditRevision(value => value + 1); };

  useEffect(() => {
    if (saveState) setEnabled(saveState.draft.enabled);
  }, [saveState?.draft.enabled]);

  useEffect(() => {
    if (alarm && editRevision > 0) void submit();
  }, [editRevision]);

  const nextText = useMemo(() => {
    const parsedHour = Number(hour);
    const parsedMinute = Number(minute);
    if (!Number.isInteger(parsedHour) || !Number.isInteger(parsedMinute)) return '—';
    return `${kind === 'once' ? date : repeatLabel(kind)} ${String(parsedHour).padStart(2, '0')}:${String(parsedMinute).padStart(2, '0')}`;
  }, [date, hour, kind, minute]);

  async function submit() {
    const parsedHour = Number(hour);
    const parsedMinute = Number(minute);
    if (!hour.trim() || !Number.isInteger(parsedHour) || parsedHour < 0 || parsedHour > 23) {
      setError(tt('time.alarms.hourError'));
      return;
    }
    if (!minute.trim() || !Number.isInteger(parsedMinute) || parsedMinute < 0 || parsedMinute > 59) {
      setError(tt('time.alarms.minuteError'));
      return;
    }
    const repeat = makeRepeat(kind, date, customWeekdays);
    if (repeat.kind === 'weekly' && repeat.weekdays.length === 0) {
      setError(tt('time.alarms.weekdaysError'));
      return;
    }
    if (repeat.kind === 'once') {
      const due = new Date(`${repeat.date}T${String(parsedHour).padStart(2, '0')}:${String(parsedMinute).padStart(2, '0')}:00`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(due.getTime()) || due.getTime() <= Date.now()) {
        setError(tt('time.alarms.pastError'));
        return;
      }
    }
    if (!alarm && creating.current) return;
    if (!alarm) creating.current = true;
    const revision = requestRevision.current;
    setSaving(true);
    setError(null);
    try {
      await onSave({ title: title.trim() || alarmText('defaultTitle'), hour: parsedHour, minute: parsedMinute, repeat, enabled });
    } catch (saveError) {
      if (revision === requestRevision.current) setError(saveError instanceof Error ? saveError.message : tt('time.saveError'));
    } finally {
      creating.current = false;
      if (revision === requestRevision.current) setSaving(false);
    }
  }

  const disabled = (!alarm && saving) || saveState?.status === 'deleting' || saveState?.status === 'deleted';

  return (
    <section className="time-alarm-editor" onChange={changed} onKeyDown={(event) => {
      if (event.key === 'Escape' && dateOpen) {
        event.preventDefault();
        event.stopPropagation();
        setDateOpen(false);
        event.currentTarget.querySelector<HTMLButtonElement>('#alarm-date')?.focus();
      }
    }}>
      <div className="time-settings-grid">
        <label className="time-field">
          <span>{tt('time.alarms.title')}</span>
          <input disabled={disabled} className="good-input" value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label className="time-field">
          <span>{tt('time.alarms.hour')}</span>
          <input disabled={disabled} className="good-input" inputMode="numeric" value={hour} onChange={(event) => setHour(event.target.value)} />
        </label>
        <label className="time-field">
          <span>{tt('time.alarms.minute')}</span>
          <input disabled={disabled} className="good-input" inputMode="numeric" value={minute} onChange={(event) => setMinute(event.target.value)} />
        </label>
        <label className="form-check form-check-custom form-check-solid time-alarm-editor__enabled">
          <input disabled={disabled} className="form-check-input" type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          <span className="form-check-label">{tt('time.alarms.enabled')}</span>
        </label>
      </div>
      <Select disabled={disabled} id="alarm-repeat" label={tt('time.alarms.repeat')} value={kind}
        options={(['once', 'daily', 'weekdays', 'custom'] as const).map((item) => ({ value: item, label: repeatLabel(item) }))}
        onChange={(value) => { setKind(value as RepeatKind); setDateOpen(false); changed(); }} />
      {kind === 'once' ? (
        <DatePicker disabled={disabled} id="alarm-date" label={tt('time.alarms.date')} value={date}
          open={dateOpen} onOpenChange={setDateOpen} onChange={(value) => { setDate(value); changed(); }} />
      ) : null}
      {kind === 'custom' ? (
        <fieldset className="time-weekday-fieldset">
          <legend>{tt('time.alarms.custom')}</legend>
          <div className="time-check-grid">
            {weekdays.map((weekday) => (
              <label className="form-check form-check-custom form-check-solid" key={weekday}>
                <input
                  disabled={disabled}
                  className="form-check-input"
                  type="checkbox"
                  checked={customWeekdays.includes(weekday)}
                  onChange={(event) => setCustomWeekdays((current) =>
                    event.target.checked ? [...current, weekday].sort() : current.filter((item) => item !== weekday)
                  )}
                />
                <span className="form-check-label">{tt(`time.weekday.${weekday}` as Parameters<typeof tt>[0])}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      <p className="time-alarm-editor__next">{tt('time.alarms.next', { value: nextText })}</p>
      {error || saveState?.error ? <p className="time-error" role="alert">{error ?? saveState?.error}</p> : null}
      {alarm ? <p className="time-alarm-editor__next" role="status" aria-live="polite">
        {saveState?.status === 'saving' || (!saveState && saving) ? alarmText('saving') : saveState?.status === 'saved' ? tt('time.saved') : ''}
      </p> : null}
      <div className="time-dialog-actions">
        <button type="button" className="time-action-button" disabled={!alarm && saving} onClick={onCancel}>{alarmText('done')}</button>
        {!alarm ? <button type="button" className="time-primary-button" disabled={saving} onClick={submit}>{alarmText('create')}</button> : null}
        {(saveState?.status === 'error' || error) ? <button type="button" className="time-action-button" onClick={() => { if (saveState?.status === 'error' && !error && onRetry) onRetry(); else void submit(); }}>{tt('time.retry')}</button> : null}
      </div>
    </section>
  );
}

function makeRepeat(kind: RepeatKind, date: string, customWeekdays: number[]): AlarmRepeat {
  if (kind === 'once') return { kind: 'once', date };
  if (kind === 'daily') return { kind: 'weekly', weekdays: [1, 2, 3, 4, 5, 6, 7] };
  if (kind === 'weekdays') return { kind: 'weekly', weekdays: [1, 2, 3, 4, 5] };
  return { kind: 'weekly', weekdays: [...customWeekdays].sort() };
}

function repeatLabel(kind: RepeatKind) {
  if (kind === 'once') return tt('time.alarms.once');
  if (kind === 'daily') return tt('time.alarms.daily');
  if (kind === 'weekdays') return tt('time.alarms.weekdays');
  return tt('time.alarms.custom');
}
