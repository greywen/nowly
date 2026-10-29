import { describe, expect, it } from 'vitest';
import type { Task, TaskLane } from '../tasks/task-model';
import { boardDoneEntries, daysSinceCompleted, groupDoneEntries, isRecentDone } from './kanban-done';

const lane: TaskLane = { id: 'lane-a', name: '进行中', color: '#4FC9DA', position: 0, createdAt: 'x', updatedAt: 'x' };

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id, title: id, description: '', priority: 'important_urgent', dueDate: null,
    completed: true, completedAt: null, laneId: 'lane-a', boardPosition: 0,
    tagIds: [], steps: [], createdAt: 'x', updatedAt: 'x', ...overrides
  };
}

const now = new Date(2026, 9, 29, 9, 30);
const at = (day: number, hour = 12) => new Date(2026, 9, day, hour).toISOString();

describe('kanban done list', () => {
  it('counts local calendar days rather than elapsed hours', () => {
    expect(daysSinceCompleted(at(29, 0), now)).toBe(0);
    expect(daysSinceCompleted(at(28, 23), now)).toBe(1);
    expect(daysSinceCompleted('not a date', now)).toBe(Number.POSITIVE_INFINITY);
  });

  it('keeps completed tasks that still have a lane, newest first', () => {
    const entries = boardDoneEntries({
      lanes: [lane],
      tasks: [
        task('older', { completedAt: at(27) }),
        task('open', { completed: false }),
        task('newer', { completedAt: at(29) }),
        task('matrix-only', { laneId: null, completedAt: at(29) }),
        task('lost-lane', { laneId: 'gone', completedAt: at(29) })
      ]
    });
    expect(entries.map((entry) => entry.task.id)).toEqual(['newer', 'older']);
    expect(entries[0].lane).toBe(lane);
  });

  it('treats the last seven days as recent and groups by today, week, and earlier', () => {
    const entries = boardDoneEntries({
      lanes: [lane],
      tasks: [task('today', { completedAt: at(29) }), task('six', { completedAt: at(23) }), task('seven', { completedAt: at(22) })]
    });
    expect(entries.filter((entry) => isRecentDone(entry, now)).map((entry) => entry.task.id)).toEqual(['today', 'six']);
    expect(groupDoneEntries(entries, now).map((group) => [group.key, group.entries.map((entry) => entry.task.id)])).toEqual([
      ['today', ['today']],
      ['week', ['six']],
      ['earlier', ['seven']]
    ]);
  });
});
