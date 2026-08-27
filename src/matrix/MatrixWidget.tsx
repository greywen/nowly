import { Plus, Settings, X } from 'lucide-react';
import { type DragEvent, useMemo, useState } from 'react';
import type { CalendarEvent } from '../calendar/calendar-model';
import type { MatrixTask, MatrixTaskTag, Quadrant } from './matrix-model';
import { quadrantLabel, quadrantOrder } from './matrix-model';
import { TaskRow } from './TaskRow';
import { t } from '../i18n';

const quadrantClass: Record<Quadrant, string> = {
  important_urgent: 'q-danger',
  important_not_urgent: 'q-primary',
  not_important_urgent: 'q-warning',
  not_important_not_urgent: 'q-neutral'
};

type LoadStatus = 'loading' | 'ready' | 'error';

type MatrixWidgetProps = {
  tasks: MatrixTask[];
  events: CalendarEvent[];
  status: LoadStatus;
  errorMessage?: string;
  completionError: string | null;
  dragError?: string | null;
  pendingTaskIds: Set<string>;
  onRetry: () => void;
  onCreateTask: () => void;
  onOpenSettings?: () => void;
  onOpenTask: (task: MatrixTask, trigger: HTMLElement) => void;
  onToggleTask: (task: MatrixTask, completed: boolean) => void;
  onMoveTask?: (task: MatrixTask, quadrant: Quadrant) => void;
  onRetryCompletion: () => void;
  onDismissCompletionError: () => void;
  onDismissDragError?: () => void;
};

