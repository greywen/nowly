import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '../calendar/calendar-model';
import type { FocusStatus } from '../focus/focus-model';
import type { Task, TaskPriority } from '../tasks/task-model';
import {
  deriveStatusIslandModel,
  localIsoWithOffset,
  reminderPanelContext,
  statusIslandPrimaryKey,
  type StatusIslandReminderState
} from './status-island-model';

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

function reminded(id: string, startAt: string, endAt: string, reminders: number[]): CalendarEvent {
  return { ...event(id, startAt, endAt), reminders };
}

describe('status island attention queue', () => {
  it('keeps every reminder out of the queue until its own stage window opens', () => {
    const model = deriveStatusIslandModel(input({
      events: [reminded('产品评审', '2026-09-12T14:30', '2026-09-12T15:30', [15, 5])]
    }));

    expect(model.attentionQueue.map(reminder => reminder.identity))
      .toEqual(['event:产品评审:2026-09-12T14:30:reminder:15']);
    expect(model.attentionQueue[0]).toMatchObject({
      reminderClass: 'system',
      lifecycle: 'unseen',
      acknowledgedAt: null
    });
  });

  it('replaces an earlier reminder stage with the next one instead of keeping both', () => {
    const model = deriveStatusIslandModel({
      ...input({ events: [reminded('产品评审', '2026-09-12T14:30', '2026-09-12T15:30', [15, 5])] }),
      now: new Date(2026, 8, 12, 14, 26)
    });

    expect(model.attentionQueue.map(reminder => reminder.identity))
      .toEqual(['event:产品评审:2026-09-12T14:30:reminder:5']);
  });

  it('sorts the queue by priority, then trigger time, then stable identity', () => {
    const model = deriveStatusIslandModel({
      ...input({
        events: [
          reminded('晚间复盘', '2026-09-12T14:20', '2026-09-12T14:50', []),
          reminded('客户电话', '2026-09-12T14:25', '2026-09-12T15:10', [15])
        ],
        tasks: [task('发布检查', 'important_urgent', '2026-09-11')]
      }),
      now: new Date(2026, 8, 12, 14, 26)
    });

    expect(model.attentionQueue.map(reminder => reminder.identity)).toEqual([
      'conflict:event:晚间复盘:2026-09-12T14:20|event:客户电话:2026-09-12T14:25:2026-09-12T14:25',
      'event:晚间复盘:2026-09-12T14:20:start',
      'event:客户电话:2026-09-12T14:25:start',
      'task:发布检查:2026-09-01T00:00:00Z:2026-09-12'
    ]);
  });

  it('keeps an acknowledged reminder in the queue until the user closes it', () => {
    // The reported defect. This used to collapse 15s after acknowledgement, so the
    // island swapped the detail for the summary while the user was doing nothing,
    // which is what made the surface look like two unrelated designs taking turns.
    const events = [reminded('产品评审', '2026-09-12T14:30', '2026-09-12T15:30', [15])];
    const identity = 'event:产品评审:2026-09-12T14:30:reminder:15';
    const acknowledged: StatusIslandReminderState = {
      identity,
      acknowledgedAt: localIsoWithOffset(new Date(2026, 8, 12, 14, 18, 0)),
      dismissed: false,
      consumed: false
    };

    for (const seconds of [14, 15, 600]) {
      const model = deriveStatusIslandModel({
        ...input({ events }),
        now: new Date(2026, 8, 12, 14, 18, seconds),
        reminderStates: [acknowledged]
      });

      expect(model.attentionQueue[0]).toMatchObject({ identity, lifecycle: 'acknowledged' });
      expect(model.surface).toMatchObject({ mode: 'detail' });
    }
  });

  it('downgrades to the summary when the user closes the detail', () => {
    const events = [reminded('产品评审', '2026-09-12T14:30', '2026-09-12T15:30', [15])];
    const identity = 'event:产品评审:2026-09-12T14:30:reminder:15';

    const closed = deriveStatusIslandModel({
      ...input({ events }),
      reminderStates: [{
        identity,
        acknowledgedAt: localIsoWithOffset(new Date(2026, 8, 12, 14, 18, 0)),
        dismissed: true,
        consumed: false
      }]
    });

    expect(closed.attentionQueue).toEqual([]);
    expect(closed.reminders[0]).toMatchObject({ lifecycle: 'dismissed' });
    // Still the capsule, now carrying the summary. Closing one notification must
    // not strip the surface back to the idle copy while the event itself still
    // exists.
    expect(closed.surface).toMatchObject({ mode: 'summary' });
  });

  it('starts in the summary when the user set the notification display to summary', () => {
    const events = [reminded('产品评审', '2026-09-12T14:30', '2026-09-12T15:30', [15])];

    const detail = deriveStatusIslandModel({ ...input({ events }), displayMode: 'detail' });
    const summary = deriveStatusIslandModel({ ...input({ events }), displayMode: 'summary' });

    // The same unseen reminder either way: the setting chooses the content, not
    // whether the notification exists.
    expect(detail.attentionQueue).toHaveLength(1);
    expect(summary.attentionQueue).toHaveLength(1);
    expect(detail.surface).toMatchObject({ mode: 'detail' });
    expect(summary.surface).toMatchObject({ mode: 'summary' });
  });

  it('keeps a closed reminder out of the queue and lets the next one take over', () => {
    // The reported defect in its original form: the hold that protected the 15s
    // timer was a global boolean, so hovering any surface flipped every
    // already-collapsed reminder back into the queue — an overdue task the user had
    // already seen would jump back to the head the instant they hovered the next
    // one. There is no timer and no hold now, so a closed reminder stays closed.
    const closed = task('完善 Nowly', 'important_urgent', '2026-09-09');
    const next = task('文件测试', 'important_urgent', null);
    const closedIdentity = `task:${closed.id}:${closed.updatedAt}:2026-09-12`;
    const nextIdentity = `task:${next.id}:${next.updatedAt}:2026-09-12`;

    const model = deriveStatusIslandModel({
      ...input({ tasks: [closed, next] }),
      reminderStates: [{
        identity: closedIdentity,
        acknowledgedAt: localIsoWithOffset(new Date(2026, 8, 12, 14, 0, 0)),
        dismissed: true,
        consumed: false
      }]
    });

    expect(model.attentionQueue.map(reminder => reminder.identity)).toEqual([nextIdentity]);
    expect(model.reminders.find(reminder => reminder.identity === closedIdentity))
      .toMatchObject({ lifecycle: 'dismissed' });
    // The next notification still gets its own turn in full detail.
    expect(model.surface).toMatchObject({ mode: 'detail' });
  });

  it('treats a hidden flag written by an older build as terminal for the day', () => {
    // Written by a build that collapsed reminders on a timer. Nothing sets it now,
    // but upgrading must not replay every reminder that had already collapsed.
    const seen = task('完善 Nowly', 'important_urgent', '2026-09-09');
    const identity = `task:${seen.id}:${seen.updatedAt}:2026-09-12`;

    const model = deriveStatusIslandModel({
      ...input({ tasks: [seen] }),
      reminderStates: [{
        identity,
        acknowledgedAt: localIsoWithOffset(new Date(2026, 8, 12, 14, 0, 0)),
        hidden: true,
        dismissed: false,
        consumed: false
      }]
    });

    expect(model.attentionQueue).toEqual([]);
    expect(model.reminders[0]).toMatchObject({ lifecycle: 'hidden' });
    expect(model.surface).toMatchObject({ mode: 'summary' });
  });

  it('goes idle only when there is nothing at all to report', () => {
    const model = deriveStatusIslandModel(input());

    expect(model.surface).toEqual({ mode: 'idle' });
    expect(model.summary).toMatchObject({ lead: null, focus: null, totalCount: 0 });
  });

  it('treats dismissal as closing only the current surface, not the later stages', () => {
    const events = [reminded('产品评审', '2026-09-12T14:30', '2026-09-12T15:30', [15, 5])];
    const dismissed: StatusIslandReminderState[] = [{
      identity: 'event:产品评审:2026-09-12T14:30:reminder:15',
      acknowledgedAt: null,
      dismissed: true,
      consumed: false
    }];

    expect(deriveStatusIslandModel({ ...input({ events }), reminderStates: dismissed }).attentionQueue).toEqual([]);
    expect(deriveStatusIslandModel({
      ...input({ events }),
      now: new Date(2026, 8, 12, 14, 26),
      reminderStates: dismissed
    }).attentionQueue.map(reminder => reminder.identity)).toEqual(['event:产品评审:2026-09-12T14:30:reminder:5']);
  });

  it('auto-acknowledges a user-initiated focus stage and keeps it on the island', () => {
    const focusInput = {
      ...input({ focusStatus: 'running' as FocusStatus, remainingSeconds: 1500 }),
      focus: {
        status: 'running' as FocusStatus,
        remainingSeconds: 1500,
        plannedSeconds: 1500,
        sessionId: 'session-1',
        stageSequence: 1,
        stageChangedAt: localIsoWithOffset(new Date(2026, 8, 12, 14, 18, 0))
      }
    };

    const shown = deriveStatusIslandModel({ ...focusInput, now: new Date(2026, 8, 12, 14, 18, 5) });
    expect(shown.attentionQueue[0]).toMatchObject({
      identity: 'focus:session-1:running:1',
      reminderClass: 'active',
      // The user started this themselves, so it counts as seen immediately.
      lifecycle: 'acknowledged'
    });

    // A running session has no dismiss button, and nothing collapses on a timer,
    // so it stays on the island for as long as it runs.
    const later = deriveStatusIslandModel({ ...focusInput, now: new Date(2026, 8, 12, 14, 18, 20) });
    expect(later.attentionQueue[0]).toMatchObject({ identity: 'focus:session-1:running:1' });
    expect(later.indicatorState.focus).toMatchObject({ status: 'running', remainingSeconds: 1500 });
  });

  it('keeps a focus completion unseen until it is acknowledged', () => {
    const model = deriveStatusIslandModel({
      ...input(),
      now: new Date(2026, 8, 12, 15, 0, 0),
      focus: {
        status: 'completed',
        remainingSeconds: 0,
        plannedSeconds: 1500,
        sessionId: 'session-1',
        stageSequence: 2,
        stageChangedAt: localIsoWithOffset(new Date(2026, 8, 12, 14, 30, 0))
      }
    });

    expect(model.attentionQueue[0]).toMatchObject({
      identity: 'focus:session-1:completed:2',
      reminderClass: 'system',
      lifecycle: 'unseen'
    });
  });

  it('drops a consumed focus completion from the queue', () => {
    const model = deriveStatusIslandModel({
      ...input(),
      now: new Date(2026, 8, 12, 15, 0, 0),
      focus: {
        status: 'completed',
        remainingSeconds: 0,
        plannedSeconds: 1500,
        sessionId: 'session-1',
        stageSequence: 2,
        stageChangedAt: localIsoWithOffset(new Date(2026, 8, 12, 14, 30, 0))
      },
      reminderStates: [{
        identity: 'focus:session-1:completed:2',
        acknowledgedAt: null,
        dismissed: false,
        consumed: true
      }]
    });

    expect(model.attentionQueue).toEqual([]);
  });

  it('never queues passive information such as a later event or an all-day event', () => {
    const model = deriveStatusIslandModel(input({
      events: [
        event('晚间复盘', '2026-09-12T19:00', '2026-09-12T19:30'),
        event('休假', '2026-09-12T00:00', '2026-09-12T23:59', true)
      ],
      tasks: [task('阅读', 'important_not_urgent', '2026-09-12')]
    }));

    expect(model.attentionQueue).toEqual([]);
    expect(model.indicatorState.markers.map(marker => marker.kind)).toEqual(['event', 'importantTask', 'allDay']);
  });

  it('does not requeue a stage whose window closed while the app was not running', () => {
    const model = deriveStatusIslandModel({
      ...input({ events: [reminded('产品评审', '2026-09-12T14:30', '2026-09-12T15:30', [15])] }),
      now: new Date(2026, 8, 12, 14, 40)
    });

    expect(model.attentionQueue.map(reminder => reminder.identity))
      .toEqual(['event:产品评审:2026-09-12T14:30:start']);
  });
});

