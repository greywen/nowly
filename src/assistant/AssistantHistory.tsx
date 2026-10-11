import { useTranslation, t, getLanguage } from '../i18n';
import { CalendarDays, Layers, SquareKanban } from 'lucide-react';
import { TabPanel, Tabs, type TabItem } from '../components/Tabs';
import { ChangeDetails, displayField, kinds } from './PlanCard';
import type { Change, Plan } from './types';

export type HistoryRange = '1' | '3' | '7';

type Props = {
  plans: Plan[];
  range: HistoryRange;
  openChange: string | null;
  busy: boolean;
  uncertain: boolean;
  onRangeChange: (range: HistoryRange) => void;
  onOpenChange: (key: string | null) => void;
  onUndo: (plan: Plan) => void;
};

function historyRanges(): TabItem<HistoryRange>[] { return [
  { id: '1', label: t('assistant.text31') },
  { id: '3', label: t('assistant.text33') },
  { id: '7', label: t('assistant.text34') }
]; }
const dayMs = 86400000;
const statuses: Record<Plan['status'], string> = { pending: 'assistant.status.pending', committed: 'assistant.status.committed', undone: 'assistant.status.undone', cancelled: 'assistant.status.cancelled', expired: 'assistant.status.expired' };

function dayStart(time: number) { const date = new Date(time); date.setHours(0, 0, 0, 0); return date.getTime(); }
export function historyCount(plans: Plan[], range: HistoryRange) {
  return plans.filter(plan => plan.createdAt >= dayStart(Date.now()) - (Number(range) - 1) * dayMs).length;
}
function dayLabel(time: number) {
  const distance = Math.round((dayStart(Date.now()) - dayStart(time)) / dayMs);
  if (distance === 0) return t('assistant.text31');
  if (distance === 1) return t('assistant.text32');
  return new Date(time).toLocaleDateString(getLanguage() === 'zh' ? 'zh-CN' : 'en-US', { month: 'long', day: 'numeric', weekday: 'short' });
}
function groupByDay(plans: Plan[]) {
  const groups: { key: number; label: string; items: Plan[] }[] = [];
  for (const plan of plans) {
    const key = dayStart(plan.createdAt); const last = groups[groups.length - 1];
    if (last?.key === key) last.items.push(plan);
    else groups.push({ key, label: dayLabel(plan.createdAt), items: [plan] });
  }
  return groups;
}
function planIcon(plan: Plan) {
  const surfaces = new Set(plan.actions.map(action => action.kind.endsWith('Event') ? 'event' : 'task'));
  if (surfaces.size !== 1) return Layers;
  return surfaces.has('event') ? CalendarDays : SquareKanban;
}
function planSummary(plan: Plan) {
  return t('assistant.summary', { kinds: [...new Set(plan.actions.map(action => t(kinds[action.kind])))].join(t('assistant.separator')), count: plan.changes.length });
}
function keyField(change: Change) {
  const data = change.after ?? change.before ?? {};
  const event = change.kind.endsWith('Event');
  return `${event ? t('assistant.field.startAt') : t('assistant.dueShort')} ${displayField(event ? 'startAt' : 'dueDate', data[event ? 'startAt' : 'dueDate'])}`;
}

export function AssistantHistory({ plans, range, openChange, busy, uncertain, onRangeChange, onOpenChange, onUndo }: Props) {
  const { t, language } = useTranslation();
  const visiblePlans = plans.filter(plan => plan.createdAt >= dayStart(Date.now()) - (Number(range) - 1) * dayMs);
  const groups = groupByDay(visiblePlans);

  return <div className="assistant-history">
    <div className="assistant-history-bar">
      <p className="assistant-history-caption">{t('assistant.text35')}</p>
      <Tabs idPrefix="assistant-history" label={t('assistant.text36')} items={historyRanges()} value={range} onChange={onRangeChange} />
    </div>
    <TabPanel idPrefix="assistant-history" tabId={range} active className="assistant-history-list">
      {!groups.length && <p>{plans.length ? t('assistant.text37') : t('assistant.text38')}</p>}
      {groups.map(group => <section className="assistant-timeline-group" key={group.key}>
        <h3 className="assistant-timeline-date">{group.label}</h3>
        <ol className="assistant-timeline">
          {group.items.map(plan => {
            const Marker = planIcon(plan);
            return <li className="assistant-timeline-item" key={plan.id} data-status={plan.status}>
              <span className="assistant-timeline-marker" role="img" aria-label={t(statuses[plan.status])}><Marker size={16} /></span>
              <div className="assistant-timeline-body">
                <div className="assistant-timeline-head">
                  <div className="assistant-timeline-heading">
                    <strong className="assistant-timeline-title">{planSummary(plan)}</strong>
                    <p className="assistant-timeline-meta">{t('assistant.recorded')} <time dateTime={new Date(plan.createdAt).toISOString()}>{new Date(plan.createdAt).toLocaleTimeString(language === 'zh' ? 'zh-CN' : 'en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })}</time></p>
                  </div>
                  {plan.status === 'committed' && <button className="btn" disabled={busy || uncertain} onClick={() => onUndo(plan)}>{t('assistant.text39')}</button>}
                </div>
                <ul className="assistant-timeline-changes">
                  {plan.changes.map(change => {
                    const changeId = `${plan.id}:${change.key}`; const open = openChange === changeId;
                    return <li key={change.key}>
                      <div className="assistant-change-row">
                        <span className="assistant-change-title">{change.title}</span>
                        <span className="assistant-change-key">{keyField(change)}</span>
                        <span className="assistant-status-badge" data-status={plan.status}>{t(statuses[plan.status])}</span>
                        <button className="btn" aria-expanded={open} aria-controls={`assistant-history-${changeId}`} onClick={() => onOpenChange(open ? null : changeId)}>{t('assistant.text40')}</button>
                      </div>
                      {open && <div className="assistant-timeline-detail" id={`assistant-history-${changeId}`}>
                        <ChangeDetails change={change} plan={plan} />
                        {plan.warnings.map((warning, index) => <p key={index}>{warning}</p>)}
                      </div>}
                    </li>;
                  })}
                </ul>
              </div>
            </li>;
          })}
        </ol>
      </section>)}
    </TabPanel>
  </div>;
}
