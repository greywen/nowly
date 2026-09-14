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

// Spec 03 splits one derived model into three independent outputs:
// `attentionQueue` answers "has the user seen this yet", `indicatorState`
// answers "does this still exist", and `panelContext` answers "what can be
// done now". A single `primary` can no longer decide all three, so the legacy
// fields below stay only for the in-window island view.
export type StatusIslandReminderClass = 'active' | 'system';

export type StatusIslandReminderLifecycle =
  | 'unseen'
  | 'acknowledged'
  | 'hidden'
  | 'dismissed'
  | 'consumed'
  | 'expired';

export type StatusIslandReminderSubject =
  | { kind: 'conflict'; events: CalendarEvent[] }
  | { kind: 'focus'; status: Exclude<FocusStatus, 'idle'>; remainingSeconds: number; plannedSeconds: number; sessionId: string | null }
  | { kind: 'event'; event: CalendarEvent; stage: 'reminder' | 'start'; reminderMinutes: number | null }
  | { kind: 'task'; task: Task };

export type StatusIslandReminder = {
  identity: string;
  reminderClass: StatusIslandReminderClass;
  priority: number;
  triggerAt: string;
  expiresAt: string | null;
  lifecycle: StatusIslandReminderLifecycle;
  acknowledgedAt: string | null;
  subject: StatusIslandReminderSubject;
};

// Persisted by the native coordinator. `dismissed` is the user asking to stop
// seeing this reminder in full: it downgrades the island to the summary for the
// rest of the local day. It is not business consumption, so a later stage of the
// same event still appears.
export type StatusIslandReminderState = {
  identity: string;
  acknowledgedAt: string | null;
  // Written by older builds, which collapsed a reminder on a timer. Nothing sets
  // it now; it is still read so a store file left by such a build keeps its
  // already-collapsed reminders collapsed instead of replaying them.
  hidden?: boolean;
  dismissed: boolean;
  consumed: boolean;
};

export type StatusIslandMarkerKind =
  | 'conflict'
  | 'ongoingEvent'
  | 'imminentEvent'
  | 'urgentTask'
  | 'event'
  | 'importantTask'
  | 'allDay';

export type StatusIslandMarkerTone = 'red' | 'yellow' | 'info' | 'teal' | 'green';

export type StatusIslandMarker = {
  kind: StatusIslandMarkerKind;
  count: number;
  tone: StatusIslandMarkerTone;
};

export type StatusIslandFocusIndicator = {
  status: Exclude<FocusStatus, 'idle'>;
  remainingSeconds: number;
  remainingMinutes: number;
  plannedSeconds: number;
  progressMax: number;
  progressNow: number;
};

export type StatusIslandIndicatorState = {
  focus: StatusIslandFocusIndicator | null;
  markers: StatusIslandMarker[];
  hasBusinessState: boolean;
};

/**
 * One marker's worth of today's items, listed in full. The summary says "重要 2
 * 项"; opening it has to show both of those two, so nothing here is truncated.
 */
export type StatusIslandOverviewGroup = {
  kind: StatusIslandMarkerKind;
  count: number;
  tone: StatusIslandMarkerTone;
  events: CalendarEvent[];
  tasks: Task[];
};

export type StatusIslandPanelContext =
  | { kind: 'empty' }
  | { kind: 'focus'; focus: StatusIslandFocusIndicator }
  | { kind: 'conflict'; events: CalendarEvent[] }
  | { kind: 'eventReminder'; event: CalendarEvent; reminderMinutes: number | null }
  | { kind: 'ongoingEvent'; event: CalendarEvent }
  | { kind: 'urgentTask'; task: Task }
  | { kind: 'overview'; groups: StatusIslandOverviewGroup[]; markers: StatusIslandMarker[]; totalCount: number };

/** Which content the island carries. Chosen by the user in settings. */
export type StatusIslandDisplayMode = 'detail' | 'summary';

/**
 * The summary content. Same four slots as the detail content, so the icon, title
 * and meta land on the same pixels in both modes: `lead` fills the icon and the
 * title, and the meta line is always today's aggregate rather than a
 * concatenation that would reflow as counts change.
 */