describe('status island indicator state', () => {
  it('exposes focus progress with accessible bounds and a text summary', () => {
    const model = deriveStatusIslandModel({
      ...input(),
      focus: {
        status: 'running',
        remainingSeconds: 600,
        plannedSeconds: 1500,
        sessionId: 'session-1',
        stageSequence: 1,
        stageChangedAt: localIsoWithOffset(new Date(2026, 8, 12, 14, 0, 0))
      }
    });

    expect(model.indicatorState.focus).toEqual({
      status: 'running',
      remainingSeconds: 600,
      remainingMinutes: 10,
      plannedSeconds: 1500,
      progressMax: 1500,
      progressNow: 600
    });
  });

  it('aggregates one marker per category and keeps at most three', () => {
    const model = deriveStatusIslandModel({
      ...input({
        events: [
          reminded('晚间复盘', '2026-09-12T14:20', '2026-09-12T14:50', []),
          reminded('客户电话', '2026-09-12T14:25', '2026-09-12T15:10', []),
          event('休假', '2026-09-12T00:00', '2026-09-12T23:59', true)
        ],
        tasks: [
          task('发布检查', 'important_urgent', '2026-09-11'),
          task('阅读', 'important_not_urgent', '2026-09-12')
        ]
      }),
      now: new Date(2026, 8, 12, 14, 26)
    });

    expect(model.indicatorState.markers).toEqual([
      { kind: 'conflict', count: 2, tone: 'red' },
      { kind: 'ongoingEvent', count: 2, tone: 'info' },
      { kind: 'urgentTask', count: 1, tone: 'red' }
    ]);
    expect(model.indicatorState.hasBusinessState).toBe(true);
  });

  it('reports no business state when nothing is pending', () => {
    const model = deriveStatusIslandModel(input());

    expect(model.indicatorState).toEqual({ focus: null, markers: [], hasBusinessState: false });
  });
});

