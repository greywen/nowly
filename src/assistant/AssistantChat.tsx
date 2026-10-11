import { translateAssistantNotice } from './client';
import { useTranslation, t, getLanguage } from '../i18n';
import { ChevronDown, ChevronUp } from '../components/icons';
import { displayField, ChangeDetails, kinds, PlanCard } from './PlanCard';
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

const statuses: Record<Plan['status'], string> = { pending: 'assistant.status.pending', committed: 'assistant.status.committed', undone: 'assistant.status.undone', cancelled: 'assistant.status.cancelled', expired: 'assistant.status.expired' };

export function AssistantChat({ items, currentPlanId, actions, edits, selected, dirty, busy, blocked, uncertainPlanId, openChange,
  onEdit, onSelect, onRevise, onConfirm, onCancel, onUndo, onRecover, onOpenChange, onOpenRecord }: AssistantChatProps) {
  const { t, language } = useTranslation();
  if (!items.length) return <p className="assistant-chat-empty">{t('assistant.text1')}</p>;

  return <ol className="assistant-chat" aria-label={t('assistant.text2')}>
    {items.map(item => {
      if (item.kind === 'message') return <li className="assistant-chat-message" data-role={item.role}
        aria-label={item.role === 'user' ? t('assistant.text3') : t('assistant.text4')} key={item.id}>
        <p>{item.content}</p>
      </li>;
      if (item.kind === 'status') return <li className="assistant-chat-card assistant-system-card" data-tone={item.tone} key={item.id}>
        <p role={item.tone === 'error' ? 'alert' : 'status'}>{translateAssistantNotice(item.content)}</p>
      </li>;
      if (item.kind === 'records') return <li className="assistant-chat-card" key={item.id}>
        <section className="assistant-records" aria-label={t('assistant.records', { count: item.records.length })}>
          <strong>{t('assistant.records', { count: item.records.length })}</strong>
          {item.records.map(record => <div className="assistant-record" key={record.key}>
            <button className="assistant-record-link" onClick={e => onOpenRecord?.(record, e.currentTarget)}>{record.title}</button>
            <span>{record.source}{record.readOnly ? t('assistant.text5') : ''}</span>
            <span>{displayField(record.domain === 'calendar' ? 'startAt' : 'dueDate', record.data[record.domain === 'calendar' ? 'startAt' : 'dueDate'])}</span>
            {record.data.lastSyncedAt != null && <span>{t('assistant.synced', { value: displayField('lastSyncedAt', record.data.lastSyncedAt) })}</span>}
          </div>)}
        </section>
      </li>;
      const plan = item.plan;
      const uncertain = uncertainPlanId === plan.id;
      if (plan.status === 'pending' && plan.id === currentPlanId) return <li className="assistant-chat-card" key={item.id}>
        <PlanCard plan={plan} actions={actions} edits={edits} selected={selected} dirty={dirty} busy={busy} blocked={blocked}
          onEdit={onEdit} onSelect={onSelect} onRevise={onRevise} onConfirm={onConfirm} onCancel={onCancel} />
        {uncertain && <div className="assistant-card-status" data-tone="error"><p role="alert">{t('assistant.text6')}</p>
          <button className="btn" disabled={busy} onClick={onRecover}>{t('assistant.text7')}</button></div>}
      </li>;
      const changeId = `${plan.id}:details`;
      const operationTitle = plan.changes.map(change => change.title).join(t('assistant.separator'));
      const operationKind = [...new Set(plan.actions.map(action => t(kinds[action.kind])))].join(t('assistant.separator'));
      const expanded = openChange === changeId;
      return <li className="assistant-chat-card" key={item.id}>
        <section className="assistant-operation" aria-label={t('assistant.operationStatus', { status: t(statuses[plan.status]) })}>
          <button className="assistant-operation-trigger"
            aria-label={t('assistant.details')}
            aria-expanded={expanded} aria-controls={`assistant-chat-${changeId}`}
            onClick={() => onOpenChange(expanded ? null : changeId)}>
            <span className="assistant-operation-summary">
              <span className="assistant-operation-kind">{operationKind}</span>
              <strong>{operationTitle}</strong>
            </span>
            <span className="assistant-operation-meta">
              <span className="assistant-operation-status">{t(statuses[plan.status])}</span>
              {expanded ? <ChevronUp aria-hidden="true" size={17} /> : <ChevronDown aria-hidden="true" size={17} />}
            </span>
          </button>
          {plan.status === 'committed' && <p className="assistant-caption">{t('assistant.text8')}</p>}
          {expanded && <div className="assistant-operation-details" id={`assistant-chat-${changeId}`}>
            {plan.changes.map(change => <ChangeDetails change={change} plan={plan} key={change.key} />)}
            {plan.warnings.map((warning, index) => <p key={index}>{warning}</p>)}
            {plan.status === 'committed' && <div className="assistant-operation-actions">
              {/* A committed operation is independent of the current preview, so its
                  undo is gated on work in flight and on an unverified operation,
                  not on `blocked`, which describes that preview. */}
              <button className="btn" aria-label={t('assistant.undoTitle', { title: operationTitle })} disabled={busy || uncertainPlanId !== null} onClick={() => onUndo(plan)}>{t('assistant.text9')}</button>
            </div>}
          </div>}
          {uncertain && <div className="assistant-card-status" data-tone="error"><p role="alert">{t('assistant.text6')}</p>
            <button className="btn" disabled={busy} onClick={onRecover}>{t('assistant.text7')}</button></div>}
        </section>
      </li>;
    })}
  </ol>;
}
