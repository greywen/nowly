import { useTranslation, t, getLocale } from '../i18n';
import { useId, useState } from 'react';
import { Check, ChevronDown, CircleAlert, RefreshCw, Trash2, X } from '../components/icons';
import { DatePicker } from '../components/DatePicker';
import { TimePicker } from '../components/TimePicker';
import { Select } from '../components/Select';
import type { Action, Change, Fields, Plan } from './types';

export const kinds: Record<Action['kind'], string> = {
  createEvent: 'assistant.kind.createEvent', updateEvent: 'assistant.kind.updateEvent', deleteEvent: 'assistant.kind.deleteEvent',
  createTask: 'assistant.kind.createTask', updateTask: 'assistant.kind.updateTask', deleteTask: 'assistant.kind.deleteTask',
  createNote: 'assistant.kind.createNote', updateNote: 'assistant.kind.updateNote', deleteNote: 'assistant.kind.deleteNote',
  createAlarm: 'assistant.kind.createAlarm', updateAlarm: 'assistant.kind.updateAlarm', deleteAlarm: 'assistant.kind.deleteAlarm',
  createRemoteEvent: 'assistant.kind.createRemoteEvent', updateRemoteEvent: 'assistant.kind.updateRemoteEvent'
};
export const statuses: Record<Plan['status'], string> = {
  pending: 'assistant.status.pending', committed: 'assistant.status.committed', undone: 'assistant.status.undone',
  cancelled: 'assistant.status.cancelled', expired: 'assistant.status.expired', executing: 'assistant.status.executing',
  failed: 'assistant.status.failed', undoing: 'assistant.status.undoing'
};
const isAlarm = (kind: Action['kind']) => kind.endsWith('Alarm');
const isRemote = (kind: Action['kind']) => kind.endsWith('RemoteEvent');
const pad = (value: unknown) => String(typeof value === 'number' ? value : 0).padStart(2, '0');
function weekdayNames(days: unknown[]): string {
  // Alarm weekdays count from Monday = 1; 2024-01-01 was a Monday.
  return days.map(day => new Date(2024, 0, Number(day)).toLocaleDateString(getLocale(), { weekday: 'short' }))
    .join(t('assistant.separator'));
}
function priorityOptions() { return [
  { value: '', label: 'assistant.text64' },
  { value: 'important_urgent', label: 'assistant.text65' },
  { value: 'important_not_urgent', label: 'assistant.text66' },
  { value: 'not_important_urgent', label: 'assistant.text67' },
  { value: 'not_important_not_urgent', label: 'assistant.text68' }
].map(option => ({ ...option, label: t(option.label) })); }
const fields: Record<string, string> = {
  title: 'assistant.field.title', startAt: 'assistant.field.startAt', endAt: 'assistant.field.endAt', allDay: 'assistant.field.allDay', reminders: 'assistant.field.reminders',
  category: 'assistant.field.category', color: 'assistant.field.color', note: 'assistant.field.note', description: 'assistant.field.description',
  dueDate: 'assistant.field.dueDate', priority: 'assistant.field.priority', completed: 'assistant.field.completed', laneId: 'assistant.field.laneId',
  views: 'assistant.field.views', linkedEventId: 'assistant.field.linkedEventId', linkedTaskId: 'assistant.field.linkedTaskId',
  text: 'assistant.field.content', pinned: 'assistant.field.pinned', tagIds: 'assistant.field.tagIds', steps: 'assistant.field.steps',
  recurrence: 'assistant.field.repeat', time: 'assistant.field.time', repeat: 'assistant.field.repeat', enabled: 'assistant.field.enabled',
  calendar: 'assistant.field.calendar'
};
/** Fields a new or deleted record only lists when they hold something. */
const sparse = new Set(['tagIds', 'steps', 'recurrence']);
function present(key: string, value: unknown): boolean {
  if (value === undefined) return false;
  if (!sparse.has(key)) return true;
  return value !== null && !(Array.isArray(value) && value.length === 0);
}
/** An alarm's hour and minute read as one "07:30" field. */
function shown(change: Change, data: Fields | null): Fields | null {
  if (!data || !isAlarm(change.kind)) return data;
  return { ...data, time: `${pad(data.hour)}:${pad(data.minute)}` };
}
export function displayField(key: string, value: unknown, plan?: Plan): string {
  if (key === 'recurrence' && (value === null || value === undefined)) return t('assistant.repeat.none');
  if (value === null || value === undefined || value === '') return t('assistant.text69');
  if (key === 'tagIds' && Array.isArray(value)) return value.length
    ? value.map(id => plan?.options?.tags?.find(tag => tag.id === id)?.name ?? String(id)).join(t('assistant.separator'))
    : t('assistant.text69');
  if (key === 'steps' && Array.isArray(value)) return value.length
    ? (value as { title?: unknown; completed?: unknown }[]).map(step => `${step.completed ? '✓ ' : ''}${String(step.title ?? '')}`).join(t('assistant.separator'))
    : t('assistant.text69');
  if (key === 'recurrence' && typeof value === 'object') {
    const { freq, interval } = value as { freq?: string; interval?: number };
    const label = t(`assistant.repeat.${freq ?? 'daily'}`);
    return interval && interval > 1 ? `${label} · ${t('assistant.repeat.interval', { count: interval })}` : label;
  }
  if (key === 'repeat' && typeof value === 'object') {
    const { kind, weekdays } = value as { kind?: string; weekdays?: unknown[] };
    return kind === 'weekly' && Array.isArray(weekdays) ? weekdayNames(weekdays) : t('time.alarms.once');
  }
  if (key === 'reminders' && Array.isArray(value)) return value.length ? value.map(n => n === 0 ? t('assistant.text70') : t('assistant.before', { minutes: n })).join(t('assistant.separator')) : t('assistant.text71');
  if (key === 'priority') return priorityOptions().find(p => p.value === value)?.label ?? String(value);
  if (key === 'laneId') return plan?.options?.lanes?.find(l => l.id === value)?.name ?? String(value);
  if (key === 'category') return plan?.options?.categories?.find(c => c.id === value)?.name
    ?? ({ work: t('assistant.text72'), personal: t('assistant.text73'), important: t('assistant.text74'), learning: t('assistant.text75') } as Record<string, string>)[String(value)]
    ?? String(value);
  if (key === 'views' && Array.isArray(value)) return value.map(v => ({ kanban: t('assistant.text76'), matrix: t('assistant.field.priority'), calendar: t('assistant.text77') } as Record<string, string>)[v] ?? v).join(t('assistant.separator')) || t('assistant.text69');
  if (typeof value === 'boolean') return value ? t('assistant.text78') : t('assistant.text79');
  return String(value).replace('T', ' ');
}
// The plan preview as it appears in the Nowly Bar. An event's color is left out
// of the diff: it is chosen from the category, not something the assistant asks
// the user to verify here.
export function ChangeDetails({ change, plan }: { change: Change; plan: Plan }) {
  const { t, language } = useTranslation();
  const before = shown(change, change.before);
  const after = shown(change, change.after);
  return <dl className="assistant-diff">
    {Object.entries(fields).filter(([key]) => !(change.kind.endsWith('Event') && key === 'color'))
      .filter(([key]) => before === null || after === null
      ? present(key, (before ?? after)?.[key])
      : JSON.stringify(before[key]) !== JSON.stringify(after[key]))
      .map(([key, label]) => <div key={key}><dt>{t(label)}</dt><dd>
        {before && <span>{displayField(key, before[key], plan)} → </span>}
        {after ? displayField(key, after[key], plan) : t('assistant.text80')}
      </dd></div>)}
  </dl>;
}
function DateField({ label, value, onChange, time = false }: { label: string; value: string; onChange: (v: string) => void; time?: boolean }) {
  const { t } = useTranslation();
  const id = useId(); const [open, setOpen] = useState<'date' | 'time' | null>(null);
  return <div className="assistant-date">
    <DatePicker id={`${id}-date`} label={time ? t('assistant.dateLabel', { label }) : label} value={value.slice(0, 10)}
      open={open === 'date'} onOpenChange={v => setOpen(v ? 'date' : null)}
      onChange={v => onChange(time && v ? `${v}T${value.slice(11, 16) || '09:00'}` : v)} />
    {time && <TimePicker id={`${id}-time`} label={t('assistant.timeLabel', { label })} value={value.slice(11, 16)}
      open={open === 'time'} onOpenChange={v => setOpen(v ? 'time' : null)}
      onChange={v => onChange(v && value.slice(0, 10) ? `${value.slice(0, 10)}T${v}` : '')} />}
  </div>;
}
function AlarmTime({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const id = useId(); const [open, setOpen] = useState(false);
  return <TimePicker id={id} label={label} value={value} open={open} onOpenChange={setOpen} onChange={v => { if (v) onChange(v); }} />;
}
type Props = {
  plan: Plan; actions: Action[]; edits: Fields[]; selected: boolean[]; dirty: boolean; busy: boolean; blocked: boolean;
  onEdit: (index: number, fields: Fields) => void; onSelect: (index: number, checked: boolean) => void;
  onRevise: () => void; onConfirm: () => void; onCancel: () => void;
};
export function PlanCard({ plan, actions, edits, selected, dirty, busy, blocked, onEdit, onSelect, onRevise, onConfirm, onCancel }: Props) {
  const { t, language } = useTranslation();
  const count = selected.filter(Boolean).length;
  const deletes = actions.filter((a, i) => selected[i] && a.kind.startsWith('delete')).length;
  const expired = plan.expiresAt <= Date.now() || plan.status !== 'pending';
  return <section className="assistant-plan" aria-label={t('assistant.text81')}>
    <div className="assistant-plan-overview"><span className="assistant-eyebrow">{t('assistant.text82')}</span>
      <strong>{t(actions.some(a => isRemote(a.kind)) ? 'assistant.remoteChanges' : 'assistant.localChanges', { count })}{deletes > 0 ? t('assistant.deletes', { count: deletes }) : ''}</strong>
      <p className="assistant-caption">{t('assistant.expires', { time: new Date(plan.expiresAt).toLocaleTimeString(getLocale(), { hour12: false }) })}</p></div>
    {plan.warnings.map((warning, i) => <div className="assistant-warning" key={i}><CircleAlert aria-hidden="true" size={17} /><p>{warning}</p></div>)}
    {plan.changes.map((change, index) => {
      const action = actions[index]; if (!action) return null;
      const value = { ...change.after, ...edits[index] };
      const event = action.kind.endsWith('Event');
      const recurring = Boolean(change.before?.seriesId);
      const edit = (key: string, v: unknown) => onEdit(index, { [key]: v });
      return <article className="assistant-change" key={change.key}>
        <header className="assistant-change-header"><label className="form-check form-check-custom form-check-solid">
            <input className="form-check-input" type="checkbox" checked={selected[index] ?? false} disabled={busy || blocked || expired}
              onChange={e => onSelect(index, e.target.checked)} />
            <span className="form-check-label">{t(kinds[action.kind])} · {change.title}{recurring ? t('assistant.text83') : ''}</span>
          </label><span className="assistant-change-number">{String(index + 1).padStart(2, '0')}</span></header>
        <ChangeDetails change={change} plan={plan} />
        {!action.kind.startsWith('delete') && <details className="assistant-editor" open={actions.length === 1}>
          <summary>{t('assistant.adjust', { kind: t(kinds[action.kind]), title: change.title })}<ChevronDown aria-hidden="true" size={17} /></summary>
          <fieldset disabled={busy || !selected[index] || blocked || expired} className="assistant-edit">
          <legend className="visually-hidden">{t('assistant.text84')}</legend>
          {action.kind.endsWith('Note') ? <>
            <label>{t('assistant.field.content')}<textarea aria-label={t('assistant.indexedField', { label: t('assistant.field.content'), index: index + 1 })}
              value={String(edits[index]?.content ?? change.after?.text ?? '')} maxLength={16000} onChange={e => edit('content', e.target.value)} /></label>
            <label className="form-check form-check-custom form-check-solid">
              <input className="form-check-input" type="checkbox" checked={Boolean(value.pinned)} onChange={e => edit('pinned', e.target.checked)} />
              <span className="form-check-label">{t('assistant.field.pinned')}</span>
            </label>
          </> : isAlarm(action.kind) ? <>
            <label>{t('assistant.field.title')}<input aria-label={t('assistant.indexedField', { label: t('assistant.field.title'), index: index + 1 })} value={String(value.title ?? '')} maxLength={80} onChange={e => edit('title', e.target.value)} /></label>
            <AlarmTime label={t('assistant.indexedField', { label: t('assistant.field.time'), index: index + 1 })}
              value={`${pad(value.hour)}:${pad(value.minute)}`}
              onChange={v => { const [hour, minute] = v.split(':').map(Number); onEdit(index, { hour, minute }); }} />
            <label className="form-check form-check-custom form-check-solid">
              <input className="form-check-input" type="checkbox" checked={Boolean(value.enabled)} onChange={e => edit('enabled', e.target.checked)} />
              <span className="form-check-label">{t('assistant.field.enabled')}</span>
            </label>
          </> : <>
          <label>{t('assistant.field.title')}<input aria-label={t('assistant.indexedField', { label: t('assistant.field.title'), index: index + 1 })} value={String(value.title ?? '')} maxLength={500} onChange={e => edit('title', e.target.value)} /></label>
          {event ? <>
            <DateField label={t('assistant.indexedField', { label: t('assistant.field.startAt'), index: index + 1 })} value={String(value.startAt ?? '')} time onChange={v => edit('startAt', v)} />
            <DateField label={t('assistant.indexedField', { label: t('assistant.field.endAt'), index: index + 1 })} value={String(value.endAt ?? '')} time onChange={v => edit('endAt', v)} />
            {!recurring && <label>{t('assistant.text85')}
              <input aria-label={t('assistant.indexedField', { label: t('assistant.field.reminders'), index: index + 1 })} defaultValue={Array.isArray(value.reminders) ? value.reminders.join(',') : ''}
                onChange={e => edit('reminders', e.target.value.trim() ? e.target.value.split(/[,，]/).map(n => Number(n.trim())) : [])} />
            </label>}
            {!isRemote(action.kind) && <Select id={`category-${index}`} label={t('assistant.indexedField', { label: t('assistant.field.category'), index: index + 1 })}
              value={String(value.category ?? '')}
              options={[{ value: '', label: t('assistant.text69') }, ...(plan.options?.categories ?? []).map(c => ({ value: c.id, label: c.name }))]}
              onChange={v => edit('category', v || (action.kind === 'createEvent' ? null : ''))} />}
            <label>{t('assistant.field.note')}<textarea aria-label={t('assistant.indexedField', { label: t('assistant.field.note'), index: index + 1 })} value={String(value.note ?? '')} maxLength={8000} onChange={e => edit('note', e.target.value)} /></label>
          </> : <>
            <label>{t('assistant.field.description')}<textarea aria-label={t('assistant.indexedField', { label: t('assistant.field.description'), index: index + 1 })} value={String(value.description ?? '')} maxLength={8000} onChange={e => edit('description', e.target.value)} /></label>
            <DateField label={t('assistant.indexedField', { label: t('assistant.field.dueDate'), index: index + 1 })} value={String(value.dueDate ?? '')} onChange={v => edit('dueDate', v || null)} />
            <Select id={`priority-${index}`} label={t('assistant.indexedField', { label: t('assistant.field.priority'), index: index + 1 })} value={String(value.priority ?? '')} options={priorityOptions()} onChange={v => edit('priority', v || null)} />
            <Select id={`lane-${index}`} label={t('assistant.indexedField', { label: t('assistant.field.laneId'), index: index + 1 })} value={String(value.laneId ?? '')}
              options={[{ value: '', label: t('assistant.noLane') }, ...(plan.options?.lanes ?? []).map(l => ({ value: l.id, label: l.name }))]}
              onChange={v => edit('laneId', v || null)} />
            <label className="form-check form-check-custom form-check-solid">
              <input className="form-check-input" type="checkbox" checked={Boolean(value.completed)} onChange={e => edit('completed', e.target.checked)} />
              <span className="form-check-label">{t('assistant.text86')}</span>
            </label>
          </>}
          </>}
          </fieldset>
        </details>}
      </article>;
    })}
    {dirty && <p role="status">{t('assistant.text87')}</p>}
    {(expired || blocked) && <p role="status">{t('assistant.text88')}</p>}
    <div className="assistant-actions">
      <button className="btn" aria-label={t('assistant.text89')} onClick={onCancel} disabled={busy}><X aria-hidden="true" />{t('assistant.text90')}</button>
      {dirty && <button className="btn" aria-label={t('assistant.text91')} onClick={onRevise} disabled={busy || !count || expired || blocked}><RefreshCw aria-hidden="true" />{t('assistant.text92')}</button>}
      <button className={`btn ${deletes ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm}
        aria-label={t('assistant.confirmExecution', { count })} disabled={busy || dirty || !count || expired || blocked}>
        {deletes ? <Trash2 aria-hidden="true" /> : <Check aria-hidden="true" />}{t('assistant.confirmCount', { count })}
      </button>
    </div>
  </section>;
}