describe('status island summary content', () => {
  it("aggregates today's pending work and counts a conflict warning only once", () => {
    const model = deriveStatusIslandModel({
      ...input({
        events: [
          reminded('晚间复盘', '2026-09-12T14:20', '2026-09-12T14:50', []),
          reminded('客户电话', '2026-09-12T14:25', '2026-09-12T15:10', [])
        ],
        tasks: [task('发布检查', 'important_urgent', '2026-09-11')]
      }),
      now: new Date(2026, 8, 12, 14, 26)
    });

    expect(model.summary.lead).toEqual({ kind: 'conflict', count: 2, tone: 'red' });
    // Two ongoing events plus one urgent task. The conflict marker warns *about*
    // those same two events, so adding it would count them twice.
    expect(model.summary.totalCount).toBe(3);
  });

  it('scopes the daily event count to today, as its label claims', () => {
    const model = deriveStatusIslandModel(input({
      events: [
        event('晚间复盘', '2026-09-12T19:00', '2026-09-12T19:30'),
        event('明日例会', '2026-09-13T09:00', '2026-09-13T10:00')
      ]
    }));

    expect(model.summary.markers).toEqual([{ kind: 'event', count: 1, tone: 'yellow' }]);
    expect(model.summary.totalCount).toBe(1);
  });

  it('keeps a standing important task in the summary whatever its due date', () => {
    // Priority is a user declaration about what matters, not a date. An overdue or
    // undated important task is still today's problem, and dropping it would empty
    // the surface of exactly what it exists to surface.
    const model = deriveStatusIslandModel(input({
      tasks: [
        task('完善 Nowly', 'important_urgent', '2026-09-09'),
        task('文件测试', 'important_urgent', null)
      ]
    }));

    expect(model.summary.markers).toEqual([{ kind: 'urgentTask', count: 2, tone: 'red' }]);
  });

  it('opens into every item of each group rather than a truncated sample', () => {
    const tasks = [
      task('阅读', 'important_not_urgent', '2026-09-12'),
      task('周报', 'important_not_urgent', '2026-09-12'),
      task('复盘', 'important_not_urgent', '2026-09-12')
    ];

    const model = deriveStatusIslandModel(input({ tasks }));

    expect(model.panelContext).toMatchObject({ kind: 'overview', totalCount: 3 });
    const overview = model.panelContext as Extract<typeof model.panelContext, { kind: 'overview' }>;
    expect(overview.groups).toHaveLength(1);
    // "重要 3 项" has to open into all three, not the first two.
    expect(overview.groups[0].kind).toBe('importantTask');
    expect(overview.groups[0].count).toBe(3);
    expect(overview.groups[0].tasks.map(item => item.id).sort()).toEqual(['周报', '复盘', '阅读'].sort());
  });

  it('routes a click in summary mode to the whole aggregate, not the queue head', () => {
    const events = [reminded('产品评审', '2026-09-12T14:30', '2026-09-12T15:30', [15])];

    const detail = deriveStatusIslandModel({ ...input({ events }), displayMode: 'detail' });
    const summary = deriveStatusIslandModel({ ...input({ events }), displayMode: 'summary' });

    // Same unseen reminder at the head either way. In detail mode the panel acts
    // on it; in summary mode the user clicked an aggregate, so the panel has to
    // show that aggregate instead.
    expect(detail.panelContext).toMatchObject({ kind: 'eventReminder' });
    expect(summary.panelContext).toMatchObject({ kind: 'overview' });
  });
});

