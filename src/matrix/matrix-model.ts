export type Quadrant = 'important_urgent' | 'important_not_urgent' | 'not_important_urgent' | 'not_important_not_urgent';

export type TaskPriority = 1 | 2 | 3;

export type MatrixTask = {
  id: string;
  title: string;
  quadrant: Quadrant;
  dueAt: string | null;
  priority: TaskPriority;
  completed: boolean;
  linkedEventId: string | null;
  note: string;
  createdAt: string;
  updatedAt: string;
};

export type TaskDraft = Omit<MatrixTask, 'id' | 'createdAt' | 'updatedAt'>;

export const quadrantOrder: Quadrant[] = [
  'important_urgent',
  'important_not_urgent',
  'not_important_urgent',
  'not_important_not_urgent'
];

export const priorityLabels: Record<TaskPriority, string> = {
  1: '高',
  2: '中',
  3: '低'
};

export const quadrantLabels: Record<Quadrant, string> = {
  important_urgent: '重要且紧急',
  important_not_urgent: '重要不紧急',
  not_important_urgent: '不重要但紧急',
  not_important_not_urgent: '不重要不紧急'
};
