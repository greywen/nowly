import { X } from 'lucide-react';
import { type RefObject, useId, useMemo, useState } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DatePicker } from '../components/DatePicker';
import { Dialog } from '../components/Dialog';
import { Select } from '../components/Select';
import type { RepositoryError } from '../data/nowly-repository';
import {
  cardToForm,
  createCardForm,
  isCardFormDirty,
  toCardDraft,
  validateCardForm,
  type CardFieldErrors,
  type CardFormDraft
} from './card-draft';
import type {
  KanbanCard,
  KanbanCardDraft,
  KanbanCollaborator,
  KanbanPriority,
  KanbanTag
} from './kanban-model';
import { KanbanMultiSelect } from './KanbanMultiSelect';

type TaskMode =
  | { type: 'create'; laneId: string; laneName: string }
  | { type: 'edit'; card: KanbanCard };

type KanbanTaskDialogProps = {
  mode: TaskMode;
  priorities: KanbanPriority[];
  tags: KanbanTag[];
  collaborators: KanbanCollaborator[];
  restoreFocusRef?: RefObject<HTMLElement | null>;
  onClose(): void;
  createCard(draft: KanbanCardDraft): Promise<KanbanCard>;
  updateCard(id: string, draft: KanbanCardDraft): Promise<KanbanCard>;
  deleteCard(id: string): Promise<void>;
};

function errorMessage(error: unknown) {
  return typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
    ? error.message
    : '操作失败，请重试。';
}

