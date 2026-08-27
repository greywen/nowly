import type { HexColor } from '../lib/color';

export type TaskPriority =
  | 'important_urgent'
  | 'important_not_urgent'
  | 'not_important_urgent'
  | 'not_important_not_urgent';

export type TaskView = 'kanban' | 'matrix' | 'calendar';

export type Task = {
  id: string;
  title: string;
  description: string;
  priority: TaskPriority | null;
  dueDate: string | null;
  completed: boolean;
  laneId: string;
  boardPosition: number;
  tagIds: string[];
  collaboratorIds: string[];
  linkedEventId: string | null;
  views: TaskView[];
  createdAt: string;
  updatedAt: string;
};

export type TaskDraft = {
  title: string;
  description: string;
  priority: TaskPriority | null;
  dueDate: string | null;
  completed: boolean;
  laneId: string;
  tagIds: string[];
  collaboratorIds: string[];
  linkedEventId: string | null;
  views?: TaskView[];
};

export type TaskLane = {
  id: string;
  name: string;
  color: HexColor;
  position: number;
  createdAt: string;
  updatedAt: string;
};

export type TaskLaneDraft = Pick<TaskLane, 'name' | 'color'>;

export type TaskTag = {
  id: string;
  name: string;
  color: HexColor;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TaskTagDraft = Pick<TaskTag, 'name' | 'color'>;

export type TaskCollaborator = {
  id: string;
  name: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TaskCollaboratorDraft = Pick<TaskCollaborator, 'name'>;

export type TaskViewPreferences = Record<string, unknown>;

export type TaskWorkspaceSnapshot = {
  tasks: Task[];
  lanes: TaskLane[];
  tags: TaskTag[];
  collaborators: TaskCollaborator[];
  linkingEnabled: boolean;
  defaultLaneId: string;
  completionLaneId: string;
  viewPreferences: TaskViewPreferences;
};

export const taskPriorityOrder: TaskPriority[] = [
  'important_urgent',
  'important_not_urgent',
  'not_important_urgent',
  'not_important_not_urgent'
];

export function isTaskPriority(value: unknown): value is TaskPriority {
  return typeof value === 'string' && taskPriorityOrder.includes(value as TaskPriority);
}

export function emptyTaskWorkspace(): TaskWorkspaceSnapshot {
  return {
    tasks: [],
    lanes: [],
    tags: [],
    collaborators: [],
    linkingEnabled: true,
    defaultLaneId: 'kanban-lane-todo',
    completionLaneId: 'kanban-lane-done',
    viewPreferences: {}
  };
}

export function sortTaskWorkspace(snapshot: TaskWorkspaceSnapshot): TaskWorkspaceSnapshot {
  const lanes = [...snapshot.lanes].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  const laneOrder = new Map(lanes.map((lane, index) => [lane.id, index]));
  const tasks = [...snapshot.tasks].sort(
    (a, b) =>
      (laneOrder.get(a.laneId) ?? Number.MAX_SAFE_INTEGER) -
        (laneOrder.get(b.laneId) ?? Number.MAX_SAFE_INTEGER) ||
      a.boardPosition - b.boardPosition ||
      a.id.localeCompare(b.id)
  );
  const tags = [...snapshot.tags].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const collaborators = [...snapshot.collaborators].sort(
    (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
  );
  return { ...snapshot, tasks, lanes, tags, collaborators };
}
