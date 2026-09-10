import { useId, useState } from 'react';
import { Check, ChevronDown, CircleAlert, RefreshCw, Trash2, X } from 'lucide-react';
import { DatePicker } from '../components/DatePicker';
import { TimePicker } from '../components/TimePicker';
import { Select } from '../components/Select';
import type { Action, Change, Fields, Plan } from './types';

export const kinds: Record<Action['kind'], string> = {
  createEvent: '新建日程', updateEvent: '修改日程', deleteEvent: '删除日程',
  createTask: '新建任务', updateTask: '修改任务', deleteTask: '删除任务'
};
const priorities = [
  { value: '', label: '未分类' },
  { value: 'important_urgent', label: '重要且紧急' },
  { value: 'important_not_urgent', label: '重要不紧急' },
  { value: 'not_important_urgent', label: '紧急不重要' },
  { value: 'not_important_not_urgent', label: '不重要不紧急' }
];
const fields: Record<string, string> = {
  title: '标题', startAt: '开始', endAt: '结束', allDay: '全天', reminders: '提醒',
  category: '分类', color: '颜色', note: '备注', description: '描述',
  dueDate: '截止日期', priority: '四象限', completed: '完成状态', laneId: '看板列',
  views: '可见视图', linkedEventId: '关联日程', linkedTaskId: '关联任务'
};
export function displayField(key: string, value: unknown, plan?: Plan): string {
  if (value === null || value === undefined || value === '') return '无';
  if (key === 'reminders' && Array.isArray(value)) return value.length ? value.map(n => n === 0 ? '开始时' : `提前 ${n} 分钟`).join('、') : '不提醒';
  if (key === 'priority') return priorities.find(p => p.value === value)?.label ?? String(value);
  if (key === 'laneId') return plan?.options?.lanes?.find(l => l.id === value)?.name ?? String(value);
  if (key === 'category') return ({ work: '工作', personal: '个人', important: '重要', learning: '学习' } as Record<string, string>)[String(value)] ?? String(value);
  if (key === 'views' && Array.isArray(value)) return value.map(v => ({ kanban: '看板', matrix: '四象限', calendar: '日历' } as Record<string, string>)[v] ?? v).join('、') || '无';
  if (typeof value === 'boolean') return value ? '是' : '否';
  return String(value).replace('T', ' ');
}
export function ChangeDetails({ change, plan }: { change: Change; plan: Plan }) {
  return <dl className="assistant-diff">
    {Object.entries(fields).filter(([key]) => change.before === null || change.after === null
      ? (change.before ?? change.after)?.[key] !== undefined
      : JSON.stringify(change.before[key]) !== JSON.stringify(change.after[key]))
      .map(([key, label]) => <div key={key}><dt>{label}</dt><dd>
        {change.before && <span>{displayField(key, change.before[key], plan)} → </span>}
        {change.after ? displayField(key, change.after[key], plan) : '删除'}
      </dd></div>)}
  </dl>;
}
function DateField({ label, value, onChange, time = false }: { label: string; value: string; onChange: (v: string) => void; time?: boolean }) {
  const id = useId(); const [open, setOpen] = useState<'date' | 'time' | null>(null);
  return <div className="assistant-date">
    <DatePicker id={`${id}-date`} label={time ? `${label}日期` : label} value={value.slice(0, 10)}
      open={open === 'date'} onOpenChange={v => setOpen(v ? 'date' : null)}
      onChange={v => onChange(time && v ? `${v}T${value.slice(11, 16) || '09:00'}` : v)} />
    {time && <TimePicker id={`${id}-time`} label={`${label}时间`} value={value.slice(11, 16)} commitOnChange
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
  const count = selected.filter(Boolean).length;
  const deletes = actions.filter((a, i) => selected[i] && a.kind.startsWith('delete')).length;
  const expired = plan.expiresAt <= Date.now() || plan.status !== 'pending';
  return <section className="assistant-plan" aria-label="变更预览">
    <div className="assistant-plan-overview"><span className="assistant-eyebrow">执行前检查</span>
      <strong>{count} 项本地变更{deletes > 0 ? ` · 删除 ${deletes} 项` : ''}</strong>
      <p className="assistant-caption">预览有效至 {new Date(plan.expiresAt).toLocaleTimeString('zh-CN', { hour12: false })} · 时间按设备时区显示</p></div>
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
            <span className="form-check-label">{kinds[action.kind]} · {change.title}{recurring ? ' · 仅这一次' : ''}</span>
          </label><span className="assistant-change-number">{String(index + 1).padStart(2, '0')}</span></header>
        <ChangeDetails change={change} plan={plan} />
        {!action.kind.startsWith('delete') && <details className="assistant-editor" open={actions.length === 1}>
          <summary>调整{kinds[action.kind]} · {change.title}<ChevronDown aria-hidden="true" size={17} /></summary>
          <fieldset disabled={busy || !selected[index] || blocked || expired} className="assistant-edit">
          <legend className="sr-only">调整这项变更</legend>
          <label>标题<input aria-label={`标题 ${index + 1}`} value={String(value.title ?? '')} maxLength={500} onChange={e => edit('title', e.target.value)} /></label>
          {event ? <>
            <DateField label={`开始 ${index + 1}`} value={String(value.startAt ?? '')} time onChange={v => edit('startAt', v)} />
            <DateField label={`结束 ${index + 1}`} value={String(value.endAt ?? '')} time onChange={v => edit('endAt', v)} />
            {!recurring && <label>提醒（提前分钟，0 为开始时；逗号分隔，留空不提醒）
              <input aria-label={`提醒 ${index + 1}`} defaultValue={Array.isArray(value.reminders) ? value.reminders.join(',') : ''}
                onChange={e => edit('reminders', e.target.value.trim() ? e.target.value.split(/[,，]/).map(n => Number(n.trim())) : [])} />
            </label>}
            <label>备注<textarea aria-label={`备注 ${index + 1}`} value={String(value.note ?? '')} maxLength={8000} onChange={e => edit('note', e.target.value)} /></label>
          </> : <>
            <label>描述<textarea aria-label={`描述 ${index + 1}`} value={String(value.description ?? '')} maxLength={8000} onChange={e => edit('description', e.target.value)} /></label>
            <DateField label={`截止日期 ${index + 1}`} value={String(value.dueDate ?? '')} onChange={v => edit('dueDate', v || null)} />
            <Select id={`priority-${index}`} label={`四象限 ${index + 1}`} value={String(value.priority ?? '')} options={priorities} onChange={v => edit('priority', v || null)} />
            <Select id={`lane-${index}`} label={`看板列 ${index + 1}`} value={String(value.laneId ?? '')}
              options={(plan.options?.lanes ?? []).map(l => ({ value: l.id, label: l.name }))}
              onChange={v => onEdit(index, { laneId: v, completed: v === plan.options.completionLaneId })} />
            <label className="form-check form-check-custom form-check-solid">
              <input className="form-check-input" type="checkbox" checked={Boolean(value.completed)} onChange={e => edit('completed', e.target.checked)} />
              <span className="form-check-label">已完成</span>
            </label>
          </>}
          </fieldset>
        </details>}
      </article>;
    })}
    {dirty && <p role="status">内容已调整，旧预览已失效。请更新预览后再确认。</p>}
    {(expired || blocked) && <p role="status">此预览不能继续确认，请重新发送请求生成新预览。</p>}
    <div className="assistant-actions">
      <button className="btn" onClick={onCancel} disabled={busy}><X aria-hidden="true" />取消方案</button>
      {dirty && <button className="btn" onClick={onRevise} disabled={busy || !count || expired || blocked}><RefreshCw aria-hidden="true" />更新预览</button>}
      <button className={`btn ${deletes ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm}
        disabled={busy || dirty || !count || expired || blocked}>{deletes ? <Trash2 aria-hidden="true" /> : <Check aria-hidden="true" />}确认执行 {count} 项</button>
    </div>
  </section>;
}
