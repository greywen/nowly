import type { CalendarEvent } from '../calendar/calendar-model';
import type { FocusStatus } from '../focus/focus-model';
import type { Task } from '../tasks/task-model';

export type StatusIslandPrimary =
  | { kind: 'loading' }
  | { kind: 'focus'; status: Exclude<FocusStatus, 'idle'>; remainingSeconds: number }
  | { kind: 'event'; eventId: string; dismissalId?: string; title: string; startAt: string; endAt: string; occurrenceStartAt?: string | null; phase: 'ongoing' | 'imminent' | 'next'; reminderMinutes?: number }
  | { kind: 'task'; taskId: string; title: string; dueDate: string | null; priority: Task['priority'] }
  | { kind: 'summary'; remainingEventCount: number; importantTaskCount: number };

export type StatusIslandSignal =
  | { kind: 'conflict'; count: number }
  | { kind: 'event'; eventId: string; startAt: string }
  | { kind: 'tasks'; count: number };

export type StatusIslandModel = {
  primary: StatusIslandPrimary;
  candidateKeys?: string[];
  signals: StatusIslandSignal[];
  details: {
    nextEvent: CalendarEvent | null;
    importantTask: Task | null;
    focus: { status: FocusStatus; remainingSeconds: number };
  };
};

export function statusIslandPrimaryKey(primary: StatusIslandPrimary): string {
  if (primary.kind === 'event') {
    const stage = primary.phase === 'imminent' && primary.reminderMinutes !== undefined
      ? `reminder:${primary.reminderMinutes}`
      : primary.phase;
    return `event:${primary.dismissalId ?? primary.eventId}:${primary.occurrenceStartAt ?? primary.startAt}:${stage}`;
  }
  if (primary.kind === 'task') return `task:${primary.taskId}`;
  return primary.kind;
}

export function statusIslandPrimaryRank(primary: StatusIslandPrimary): number {
  if (primary.kind === 'loading') return 7;
  if (primary.kind === 'focus') return 1;
  if (primary.kind === 'event') return primary.phase === 'next' ? 4 : 2;
  if (primary.kind === 'task') return primary.priority === 'important_urgent' ? 3 : 5;
  return 6;
}

type StatusIslandInput = {
  now: Date;
  events: CalendarEvent[];
  tasks: Task[];
  focus: { status: FocusStatus; remainingSeconds: number };
  loading?: boolean;
  dismissedPrimaryKeys?: readonly string[];
};

