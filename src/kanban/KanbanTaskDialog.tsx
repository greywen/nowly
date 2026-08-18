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
import { t } from '../i18n';

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
    : t('common.opFailed');
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
    { value: '', label: t('kanbanTask.noPriority') },
    ...(form.priorityId && !priorities.some((item) => item.id === form.priorityId)
      ? [{ value: form.priorityId, label: t('kanbanTask.stalePriority') }]
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
        title={mode.type === 'create' ? t('kanbanTask.createTitle', { lane: mode.laneName }) : t('kanbanTask.editTitle')}
        ariaLabelledBy={titleId}
        isTopLayer={!confirm && !dateOpen}
        restoreFocusRef={restoreFocusRef}
        onRequestClose={requestClose}
        className="task-dialog"
        headerActions={
          <button type="button" aria-label={t('common.close')} className="good-icon-button" disabled={busy} onClick={requestClose}>
            <X aria-hidden="true" />
          </button>
        }
        footer={
          <div className="task-dialog__actions">
            {dialogError && !confirm ? <div role="alert" className="dialog-error">{dialogError}</div> : null}
            {mode.type === 'edit' ? (
              <button type="button" className="good-button good-button--danger-ghost" disabled={busy} onClick={() => setConfirm('delete')}>
                {t('kanbanTask.deleteTask')}
              </button>
            ) : null}
            <button type="button" className="good-button" disabled={busy} onClick={requestClose}>{t('common.cancel')}</button>
            <button type="button" className="good-button good-button--primary" disabled={busy} onClick={() => void save()}>
              {busy ? t('common.saving') : t('kanbanTask.saveTask')}
            </button>
          </div>
        }
      >
        <form className="task-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <div className="good-field">
            <label htmlFor="kanban-card-title">{t('kanbanTask.title')}</label>
            <input
              id="kanban-card-title" className="good-input" autoComplete="off" value={form.title} disabled={busy}
              aria-describedby={errors.title ? 'kanban-card-title-error' : undefined}
              onChange={(event) => update('title', event.target.value)}
            />
            {errors.title ? <span id="kanban-card-title-error" className="field-error">{errors.title}</span> : null}
          </div>

          <div className="good-field">
            <label htmlFor="kanban-card-desc">{t('kanbanTask.description')}</label>
            <textarea
              id="kanban-card-desc" className="good-input good-textarea" autoComplete="off" value={form.description} disabled={busy}
              onChange={(event) => update('description', event.target.value)}
            />
          </div>

          <DatePicker
            id="kanban-card-due" label={t('kanbanTask.dueDate')} value={form.dueDate}
            errorId={errors.dueDate ? 'kanban-card-due-error' : undefined}
            disabled={busy} open={dateOpen} onOpenChange={setDateOpen}
            onChange={(value) => update('dueDate', value)}
          />
          {errors.dueDate ? <span id="kanban-card-due-error" className="field-error">{errors.dueDate}</span> : null}

          <Select
            id="kanban-card-priority" name="priorityId" label={t('kanbanTask.priority')} options={priorityOptions}
            value={form.priorityId} disabled={busy}
            onChange={(value) => update('priorityId', value)}
          />

          <KanbanMultiSelect
            legend={t('kanbanTask.tags')}
            options={tags.map((tag) => ({ id: tag.id, label: tag.name }))}
            selected={form.tagIds}
            disabled={busy}
            emptyHint={t('kanbanTask.tagsEmpty')}
            onToggle={(id, next) => update('tagIds', toggleFrom(form.tagIds, id, next))}
          />

          <KanbanMultiSelect
            legend={t('kanbanTask.collaborators')}
            options={collaborators.map((person) => ({ id: person.id, label: person.name }))}
            selected={form.collaboratorIds}
            disabled={busy}
            emptyHint={t('kanbanTask.collaboratorsEmpty')}
            onToggle={(id, next) => update('collaboratorIds', toggleFrom(form.collaboratorIds, id, next))}
          />
        </form>
      </Dialog>

      {confirm === 'discard' ? (
        <ConfirmDialog
          title={t('common.discardTitle')} description={t('common.discardDesc')}
          confirmLabel={t('common.discard')} busyLabel={t('common.discarding')}
          onCancel={() => setConfirm(null)} onConfirm={onClose}
        />
      ) : null}
      {confirm === 'delete' && mode.type === 'edit' ? (
        <ConfirmDialog
          title={t('kanbanTask.deleteTitle', { title: mode.card.title })}
          description={t('common.deleteUnrecoverable')}
          tone="danger" confirmLabel={t('common.permanentDelete')} busyLabel={t('common.deleting')} busy={busy}
          errorMessage={dialogError}
          onCancel={() => { setConfirm(null); setDialogError(''); }}
          onConfirm={() => void remove()}
        />
      ) : null}
    </>
  );
}
