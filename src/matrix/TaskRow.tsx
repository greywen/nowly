import { useRef, type DragEvent } from 'react';
import { formatTaskMeta } from '../lib/task-draft';
import { colorStyle } from '../lib/color';
import type { MatrixTask } from './matrix-model';
import { t } from '../i18n';
import { TaskStepCount } from '../tasks/TaskStepCount';
import { celebrateTaskCompletion } from '../tasks/completion-celebration';
import { priorityColors } from '../tasks/task-projections';

function boardCard(taskId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-task-card="${CSS.escape(taskId)}"]`);
}

function isSeparateControl(target: EventTarget): boolean {
  return target instanceof Element && Boolean(target.closest(
    'label, input, select, textarea, a[href], button:not(.task-row__title), [contenteditable="true"]'
  ));
}

type TaskRowProps = {
  task: MatrixTask;
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
  const titleRef = useRef<HTMLButtonElement>(null);
  const suppressOpen = useRef(false);
  const pressedControl = useRef(false);

  return (
    <div
      className={`task-row${task.completed ? ' task-row--completed' : ''}${dragging ? ' task-row--dragging' : ''}`}
      draggable={draggable}
      aria-grabbed={draggable ? dragging : undefined}
      onPointerDownCapture={(event) => {
        suppressOpen.current = false;
        pressedControl.current = isSeparateControl(event.target);
      }}
      onPointerCancel={() => { suppressOpen.current = true; }}
      onClick={(event) => {
        if (event.defaultPrevented || event.button !== 0 || dragging || suppressOpen.current
          || pressedControl.current || isSeparateControl(event.target)) return;
        if (titleRef.current) onOpen(task, titleRef.current);
      }}
      onDragStart={onDragStart ? (event) => {
        if (pressedControl.current || isSeparateControl(event.target)) {
          event.preventDefault();
          return;
        }
        // Keep this set through dragend: a release click is still part of the
        // drag. Only a new press or keyboard activation starts another gesture.
        suppressOpen.current = true;
        onDragStart(event, task);
      } : undefined}
      onDragEnd={onDragEnd}
    >
      <label className="form-check form-check-custom form-check-solid task-row__check">
        <input
          className="form-check-input"
          type="checkbox"
          checked={task.completed}
          disabled={pending}
          aria-label={task.completed ? t('taskRow.markIncomplete', { title: task.title }) : t('taskRow.complete', { title: task.title })}
          onChange={(event) => {
            const completed = event.target.checked;
            // Before the write, so a board card can still be measured.
            if (completed) {
              celebrateTaskCompletion({
                title: task.title,
                color: priorityColors[task.quadrant],
                checkbox: event.currentTarget,
                card: boardCard(task.id),
                announcement: t('kanbanDone.dropped', { title: task.title })
              });
            }
            onToggle(task, completed);
          }}
        />
      </label>
      <div className="task-row__copy">
        <div className="task-row__headline">
          <button
            ref={titleRef}
            type="button"
            className="task-row__title"
            aria-label={t('taskRow.edit', { title: task.title })}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                suppressOpen.current = false;
                pressedControl.current = false;
              }
            }}
          >
            {task.title}
          </button>
          {task.lane && !task.completed ? (
            <span
              className="task-lane-chip"
              style={colorStyle(task.lane.color)}
              title={t('taskRow.lane', { name: task.lane.name })}
            >
              <span className="task-lane-chip__dot" aria-hidden="true" />
              <span aria-hidden="true">{task.lane.name}</span>
              <span className="visually-hidden">{t('taskRow.lane', { name: task.lane.name })}</span>
            </span>
          ) : null}
          {task.tags.length > 0 ? (
            <span className="task-row__tags">
              {task.tags.map((tag) => (
                <span key={tag.id} className="task-tag" style={{ color: tag.color }}>
                  <span className="task-tag__hash" aria-hidden="true">#</span>
                  {tag.name}
                </span>
              ))}
            </span>
          ) : null}
        </div>
        <div className="task-row__meta-line">
          <span className="task-row__meta">{formatTaskMeta(task, today)}</span>
          <TaskStepCount steps={task.steps} />
        </div>
      </div>
    </div>
  );
}
