import type { Task, TaskLane, TaskWorkspaceSnapshot } from '../tasks/task-model';

// The board's done list covers this many calendar days, today included.
export const RECENT_DONE_DAYS = 7;

export type DoneEntry = { task: Task; lane: TaskLane };
export type DoneGroupKey = 'today' | 'week' | 'earlier';
export type DoneGroup = { key: DoneGroupKey; entries: DoneEntry[] };

function localDayStart(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

// Calendar days between the completion and `now` in local time; 0 is today.
export function daysSinceCompleted(completedAt: string, now: Date): number {
  const done = new Date(completedAt);
  if (Number.isNaN(done.getTime())) return Number.POSITIVE_INFINITY;
  return Math.round((localDayStart(now) - localDayStart(done)) / 86_400_000);
}

// Completed tasks that are still in a lane, newest first. Tasks completed from
// the matrix without ever joining the board stay out of the board's list.
export function boardDoneEntries(snapshot: Pick<TaskWorkspaceSnapshot, 'tasks' | 'lanes'>): DoneEntry[] {
  const lanes = new Map(snapshot.lanes.map((lane) => [lane.id, lane]));
  return snapshot.tasks
    .flatMap((task) => {
      const lane = task.completed && task.laneId ? lanes.get(task.laneId) : undefined;
      return lane ? [{ task, lane }] : [];
    })
    .sort((a, b) =>
      (b.task.completedAt ?? '').localeCompare(a.task.completedAt ?? '') || a.task.id.localeCompare(b.task.id));
}

export function isRecentDone(entry: DoneEntry, now: Date): boolean {
  return entry.task.completedAt !== null && daysSinceCompleted(entry.task.completedAt, now) < RECENT_DONE_DAYS;
}

export function groupDoneEntries(entries: DoneEntry[], now: Date): DoneGroup[] {
  const groups: DoneGroup[] = [
    { key: 'today', entries: [] },
    { key: 'week', entries: [] },
    { key: 'earlier', entries: [] }
  ];
  for (const entry of entries) {
    const days = entry.task.completedAt ? daysSinceCompleted(entry.task.completedAt, now) : Number.POSITIVE_INFINITY;
    groups[days <= 0 ? 0 : days < RECENT_DONE_DAYS ? 1 : 2].entries.push(entry);
  }
  return groups.filter((group) => group.entries.length > 0);
}
