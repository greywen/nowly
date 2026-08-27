import { X } from 'lucide-react';
import { type RefObject, useId, useMemo, useState } from 'react';
import type { CalendarEvent } from '../calendar/calendar-model';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DatePicker } from '../components/DatePicker';
import { Dialog } from '../components/Dialog';
import { Select } from '../components/Select';
import type { RepositoryError } from '../data/nowly-repository';
import { t } from '../i18n';
import { KanbanMultiSelect } from '../kanban/KanbanMultiSelect';
import { quadrantLabel } from '../matrix/matrix-model';
import { useTaskWorkspace } from './TaskWorkspaceContext';
import {
  taskPriorityOrder,
  type Task,
  type TaskDraft,
  type TaskPriority,
  type TaskView
} from './task-model';

type Mode =
  | { type: 'create'; originView: TaskView; dueDate: string | null; laneId?: string | null }
  | { type: 'edit'; task: Task };

type Props = {
  mode: Mode;
  events: CalendarEvent[];
  restoreFocusRef?: RefObject<HTMLElement | null>;
  onClose(): void;
  onEventsChanged?(): Promise<unknown> | void;
};

type Form = {
  title: string;
  description: string;
  priority: TaskPriority | '';
  dueDate: string;
  completed: boolean;
  laneId: string;
  tagIds: string[];
  collaboratorIds: string[];
  linkedEventId: string;
  views: TaskView[];
};

function message(error: unknown) {
  return typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
    ? error.message
    : t('common.opFailed');
}

