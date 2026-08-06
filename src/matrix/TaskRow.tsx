import type { CalendarEvent } from '../calendar/calendar-model';
import { formatTaskMeta } from '../lib/task-draft';
import type { MatrixTask } from './matrix-model';

type TaskRowProps = {
  task: MatrixTask;
  events: CalendarEvent[];
  today?: Date;
  pending: boolean;
  onToggle(task: MatrixTask, completed: boolean): void;
  onOpen(task: MatrixTask, trigger: HTMLElement): void;
};

export function TaskRow({ task, today, pending, onToggle, onOpen }: TaskRowProps) {

  return (
    <div className={`task-row${task.completed ? ' task-row--completed' : ''}`}>
      <label className="form-check form-check-custom form-check-solid task-row__check">
        <input
          className="form-check-input"
          type="checkbox"
          checked={task.completed}
          disabled={pending}
          aria-label={task.completed ? `标记任务为未完成：${task.title}` : `完成任务：${task.title}`}
          onChange={(event) => onToggle(task, event.target.checked)}
        />
      </label>
      <div className="task-row__copy">
        <button
          type="button"
          className="task-row__title"
          aria-label={`编辑任务：${task.title}`}
          onClick={(event) => onOpen(task, event.currentTarget)}
        >
          {task.title}
        </button>
        <span className="task-row__meta">{formatTaskMeta(task, today)}</span>
      </div>
    </div>
  );
}