export type StatusIslandSummary = {
  lead: StatusIslandMarker | null;
  focus: StatusIslandFocusIndicator | null;
  markers: StatusIslandMarker[];
  totalCount: number;
};

/**
 * What the top rail's capsule is carrying. Not a shape: the rail is one size
 * whatever happens, so this only chooses content. `idle` is the state with
 * nothing at all to report — the capsule stays, it just goes quiet.
 */
export type StatusIslandSurface =
  | { mode: 'idle' }
  | { mode: 'detail'; reminder: StatusIslandReminder }
  | { mode: 'summary'; summary: StatusIslandSummary };

export type StatusIslandModel = {
  primary: StatusIslandPrimary;
  displayMode: StatusIslandDisplayMode;
  summary: StatusIslandSummary;
  surface: StatusIslandSurface;
  attentionQueue: StatusIslandReminder[];
  /**
   * Every resolved reminder, whatever its lifecycle. A details panel opened for
   * one reminder stays pinned to it by identity, so the reminder has to remain
   * resolvable after it leaves `attentionQueue` (hidden, dismissed, consumed).
   * Without this an open panel silently re-targets to the next queue head.
   */
  reminders: StatusIslandReminder[];
  indicatorState: StatusIslandIndicatorState;
  panelContext: StatusIslandPanelContext;
  candidateKeys?: string[];
  signals: StatusIslandSignal[];
  details: {
    nextEvent: CalendarEvent | null;
    importantTask: Task | null;
    focus: { status: FocusStatus; remainingSeconds: number };
  };
};

const CONFLICT_HORIZON_MS = 60 * 60 * 1000;

const MARKER_ORDER: StatusIslandMarkerKind[] = [
  'conflict',
  'ongoingEvent',
  'imminentEvent',
  'urgentTask',
  'event',
  'importantTask',
  'allDay'
];

const MARKER_TONES: Record<StatusIslandMarkerKind, StatusIslandMarkerTone> = {
  conflict: 'red',
  ongoingEvent: 'info',
  imminentEvent: 'red',
  urgentTask: 'red',
  event: 'yellow',
  importantTask: 'yellow',
  allDay: 'info'
};