export function KanbanTaskDialog({
  mode,
  priorities,
  tags,
  collaborators,
  restoreFocusRef,
  onClose,
  createCard,
  updateCard,
  deleteCard
}: KanbanTaskDialogProps) {
  const initial = useMemo(
    () => (mode.type === 'edit' ? cardToForm(mode.card) : createCardForm()),
    [mode]
  );
  const [form, setForm] = useState<CardFormDraft>(initial);
  const [errors, setErrors] = useState<CardFieldErrors>({});
  const [dialogError, setDialogError] = useState('');
  const [dateOpen, setDateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<'discard' | 'delete' | null>(null);
  const titleId = useId();

  const laneId = mode.type === 'edit' ? mode.card.laneId : mode.laneId;

  // Keep a stale priority id selectable so an edited card that references a
  // just-deleted priority does not silently lose it before the user reacts.
  const priorityOptions = [
    { value: '', label: '无优先级' },
    ...(form.priorityId && !priorities.some((item) => item.id === form.priorityId)
      ? [{ value: form.priorityId, label: '已失效的优先级' }]
      : []),
    ...priorities.map((item) => ({ value: item.id, label: item.name }))
  ];

  const update = <K extends keyof CardFormDraft>(key: K, value: CardFormDraft[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const toggleFrom = (list: string[], id: string, next: boolean) =>
    next ? [...list, id] : list.filter((item) => item !== id);

  function requestClose() {
    if (busy) return;
    if (isCardFormDirty(initial, form)) setConfirm('discard');
    else onClose();
  }

  async function save() {
    const validation = validateCardForm(form);
    setErrors(validation);
    setDialogError('');
    if (Object.keys(validation).length) return;
    setBusy(true);
    try {
      const draft = toCardDraft(form, laneId);
      if (mode.type === 'create') await createCard(draft);
      else await updateCard(mode.card.id, draft);
      onClose();
    } catch (error) {
      const repositoryError = error as RepositoryError;
      if (repositoryError.code === 'validation_error' && repositoryError.field) {
        setErrors({ [repositoryError.field]: repositoryError.message });
      } else {
        setDialogError(errorMessage(error));
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (mode.type !== 'edit') return;
    setBusy(true);
    setDialogError('');
    try {
      await deleteCard(mode.card.id);
      setConfirm(null);
      onClose();
    } catch (error) {
      setDialogError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Dialog
        title={mode.type === 'create' ? `在“${mode.laneName}”新建任务` : '编辑任务'}
        ariaLabelledBy={titleId}
        isTopLayer={!confirm && !dateOpen}
        restoreFocusRef={restoreFocusRef}
        onRequestClose={requestClose}
        className="task-dialog"
        headerActions={
          <button type="button" aria-label="关闭" className="good-icon-button" disabled={busy} onClick={requestClose}>
            <X aria-hidden="true" />
          </button>
        }
        footer={
          <div className="task-dialog__actions">
            {dialogError && !confirm ? <div role="alert" className="dialog-error">{dialogError}</div> : null}
            {mode.type === 'edit' ? (
              <button type="button" className="good-button good-button--danger-ghost" disabled={busy} onClick={() => setConfirm('delete')}>
                删除任务
              </button>
            ) : null}
            <button type="button" className="good-button" disabled={busy} onClick={requestClose}>取消</button>
            <button type="button" className="good-button good-button--primary" disabled={busy} onClick={() => void save()}>
              {busy ? '正在保存' : '保存任务'}
            </button>
          </div>
        }
      >
        <form className="task-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <div className="good-field">
            <label htmlFor="kanban-card-title">任务标题</label>
            <input
              id="kanban-card-title" className="good-input" value={form.title} disabled={busy}
              aria-describedby={errors.title ? 'kanban-card-title-error' : undefined}
              onChange={(event) => update('title', event.target.value)}
            />
            {errors.title ? <span id="kanban-card-title-error" className="field-error">{errors.title}</span> : null}
          </div>

          <div className="good-field">
            <label htmlFor="kanban-card-desc">描述</label>
            <textarea
              id="kanban-card-desc" className="good-input good-textarea" value={form.description} disabled={busy}
              onChange={(event) => update('description', event.target.value)}
            />
          </div>

          <DatePicker
            id="kanban-card-due" label="截止日期" value={form.dueDate}
            errorId={errors.dueDate ? 'kanban-card-due-error' : undefined}
            disabled={busy} open={dateOpen} onOpenChange={setDateOpen}
            onChange={(value) => update('dueDate', value)}
          />
          {errors.dueDate ? <span id="kanban-card-due-error" className="field-error">{errors.dueDate}</span> : null}

          <Select
            id="kanban-card-priority" name="priorityId" label="优先级" options={priorityOptions}
            value={form.priorityId} disabled={busy}
            onChange={(value) => update('priorityId', value)}
          />

          <KanbanMultiSelect
            legend="标签"
            options={tags.map((tag) => ({ id: tag.id, label: tag.name }))}
            selected={form.tagIds}
            disabled={busy}
            emptyHint="还没有标签，可在“管理字段”中新增。"
            onToggle={(id, next) => update('tagIds', toggleFrom(form.tagIds, id, next))}
          />

          <KanbanMultiSelect
            legend="协作人"
            options={collaborators.map((person) => ({ id: person.id, label: person.name }))}
            selected={form.collaboratorIds}
            disabled={busy}
            emptyHint="还没有协作人，可在“管理字段”中新增。"
            onToggle={(id, next) => update('collaboratorIds', toggleFrom(form.collaboratorIds, id, next))}
          />
        </form>
      </Dialog>

      {confirm === 'discard' ? (
        <ConfirmDialog
          title="放弃更改？" description="未保存的内容将丢失。"
          confirmLabel="放弃更改" busyLabel="正在放弃"
          onCancel={() => setConfirm(null)} onConfirm={onClose}
        />
      ) : null}
      {confirm === 'delete' && mode.type === 'edit' ? (
        <ConfirmDialog
          title={`永久删除“${mode.card.title}”？`}
          description="删除后无法恢复。"
          tone="danger" confirmLabel="永久删除" busyLabel="正在删除" busy={busy}
          errorMessage={dialogError}
          onCancel={() => { setConfirm(null); setDialogError(''); }}
          onConfirm={() => void remove()}
        />
      ) : null}
    </>
  );
}