describe('status island panel context', () => {
  it('routes to the focus panel while a session is running', () => {
    const model = deriveStatusIslandModel({
      ...input({ events: [event('晚间复盘', '2026-09-12T19:00', '2026-09-12T19:30')] }),
      focus: {
        status: 'running',
        remainingSeconds: 600,
        plannedSeconds: 1500,
        sessionId: 'session-1',
        stageSequence: 1,
        stageChangedAt: localIsoWithOffset(new Date(2026, 8, 12, 14, 0, 0))
      }
    });

    expect(model.panelContext).toMatchObject({ kind: 'focus' });
  });

  it('routes to the conflict panel before the individual events', () => {
    const model = deriveStatusIslandModel({
      ...input({
        events: [
          event('晚间复盘', '2026-09-12T14:20', '2026-09-12T14:50'),
          event('客户电话', '2026-09-12T14:25', '2026-09-12T15:10')
        ]
      }),
      now: new Date(2026, 8, 12, 14, 26)
    });

    expect(model.panelContext).toMatchObject({ kind: 'conflict' });
    expect((model.panelContext as { events: CalendarEvent[] }).events.map(item => item.id))
      .toEqual(['晚间复盘', '客户电话']);
  });

  it('routes to the reminder, ongoing and urgent task panels by queue head', () => {
    const reminder = deriveStatusIslandModel(input({
      events: [reminded('产品评审', '2026-09-12T14:30', '2026-09-12T15:30', [15])]
    }));
    expect(reminder.panelContext).toMatchObject({ kind: 'eventReminder' });

    const ongoing = deriveStatusIslandModel(input({
      events: [event('产品评审', '2026-09-12T14:00', '2026-09-12T15:30')]
    }));
    expect(ongoing.panelContext).toMatchObject({ kind: 'ongoingEvent' });

    const urgent = deriveStatusIslandModel(input({ tasks: [task('发布检查', 'important_urgent', '2026-09-11')] }));
    expect(urgent.panelContext).toMatchObject({ kind: 'urgentTask' });
  });

  it('routes coexisting passive state to the daily overview and nothing to an empty panel', () => {
    const overview = deriveStatusIslandModel(input({
      events: [event('晚间复盘', '2026-09-12T19:00', '2026-09-12T19:30')],
      tasks: [task('阅读', 'important_not_urgent', '2026-09-12')]
    }));

    expect(overview.panelContext).toMatchObject({ kind: 'overview' });
    expect(deriveStatusIslandModel(input()).panelContext).toEqual({ kind: 'empty' });
  });
});

