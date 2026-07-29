import type { MatrixTask, Quadrant } from './matrix-model';
import { quadrantLabels } from './matrix-model';

const quadrantOrder: Quadrant[] = ['important_urgent', 'important_not_urgent', 'not_important_urgent', 'not_important_not_urgent'];

const quadrantClass: Record<Quadrant, string> = {
  important_urgent: 'bg-rose-50',
  important_not_urgent: 'bg-sky-50',
  not_important_urgent: 'bg-amber-50',
  not_important_not_urgent: 'bg-slate-100'
};

type MatrixWidgetProps = {
  tasks: MatrixTask[];
  onOpenTask: (task: MatrixTask) => void;
};

export function MatrixWidget({ tasks, onOpenTask }: MatrixWidgetProps) {
  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] p-3 xl:p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-black text-ink">四象限</h2>
        <span className="rounded-full bg-sky-50 px-2.5 py-1 text-xs font-black text-brand">编辑</span>
      </div>
      <div className="grid min-h-0 grid-cols-2 grid-rows-2 gap-2 overflow-hidden">
        {quadrantOrder.map((quadrant) => {
          const quadrantTasks = tasks.filter((task) => task.quadrant === quadrant);
          return (
            <section key={quadrant} className={`grid min-h-0 grid-rows-[auto_minmax(0,1fr)] rounded-2xl p-2.5 ${quadrantClass[quadrant]}`}>
              <h3 className="mb-2 text-xs font-black text-slate-800">{quadrantLabels[quadrant]}</h3>
              <div data-testid="quadrant-scroll" className="grid min-h-0 content-start gap-1.5 overflow-auto pr-1">
                {quadrantTasks.map((task) => (
                  <button key={task.id} type="button" onClick={() => onOpenTask(task)} className="rounded-lg bg-white/60 p-1.5 text-left text-[11px] font-bold leading-snug text-slate-600">
                    {task.title}
                  </button>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
