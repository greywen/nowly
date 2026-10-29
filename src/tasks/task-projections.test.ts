import { describe, expect, it } from 'vitest';
import type { Task, TaskWorkspaceSnapshot } from './task-model';
import {
  kanbanSnapshotFromWorkspace,
  matrixDraftToWorkspace,
  matrixTasksFromWorkspace,
  taskToKanbanCard,
  taskToMatrixTask
} from './task-projections';

const steps = [
  { id: 's1', title: '起草', completed: true },
  { id: 's2', title: '评审', completed: false }
];

const task: Task & { laneId: string } = {
  id: 't1', title: '发布', description: '', priority: 'important_urgent', dueDate: null, completed: false,
  completedAt: null,
  laneId: 'lane-a', boardPosition: 0, tagIds: [], steps,
  createdAt: 'x', updatedAt: 'x'
};

const snapshot = (tasks: Task[]): TaskWorkspaceSnapshot => ({
  tasks, lanes: [], tags: [], defaultLaneId: 'lane-a', viewPreferences: {}
});

describe('task projections', () => {
  it('carries steps into kanban cards and matrix rows', () => {
    expect(taskToKanbanCard(task).steps).toEqual(steps);
    expect(taskToMatrixTask(task)?.steps).toEqual(steps);
  });

  it('keeps tasks without a lane off the kanban board but in the matrix', () => {
    const offBoard: Task = { ...task, id: 't2', laneId: null };
    expect(kanbanSnapshotFromWorkspace(snapshot([task, offBoard])).cards.map((card) => card.id)).toEqual(['t1']);
    expect(matrixTasksFromWorkspace(snapshot([task, offBoard])).map((row) => row.id)).toEqual(['t1', 't2']);
  });

  it('shows the board lane on open matrix rows only', () => {
    const lane = { id: 'lane-a', name: '进行中', color: '#4FC9DA', position: 0, createdAt: 'x', updatedAt: 'x' };
    const done: Task = { ...task, id: 't2', completed: true, completedAt: '2026-10-29T08:00:00.000Z' };
    const rows = matrixTasksFromWorkspace({ ...snapshot([task, done]), lanes: [lane] });
    expect(rows.find((row) => row.id === 't1')?.lane).toEqual({ id: 'lane-a', name: '进行中', color: '#4FC9DA' });
    expect(rows.find((row) => row.id === 't2')?.lane ?? null).toBeNull();
  });

  it('creates matrix tasks without a lane and keeps the lane on edit', () => {
    const draft = { title: '新', note: '', quadrant: 'important_urgent' as const, dueAt: null, priority: 1 as const, completed: false };
    expect(matrixDraftToWorkspace(draft, undefined, snapshot([])).laneId).toBeNull();
    expect(matrixDraftToWorkspace(draft, task, snapshot([task])).laneId).toBe('lane-a');
  });
});