describe('status island queue fairness between same-priority tasks', () => {
  it('ranks an overdue urgent task ahead of one with no due date', () => {
    // Regression: every urgent task shared one triggerAt, so the tie fell to the
    // identity string, i.e. effectively the task's uuid. An overdue task could
    // end up behind a task with no due date at all.
    const model = deriveStatusIslandModel(input({
      tasks: [
        { ...task('文件测试', 'important_urgent', null), id: 'aaaa-no-due' },
        { ...task('完善 Nowly', 'important_urgent', '2026-09-09'), id: 'zzzz-overdue' }
      ]
    }));

    expect(model.attentionQueue.map(reminder => reminder.subject.kind === 'task' ? reminder.subject.task.title : null))
      .toEqual(['完善 Nowly', '文件测试']);
    expect(model.panelContext).toMatchObject({ kind: 'urgentTask' });
    expect((model.panelContext as { task: Task }).task.title).toBe('完善 Nowly');
  });

  it('orders overdue, due today, undated and future urgent tasks in that order', () => {
    const model = deriveStatusIslandModel(input({
      tasks: [
        { ...task('未来', 'important_urgent', '2026-09-20'), id: 'a-future' },
        { ...task('无期限', 'important_urgent', null), id: 'b-undated' },
        { ...task('今天', 'important_urgent', '2026-09-12'), id: 'c-today' },
        { ...task('逾期', 'important_urgent', '2026-09-09'), id: 'd-overdue' }
      ]
    }));

    expect(model.attentionQueue.map(reminder => reminder.subject.kind === 'task' ? reminder.subject.task.title : null))
      .toEqual(['逾期', '今天', '无期限', '未来']);
  });

  it('breaks a genuine tie by stable identity, not by array order', () => {
    const first = { ...task('先', 'important_urgent', '2026-09-12'), id: 'aaa' };
    const second = { ...task('后', 'important_urgent', '2026-09-12'), id: 'bbb' };

    const forward = deriveStatusIslandModel(input({ tasks: [first, second] }));
    const reversed = deriveStatusIslandModel(input({ tasks: [second, first] }));

    expect(forward.attentionQueue.map(reminder => reminder.identity))
      .toEqual(reversed.attentionQueue.map(reminder => reminder.identity));
  });
});