export function MatrixWidget({
  tasks,
  events,
  status,
  errorMessage,
  completionError,
  dragError,
  pendingTaskIds,
  onRetry,
  onCreateTask,
  onOpenSettings,
  onOpenTask,
  onToggleTask,
  onMoveTask,
  onRetryCompletion,
  onDismissCompletionError,
  onDismissDragError
}: MatrixWidgetProps) {
  // The task currently being dragged and the quadrant hovered as a drop target.
  // Kept in component state because the WebView's dataTransfer is unreliable for
  // structured payloads, mirroring the kanban board's approach.
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropQuadrant, setDropQuadrant] = useState<Quadrant | null>(null);
  // The active tag filter. `null` means "show every task"; otherwise only tasks
  // carrying the selected tag id are visible across all quadrants.
  const [activeTagId, setActiveTagId] = useState<string | null>(null);

  const draggingTask = draggingId ? tasks.find((task) => task.id === draggingId) ?? null : null;

  // Distinct tags present on the current tasks, sorted by name, so the filter
  // bar only ever offers tags that would actually match something.
  const availableTags = useMemo<MatrixTaskTag[]>(() => {
    const byId = new Map<string, MatrixTaskTag>();
    for (const task of tasks) {
      for (const tag of task.tags) if (!byId.has(tag.id)) byId.set(tag.id, tag);
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [tasks]);

  // If the active tag disappears (e.g. after edits), fall back to showing all.
  const effectiveTagId = activeTagId && availableTags.some((tag) => tag.id === activeTagId) ? activeTagId : null;
  const visibleTasks = effectiveTagId ? tasks.filter((task) => task.tags.some((tag) => tag.id === effectiveTagId)) : tasks;

  function onTaskDragStart(event: DragEvent<HTMLElement>, task: MatrixTask) {
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', task.id);
    }
    setDraggingId(task.id);
  }

  function onTaskDragEnd() {
    setDraggingId(null);
    setDropQuadrant(null);
  }

  function onQuadrantDragOver(event: DragEvent<HTMLElement>, quadrant: Quadrant) {
    if (!draggingTask) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    setDropQuadrant(quadrant);
  }

  function onQuadrantDrop(event: DragEvent<HTMLElement>, quadrant: Quadrant) {
    event.preventDefault();
    if (draggingTask && draggingTask.quadrant !== quadrant) {
      onMoveTask?.(draggingTask, quadrant);
    }
    onTaskDragEnd();
  }

  return (
    <div className="widget-content">
      <div className="card-header card-header--actions-only">
        {onOpenSettings ? (
          <button type="button" className="btn btn-icon" aria-label={t('taskSettings.title')} onClick={onOpenSettings}>
            <Settings aria-hidden="true" />
          </button>
        ) : null}
        <button type="button" className="btn btn-icon" aria-label={t('matrix.newTask')} onClick={onCreateTask}>
          <Plus aria-hidden="true" />
        </button>
      </div>
      {availableTags.length > 0 ? (
        <nav className="matrix-filter" aria-label={t('matrix.filterLabel')}>
          <button
            type="button"
            className={`matrix-filter__chip${effectiveTagId === null ? ' matrix-filter__chip--active' : ''}`}
            aria-pressed={effectiveTagId === null}
            onClick={() => setActiveTagId(null)}
          >
            {t('matrix.filterAll')}
          </button>
          {availableTags.map((tag) => {
            const active = effectiveTagId === tag.id;
            return (
              <button
                key={tag.id}
                type="button"
                className={`matrix-filter__chip${active ? ' matrix-filter__chip--active' : ''}`}
                style={{ color: tag.color }}
                aria-pressed={active}
                onClick={() => setActiveTagId(active ? null : tag.id)}
              >
                <span className="matrix-filter__hash" aria-hidden="true">#</span>
                {tag.name}
              </button>
            );
          })}
        </nav>
      ) : null}
      <div className="panel-body matrix-body">
        {status === 'error' ? (
          <div className="module-message" role="alert">
            <span>{errorMessage ?? t('matrix.errorLoad')}</span>
            <button type="button" className="link-btn" aria-label={t('matrix.retryLoad')} onClick={onRetry}>{t('common.retry')}</button>
          </div>
        ) : null}
        {completionError ? (
          <div className="module-message completion-message" role="alert">
            <span>{completionError}</span>
            <span className="module-message__actions">
              <button type="button" className="link-btn" aria-label={t('matrix.retryCompletion')} onClick={onRetryCompletion}>{t('common.retry')}</button>
              <button type="button" className="link-btn icon-link" aria-label={t('matrix.dismissError')} onClick={onDismissCompletionError}>
                <X aria-hidden="true" />
              </button>
            </span>
          </div>
        ) : null}
        {dragError ? (
          <div className="module-message" role="alert">
            <span>{dragError}</span>
            <button type="button" className="link-btn icon-link" aria-label={t('matrix.dismissError')} onClick={onDismissDragError}>
              <X aria-hidden="true" />
            </button>
          </div>
        ) : null}
        {status === 'loading' ? <p className="empty-copy">{t('matrix.loading')}</p> : null}
        <div className="quadrant-grid">
          {quadrantOrder.map((quadrant) => {
            const quadrantTasks = visibleTasks.filter((task) => task.quadrant === quadrant);
            const remaining = quadrantTasks.filter((task) => !task.completed).length;
            const isDropTarget = draggingTask !== null && dropQuadrant === quadrant && draggingTask.quadrant !== quadrant;
            return (
              <section
                key={quadrant}
                aria-label={quadrantLabel(quadrant)}
                className={`quadrant ${quadrantClass[quadrant]}${isDropTarget ? ' quadrant--drop' : ''}`}
                onDragOver={(event) => onQuadrantDragOver(event, quadrant)}
                onDrop={(event) => onQuadrantDrop(event, quadrant)}
              >
                <div className="quadrant-head">
                  <h3>{quadrantLabel(quadrant)}</h3>
                  <span className="quadrant-count" aria-label={t('matrix.quadrantCount', { label: quadrantLabel(quadrant), remaining, total: quadrantTasks.length })}>
                    {remaining}/{quadrantTasks.length}
                  </span>
                </div>
                <div data-testid="quadrant-scroll" className="quadrant-tasks">
                  {status === 'ready' && quadrantTasks.length === 0 ? <p className="empty-copy">{t('matrix.empty')}</p> : null}
                  {quadrantTasks.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      events={events}
                      pending={pendingTaskIds.has(task.id)}
                      dragging={draggingId === task.id}
                      onToggle={onToggleTask}
                      onOpen={onOpenTask}
                      onDragStart={onTaskDragStart}
                      onDragEnd={onTaskDragEnd}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
