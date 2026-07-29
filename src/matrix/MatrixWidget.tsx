import { Plus } from 'lucide-react';
import type { MatrixTask, Quadrant } from './matrix-model';
import { quadrantLabels } from './matrix-model';

const quadrantOrder: Quadrant[] = ['important_urgent', 'important_not_urgent', 'not_important_urgent', 'not_important_not_urgent'];

const quadrantClass: Record<Quadrant, string> = {
  important_urgent: 'q-danger',
  important_not_urgent: 'q-primary',
  not_important_urgent: 'q-warning',
  not_important_not_urgent: 'q-neutral'
};

type LoadStatus = 'loading' | 'ready' | 'error';

type MatrixWidgetProps = {
  tasks: MatrixTask[];
  status: LoadStatus;
  errorMessage?: string;
  onRetry: () => void;
  onCreateTask: () => void;
  onOpenTask: (task: MatrixTask) => void;
};

export function MatrixWidget({
  tasks,
  status,
  errorMessage,
  onRetry,
  onCreateTask,
  onOpenTask
}: MatrixWidgetProps) {
  return (
    <div className="widget-content">
      <div className="card-header">
        <div className="heading-group">
          <h2>四象限</h2>
        </div>
        <button type="button" className="btn btn-icon" aria-label="新增任务" onClick={onCreateTask}>
          <Plus aria-hidden="true" />
        </button>
      </div>
      <div className="panel-body">
        {status === 'error' ? (
          <div className="module-message" role="alert">
            <span>{errorMessage ?? '无法读取任务。'}</span>
            <button type="button" className="link-btn" aria-label="重试读取任务" onClick={onRetry}>
              重试
            </button>
          </div>
        ) : null}
        {status === 'loading' ? <p className="empty-copy">正在读取本地任务</p> : null}
        <div className="quadrant-grid">
          {quadrantOrder.map((quadrant) => {
            const quadrantTasks = tasks.filter((task) => task.quadrant === quadrant);
            return (
              <section key={quadrant} className={`quadrant ${quadrantClass[quadrant]}`}>
                <h3>{quadrantLabels[quadrant]}</h3>
                <div data-testid="quadrant-scroll" className="quadrant-tasks">
                  {status === 'ready' && quadrantTasks.length === 0 ? (
                    <p className="empty-copy">暂无任务</p>
                  ) : null}
                  {quadrantTasks.map((task) => (
                    <button
                      key={task.id}
                      type="button"
                      onClick={() => onOpenTask(task)}
                      className="quadrant-task"
                    >
                      {task.title}
                    </button>
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
