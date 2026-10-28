import { useEffect, useId, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { GripVertical, Trash2 } from '../components/icons';
import { t } from '../i18n';
import { stepProgress } from './task-model';

export type TaskStepItem = {
  key: string;
  id: string | null;
  title: string;
  completed: boolean;
};

let draftKey = 0;

export function newTaskStepItem(title: string): TaskStepItem {
  draftKey += 1;
  return { key: `draft-step-${draftKey}`, id: null, title, completed: false };
}

function moveStep(steps: TaskStepItem[], from: number, to: number) {
  const next = [...steps];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

type Editing = { key: string; value: string };

type Props = {
  steps: TaskStepItem[];
  input: string;
  disabled: boolean;
  error?: string;
  onStepsChange(steps: TaskStepItem[]): void;
  onInputChange(value: string): void;
};

// The step checklist inside the task dialog (design.md §10.14). Fully
// controlled: the dialog keeps the steps and the add-box text in its draft, so
// nothing here is stored until the task is saved.
export function TaskStepsField({ steps, input, disabled, error, onStepsChange, onInputChange }: Props) {
  const labelId = useId();
  const hintId = useId();
  const [editing, setEditingState] = useState<Editing | null>(null);
  // Enter and the blur that follows both end an edit; the ref makes the second a no-op.
  const editingRef = useRef<Editing | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const dragOrigin = useRef<TaskStepItem[] | null>(null);
  const dropped = useRef(false);
  const [announcement, setAnnouncement] = useState('');
  const nodes = useRef(new Map<string, HTMLElement>());
  // React moves reordered rows with insertBefore, which drops focus, and edit
  // mode swaps elements, so focus is put back after the new tree is committed.
  const focusAfterRender = useRef<string | null>(null);
  const { done, total } = stepProgress(steps);

  useEffect(() => {
    const name = focusAfterRender.current;
    if (!name) return;
    focusAfterRender.current = null;
    nodes.current.get(name)?.focus();
  });

  const register = (name: string) => (node: HTMLElement | null) => {
    if (node) nodes.current.set(name, node);
    else nodes.current.delete(name);
  };

  function setEditing(next: Editing | null) {
    editingRef.current = next;
    setEditingState(next);
  }

  function add() {
    const title = input.trim();
    if (!title) return;
    onStepsChange([...steps, newTaskStepItem(title)]);
    onInputChange('');
    focusAfterRender.current = 'add';
  }

  function startEdit(step: TaskStepItem) {
    setEditing({ key: step.key, value: step.title });
    focusAfterRender.current = 'edit';
  }

  function finishEdit(save: boolean, restoreFocus: boolean) {
    const current = editingRef.current;
    if (!current) return;
    setEditing(null);
    const title = current.value.trim();
    if (save && title) {
      onStepsChange(steps.map((step) => (step.key === current.key ? { ...step, title } : step)));
    }
    if (restoreFocus) focusAfterRender.current = `title:${current.key}`;
  }

  function toggle(key: string, completed: boolean) {
    onStepsChange(steps.map((step) => (step.key === key ? { ...step, completed } : step)));
  }

  function remove(key: string) {
    onStepsChange(steps.filter((step) => step.key !== key));
    focusAfterRender.current = 'add';
  }

  function moveWithKeys(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const offset = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
    if (!offset) return;
    event.preventDefault();
    const target = index + offset;
    if (target < 0 || target >= steps.length) return;
    const step = steps[index];
    onStepsChange(moveStep(steps, index, target));
    focusAfterRender.current = `handle:${step.key}`;
    setAnnouncement(t('taskSteps.moved', { title: step.title, position: target + 1 }));
  }

  function dragStart(event: DragEvent<HTMLButtonElement>, step: TaskStepItem) {
    event.stopPropagation();
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', step.title);
    const row = event.currentTarget.closest('li');
    if (row) event.dataTransfer.setDragImage(row, 20, 20);
    dragOrigin.current = steps;
    dropped.current = false;
    setDragKey(step.key);
  }

  // The dragged key lives in state because dataTransfer is unreliable in the
  // webview. A row swaps only once the pointer passes the middle of the row it
  // is over, so the order does not flicker at the boundary.
  function dragOver(event: DragEvent<HTMLOListElement>) {
    if (!dragKey) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    const row = (event.target as Element).closest<HTMLElement>('[data-step-key]');
    const overKey = row?.dataset.stepKey;
    if (!row || !overKey || overKey === dragKey) return;
    const from = steps.findIndex((step) => step.key === dragKey);
    const over = steps.findIndex((step) => step.key === overKey);
    const rect = row.getBoundingClientRect();
    const lowerHalf = event.clientY > rect.top + rect.height / 2;
    if (from < over ? !lowerHalf : lowerHalf) return;
    onStepsChange(moveStep(steps, from, over));
  }

  function drop(event: DragEvent<HTMLOListElement>) {
    if (!dragKey) return;
    event.preventDefault();
    event.stopPropagation();
    dropped.current = true;
  }

  // A drag cancelled with Esc or released outside the list restores the order.
  function dragEnd(event: DragEvent<HTMLButtonElement>) {
    event.stopPropagation();
    if (!dropped.current && dragOrigin.current) onStepsChange(dragOrigin.current);
    dragOrigin.current = null;
    setDragKey(null);
  }

  return (
    <div className="task-steps" role="group" aria-labelledby={labelId}>
      <div className="task-steps__head">
        <span id={labelId} className="task-steps__label">{t('taskSteps.title')}</span>
        {total > 0 ? <span className="task-steps__count" aria-hidden="true">{done}/{total}</span> : null}
      </div>
      {total > 0 ? (
        <div className="task-steps__progress" role="progressbar" aria-labelledby={labelId}
          aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}
          aria-valuetext={t('taskSteps.progress', { done, total })}>
          <span className="task-steps__progress-fill" style={{ width: `${(done / total) * 100}%` }} />
        </div>
      ) : null}
      {total > 0 ? (
        <ol className="task-steps__list" onDragOver={dragOver} onDrop={drop}>
          {steps.map((step, index) => (
            <li key={step.key} data-step-key={step.key}
              className={`task-step${step.completed ? ' task-step--completed' : ''}${dragKey === step.key ? ' task-step--dragging' : ''}`}>
              <button type="button" ref={register(`handle:${step.key}`)} className="good-icon-button task-step__handle"
                draggable={!disabled} disabled={disabled} aria-describedby={hintId}
                aria-label={t('taskSteps.reorder', { title: step.title })}
                onKeyDown={(event) => moveWithKeys(event, index)}
                onDragStart={(event) => dragStart(event, step)} onDragEnd={dragEnd}>
                <GripVertical aria-hidden="true" />
              </button>
              <label className="form-check form-check-custom form-check-solid task-step__check">
                <input className="form-check-input" type="checkbox" checked={step.completed} disabled={disabled}
                  aria-label={step.completed
                    ? t('taskSteps.markIncomplete', { title: step.title })
                    : t('taskSteps.complete', { title: step.title })}
                  onChange={(event) => toggle(step.key, event.target.checked)} />
              </label>
              {editing?.key === step.key ? (
                <input ref={register('edit')} className="good-input task-step__input" autoComplete="off"
                  aria-label={t('taskSteps.editInput')} value={editing.value} disabled={disabled}
                  onChange={(event) => setEditing({ key: step.key, value: event.target.value })}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      // Handled here, so the dialog's document listener does not close it.
                      event.preventDefault();
                      finishEdit(false, true);
                    } else if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      finishEdit(true, true);
                    }
                  }}
                  onBlur={() => finishEdit(true, false)} />
              ) : (
                <button type="button" ref={register(`title:${step.key}`)} className="task-step__title"
                  disabled={disabled} aria-label={t('taskSteps.edit', { title: step.title })}
                  onClick={() => startEdit(step)}>
                  {step.title}
                </button>
              )}
              <button type="button" className="good-icon-button task-step__delete" disabled={disabled}
                aria-label={t('taskSteps.delete', { title: step.title })} onClick={() => remove(step.key)}>
                <Trash2 aria-hidden="true" />
              </button>
            </li>
          ))}
        </ol>
      ) : null}
      <div className="task-steps__add">
        <input ref={register('add')} className="good-input" autoComplete="off" value={input} disabled={disabled}
          aria-label={t('taskSteps.newLabel')} placeholder={t('taskSteps.placeholder')}
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={(event) => {
            // Enter adds a step instead of submitting the task form.
            if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
            event.preventDefault();
            add();
          }} />
        <button type="button" className="good-button" disabled={disabled || !input.trim()} onClick={add}>
          {t('taskSteps.add')}
        </button>
      </div>
      {error ? <span className="field-error">{error}</span> : null}
      <span id={hintId} className="visually-hidden">{t('taskSteps.reorderHint')}</span>
      <span className="visually-hidden" aria-live="polite">{announcement}</span>
    </div>
  );
}
