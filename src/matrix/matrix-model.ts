export type Quadrant = 'important_urgent' | 'important_not_urgent' | 'not_important_urgent' | 'not_important_not_urgent';

export type TaskPriority = 1 | 2 | 3;

// A tag resolved for display alongside a task. Colors are canonical HEX values,
// mirroring the kanban tag chips.
export type MatrixTaskTag = {
  id: string;
  name: string;
  color: string;
};

export type MatrixTask = {
  id: string;
  title: string;
  quadrant: Quadrant;
  dueAt: string | null;
  priority: TaskPriority;
  completed: boolean;
  linkedEventId: string | null;
  note: string;
  tags: MatrixTaskTag[];
  createdAt: string;
  updatedAt: string;
};

// Tags are resolved for display, not edited through the matrix draft, so they
// are excluded here alongside the identity/audit fields.
export type TaskDraft = Omit<MatrixTask, 'id' | 'createdAt' | 'updatedAt' | 'tags'>;

export const quadrantOrder: Quadrant[] = [
  'important_urgent',
  'important_not_urgent',
  'not_important_urgent',
  'not_important_not_urgent'
];

import { t } from '../i18n';

const priorityKeys: Record<TaskPriority, string> = {
  1: 'priority.high',
  2: 'priority.medium',
  3: 'priority.low'
};

// Language-aware label lookups. These read the active language at call time so
// a language switch (which re-renders the tree) produces the new strings.
export function priorityLabel(priority: TaskPriority): string {
  return t(priorityKeys[priority]);
}

export function quadrantLabel(quadrant: Quadrant): string {
  return t(`quadrant.${quadrant}`);
}
