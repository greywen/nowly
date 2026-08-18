import type { DragEvent } from 'react';
import type { CalendarEvent } from '../calendar/calendar-model';
import { formatTaskMeta } from '../lib/task-draft';
import type { MatrixTask } from './matrix-model';
import { t } from '../i18n';

type TaskRowProps = {
  task: MatrixTask;
  events: CalendarEvent[];
  today?: Date;
  pending: boolean;
  dragging?: boolean;
  onToggle(task: MatrixTask, completed: boolean): void;
  onOpen(task: MatrixTask, trigger: HTMLElement): void;
  onDragStart?(event: DragEvent<HTMLElement>, task: MatrixTask): void;
  onDragEnd?(): void;
};

export function TaskRow({ task, today, pending, dragging = false, onToggle, onOpen, onDragStart, onDragEnd }: TaskRowProps) {
  const draggable = Boolean(onDragStart);

  return (
    <div
      className={`task-row${task.completed ? ' task-row--completed' : ''}${dragging ? ' task-row--dragging' : ''}`}
      draggable={draggable}
      aria-grabbed={draggable ? dragging : undefined}
      onDragStart={onDragStart ? (event) => onDragStart(event, task) : undefined}
      onDragEnd={onDragEnd}
    >
      <label className="form-check form-check-custom form-check-solid task-row__check">
        <input
          className="form-check-input"
          type="checkbox"
          checked={task.completed}
          disabled={pending}
          aria-label={task.completed ? t('taskRow.markIncomplete', { title: task.title }) : t('taskRow.complete', { title: task.title })}
          onChange={(event) => onToggle(task, event.target.checked)}
        />
      </label>
      <div className="task-row__copy">
        <button
          type="button"
          className="task-row__title"
          aria-label={t('taskRow.edit', { title: task.title })}
          onClick={(event) => onOpen(task, event.currentTarget)}
        >
          {task.title}
        </button>
        <span className="task-row__meta">{formatTaskMeta(task, today)}</span>
      </div>
    </div>
  );
}