describe('status island panel pinning', () => {
  const pending = task('文件测试', 'important_urgent', null);
  const overdue = task('完善 Nowly', 'important_urgent', '2026-09-09');

  it('exposes every resolved reminder, including closed ones, so an open panel can stay pinned', () => {
    const model = deriveStatusIslandModel({
      ...input({ tasks: [overdue, pending] }),
      reminderStates: [{
        identity: `task:${overdue.id}:${overdue.updatedAt}:2026-09-12`,
        acknowledgedAt: localIsoWithOffset(new Date(2026, 8, 12, 14, 0, 0)),
        dismissed: true,
        consumed: false
      }]
    });

    // The user closed this one, so it left the queue.
    expect(model.attentionQueue.map(reminder => reminder.identity))
      .not.toContain(`task:${overdue.id}:${overdue.updatedAt}:2026-09-12`);
    // It is still resolvable, so a panel opened for it does not lose its subject.
    const closed = model.reminders.find(reminder => reminder.identity === `task:${overdue.id}:${overdue.updatedAt}:2026-09-12`);
    expect(closed).toMatchObject({ lifecycle: 'dismissed' });
    expect(closed!.subject).toMatchObject({ kind: 'task' });
  });

  it('maps a pinned reminder to its own panel context, not the queue head', () => {
    const model = deriveStatusIslandModel(input({ tasks: [overdue, pending] }));
    const head = model.attentionQueue[0];
    const second = model.attentionQueue[1];

    expect(reminderPanelContext(head, model.indicatorState.focus)).toMatchObject({ kind: 'urgentTask' });
    const pinned = reminderPanelContext(second, model.indicatorState.focus);
    expect((pinned as { task: Task }).task.title).toBe('文件测试');
    // The live context still follows the queue head; pinning is the caller's choice.
    expect((model.panelContext as { task: Task }).task.title).toBe('完善 Nowly');
  });

  it('maps each reminder subject kind to its matching panel', () => {
    const conflictModel = deriveStatusIslandModel({
      ...input({
        events: [
          event('晚间复盘', '2026-09-12T14:20', '2026-09-12T14:50'),
          event('客户电话', '2026-09-12T14:25', '2026-09-12T15:10')
        ]
      }),
      now: new Date(2026, 8, 12, 14, 26)
    });
    const [conflict, start] = conflictModel.attentionQueue;
    expect(reminderPanelContext(conflict, null)).toMatchObject({ kind: 'conflict' });
    expect(reminderPanelContext(start, null)).toMatchObject({ kind: 'ongoingEvent' });

    const reminderModel = deriveStatusIslandModel(input({
      events: [{ ...event('产品评审', '2026-09-12T14:30', '2026-09-12T15:30'), reminders: [15] }]
    }));
    expect(reminderPanelContext(reminderModel.attentionQueue[0], null))
      .toMatchObject({ kind: 'eventReminder', reminderMinutes: 15 });

    const focusModel = deriveStatusIslandModel({
      ...input(),
      focus: {
        status: 'running', remainingSeconds: 600, plannedSeconds: 1500, sessionId: 'session-1',
        stageSequence: 1, stageChangedAt: localIsoWithOffset(new Date(2026, 8, 12, 14, 18, 0))
      },
      now: new Date(2026, 8, 12, 14, 18, 5)
    });
    expect(reminderPanelContext(focusModel.attentionQueue[0], focusModel.indicatorState.focus))
      .toMatchObject({ kind: 'focus' });
  });
});

describe('local wall-clock identities', () => {
  it('serializes local time with its own offset', () => {
    const value = localIsoWithOffset(new Date(2026, 8, 12, 14, 18, 5));

    expect(value.slice(0, 19)).toBe('2026-09-12T14:18:05');
    expect(value.slice(19)).toMatch(/^[+-]\d{2}:\d{2}$/);
  });

  it('re-derives a task identity when the local date changes', () => {
    const pending = task('发布检查', 'important_urgent', '2026-09-11');
    const today = deriveStatusIslandModel(input({ tasks: [pending] }));
    const tomorrow = deriveStatusIslandModel({
      ...input({ tasks: [pending] }),
      now: new Date(2026, 8, 13, 9, 0)
    });

    expect(today.attentionQueue[0].identity).toBe('task:发布检查:2026-09-01T00:00:00Z:2026-09-12');
    expect(tomorrow.attentionQueue[0].identity).toBe('task:发布检查:2026-09-01T00:00:00Z:2026-09-13');
  });
});