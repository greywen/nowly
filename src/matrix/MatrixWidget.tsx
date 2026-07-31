import { Plus, X } from 'lucide-react';
import type { CalendarEvent } from '../calendar/calendar-model';
import type { MatrixTask, Quadrant } from './matrix-model';
import { quadrantLabels, quadrantOrder } from './matrix-model';
import { TaskRow } from './TaskRow';

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
      <div className="card-header">
        <div className="heading-group"><h2>四象限</h2></div>
        <button type="button" className="btn btn-icon" aria-label="新增任务" onClick={onCreateTask}>
          <Plus aria-hidden="true" />
        </button>
      </div>
      <div className="panel-body matrix-body">
        {status === 'error' ? (
          <div className="module-message" role="alert">
            <span>{errorMessage ?? '无法读取任务。'}</span>
            <button type="button" className="link-btn" aria-label="重试读取任务" onClick={onRetry}>重试</button>
          </div>
        ) : null}
        {completionError ? (
          <div className="module-message completion-message" role="alert">
            <span>{completionError}</span>
            <span className="module-message__actions">
              <button type="button" className="link-btn" aria-label="重试完成状态" onClick={onRetryCompletion}>重试</button>
              <button type="button" className="link-btn icon-link" aria-label="关闭错误提示" onClick={onDismissCompletionError}>
                <X aria-hidden="true" />
              </button>
            </span>
          </div>
        ) : null}
        {status === 'loading' ? <p className="empty-copy">正在读取本地任务</p> : null}
        <div className="quadrant-grid">
          {quadrantOrder.map((quadrant) => {
            const quadrantTasks = tasks.filter((task) => task.quadrant === quadrant);
            return (
              <section key={quadrant} aria-label={quadrantLabels[quadrant]} className={`quadrant ${quadrantClass[quadrant]}`}>
                <div className="quadrant-head">
                  <h3>{quadrantLabels[quadrant]}</h3>
                  <span className="quadrant-count" aria-label={`${quadrantLabels[quadrant]} ${quadrantTasks.length} 个任务`}>
                    {quadrantTasks.length}
                  </span>
                </div>
                <div data-testid="quadrant-scroll" className="quadrant-tasks">
                  {status === 'ready' && quadrantTasks.length === 0 ? <p className="empty-copy">暂无任务</p> : null}
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