// Every persisted stage boundary is user wall-clock time, so identities and
// timestamps carry the local offset instead of UTC.
export function localIsoWithOffset(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const offsetMinutes = -date.getTimezoneOffset();
  const absolute = Math.abs(offsetMinutes);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    + `${offsetMinutes < 0 ? '-' : '+'}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}

function localMinuteString(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// Local midnight of a `YYYY-MM-DD` value. `new Date(iso)` would parse a bare
// date as UTC and shift the day in any non-zero timezone.
function localDateStartMs(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day).getTime();
}

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

type StatusIslandFocusInput = {
  status: FocusStatus;
  remainingSeconds: number;
  plannedSeconds?: number;
  sessionId?: string | null;
  // Distinguishes repeated stages of one session, e.g. pause then resume, which
  // a status-only snapshot cannot tell apart.
  stageSequence?: number;
  stageChangedAt?: string | null;
};

type StatusIslandInput = {
  now: Date;
  events: CalendarEvent[];
  tasks: Task[];
  focus: StatusIslandFocusInput;
  loading?: boolean;
  dismissedPrimaryKeys?: readonly string[];
  reminderStates?: readonly StatusIslandReminderState[];
  // Which content the island carries when nothing has been dismissed yet. Comes
  // from the user's notification setting; `detail` is the default.
  displayMode?: StatusIslandDisplayMode;
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

type ReminderDraft = {
  reminder: Omit<StatusIslandReminder, 'lifecycle' | 'acknowledgedAt' | 'hideEligibleAt'>;
  triggerMs: number;
  autoAcknowledgedAt: string | null;
};

function eventIdentity(event: CalendarEvent): string {
  const subject = event.subscriptionId
    ? `external:${event.subscriptionId}:${event.remoteEventId ?? `${event.title}:${event.endAt}`}`
    : event.id;
  return `event:${subject}:${event.occurrenceStartAt ?? event.startAt}`;
}

function conflictGroup(events: CalendarEvent[], nowMs: number): { events: CalendarEvent[]; startsAtMs: number } | null {
  const relevant = events
    .filter(event => !event.allDay && eventEnd(event) > nowMs && eventStart(event) < nowMs + CONFLICT_HORIZON_MS)
    .sort(compareEvents);
  const participants: CalendarEvent[] = [];
  let overlapStart = Number.POSITIVE_INFINITY;
  for (let left = 0; left < relevant.length; left += 1) {
    for (let right = left + 1; right < relevant.length; right += 1) {
      if (eventStart(relevant[right]) >= eventEnd(relevant[left])) break;
      for (const participant of [relevant[left], relevant[right]]) {
        if (!participants.includes(participant)) participants.push(participant);
      }
      overlapStart = Math.min(overlapStart, Math.max(eventStart(relevant[left]), eventStart(relevant[right])));
    }
  }
  if (participants.length === 0) return null;
  return { events: participants.sort(compareEvents), startsAtMs: overlapStart };
}

// One event contributes at most one open stage: each configured reminder, then
// the start itself. A stage that closed while the app was down is expired and
// must not be replayed.
function openEventStage(event: CalendarEvent, nowMs: number): ReminderDraft | null {
  const startMs = eventStart(event);
  const endMs = eventEnd(event);
  const stages = [
    ...[...new Set(event.reminders)]
      .filter(minutes => minutes > 0)
      .sort((left, right) => right - left)
      .map(minutes => ({ triggerMs: startMs - minutes * 60_000, minutes })),
    { triggerMs: startMs, minutes: null as number | null }
  ].sort((left, right) => left.triggerMs - right.triggerMs);
  const index = stages.findIndex((stage, position) => {
    const expiresMs = position + 1 < stages.length ? stages[position + 1].triggerMs : endMs;
    return stage.triggerMs <= nowMs && nowMs < expiresMs;
  });
  if (index < 0) return null;
  const stage = stages[index];
  const expiresMs = index + 1 < stages.length ? stages[index + 1].triggerMs : endMs;
  const isStart = stage.minutes === null;
  return {
    triggerMs: stage.triggerMs,
    autoAcknowledgedAt: null,
    reminder: {
      identity: `${eventIdentity(event)}:${isStart ? 'start' : `reminder:${stage.minutes}`}`,
      reminderClass: 'system',
      priority: isStart ? 4 : 5,
      triggerAt: localMinuteString(new Date(stage.triggerMs)),
      expiresAt: localMinuteString(new Date(expiresMs)),
      subject: { kind: 'event', event, stage: isStart ? 'start' : 'reminder', reminderMinutes: stage.minutes }
    }
  };
}

function focusDraft(focus: StatusIslandFocusInput, nowMs: number): ReminderDraft | null {
  if (focus.status === 'idle') return null;
  const sessionId = focus.sessionId ?? null;
  const stageSequence = focus.stageSequence ?? 0;
  // Focus completion is produced by the system, so having started the session
  // does not mean the user has seen the result.
  const isCompletion = focus.status === 'completed';
  const stageChangedAt = focus.stageChangedAt ?? null;
  return {
    triggerMs: stageChangedAt ? Date.parse(stageChangedAt) : nowMs,
    autoAcknowledgedAt: isCompletion ? null : stageChangedAt,
    reminder: {
      identity: `focus:${sessionId ?? 'unknown'}:${focus.status}:${stageSequence}`,
      reminderClass: isCompletion ? 'system' : 'active',
      priority: isCompletion ? 3 : 2,
      triggerAt: stageChangedAt ?? localIsoWithOffset(new Date(nowMs)),
      expiresAt: null,
      subject: {
        kind: 'focus',
        status: focus.status,
        remainingSeconds: focus.remainingSeconds,
        plannedSeconds: focus.plannedSeconds ?? focus.remainingSeconds,
        sessionId
      }
    }
  };
}

// Lifecycle is now decided entirely by stored user intent, never by elapsed
// time: a reminder stays in full detail until the user closes it. An earlier
// build collapsed it 15s after acknowledgement, which moved the island from
// detail to summary while the user was doing nothing and made the surface look
// like it was flipping between two unrelated designs.
function resolveLifecycle(
  draft: ReminderDraft,
  state: StatusIslandReminderState | undefined
): StatusIslandReminder {
  const acknowledgedAt = state?.acknowledgedAt ?? draft.autoAcknowledgedAt ?? null;
  if (state?.consumed) {
    return { ...draft.reminder, lifecycle: 'consumed', acknowledgedAt };
  }
  // The user asked to stop seeing this one in full. Terminal for the local day,
  // so it cannot climb back into the queue and re-expand on its own.
  if (state?.dismissed) {
    return { ...draft.reminder, lifecycle: 'dismissed', acknowledgedAt };
  }
  // Only a store file written by an older, timer-based build still carries this.
  if (state?.hidden) {
    return { ...draft.reminder, lifecycle: 'hidden', acknowledgedAt };
  }
  if (!acknowledgedAt) {
    return { ...draft.reminder, lifecycle: 'unseen', acknowledgedAt: null };
  }
  return { ...draft.reminder, lifecycle: 'acknowledged', acknowledgedAt };
}

function focusIndicator(focus: StatusIslandFocusInput): StatusIslandFocusIndicator | null {
  if (focus.status === 'idle') return null;
  const plannedSeconds = focus.plannedSeconds ?? focus.remainingSeconds;
  return {
    status: focus.status,
    remainingSeconds: focus.remainingSeconds,
    remainingMinutes: Math.ceil(focus.remainingSeconds / 60),
    plannedSeconds,
    progressMax: plannedSeconds,
    progressNow: focus.remainingSeconds
  };
}

/**
 * Today's pending work, split into the buckets the markers count. Opening the
 * summary lists these same buckets, so counting and listing cannot disagree.
 *
 * Timed events are scoped to today: `markerEvent` reads "今日日程 {count} 项", so
 * counting tomorrow's 9am meeting in it would make the label untrue.
 * Important/urgent tasks are deliberately *not* date-scoped. That priority is a
 * standing user declaration about what matters, and an overdue or undated
 * important task is still today's problem; dropping it would empty the surface
 * of exactly what it exists to surface.
 */
type TodayBuckets = {
  events: Partial<Record<StatusIslandMarkerKind, CalendarEvent[]>>;
  tasks: Partial<Record<StatusIslandMarkerKind, Task[]>>;
  markers: StatusIslandMarker[];
};

function todayBuckets(
  events: CalendarEvent[],
  tasks: Task[],
  nowMs: number,
  today: string,
  conflict: { events: CalendarEvent[] } | null
): TodayBuckets {
  const timed = events.filter(event => !event.allDay && eventEnd(event) > nowMs);
  const ongoing = timed.filter(event => eventStart(event) <= nowMs).sort(compareEvents);
  const upcomingToday = timed
    .filter(event => eventStart(event) > nowMs && event.startAt.slice(0, 10) === today)
    .sort(compareEvents);
  const imminent = upcomingToday.filter(event => {
    const minutesUntilStart = (eventStart(event) - nowMs) / 60_000;
    const reminderWindow = Math.max(15, ...event.reminders.filter(minutes => minutes > 0), 0);
    return minutesUntilStart <= reminderWindow;
  });
  const openTasks = tasks.filter(task => !task.completed);
  const eventBuckets: Partial<Record<StatusIslandMarkerKind, CalendarEvent[]>> = {
    conflict: conflict?.events ?? [],
    ongoingEvent: ongoing,
    imminentEvent: imminent,
    event: upcomingToday.filter(event => !imminent.includes(event)),
    allDay: events
      .filter(event => event.allDay && eventEnd(event) > nowMs && event.startAt.slice(0, 10) <= today)
      .sort(compareEvents)
  };
  const taskBuckets: Partial<Record<StatusIslandMarkerKind, Task[]>> = {
    urgentTask: openTasks.filter(task => task.priority === 'important_urgent').sort(compareTasks(today)),
    importantTask: openTasks.filter(task => task.priority === 'important_not_urgent').sort(compareTasks(today))
  };
  const markers = MARKER_ORDER
    .map(kind => ({
      kind,
      count: (eventBuckets[kind]?.length ?? 0) + (taskBuckets[kind]?.length ?? 0),
      tone: MARKER_TONES[kind]
    }))
    .filter(marker => marker.count > 0);
  return { events: eventBuckets, tasks: taskBuckets, markers };
}

function overviewGroups(buckets: TodayBuckets): StatusIslandOverviewGroup[] {
  return buckets.markers.map(marker => ({
    kind: marker.kind,
    count: marker.count,
    tone: marker.tone,
    events: buckets.events[marker.kind] ?? [],
    tasks: buckets.tasks[marker.kind] ?? []
  }));
}

// `conflict` is a warning *about* events already counted elsewhere, so including
// it would count those events twice.
function summaryTotal(markers: StatusIslandMarker[]): number {
  return markers
    .filter(marker => marker.kind !== 'conflict')
    .reduce((total, marker) => total + marker.count, 0);
}

/**
 * Maps one reminder to the panel that acts on it. Exported because a details
 * panel stays pinned to the reminder it was opened for: it must be able to build
 * its own context instead of following whatever is now at the queue head.
 */
export function reminderPanelContext(
  reminder: StatusIslandReminder | undefined,
  focus: StatusIslandFocusIndicator | null
): StatusIslandPanelContext | null {
  const subject = reminder?.subject;
  if (!subject) return null;
  if (subject.kind === 'conflict') return { kind: 'conflict', events: subject.events };
  if (subject.kind === 'focus') {
    // Prefer the live indicator so the countdown keeps ticking; fall back to the
    // reminder's own snapshot when the session is already gone.
    return {
      kind: 'focus',
      focus: focus ?? {
        status: subject.status,
        remainingSeconds: subject.remainingSeconds,
        remainingMinutes: Math.ceil(subject.remainingSeconds / 60),
        plannedSeconds: subject.plannedSeconds,
        progressMax: subject.plannedSeconds,
        progressNow: subject.remainingSeconds
      }
    };
  }
  if (subject.kind === 'event') {
    return subject.stage === 'start'
      ? { kind: 'ongoingEvent', event: subject.event }
      : { kind: 'eventReminder', event: subject.event, reminderMinutes: subject.reminderMinutes };
  }
  return { kind: 'urgentTask', task: subject.task };
}

// Clicking the island opens whatever the island was showing. In summary mode
// that is the whole aggregate, listed in full, never the head reminder's own
// panel: the user clicked "重要 2 项", so both of those two have to appear.
function panelContextFor(
  queue: StatusIslandReminder[],
  focus: StatusIslandFocusInput,
  buckets: TodayBuckets,
  displayMode: StatusIslandDisplayMode
): StatusIslandPanelContext {
  const indicator = focusIndicator(focus);
  const markers = buckets.markers;
  const overview: StatusIslandPanelContext = markers.length === 0
    ? indicator && focus.status !== 'completed'
      ? { kind: 'focus', focus: indicator }
      : { kind: 'empty' }
    : { kind: 'overview', groups: overviewGroups(buckets), markers, totalCount: summaryTotal(markers) };
  if (displayMode === 'summary') return overview;
  const head = reminderPanelContext(queue[0], indicator);
  if (head) return head;
  if (indicator && focus.status !== 'completed') return { kind: 'focus', focus: indicator };
  return overview;
}

export function deriveStatusIslandModel({
  now,
  events,
  tasks,
  focus,
  loading = false,
  dismissedPrimaryKeys = [],
  reminderStates = [],
  displayMode = 'detail'
}: StatusIslandInput): StatusIslandModel {
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

  const conflict = conflictGroup(events, nowMs);
  const states = new Map(reminderStates.map(state => [state.identity, state]));
  const drafts: ReminderDraft[] = [];
  if (conflict) {
    const identity = `conflict:${conflict.events.map(eventIdentity).join('|')}`
      + `:${localMinuteString(new Date(conflict.startsAtMs))}`;
    drafts.push({
      triggerMs: conflict.startsAtMs,
      autoAcknowledgedAt: null,
      reminder: {
        identity,
        reminderClass: 'system',
        priority: 1,
        triggerAt: localMinuteString(new Date(conflict.startsAtMs)),
        expiresAt: localMinuteString(new Date(Math.max(...conflict.events.map(eventEnd)))),
        subject: { kind: 'conflict', events: conflict.events }
      }
    });
  }
  const focusStage = focusDraft(focus, nowMs);
  if (focusStage) drafts.push(focusStage);
  for (const event of events.filter(candidate => !candidate.allDay && eventEnd(candidate) > nowMs)) {
    const stage = openEventStage(event, nowMs);
    if (stage) drafts.push(stage);
  }
  const localDayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  for (const urgent of tasks.filter(task => !task.completed && task.priority === 'important_urgent')) {
    // The queue sort key is fixed as priority -> triggerAt -> stableIdentity, so
    // urgency has to be carried by triggerAt: the moment a task fell due is the
    // moment it started asking for attention. Overdue sorts first, then due
    // today, then undated, then future. Sharing one triggerAt across every urgent
    // task pushed the tie down to the uuid inside the identity, which ranked an
    // undated task ahead of an overdue one.
    const dueMs = urgent.dueDate === null
      ? localDayEnd.getTime() - 1
      : localDateStartMs(urgent.dueDate);
    drafts.push({
      triggerMs: dueMs,
      autoAcknowledgedAt: null,
      reminder: {
        identity: `task:${urgent.id}:${urgent.updatedAt}:${today}`,
        reminderClass: 'system',
        priority: 6,
        triggerAt: localIsoWithOffset(new Date(dueMs)),
        expiresAt: localIsoWithOffset(localDayEnd),
        subject: { kind: 'task', task: urgent }
      }
    });
  }
  // Sorted once, then split: the queue is the visible slice, `reminders` keeps
  // every resolved reminder so a pinned panel can still find its own subject.
  const resolved = drafts
    .map(draft => ({ draft, reminder: resolveLifecycle(draft, states.get(draft.reminder.identity)) }))
    .sort((left, right) =>
      left.reminder.priority - right.reminder.priority
      || left.draft.triggerMs - right.draft.triggerMs
      || (left.reminder.identity < right.reminder.identity ? -1 : left.reminder.identity > right.reminder.identity ? 1 : 0))
    .map(entry => entry.reminder);
  const attentionQueue = resolved
    .filter(reminder => reminder.lifecycle === 'unseen' || reminder.lifecycle === 'acknowledged');
  const buckets = todayBuckets(events, tasks, nowMs, today, conflict);
  const indicatorFocus = focusIndicator(focus);
  const hasBusinessState = indicatorFocus !== null || buckets.markers.length > 0;
  const summary: StatusIslandSummary = {
    lead: buckets.markers[0] ?? null,
    focus: indicatorFocus,
    markers: buckets.markers,
    totalCount: summaryTotal(buckets.markers)
  };
  // The rail never resizes between modes, so this only chooses the content.
  // `idle` is reserved for having nothing at all to say.
  const head = attentionQueue[0];
  const surface: StatusIslandSurface = !hasBusinessState
    ? { mode: 'idle' }
    : displayMode === 'detail' && head
      ? { mode: 'detail', reminder: head }
      : { mode: 'summary', summary };

  return {
    primary,
    displayMode,
    summary,
    surface,
    attentionQueue,
    reminders: resolved,
    indicatorState: {
      focus: indicatorFocus,
      // Capped for the signals row, which has room for three. The uncapped list
      // lives on `summary` and drives the aggregate count.
      markers: buckets.markers.slice(0, 3),
      hasBusinessState
    },
    panelContext: panelContextFor(attentionQueue, focus, buckets, displayMode),
    candidateKeys,
    signals: signals.slice(0, 2),
    details: { nextEvent: detailEvent, importantTask, focus }
  };
}
