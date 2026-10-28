import { describe, expect, it } from 'vitest';
import type { Task } from './task-model';
import { taskToKanbanCard, taskToMatrixTask } from './task-projections';

const steps = [
  { id: 's1', title: '起草', completed: true },
  { id: 's2', title: '评审', completed: false }
];

const task: Task = {
  id: 't1', title: '发布', description: '', priority: 'important_urgent', dueDate: null, completed: false,
  laneId: 'lane-a', boardPosition: 0, tagIds: [], steps,
  createdAt: 'x', updatedAt: 'x'
};

describe('task projections', () => {
  it('carries steps into kanban cards and matrix rows', () => {
    expect(taskToKanbanCard(task).steps).toEqual(steps);
    expect(taskToMatrixTask(task)?.steps).toEqual(steps);
  });
});
