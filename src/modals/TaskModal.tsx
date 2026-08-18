import { X } from 'lucide-react';
import { type RefObject, useId, useMemo, useState } from 'react';
import type { CalendarEvent } from '../calendar/calendar-model';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DatePicker } from '../components/DatePicker';
import { Dialog } from '../components/Dialog';
import { Select } from '../components/Select';
import type { RepositoryError } from '../data/nowly-repository';
import {
  createTaskForm, isTaskFormDirty, taskToForm, toTaskDraft, validateTaskForm,
  type TaskFieldErrors, type TaskFormDraft
} from '../lib/task-draft';
import {
  priorityLabel, quadrantLabel, quadrantOrder,
  type MatrixTask, type Quadrant, type TaskDraft, type TaskPriority
} from '../matrix/matrix-model';
import { t } from '../i18n';

type TaskModalProps = {
  mode: { type: 'create'; dueDate: string | null } | { type: 'edit'; task: MatrixTask };
  events: CalendarEvent[];
  restoreFocusRef?: RefObject<HTMLElement | null>;
  onClose(): void;
  onSaved(task: MatrixTask, previousLinkedEventId: string | null): Promise<void> | void;
  onDeleted(task: MatrixTask): Promise<void> | void;
  createTask(draft: TaskDraft): Promise<MatrixTask>;
  updateTask(task: MatrixTask, draft: TaskDraft): Promise<MatrixTask>;
  deleteTask(task: MatrixTask): Promise<void>;
};

function errorMessage(error: unknown) {
  return typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
    ? error.message : t('common.opFailed');
}

export function TaskModal({
  mode, events, restoreFocusRef, onClose, onSaved, onDeleted, createTask, updateTask, deleteTask
}: TaskModalProps) {
  const initial = useMemo(
    () => mode.type === 'edit' ? taskToForm(mode.task) : createTaskForm(mode.dueDate),
    [mode]
  );
  const [form, setForm] = useState<TaskFormDraft>(initial);
  const [errors, setErrors] = useState<TaskFieldErrors>({});
  const [dialogError, setDialogError] = useState('');
  const [dateOpen, setDateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<'discard' | 'delete' | null>(null);
  const titleId = useId();

  const eventOptions = [
    { value: '', label: t('taskModal.noLink') },
    ...(form.linkedEventId && !events.some((event) => event.id === form.linkedEventId)
      ? [{ value: form.linkedEventId, label: t('taskModal.staleLink') }]
      : []),
    ...events.map((event) => ({ value: event.id, label: event.title }))
  ];
  const priorityOptions = ([1, 2, 3] as TaskPriority[]).map((value) => ({
    value: String(value), label: priorityLabel(value)
  }));
  const update = <K extends keyof TaskFormDraft>(key: K, value: TaskFormDraft[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  function requestClose() {
    if (busy) return;
    if (isTaskFormDirty(initial, form)) setConfirm('discard');
    else onClose();
  }

  async function save() {
    const validation = validateTaskForm(form);
    setErrors(validation);
    setDialogError('');
    if (Object.keys(validation).length) return;
    setBusy(true);
    try {
      const draft = toTaskDraft(form);
      const saved = mode.type === 'create'
        ? await createTask(draft)
        : await updateTask(mode.task, draft);
      await onSaved(saved, mode.type === 'edit' ? mode.task.linkedEventId : null);
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
      await deleteTask(mode.task);
      await onDeleted(mode.task);
      setConfirm(null);
      onClose();
    } catch (error) {
      setDialogError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return <>
    <Dialog
      title={mode.type === 'create' ? t('taskModal.createTitle') : t('taskModal.editTitle')}
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
              {t('taskModal.deleteTask')}
            </button>
          ) : null}
          <button type="button" className="good-button" disabled={busy} onClick={requestClose}>{t('common.cancel')}</button>
          <button type="button" className="good-button good-button--primary" disabled={busy} onClick={() => void save()}>
            {busy ? t('common.saving') : t('taskModal.saveTask')}
          </button>
        </div>
      }
    >
      <form className="task-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <div className="good-field">
          <label htmlFor="task-title">{t('taskModal.title')}</label>
          <input
            id="task-title" className="good-input" autoComplete="off" value={form.title} disabled={busy}
            aria-describedby={errors.title ? 'task-title-error' : undefined}
            onChange={(event) => update('title', event.target.value)}
          />
          {errors.title ? <span id="task-title-error" className="field-error">{errors.title}</span> : null}
        </div>

        <fieldset className="task-quadrants">
          <legend>{t('taskModal.quadrant')}</legend>
          {quadrantOrder.map((quadrant) => (
            <label key={quadrant} className="form-check form-check-custom form-check-solid">
              <input
                className="form-check-input" type="radio" name="task-quadrant" value={quadrant}
                checked={form.quadrant === quadrant} disabled={busy}
                onChange={() => update('quadrant', quadrant as Quadrant)}
              />
              <span className="form-check-label">{quadrantLabel(quadrant)}</span>
            </label>
          ))}
        </fieldset>
        {errors.quadrant ? <span className="field-error">{errors.quadrant}</span> : null}

        <DatePicker
          id="task-due-date" label={t('taskModal.dueDate')} value={form.dueAt}
          errorId={errors.dueAt ? 'task-due-date-error' : undefined}
          disabled={busy} open={dateOpen} onOpenChange={setDateOpen}
          onChange={(value) => update('dueAt', value)}
        />
        {errors.dueAt ? <span id="task-due-date-error" className="field-error">{errors.dueAt}</span> : null}

        <Select
          id="task-priority" name="priority" label={t('taskModal.priority')} options={priorityOptions}
          value={String(form.priority)} disabled={busy}
          onChange={(value) => update('priority', Number(value) as TaskPriority)}
        />
        {errors.priority ? <span className="field-error">{errors.priority}</span> : null}

        <Select
          id="task-linked-event" name="linkedEventId" label={t('taskModal.linkedEvent')} options={eventOptions}
          value={form.linkedEventId} searchable disabled={busy}
          errorId={errors.linkedEventId ? 'task-linked-event-error' : undefined}
          onChange={(value) => update('linkedEventId', value)}
        />
        {errors.linkedEventId ? <span id="task-linked-event-error" className="field-error">{errors.linkedEventId}</span> : null}

        <label className="form-check form-check-custom form-check-solid">
          <input
            className="form-check-input" type="checkbox" checked={form.completed} disabled={busy}
            aria-label={t('taskModal.completed')} onChange={(event) => update('completed', event.target.checked)}
          />
          <span className="form-check-label">{t('taskModal.completed')}</span>
        </label>

        <div className="good-field">
          <label htmlFor="task-note">{t('taskModal.note')}</label>
          <textarea id="task-note" className="good-input good-textarea" autoComplete="off" value={form.note} disabled={busy} onChange={(event) => update('note', event.target.value)} />
        </div>
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
        title={t('taskModal.deleteTitle', { title: mode.task.title })}
        description={<>{t('common.deleteUnrecoverable')}<br />{t('taskModal.deleteDesc2')}</>}
        tone="danger" confirmLabel={t('common.permanentDelete')} busyLabel={t('common.deleting')} busy={busy}
        errorMessage={dialogError}
        onCancel={() => { setConfirm(null); setDialogError(''); }}
        onConfirm={() => void remove()}
      />
    ) : null}
  </>;
}
