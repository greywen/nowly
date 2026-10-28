import type { KanbanCard, KanbanPriority, KanbanSnapshot } from '../kanban/kanban-model';
import type { MatrixTask, TaskDraft as MatrixTaskDraft, TaskPriority as LegacyTaskPriority } from '../matrix/matrix-model';
import { DESIGN_COLORS, type HexColor } from '../lib/color';
import { quadrantLabel } from '../matrix/matrix-model';
import { defaultTaskPriority, type Task, type TaskDraft, type TaskPriority, type TaskTag, type TaskWorkspaceSnapshot } from './task-model';

export const priorityColors: Record<TaskPriority, HexColor> = {
  important_urgent: DESIGN_COLORS.danger,
  important_not_urgent: DESIGN_COLORS.primary,
  not_important_urgent: DESIGN_COLORS.warning,
  not_important_not_urgent: DESIGN_COLORS.info
};

export function legacyPriority(priority: TaskPriority): LegacyTaskPriority {
  if (priority === 'important_urgent') return 1;
  if (priority === 'important_not_urgent') return 2;
  return 3;
}

export function taskToMatrixTask(task: Task, tags: TaskTag[] = []): MatrixTask {
  const tagById = new Map(tags.map((tag) => [tag.id, tag]));
  const resolvedTags = task.tagIds
    .map((id) => tagById.get(id))
    .filter((tag): tag is TaskTag => tag !== undefined)
    .map((tag) => ({ id: tag.id, name: tag.name, color: tag.color }));
  return {
    id: task.id,
    title: task.title,
    quadrant: task.priority,
    dueAt: task.dueDate,
    priority: legacyPriority(task.priority),
    completed: task.completed,
    note: task.description,
    tags: resolvedTags,
    steps: task.steps,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt
  };
}

export function matrixTasksFromWorkspace(snapshot: TaskWorkspaceSnapshot): MatrixTask[] {
  return snapshot.tasks.map((task) => taskToMatrixTask(task, snapshot.tags));
}

export function matrixDraftToWorkspace(
  draft: MatrixTaskDraft,
  current: Task | undefined,
  snapshot: TaskWorkspaceSnapshot
): TaskDraft {
  return {
    title: draft.title,
    description: draft.note,
    priority: draft.quadrant,
    dueDate: draft.dueAt,
    completed: draft.completed,
    laneId: current?.laneId ?? (draft.completed ? snapshot.completionLaneId : snapshot.defaultLaneId),
    tagIds: current?.tagIds ?? []
  };
}

export function workspaceTaskFromMatrix(
  task: MatrixTask,
  snapshot: TaskWorkspaceSnapshot
): Task {
  return {
    id: task.id,
    title: task.title,
    description: task.note,
    priority: task.quadrant,
    dueDate: task.dueAt,
    completed: task.completed,
    laneId: task.completed ? snapshot.completionLaneId : snapshot.defaultLaneId,
    boardPosition: snapshot.tasks.filter((item) => item.laneId === snapshot.defaultLaneId).length,
    tagIds: [],
    steps: task.steps ?? [],
    createdAt: task.createdAt,
    updatedAt: task.updatedAt
  };
}

export function workspaceTaskFromKanbanCard(card: KanbanCard, snapshot: TaskWorkspaceSnapshot): Task {
  const priority = card.priorityId && priorityColors[card.priorityId as TaskPriority]
    ? card.priorityId as TaskPriority
    : defaultTaskPriority;
  return {
    id: card.id,
    title: card.title,
    description: card.description ?? '',
    priority,
    dueDate: card.dueDate,
    completed: card.laneId === snapshot.completionLaneId,
    laneId: card.laneId,
    boardPosition: card.position,
    tagIds: card.tagIds,
    steps: card.steps ?? [],
    createdAt: card.createdAt,
    updatedAt: card.updatedAt
  };
}

export function workspaceFromLegacy(matrixTasks: MatrixTask[], kanban: KanbanSnapshot): TaskWorkspaceSnapshot {
  const now = '';
  const lanes = kanban.lanes.length ? kanban.lanes : [
    { id: 'kanban-lane-todo', name: '待处理', color: DESIGN_COLORS.primary, position: 0, createdAt: now, updatedAt: now },
    { id: 'kanban-lane-doing', name: '进行中', color: DESIGN_COLORS.warning, position: 1, createdAt: now, updatedAt: now },
    { id: 'kanban-lane-done', name: '已完成', color: DESIGN_COLORS.success, position: 2, createdAt: now, updatedAt: now }
  ];
  const seed: TaskWorkspaceSnapshot = {
    tasks: [],
    lanes,
    tags: kanban.tags.map((tag) => ({ ...tag, archivedAt: null })),
    defaultLaneId: lanes.some((lane) => lane.id === 'kanban-lane-todo') ? 'kanban-lane-todo' : lanes[0].id,
    completionLaneId: lanes.some((lane) => lane.id === 'kanban-lane-done') ? 'kanban-lane-done' : lanes[lanes.length - 1].id,
    viewPreferences: {}
  };
  const matrix = matrixTasks.map((task) => workspaceTaskFromMatrix(task, seed));
  const matrixIds = new Set(matrix.map((task) => task.id));
  const cards = kanban.cards.map((card) => workspaceTaskFromKanbanCard(
    matrixIds.has(card.id) ? { ...card, id: `legacy-kanban-${card.id}` } : card,
    seed
  ));
  return { ...seed, tasks: [...matrix, ...cards] };
}

export function fixedPriorities(): KanbanPriority[] {
  return (['important_urgent', 'important_not_urgent', 'not_important_urgent', 'not_important_not_urgent'] as TaskPriority[])
    .map((priority, position) => ({
      id: priority,
      name: quadrantLabel(priority),
      color: priorityColors[priority],
      position,
      createdAt: '',
      updatedAt: ''
    }));
}

export function taskToKanbanCard(task: Task): KanbanCard {
  return {
    id: task.id,
    laneId: task.laneId,
    title: task.title,
    description: task.description || null,
    dueDate: task.dueDate,
    priorityId: task.priority,
    position: task.boardPosition,
    tagIds: task.tagIds,
    steps: task.steps,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt
  };
}

export function kanbanSnapshotFromWorkspace(snapshot: TaskWorkspaceSnapshot): KanbanSnapshot {
  return {
    lanes: snapshot.lanes,
    cards: snapshot.tasks.map(taskToKanbanCard),
    priorities: fixedPriorities(),
    tags: snapshot.tags.map(({ archivedAt: _archivedAt, ...tag }) => tag)
  };
}
