import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '../calendar/calendar-model';
import type { FocusStatus } from '../focus/focus-model';
import type { Task, TaskPriority } from '../tasks/task-model';
import { deriveStatusIslandModel, statusIslandPrimaryKey } from './status-island-model';

const now = new Date(2026, 8, 12, 14, 18);

function event(id: string, startAt: string, endAt: string, allDay = false): CalendarEvent {
  return {
    id,
    title: id,
    startAt,
    endAt,
    allDay,
    category: 'work',
    color: '#4FC9DA',
    note: '',
    reminders: [],
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    recurrence: null,
    startTz: null,
    endTz: null,
    rrule: null,
    seriesId: null,
    seriesStartAt: null,
    occurrenceStartAt: null,
    isOverridden: false,
    subscriptionId: null
  };
}

function task(
  id: string,
  priority: TaskPriority,
  dueDate: string | null,
  boardPosition = 0
): Task {
  return {
    id,
    title: id,
    description: '',
    priority,
    dueDate,
    completed: false,
    laneId: 'todo',
    boardPosition,
    tagIds: [],
    collaboratorIds: [],
    views: ['matrix'],
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z'
  };
}

function input(options: {
  events?: CalendarEvent[];
  tasks?: Task[];
  focusStatus?: FocusStatus;
  remainingSeconds?: number;
} = {}) {
  return {
    now,
    events: options.events ?? [],
    tasks: options.tasks ?? [],
    focus: {
      status: options.focusStatus ?? 'idle',
      remainingSeconds: options.remainingSeconds ?? 0
    }
  };
}

