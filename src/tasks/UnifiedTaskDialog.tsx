import { X } from '../components/icons';
import { type RefObject, useEffect, useId, useMemo, useState } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DatePicker } from '../components/DatePicker';
import { Dialog } from '../components/Dialog';
import { RichEditor } from '../components/rich-text/RichEditor';
import { Select } from '../components/Select';
import type { RepositoryError } from '../data/nowly-repository';
import { t } from '../i18n';
import { KanbanMultiSelect } from '../kanban/KanbanMultiSelect';
import { quadrantLabel } from '../matrix/matrix-model';
import { priorityColors } from './task-projections';
import { useTaskWorkspace } from './TaskWorkspaceContext';
import { TaskStepsField, type TaskStepItem } from './TaskStepsField';
import {
  defaultTaskPriority,
  taskPriorityOrder,
  type Task,
  type TaskDraft,
  type TaskPriority
} from './task-model';

type Mode =
  | { type: 'create'; dueDate: string | null; laneId?: string | null; priority?: TaskPriority }
  | { type: 'edit'; task: Task };

type Props = {
  mode: Mode;
  // The matrix does not use lanes, so it hides the lane field; new tasks then
  // stay off the kanban board and edits keep the task's lane.
  showLane?: boolean;
  restoreFocusRef?: RefObject<HTMLElement | null>;
  onClose(): void;
  onSaved?(task: Task): void | Promise<void>;
  onDirtyChange?(dirty: boolean): void;
};

type Form = {
  title: string;
  description: string;
  priority: TaskPriority;
  dueDate: string;
  laneId: string | null;
  tagIds: string[];
  steps: TaskStepItem[];
  stepInput: string;
};

function message(error: unknown) {
  return typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
    ? error.message
    : t('common.opFailed');
}

