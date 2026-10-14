import { useTranslation, t, getLanguage } from '../i18n';
import { useId, useState } from 'react';
import { Check, ChevronDown, CircleAlert, RefreshCw, Trash2, X } from '../components/icons';
import { DatePicker } from '../components/DatePicker';
import { TimePicker } from '../components/TimePicker';
import { Select } from '../components/Select';
import type { Action, Change, Fields, Plan } from './types';

export const kinds: Record<Action['kind'], string> = {
  createEvent: 'assistant.kind.createEvent', updateEvent: 'assistant.kind.updateEvent', deleteEvent: 'assistant.kind.deleteEvent',
  createTask: 'assistant.kind.createTask', updateTask: 'assistant.kind.updateTask', deleteTask: 'assistant.kind.deleteTask'
};
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
  views: 'assistant.field.views', linkedEventId: 'assistant.field.linkedEventId', linkedTaskId: 'assistant.field.linkedTaskId'
};
export function displayField(key: string, value: unknown, plan?: Plan): string {
  if (value === null || value === undefined || value === '') return t('assistant.text69');
  if (key === 'reminders' && Array.isArray(value)) return value.length ? value.map(n => n === 0 ? t('assistant.text70') : t('assistant.before', { minutes: n })).join(t('assistant.separator')) : t('assistant.text71');
  if (key === 'priority') return priorityOptions().find(p => p.value === value)?.label ?? String(value);
  if (key === 'laneId') return plan?.options?.lanes?.find(l => l.id === value)?.name ?? String(value);
  if (key === 'category') return ({ work: t('assistant.text72'), personal: t('assistant.text73'), important: t('assistant.text74'), learning: t('assistant.text75') } as Record<string, string>)[String(value)] ?? String(value);
  if (key === 'views' && Array.isArray(value)) return value.map(v => ({ kanban: t('assistant.text76'), matrix: t('assistant.field.priority'), calendar: t('assistant.text77') } as Record<string, string>)[v] ?? v).join(t('assistant.separator')) || t('assistant.text69');
  if (typeof value === 'boolean') return value ? t('assistant.text78') : t('assistant.text79');
  return String(value).replace('T', ' ');
}
// The plan preview as it appears in the Nowly Bar. An event's color is left out
// of the diff: it is chosen from the category, not something the assistant asks
// the user to verify here.
export function ChangeDetails({ change, plan }: { change: Change; plan: Plan }) {
  const { t, language } = useTranslation();
  return <dl className="assistant-diff">
    {Object.entries(fields).filter(([key]) => !(change.kind.endsWith('Event') && key === 'color'))
      .filter(([key]) => change.before === null || change.after === null
      ? (change.before ?? change.after)?.[key] !== undefined
      : JSON.stringify(change.before[key]) !== JSON.stringify(change.after[key]))
      .map(([key, label]) => <div key={key}><dt>{t(label)}</dt><dd>
        {change.before && <span>{displayField(key, change.before[key], plan)} → </span>}
        {change.after ? displayField(key, change.after[key], plan) : t('assistant.text80')}
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
      <strong>{t('assistant.localChanges', { count })}{deletes > 0 ? t('assistant.deletes', { count: deletes }) : ''}</strong>
      <p className="assistant-caption">{t('assistant.expires', { time: new Date(plan.expiresAt).toLocaleTimeString(language === 'zh' ? 'zh-CN' : 'en-US', { hour12: false }) })}</p></div>
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
          <label>{t('assistant.field.title')}<input aria-label={t('assistant.indexedField', { label: t('assistant.field.title'), index: index + 1 })} value={String(value.title ?? '')} maxLength={500} onChange={e => edit('title', e.target.value)} /></label>
          {event ? <>
            <DateField label={t('assistant.indexedField', { label: t('assistant.field.startAt'), index: index + 1 })} value={String(value.startAt ?? '')} time onChange={v => edit('startAt', v)} />
            <DateField label={t('assistant.indexedField', { label: t('assistant.field.endAt'), index: index + 1 })} value={String(value.endAt ?? '')} time onChange={v => edit('endAt', v)} />
            {!recurring && <label>{t('assistant.text85')}
              <input aria-label={t('assistant.indexedField', { label: t('assistant.field.reminders'), index: index + 1 })} defaultValue={Array.isArray(value.reminders) ? value.reminders.join(',') : ''}
                onChange={e => edit('reminders', e.target.value.trim() ? e.target.value.split(/[,，]/).map(n => Number(n.trim())) : [])} />
            </label>}
            <label>{t('assistant.field.note')}<textarea aria-label={t('assistant.indexedField', { label: t('assistant.field.note'), index: index + 1 })} value={String(value.note ?? '')} maxLength={8000} onChange={e => edit('note', e.target.value)} /></label>
          </> : <>
            <label>{t('assistant.field.description')}<textarea aria-label={t('assistant.indexedField', { label: t('assistant.field.description'), index: index + 1 })} value={String(value.description ?? '')} maxLength={8000} onChange={e => edit('description', e.target.value)} /></label>
            <DateField label={t('assistant.indexedField', { label: t('assistant.field.dueDate'), index: index + 1 })} value={String(value.dueDate ?? '')} onChange={v => edit('dueDate', v || null)} />
            <Select id={`priority-${index}`} label={t('assistant.indexedField', { label: t('assistant.field.priority'), index: index + 1 })} value={String(value.priority ?? '')} options={priorityOptions()} onChange={v => edit('priority', v || null)} />
            <Select id={`lane-${index}`} label={t('assistant.indexedField', { label: t('assistant.field.laneId'), index: index + 1 })} value={String(value.laneId ?? '')}
              options={(plan.options?.lanes ?? []).map(l => ({ value: l.id, label: l.name }))}
              onChange={v => onEdit(index, { laneId: v, completed: v === plan.options.completionLaneId })} />
            <label className="form-check form-check-custom form-check-solid">
              <input className="form-check-input" type="checkbox" checked={Boolean(value.completed)} onChange={e => edit('completed', e.target.checked)} />
              <span className="form-check-label">{t('assistant.text86')}</span>
            </label>
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