describe('deriveStatusIslandModel', () => {
  it('shows a static loading state before the first event snapshot is ready', () => {
    const model = deriveStatusIslandModel({ ...input(), loading: true });

    expect(model.primary).toEqual({ kind: 'loading' });
  });

  it('keeps an active focus session primary and exposes an imminent event as a signal', () => {
    const next = event('产品评审', '2026-09-12T14:30', '2026-09-12T15:30');

    const model = deriveStatusIslandModel(input({
      events: [next],
      tasks: [task('发布检查', 'important_urgent', '2026-09-12')],
      focusStatus: 'running',
      remainingSeconds: 1122
    }));

    expect(model.primary).toMatchObject({ kind: 'focus', status: 'running', remainingSeconds: 1122 });
    expect(model.signals).toContainEqual(expect.objectContaining({ kind: 'event', eventId: '产品评审' }));
  });

  it('selects a timed event starting within fifteen minutes before urgent tasks', () => {
    const remindedEvent = event('产品评审', '2026-09-12T14:30', '2026-09-12T15:30');
    remindedEvent.reminders = [15];
    const model = deriveStatusIslandModel(input({
      events: [remindedEvent],
      tasks: [task('发布检查', 'important_urgent', '2026-09-11')]
    }));

    expect(model.primary).toMatchObject({ kind: 'event', eventId: '产品评审', phase: 'imminent' });
  });

  it('selects the next candidate after the current event instance is dismissed', () => {
    const model = deriveStatusIslandModel({
      ...input({
        events: [event('产品评审', '2026-09-12T14:30', '2026-09-12T15:30')],
        tasks: [task('发布检查', 'important_urgent', '2026-09-11')]
      }),
      dismissedPrimaryKeys: ['event:产品评审:2026-09-12T14:30:next']
    });

    expect(model.primary).toMatchObject({ kind: 'task', taskId: '发布检查' });
    expect(model.signals).not.toContainEqual(expect.objectContaining({ kind: 'event', eventId: '产品评审' }));
  });

  it('dismisses a rescheduled recurring instance by its occurrence identity', () => {
    const recurring = {
      ...event('每日站会', '2026-09-12T14:25', '2026-09-12T14:55'),
      occurrenceStartAt: '2026-09-12T14:00'
    };
    const current = deriveStatusIslandModel(input({ events: [recurring] }));

    const dismissed = deriveStatusIslandModel({
      ...input({ events: [recurring] }),
      dismissedPrimaryKeys: [statusIslandPrimaryKey(current.primary)]
    });

    expect(dismissed.primary.kind).toBe('summary');
  });

  it('keeps an external event dismissed when sync replaces its cache row id', () => {
    const beforeSync = {
      ...event('cache-row-1', '2026-09-12T14:30', '2026-09-12T15:30'),
      subscriptionId: 'calendar-1',
      remoteEventId: 'remote-event-1'
    };
    const dismissedKey = statusIslandPrimaryKey(deriveStatusIslandModel(input({ events: [beforeSync] })).primary);
    const afterSync = { ...beforeSync, id: 'cache-row-2' };

    const restarted = deriveStatusIslandModel({
      ...input({ events: [afterSync] }),
      dismissedPrimaryKeys: [dismissedKey]
    });

    expect(restarted.primary.kind).toBe('summary');
  });

  it('distinguishes external events without remote ids when their end times differ', () => {
    const first = {
      ...event('cache-row-1', '2026-09-12T14:30', '2026-09-12T15:00'),
      subscriptionId: 'calendar-1',
      remoteEventId: null
    };
    const second = { ...first, id: 'cache-row-2', endAt: '2026-09-12T15:30' };
    const dismissedKey = statusIslandPrimaryKey(deriveStatusIslandModel(input({ events: [first] })).primary);

    const model = deriveStatusIslandModel({
      ...input({ events: [first, second] }),
      dismissedPrimaryKeys: [dismissedKey]
    });

    expect(model.primary).toMatchObject({ kind: 'event', eventId: 'cache-row-2' });
  });

  it('treats each reminder and the event start as a separate dismissible stage', () => {
    const remindedEvent = {
      ...event('产品评审', '2026-09-12T14:30', '2026-09-12T15:30'),
      reminders: [15, 5]
    };
    const fifteenMinute = deriveStatusIslandModel(input({ events: [remindedEvent] }));
    const fifteenMinuteKey = statusIslandPrimaryKey(fifteenMinute.primary);

    expect(fifteenMinute.primary).toMatchObject({ kind: 'event', reminderMinutes: 15 });
    expect(fifteenMinuteKey).toBe('event:产品评审:2026-09-12T14:30:reminder:15');
    expect(deriveStatusIslandModel({
      ...input({ events: [remindedEvent] }),
      dismissedPrimaryKeys: [fifteenMinuteKey]
    }).primary.kind).toBe('summary');

    const fiveMinute = deriveStatusIslandModel({
      ...input({ events: [remindedEvent] }),
      now: new Date(2026, 8, 12, 14, 26),
      dismissedPrimaryKeys: [fifteenMinuteKey]
    });
    const fiveMinuteKey = statusIslandPrimaryKey(fiveMinute.primary);
    expect(fiveMinute.primary).toMatchObject({ kind: 'event', reminderMinutes: 5 });
    expect(fiveMinuteKey).toBe('event:产品评审:2026-09-12T14:30:reminder:5');

    const started = deriveStatusIslandModel({
      ...input({ events: [remindedEvent] }),
      now: new Date(2026, 8, 12, 14, 30),
      dismissedPrimaryKeys: [fifteenMinuteKey, fiveMinuteKey]
    });
    expect(started.primary).toMatchObject({ kind: 'event', phase: 'ongoing' });
    expect(statusIslandPrimaryKey(started.primary)).toBe('event:产品评审:2026-09-12T14:30:ongoing');
  });

  it('does not let an all-day event take the primary position', () => {
    const model = deriveStatusIslandModel(input({
      events: [event('休假', '2026-09-12T00:00', '2026-09-12T23:59', true)],
      tasks: [task('发布检查', 'important_urgent', '2026-09-12')]
    }));

    expect(model.primary).toMatchObject({ kind: 'task', taskId: '发布检查' });
    expect(model.details.nextEvent).toMatchObject({ id: '休假', allDay: true });
  });

  it('selects an event that started yesterday and is still ongoing', () => {
    const model = deriveStatusIslandModel(input({
      events: [event('跨夜发布', '2026-09-11T23:30', '2026-09-12T14:30')]
    }));

    expect(model.primary).toMatchObject({ kind: 'event', eventId: '跨夜发布', phase: 'ongoing' });
  });

  it('selects a next-day event when it starts within fifteen minutes', () => {
    const nextDayEvent = event('午夜值班', '2026-09-13T00:05', '2026-09-13T00:35');
    nextDayEvent.reminders = [15];
    const model = deriveStatusIslandModel({
      ...input({ events: [nextDayEvent] }),
      now: new Date(2026, 8, 12, 23, 55)
    });

    expect(model.primary).toMatchObject({ kind: 'event', eventId: '午夜值班', phase: 'imminent' });
  });

  it('orders urgent tasks by overdue state, due date, board position, and id', () => {
    const model = deriveStatusIslandModel(input({
      tasks: [
        task('later-board', 'important_urgent', '2026-09-11', 2),
        task('first-board', 'important_urgent', '2026-09-11', 1),
        task('today', 'important_urgent', '2026-09-12', 0)
      ]
    }));

    expect(model.primary).toMatchObject({ kind: 'task', taskId: 'first-board' });
  });

  it('uses the next timed event before a non-urgent important task', () => {
    const model = deriveStatusIslandModel(input({
      events: [event('晚间复盘', '2026-09-12T19:00', '2026-09-12T19:30')],
      tasks: [task('阅读', 'important_not_urgent', '2026-09-12')]
    }));

    expect(model.primary).toMatchObject({ kind: 'event', eventId: '晚间复盘', phase: 'next' });
  });

  it('prefers a non-urgent important task due today over an overdue one', () => {
    const model = deriveStatusIslandModel(input({
      tasks: [
        task('逾期阅读', 'important_not_urgent', '2026-09-11'),
        task('今日复盘', 'important_not_urgent', '2026-09-12')
      ]
    }));

    expect(model.primary).toMatchObject({ kind: 'task', taskId: '今日复盘' });
  });

  it('falls back to a remaining-work summary', () => {
    const model = deriveStatusIslandModel(input());

    expect(model.primary).toEqual({ kind: 'summary', remainingEventCount: 0, importantTaskCount: 0 });
  });

  it('reports overlapping events in the independent conflict signal', () => {
    const model = deriveStatusIslandModel(input({
      events: [
        event('产品评审', '2026-09-12T14:30', '2026-09-12T15:30'),
        event('客户电话', '2026-09-12T15:00', '2026-09-12T15:45')
      ]
    }));

    expect(model.signals[0]).toEqual({ kind: 'conflict', count: 2 });
  });
});