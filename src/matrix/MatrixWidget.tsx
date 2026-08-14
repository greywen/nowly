import { Plus, X } from 'lucide-react';
import type { CalendarEvent } from '../calendar/calendar-model';
import type { MatrixTask, Quadrant } from './matrix-model';
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
  pendingTaskIds: Set<string>;
  onRetry: () => void;
  onCreateTask: () => void;
  onOpenTask: (task: MatrixTask, trigger: HTMLElement) => void;
  onToggleTask: (task: MatrixTask, completed: boolean) => void;
  onRetryCompletion: () => void;
  onDismissCompletionError: () => void;
};

export function MatrixWidget({
  tasks,
  events,
  status,
  errorMessage,
  completionError,
  pendingTaskIds,
  onRetry,
  onCreateTask,
  onOpenTask,
  onToggleTask,
  onRetryCompletion,
  onDismissCompletionError
}: MatrixWidgetProps) {
  return (
    <div className="widget-content">
      <div className="card-header card-header--actions-only">
        <button type="button" className="btn btn-icon" aria-label={t('matrix.newTask')} onClick={onCreateTask}>
          <Plus aria-hidden="true" />
        </button>
      </div>
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
        {status === 'loading' ? <p className="empty-copy">{t('matrix.loading')}</p> : null}
        <div className="quadrant-grid">
          {quadrantOrder.map((quadrant) => {
            const quadrantTasks = tasks.filter((task) => task.quadrant === quadrant);
            return (
              <section key={quadrant} aria-label={quadrantLabel(quadrant)} className={`quadrant ${quadrantClass[quadrant]}`}>
                <div className="quadrant-head">
                  <h3>{quadrantLabel(quadrant)}</h3>
                  <span className="quadrant-count" aria-label={t('matrix.quadrantCount', { label: quadrantLabel(quadrant), count: quadrantTasks.length })}>
                    {quadrantTasks.length}
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
                      onToggle={onToggleTask}
                      onOpen={onOpenTask}
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