export function UnifiedTaskDialog({ mode, showLane = true, restoreFocusRef, onClose, onSaved, onDirtyChange }: Props) {
  const workspace = useTaskWorkspace();
  const snapshot = workspace.workspace.data;
  const initial = useMemo<Form>(() => {
    if (mode.type === 'edit') {
      return {
        title: mode.task.title,
        description: mode.task.description,
        priority: mode.task.priority,
        dueDate: mode.task.dueDate ?? '',
        laneId: mode.task.laneId,
        tagIds: mode.task.tagIds,
        steps: (mode.task.steps ?? []).map((step) => ({
          key: step.id, id: step.id, title: step.title, completed: step.completed
        })),
        stepInput: ''
      };
    }
    return {
      title: '',
      description: '',
      priority: mode.priority ?? defaultTaskPriority,
      dueDate: mode.dueDate ?? '',
      laneId: mode.laneId !== undefined ? mode.laneId : showLane ? snapshot.defaultLaneId : null,
      tagIds: [],
      steps: [],
      stepInput: ''
    };
  }, [mode, showLane, snapshot.defaultLaneId]);
  // A task that is off the board has no lane to pick.
  const laneVisible = showLane && initial.laneId !== null;
  const [form, setForm] = useState(initial);
  const [fieldError, setFieldError] = useState<{ field?: string; message: string } | null>(null);
  const [dialogError, setDialogError] = useState('');
  const [dateOpen, setDateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<'discard' | 'delete' | null>(null);
  const titleId = useId();

  const dirty = JSON.stringify(initial) !== JSON.stringify(form);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  const activeTags = snapshot.tags.filter((tag) => !tag.archivedAt || form.tagIds.includes(tag.id));
  const laneOptions = snapshot.lanes.map((lane) => ({ value: lane.id, label: lane.name }));

  const update = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    if (fieldError?.field === key) setFieldError(null);
  };
  const toggle = (values: string[], id: string, checked: boolean) =>
    checked ? [...values, id] : values.filter((value) => value !== id);

  function requestClose() {
    if (busy) return;
    if (dirty) setConfirm('discard');
    else onClose();
  }

  function draft(): TaskDraft {
    return {
      title: form.title.trim(),
      description: form.description,
      priority: form.priority,
      dueDate: form.dueDate || null,
      // Completion is toggled from the matrix checkbox; the dialog keeps it as is.
      completed: mode.type === 'edit' ? mode.task.completed : false,
      laneId: form.laneId,
      tagIds: form.tagIds,
      steps: [
        ...form.steps.map(({ id, title, completed }) => ({ id, title: title.trim(), completed })),
        // Text typed but not yet added is kept as the last step rather than lost.
        ...(form.stepInput.trim() ? [{ id: null, title: form.stepInput.trim(), completed: false }] : [])
      ]
    };
  }

  async function save() {
    if (!form.title.trim()) {
      setFieldError({ field: 'title', message: t('taskDraft.errorTitle') });
      return;
    }
    setBusy(true);
    setDialogError('');
    setFieldError(null);
    try {
      const saved = mode.type === 'create'
        ? await workspace.createTask(draft())
        : await workspace.updateTask(mode.task.id, draft());
      await onSaved?.(saved);
      onClose();
    } catch (error) {
      const repositoryError = error as RepositoryError;
      if (repositoryError.code === 'validation_error' && repositoryError.field) {
        setFieldError({ field: repositoryError.field, message: repositoryError.message });
      } else {
        setDialogError(message(error));
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
      await workspace.deleteTask(mode.task.id);
      onClose();
    } catch (error) {
      setDialogError(message(error));
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
      footer={<div className="task-dialog__actions">
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
      </div>}
    >
      <form className="task-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <div className="good-field">
          <label htmlFor="unified-task-title">{t('taskModal.title')}</label>
          <input id="unified-task-title" className="good-input" autoComplete="off" value={form.title} disabled={busy}
            onChange={(event) => update('title', event.target.value)}
            onKeyDown={(event) => {
              // A second text box (the step input) turns off the browser's
              // implicit Enter submission, so the title keeps Enter-to-save here.
              if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
              event.preventDefault();
              void save();
            }} />
          {fieldError?.field === 'title' ? <span className="field-error">{fieldError.message}</span> : null}
        </div>
        <fieldset className="quadrant-picker" disabled={busy}>
          <legend className="quadrant-picker__legend">{t('taskModal.quadrant')}</legend>
          <div className="quadrant-picker__grid">
            {taskPriorityOrder.map((priority) => (
              <label key={priority} className="quadrant-picker__option">
                <input type="radio" className="quadrant-picker__input" name="unified-task-quadrant" value={priority}
                  checked={form.priority === priority} onChange={() => update('priority', priority)} />
                <span className="quadrant-picker__dot" style={{ background: priorityColors[priority] }} aria-hidden="true" />
                {quadrantLabel(priority)}
              </label>
            ))}
          </div>
        </fieldset>
        <div className={laneVisible ? 'task-form__row' : undefined}>
          {laneVisible && form.laneId !== null ? (
            <Select id="unified-task-lane" label={t('taskModal.lane')} options={laneOptions} value={form.laneId}
              disabled={busy} onChange={(value) => update('laneId', value)} />
          ) : null}
          <DatePicker id="unified-task-due-date" label={t('taskModal.dueDate')} value={form.dueDate}
            disabled={busy} open={dateOpen} onOpenChange={setDateOpen} onChange={(value) => update('dueDate', value)} />
        </div>
        <div className="good-field">
          <label id="unified-task-description-label">{t('kanbanTask.description')}</label>
          <RichEditor id="unified-task-description" labelledBy="unified-task-description-label"
            value={form.description} disabled={busy} placeholder={t('richEditor.placeholder')}
            onChange={(markdown) => update('description', markdown)} />
        </div>
        <TaskStepsField steps={form.steps} input={form.stepInput} disabled={busy}
          error={fieldError?.field === 'steps' ? fieldError.message : undefined}
          onStepsChange={(steps) => update('steps', steps)}
          onInputChange={(value) => update('stepInput', value)} />
        <KanbanMultiSelect legend={t('kanbanTask.tags')}
          options={activeTags.map((tag) => ({ id: tag.id, label: tag.name }))} selected={form.tagIds} disabled={busy}
          emptyHint={t('kanbanTask.tagsEmpty')}
          onToggle={(id, checked) => update('tagIds', toggle(form.tagIds, id, checked))} />
      </form>
    </Dialog>
    {confirm === 'discard' ? (
      <ConfirmDialog title={t('common.discardTitle')} description={t('common.discardDesc')}
        confirmLabel={t('common.discard')} busyLabel={t('common.discarding')}
        onCancel={() => setConfirm(null)} onConfirm={onClose} />
    ) : null}
    {confirm === 'delete' && mode.type === 'edit' ? (
      <ConfirmDialog title={t('taskModal.deleteTitle', { title: mode.task.title })}
        description={t('common.deleteUnrecoverable')}
        tone="danger" confirmLabel={t('common.permanentDelete')} busyLabel={t('common.deleting')}
        busy={busy} errorMessage={dialogError} onCancel={() => setConfirm(null)} onConfirm={() => void remove()} />
    ) : null}
  </>;
}
