import { displayField, ChangeDetails, PlanCard } from './PlanCard';
import type { Action, AssistantRecord, ChatItem, Fields, Plan } from './types';

export type AssistantChatProps = {
  items: ChatItem[];
  currentPlanId: string | null;
  actions: Action[];
  edits: Fields[];
  selected: boolean[];
  dirty: boolean;
  busy: boolean;
  blocked: boolean;
  uncertainPlanId: string | null;
  openChange: string | null;
  onEdit: (index: number, fields: Fields) => void;
  onSelect: (index: number, checked: boolean) => void;
  onRevise: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  onUndo: (plan: Plan) => void;
  onRecover: () => void;
  onOpenChange: (key: string | null) => void;
  onOpenRecord?: (record: AssistantRecord, trigger: HTMLElement) => void;
};

const statuses: Record<Plan['status'], string> = { pending: '待确认', committed: '已执行', undone: '已撤销', cancelled: '已取消', expired: '已过期' };

export function AssistantChat({ items, currentPlanId, actions, edits, selected, dirty, busy, blocked, uncertainPlanId, openChange,
  onEdit, onSelect, onRevise, onConfirm, onCancel, onUndo, onRecover, onOpenChange, onOpenRecord }: AssistantChatProps) {
  if (!items.length) return <p className="assistant-chat-empty">今天还没有对话。</p>;

  return <ol className="assistant-chat" aria-label="当前聊天消息">
    {items.map(item => {
      if (item.kind === 'message') return <li className="assistant-chat-message" data-role={item.role}
        aria-label={item.role === 'user' ? '你说' : 'Nowly 回复'} key={item.id}>
        <p>{item.content}</p>
      </li>;
      if (item.kind === 'status') return <li className="assistant-chat-card assistant-system-card" data-tone={item.tone} key={item.id}>
        <p role={item.tone === 'error' ? 'alert' : 'status'}>{item.content}</p>
      </li>;
      if (item.kind === 'records') return <li className="assistant-chat-card" key={item.id}>
        <section className="assistant-records" aria-label={`查询记录 · ${item.records.length} 项`}>
          <strong>查询记录 · {item.records.length} 项</strong>
          {item.records.map(record => <div className="assistant-record" key={record.key}>
            <button className="assistant-record-link" onClick={e => onOpenRecord?.(record, e.currentTarget)}>{record.title}</button>
            <span>{record.source}{record.readOnly ? ' · 只读' : ''}</span>
            <span>{displayField(record.domain === 'calendar' ? 'startAt' : 'dueDate', record.data[record.domain === 'calendar' ? 'startAt' : 'dueDate'])}</span>
            {record.data.lastSyncedAt != null && <span>同步：{displayField('lastSyncedAt', record.data.lastSyncedAt)}</span>}
          </div>)}
        </section>
      </li>;
      const plan = item.plan;
      const uncertain = uncertainPlanId === plan.id;
      if (plan.status === 'pending' && plan.id === currentPlanId) return <li className="assistant-chat-card" key={item.id}>
        <PlanCard plan={plan} actions={actions} edits={edits} selected={selected} dirty={dirty} busy={busy} blocked={blocked}
          onEdit={onEdit} onSelect={onSelect} onRevise={onRevise} onConfirm={onConfirm} onCancel={onCancel} />
        {uncertain && <div className="assistant-card-status" data-tone="error"><p role="alert">执行状态尚未核实，请勿重复操作。</p>
          <button className="btn" disabled={busy} onClick={onRecover}>核实操作状态</button></div>}
      </li>;
      const changeId = `${plan.id}:details`;
      const operationTitle = plan.changes.map(change => change.title).join('、');
      return <li className="assistant-chat-card" key={item.id}>
        <section className="assistant-operation" aria-label={`操作状态：${statuses[plan.status]}`}>
          <header><div><span className="assistant-eyebrow">本次操作</span>
            <strong>{operationTitle}</strong></div>
            <span className="assistant-status-badge" data-status={plan.status}>{statuses[plan.status]}</span>
          </header>
          <button className="btn" aria-label={`查看${operationTitle}详情`} aria-expanded={openChange === changeId} aria-controls={`assistant-chat-${changeId}`}
            onClick={() => onOpenChange(openChange === changeId ? null : changeId)}>查看详情</button>
          {openChange === changeId && <div className="assistant-operation-details" id={`assistant-chat-${changeId}`}>
            {plan.changes.map(change => <ChangeDetails change={change} plan={plan} key={change.key} />)}
            {plan.warnings.map((warning, index) => <p key={index}>{warning}</p>)}
          </div>}
          {plan.status === 'committed' && <div className="assistant-operation-actions">
            <p className="assistant-caption">日程已保存不代表系统通知已送达；提醒仍由现有通知机制处理。</p>
            <button className="btn" aria-label={`撤销${operationTitle}`} disabled={busy || blocked} onClick={() => onUndo(plan)}>撤销这次操作</button>
          </div>}
          {uncertain && <div className="assistant-card-status" data-tone="error"><p role="alert">执行状态尚未核实，请勿重复操作。</p>
            <button className="btn" disabled={busy} onClick={onRecover}>核实操作状态</button></div>}
        </section>
      </li>;
    })}
  </ol>;
}
