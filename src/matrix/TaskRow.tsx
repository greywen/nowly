import { useId, useState } from 'react';
import type { CalendarEvent } from '../calendar/calendar-model';
import { formatTaskMeta } from '../lib/task-draft';
import { priorityLabels, type MatrixTask } from './matrix-model';

type TaskRowProps = {
  task: MatrixTask;
  events: CalendarEvent[];
  today?: Date;
  pending: boolean;
  onToggle(task: MatrixTask, completed: boolean): void;
  onOpen(task: MatrixTask, trigger: HTMLElement): void;
};

export function TaskRow({ task, events, today, pending, onToggle, onOpen }: TaskRowProps) {
  const tooltipId = useId();
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const linkedEvent = events.find((event) => event.id === task.linkedEventId);
  const relationText = linkedEvent?.title ?? (task.linkedEventId ? '已关联其他月份日程' : '未关联日程');

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
          aria-describedby={tooltipOpen ? tooltipId : undefined}
          aria-label={`编辑任务：${task.title}`}
          onClick={(event) => onOpen(task, event.currentTarget)}
          onMouseEnter={() => setTooltipOpen(true)}
          onMouseLeave={() => setTooltipOpen(false)}
          onFocus={() => setTooltipOpen(true)}
          onBlur={() => setTooltipOpen(false)}
        >
          {task.title}
        </button>
        <span className="task-row__meta">{formatTaskMeta(task, today)}</span>
        {tooltipOpen ? (
          <span id={tooltipId} role="tooltip" className="task-tooltip">
            <strong>{task.title}</strong>
            <span>截止日期：{task.dueAt ?? '无截止日期'}</span>
            <span>优先级：{priorityLabels[task.priority]}</span>
            <span>关联日程：{relationText}</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}
