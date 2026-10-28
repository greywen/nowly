import { ListCheck } from '../components/icons';
import { t } from '../i18n';
import { stepProgress, type TaskStep } from './task-model';

// Read-only "done/total" shown on kanban cards and matrix rows. The visual
// fraction is hidden from assistive technology, which reads the full sentence.
export function TaskStepCount({ steps }: { steps?: readonly TaskStep[] }) {
  const { done, total } = stepProgress(steps);
  if (total === 0) return null;
  return (
    <span className="task-step-count">
      <ListCheck aria-hidden="true" />
      <span aria-hidden="true">{done}/{total}</span>
      <span className="visually-hidden">{t('taskSteps.progress', { done, total })}</span>
    </span>
  );
}