function localDate(date: Date): string {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

function eventStart(event: CalendarEvent): number {
  return new Date(event.startAt).getTime();
}

function eventEnd(event: CalendarEvent): number {
  return new Date(event.endAt).getTime();
}

function compareEvents(left: CalendarEvent, right: CalendarEvent): number {
  return eventStart(left) - eventStart(right) || eventEnd(left) - eventEnd(right) || left.id.localeCompare(right.id);
}

function taskDueRank(task: Task, today: string): number {
  if (task.dueDate === null) return 2;
  if (task.dueDate < today) return 0;
  if (task.dueDate === today) return 1;
  return 3;
}

function compareTasks(today: string) {
  return (left: Task, right: Task): number =>
    taskDueRank(left, today) - taskDueRank(right, today) ||
    (left.dueDate ?? '').localeCompare(right.dueDate ?? '') ||
    left.boardPosition - right.boardPosition ||
    left.id.localeCompare(right.id);
}

function compareNonUrgentTasks(today: string) {
  const dueRank = (task: Task) => {
    if (task.dueDate === today) return 0;
    if (task.dueDate !== null && task.dueDate < today) return 1;
    if (task.dueDate === null) return 2;
    return 3;
  };
  return (left: Task, right: Task): number =>
    dueRank(left) - dueRank(right) ||
    (left.dueDate ?? '').localeCompare(right.dueDate ?? '') ||
    left.boardPosition - right.boardPosition ||
    left.id.localeCompare(right.id);
}

function conflictCount(events: CalendarEvent[], nowMs: number): number {
  const horizon = nowMs + 60 * 60 * 1000;
  const relevant = events
    .filter(event => !event.allDay && eventEnd(event) > nowMs && eventStart(event) < horizon)
    .sort(compareEvents);
  const conflicting = new Set<string>();
  for (let left = 0; left < relevant.length; left += 1) {
    for (let right = left + 1; right < relevant.length; right += 1) {
      if (eventStart(relevant[right]) >= eventEnd(relevant[left])) break;
      conflicting.add(relevant[left].id);
      conflicting.add(relevant[right].id);
    }
  }
  return conflicting.size;
}

function eventPrimary(event: CalendarEvent, nowMs: number): Extract<StatusIslandPrimary, { kind: 'event' }> {
  const startMs = eventStart(event);
  const dismissalId = event.subscriptionId
    ? `external:${event.subscriptionId}:${event.remoteEventId ?? `${event.title}:${event.endAt}`}`
    : undefined;
  if (startMs <= nowMs) {
    return {
      kind: 'event', eventId: event.id, title: event.title, startAt: event.startAt, endAt: event.endAt,
      occurrenceStartAt: event.occurrenceStartAt, phase: 'ongoing', ...(dismissalId ? { dismissalId } : {})
    };
  }
  const minutesUntilStart = Math.ceil((startMs - nowMs) / 60_000);
  const reminderMinutes = [...new Set(event.reminders)]
    .filter(minutes => minutes >= minutesUntilStart)
    .sort((left, right) => left - right)[0];
  return {
    kind: 'event', eventId: event.id, title: event.title, startAt: event.startAt, endAt: event.endAt,
    occurrenceStartAt: event.occurrenceStartAt,
    phase: reminderMinutes === undefined ? 'next' : 'imminent',
    ...(dismissalId ? { dismissalId } : {}),
    ...(reminderMinutes === undefined ? {} : { reminderMinutes })
  };
}

export function deriveStatusIslandModel({ now, events, tasks, focus, loading = false, dismissedPrimaryKeys = [] }: StatusIslandInput): StatusIslandModel {
  const nowMs = now.getTime();
  const today = localDate(now);
  const dismissed = new Set(dismissedPrimaryKeys);
  const eventCandidates = events
    .filter(event => !event.allDay && eventEnd(event) > nowMs)
    .sort(compareEvents)
    .map(event => ({ event, primary: eventPrimary(event, nowMs) }));
  const visibleEventCandidates = eventCandidates
    .filter(candidate => !dismissed.has(statusIslandPrimaryKey(candidate.primary)));
  const nextEvent = visibleEventCandidates
    .find(candidate => candidate.event.startAt.slice(0, 10) === today)?.event ?? null;
  const activeEvent = visibleEventCandidates.find(candidate => candidate.primary.phase !== 'next')?.primary ?? null;
  const detailEvent = events
    .filter(event => eventEnd(event) > nowMs && (event.startAt.slice(0, 10) === today || eventStart(event) <= nowMs))
    .sort(compareEvents)[0] ?? null;
  const importantTasks = tasks
    .filter(task => !task.completed && task.priority?.startsWith('important'))
    .sort(compareTasks(today));
  const visibleImportantTasks = importantTasks.filter(task => !dismissed.has(`task:${task.id}`));
  const urgentTask = visibleImportantTasks.find(task => task.priority === 'important_urgent') ?? null;
  const nonUrgentTask = visibleImportantTasks
    .filter(task => task.priority === 'important_not_urgent')
    .sort(compareNonUrgentTasks(today))[0] ?? null;
  const importantTask = importantTasks[0] ?? null;
  const remainingEventCount = events.filter(event =>
    eventEnd(event) > nowMs && (event.startAt.slice(0, 10) === today || eventStart(event) <= nowMs)
  ).length;

  let primary: StatusIslandPrimary;
  if (loading) {
    primary = { kind: 'loading' };
  } else if (focus.status !== 'idle') {
    primary = { kind: 'focus', status: focus.status, remainingSeconds: focus.remainingSeconds };
  } else if (activeEvent) {
    primary = activeEvent;
  } else if (urgentTask) {
    primary = { kind: 'task', taskId: urgentTask.id, title: urgentTask.title, dueDate: urgentTask.dueDate, priority: urgentTask.priority };
  } else if (nextEvent) {
    primary = eventPrimary(nextEvent, nowMs);
  } else if (nonUrgentTask) {
    primary = { kind: 'task', taskId: nonUrgentTask.id, title: nonUrgentTask.title, dueDate: nonUrgentTask.dueDate, priority: nonUrgentTask.priority };
  } else {
    primary = { kind: 'summary', remainingEventCount, importantTaskCount: importantTasks.length };
  }

  const signals: StatusIslandSignal[] = [];
  const overlaps = conflictCount(events, nowMs);
  if (overlaps > 0) signals.push({ kind: 'conflict', count: overlaps });
  if (primary.kind !== 'event' && nextEvent) signals.push({ kind: 'event', eventId: nextEvent.id, startAt: nextEvent.startAt });
  if (primary.kind !== 'task' && visibleImportantTasks.length > 0) signals.push({ kind: 'tasks', count: visibleImportantTasks.length });

  const candidateKeys = [
    ...(loading ? ['loading'] : []),
    ...(focus.status !== 'idle' ? ['focus'] : []),
    ...visibleEventCandidates.map(candidate => statusIslandPrimaryKey(candidate.primary)),
    ...visibleImportantTasks.map(task => `task:${task.id}`),
    'summary'
  ];

  return {
    primary,
    candidateKeys,
    signals: signals.slice(0, 2),
    details: { nextEvent: detailEvent, importantTask, focus }
  };
}