export function UnifiedTaskDialog({ mode, events, restoreFocusRef, onClose, onEventsChanged }: Props) {
  const workspace = useTaskWorkspace();
  const snapshot = workspace.workspace.data;
  const initial = useMemo<Form>(() => {
    if (mode.type === 'edit') {
      return {
        title: mode.task.title,
        description: mode.task.description,
        priority: mode.task.priority ?? '',
        dueDate: mode.task.dueDate ?? '',
        completed: mode.task.completed,
        laneId: mode.task.laneId,
        tagIds: mode.task.tagIds,
        collaboratorIds: mode.task.collaboratorIds,
        linkedEventId: mode.task.linkedEventId ?? '',
        views: mode.task.views
      };
    }
    const priority = mode.originView === 'matrix' ? 'important_urgent' : '';
    const views: TaskView[] = mode.originView === 'kanban' ? ['kanban'] : ['kanban', mode.originView];
    return {
      title: '',
      description: '',
      priority,
      dueDate: mode.dueDate ?? '',
      completed: false,
      laneId: mode.laneId ?? snapshot.defaultLaneId,
      tagIds: [],
      collaboratorIds: [],
      linkedEventId: '',
      views
    };
  }, [mode, snapshot.defaultLaneId]);
  const [form, setForm] = useState(initial);
  const [fieldError, setFieldError] = useState<{ field?: string; message: string } | null>(null);
  const [dialogError, setDialogError] = useState('');
  const [dateOpen, setDateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<'discard' | 'delete' | null>(null);
  const titleId = useId();

  const dirty = JSON.stringify(initial) !== JSON.stringify(form);
  const activeTags = snapshot.tags.filter((tag) => !tag.archivedAt || form.tagIds.includes(tag.id));
  const activeCollaborators = snapshot.collaborators.filter(
    (person) => !person.archivedAt || form.collaboratorIds.includes(person.id)
  );
  const priorityOptions = [
    { value: '', label: t('kanbanTask.noPriority') },
    ...taskPriorityOrder.map((priority) => ({ value: priority, label: quadrantLabel(priority) }))
  ];
  const laneOptions = snapshot.lanes.map((lane) => ({ value: lane.id, label: lane.name }));
  const eventOptions = [
    { value: '', label: t('taskModal.noLink') },
    ...(form.linkedEventId && !events.some((event) => event.id === form.linkedEventId)
      ? [{ value: form.linkedEventId, label: t('taskModal.staleLink') }]
      : []),
    ...events.map((event) => ({ value: event.id, label: event.title }))
  ];

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
    const views = form.views.filter((view) =>
      view === 'kanban' || (view === 'matrix' && form.priority) || (view === 'calendar' && form.dueDate)
    );
    return {
      title: form.title.trim(),
      description: form.description,
      priority: form.priority || null,
      dueDate: form.dueDate || null,
      completed: form.completed,
      laneId: form.laneId,
      tagIds: form.tagIds,
      collaboratorIds: form.collaboratorIds,
      linkedEventId: form.linkedEventId || null,
      ...(!snapshot.linkingEnabled ? { views: views.length ? views : ['kanban'] } : {})
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
    const previousLink = mode.type === 'edit' ? mode.task.linkedEventId : null;
    try {
      const saved = mode.type === 'create'
        ? await workspace.createTask(mode.originView, draft())
        : await workspace.updateTask(mode.task.id, draft());
      if (previousLink !== saved.linkedEventId) await onEventsChanged?.();
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
      if (mode.task.linkedEventId) await onEventsChanged?.();
      onClose();
    } catch (error) {
      setDialogError(message(error));
    } finally {
      setBusy(false);
    }
  }

  const viewOptions: Array<{ id: TaskView; label: string; disabled: boolean }> = [
    { id: 'kanban', label: t('taskModal.viewKanban'), disabled: false },
    { id: 'matrix', label: t('taskModal.viewMatrix'), disabled: !form.priority },
    { id: 'calendar', label: t('taskModal.viewCalendar'), disabled: !form.dueDate }
  ];

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
            onChange={(event) => update('title', event.target.value)} />
          {fieldError?.field === 'title' ? <span className="field-error">{fieldError.message}</span> : null}
        </div>
        <div className="good-field">
          <label htmlFor="unified-task-description">{t('kanbanTask.description')}</label>
          <textarea id="unified-task-description" className="good-input good-textarea" value={form.description} disabled={busy}
            onChange={(event) => update('description', event.target.value)} />
        </div>
        <Select id="unified-task-priority" label={t('taskModal.quadrant')} options={priorityOptions}
          value={form.priority} disabled={busy} onChange={(value) => update('priority', value as TaskPriority | '')} />
        <DatePicker id="unified-task-due-date" label={t('taskModal.dueDate')} value={form.dueDate}
          disabled={busy} open={dateOpen} onOpenChange={setDateOpen} onChange={(value) => update('dueDate', value)} />
        <Select id="unified-task-lane" label={t('taskModal.lane')} options={laneOptions} value={form.laneId}
          disabled={busy} onChange={(value) => update('laneId', value)} />
        <label className="form-check form-check-custom form-check-solid">
          <input className="form-check-input" type="checkbox" checked={form.completed} disabled={busy}
            aria-label={t('taskModal.completed')} onChange={(event) => update('completed', event.target.checked)} />
          <span className="form-check-label">{t('taskModal.completed')}</span>
        </label>
        <KanbanMultiSelect legend={t('kanbanTask.tags')}
          options={activeTags.map((tag) => ({ id: tag.id, label: tag.name }))} selected={form.tagIds} disabled={busy}
          emptyHint={t('kanbanTask.tagsEmpty')}
          onToggle={(id, checked) => update('tagIds', toggle(form.tagIds, id, checked))} />
        <KanbanMultiSelect legend={t('kanbanTask.collaborators')}
          options={activeCollaborators.map((person) => ({ id: person.id, label: person.name }))}
          selected={form.collaboratorIds} disabled={busy} emptyHint={t('kanbanTask.collaboratorsEmpty')}
          onToggle={(id, checked) => update('collaboratorIds', toggle(form.collaboratorIds, id, checked))} />
        <Select id="unified-task-event" label={t('taskModal.linkedEvent')} options={eventOptions}
          value={form.linkedEventId} searchable disabled={busy} onChange={(value) => update('linkedEventId', value)} />
        {!snapshot.linkingEnabled ? (
          <fieldset className="kanban-multiselect">
            <legend>{t('taskModal.views')}</legend>
            <div className="kanban-multiselect__options">
              {viewOptions.map((view) => (
                <label key={view.id} className="form-check form-check-custom form-check-solid">
                  <input className="form-check-input" type="checkbox" checked={form.views.includes(view.id)}
                    disabled={busy || view.disabled}
                    onChange={(event) => update('views', event.target.checked
                      ? [...form.views, view.id]
                      : form.views.filter((item) => item !== view.id))} />
                  <span className="form-check-label">{view.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
      </form>
    </Dialog>
    {confirm === 'discard' ? (
      <ConfirmDialog title={t('common.discardTitle')} description={t('common.discardDesc')}
        confirmLabel={t('common.discard')} busyLabel={t('common.discarding')}
        onCancel={() => setConfirm(null)} onConfirm={onClose} />
    ) : null}
    {confirm === 'delete' && mode.type === 'edit' ? (
      <ConfirmDialog title={t('taskModal.deleteTitle', { title: mode.task.title })}
        description={<>{t('common.deleteUnrecoverable')}<br />{t('taskModal.deleteDesc2')}</>}
        tone="danger" confirmLabel={t('common.permanentDelete')} busyLabel={t('common.deleting')}
        busy={busy} errorMessage={dialogError} onCancel={() => setConfirm(null)} onConfirm={() => void remove()} />
    ) : null}
  </>;
}
