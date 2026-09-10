import { CalendarDays, Layers, SquareKanban } from '../components/icons';
import { TabPanel, Tabs, type TabItem } from '../components/Tabs';
import { ChangeDetails, kinds } from './PlanCard';
import type { Plan } from './types';

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

const ranges: TabItem<HistoryRange>[] = [
  { id: '1', label: '今天' },
  { id: '3', label: '近 3 天' },
  { id: '7', label: '近 7 天' }
];
const statuses: Record<Plan['status'], string> = { pending: '待确认', committed: '已执行', undone: '已撤销', cancelled: '已取消', expired: '已过期' };

function dayStart(time: number) { const date = new Date(time); date.setHours(0, 0, 0, 0); return date.getTime(); }
function rangeStart(range: HistoryRange) {
  const date = new Date(dayStart(Date.now()));
  date.setDate(date.getDate() - (Number(range) - 1));
  return date.getTime();
}
export function historyCount(plans: Plan[], range: HistoryRange) {
  return plans.filter(plan => plan.createdAt >= rangeStart(range)).length;
}
function dayLabel(time: number) {
  const today = new Date(dayStart(Date.now()));
  if (dayStart(time) === today.getTime()) return '今天';
  today.setDate(today.getDate() - 1);
  if (dayStart(time) === today.getTime()) return '昨天';
  return new Date(time).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' });
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
  return `${[...new Set(plan.actions.map(action => kinds[action.kind]))].join('、')} · ${plan.changes.length} 项`;
}

export function AssistantHistory({ plans, range, openChange, busy, uncertain, onRangeChange, onOpenChange, onUndo }: Props) {
  const visiblePlans = plans.filter(plan => plan.createdAt >= rangeStart(range));
  const groups = groupByDay(visiblePlans);

  return <div className="assistant-history">
    <div className="assistant-history-bar">
      <p className="assistant-history-caption">操作记录保留 7 天，最多 50 条</p>
      <Tabs idPrefix="assistant-history" label="时间范围" items={ranges} value={range} onChange={onRangeChange} />
    </div>
    <TabPanel idPrefix="assistant-history" tabId={range} active className="assistant-history-list">
      {!groups.length && <p>{plans.length ? '这段时间没有操作记录。' : '暂无操作记录。'}</p>}
      {groups.map(group => <section className="assistant-timeline-group" key={group.key}>
        <h3 className="assistant-timeline-date">{group.label}</h3>
        <ol className="assistant-timeline">
          {group.items.map(plan => {
            const Marker = planIcon(plan);
            const changeId = `${plan.id}:details`; const open = openChange === changeId;
            const title = plan.changes.map(change => change.title).join('、');
            return <li className="assistant-history-row" key={plan.id} data-status={plan.status}>
              <span className="assistant-timeline-marker" aria-hidden="true"><Marker size={16} /></span>
              <div className="assistant-timeline-body">
                <div className="assistant-timeline-head">
                  <div className="assistant-timeline-heading">
                    <strong className="assistant-timeline-title">{title}</strong>
                    <p className="assistant-timeline-meta">{planSummary(plan)}</p>
                  </div>
                  <div className="assistant-history-actions">
                    <span className="assistant-status-badge" data-status={plan.status}>{statuses[plan.status]}</span>
                    <button className="btn" aria-label={`查看${title}详情`} aria-expanded={open} aria-controls={`assistant-history-${changeId}`}
                      onClick={() => onOpenChange(open ? null : changeId)}>查看</button>
                    {plan.status === 'committed' && <button className="btn" aria-label={`撤销${title}`} disabled={busy || uncertain} onClick={() => onUndo(plan)}>撤销</button>}
                  </div>
                </div>
                {open && <div className="assistant-timeline-detail" id={`assistant-history-${changeId}`}>
                  {plan.changes.map(change => <section className="assistant-history-change" key={change.key}>
                    <h4>{change.title}</h4><ChangeDetails change={change} plan={plan} />
                  </section>)}
                  {plan.warnings.map((warning, index) => <p key={index}>{warning}</p>)}
                </div>}
              </div>
            </li>;
          })}
        </ol>
      </section>)}
    </TabPanel>
  </div>;
}
