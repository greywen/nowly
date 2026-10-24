import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from './calendar-model';
import {
  buildWeekDays,
  dayRange,
  eventCoversDate,
  groupEventsByDate,
  layoutDayTimeline,
  layoutWeekRows,
  layoutWeekSegments,
  listDateLabel,
  rangeFor,
  resizeEventEndToDate,
  resizeEventEndToHour,
  shiftEventToDate,
  splitIntoWeeks,
  startOfWeek,
  viewTitle,
  weekRange
} from './calendar-view';

function event(id: string, startAt: string, endAt: string, allDay = false): CalendarEvent {
  return {
    id,
    title: id,
    startAt,
    endAt,
    allDay,
    category: 'work',
    color: 'blue',
    note: '',
    createdAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-07-01T00:00:00Z',
    reminders: [],
    recurrence: null,
    startTz: null,
    endTz: null,
    rrule: null,
    seriesId: null,
    seriesStartAt: null,
    occurrenceStartAt: null,
    subscriptionId: null,
    isOverridden: false
  };
}

describe('calendar-view ranges', () => {
  it('anchors weeks to Monday and spans exactly seven days', () => {
    // 2026-07-23 is a Thursday.
    const monday = startOfWeek(new Date(2026, 6, 23));
    expect(monday.getDay()).toBe(1);
    expect(monday.getDate()).toBe(20);
    expect(weekRange(new Date(2026, 6, 23))).toEqual({
      startAt: '2026-07-20T00:00',
      endAtExclusive: '2026-07-27T00:00'
    });
  });

  it('computes a single-day half-open range', () => {
    expect(dayRange(new Date(2026, 6, 23))).toEqual({
      startAt: '2026-07-23T00:00',
      endAtExclusive: '2026-07-24T00:00'
    });
  });

  it('falls back to the month range for month and list views', () => {
    const month = { startAt: '2026-07-01T00:00', endAtExclusive: '2026-08-01T00:00' };
    expect(rangeFor('month', new Date(2026, 6, 23))).toEqual(month);
    expect(rangeFor('list', new Date(2026, 6, 23))).toEqual(month);
  });

  it('builds a Monday-first week with today and month membership flags', () => {
    const days = buildWeekDays(new Date(2026, 6, 23), new Date(2026, 6, 23));
    expect(days).toHaveLength(7);
    expect(days[0].isoDate).toBe('2026-07-20');
    expect(days.find((day) => day.isToday)?.isoDate).toBe('2026-07-23');
    expect(days.every((day) => day.isCurrentMonth)).toBe(true);
  });

  it('anchors weeks to Sunday when the week starts on Sunday', () => {
    const sunday = startOfWeek(new Date(2026, 6, 23), 'sunday');
    expect(sunday.getDay()).toBe(0);
    expect(sunday.getDate()).toBe(19);
    expect(weekRange(new Date(2026, 6, 23), 'sunday')).toEqual({
      startAt: '2026-07-19T00:00',
      endAtExclusive: '2026-07-26T00:00'
    });
    const days = buildWeekDays(new Date(2026, 6, 23), new Date(2026, 6, 23), 'sunday');
    expect(days[0].isoDate).toBe('2026-07-19');
    expect(rangeFor('week', new Date(2026, 6, 23), 'sunday')).toEqual({
      startAt: '2026-07-19T00:00',
      endAtExclusive: '2026-07-26T00:00'
    });
  });
});

describe('calendar-view titles and grouping', () => {
  it('renders a title per view', () => {
    const anchor = new Date(2026, 6, 23);
    expect(viewTitle('month', 2026, 6, anchor)).toBe('2026年7月');
    expect(viewTitle('week', 2026, 6, anchor)).toBe('2026年7月20日 - 2026年7月26日');
    expect(viewTitle('day', 2026, 6, anchor)).toBe('2026年7月23日 星期四');
  });

  it('renders ISO-formatted titles when the date format is iso', () => {
    const anchor = new Date(2026, 6, 23);
    expect(viewTitle('month', 2026, 6, anchor, 'monday', 'iso')).toBe('2026-07');
    expect(viewTitle('week', 2026, 6, anchor, 'monday', 'iso')).toBe('2026-07-20 - 2026-07-26');
    expect(viewTitle('day', 2026, 6, anchor, 'monday', 'iso')).toBe('2026-07-23 星期四');
  });

  it('formats list date labels per date format', () => {
    expect(listDateLabel('2026-07-23')).toBe('7月23日 星期四');
    expect(listDateLabel('2026-07-23', 'iso')).toBe('2026-07-23 星期四');
  });

  it('groups events by date and sorts all-day first then by start time', () => {
    const groups = groupEventsByDate([
      event('b', '2026-07-23T14:00:00', '2026-07-23T15:00:00'),
      event('a', '2026-07-23T00:00:00', '2026-07-23T23:59:00', true),
      event('c', '2026-07-22T09:00:00', '2026-07-22T10:00:00')
    ]);
    expect(groups.map((group) => group.isoDate)).toEqual(['2026-07-22', '2026-07-23']);
    expect(groups[1].events.map((entry) => entry.id)).toEqual(['a', 'b']);
  });
});

describe('shiftEventToDate', () => {
  it('moves a timed event to a new date preserving its time of day', () => {
    const draft = shiftEventToDate(event('e', '2026-07-23T09:30:00', '2026-07-23T10:00:00'), '2026-07-25');
    expect(draft.startAt).toBe('2026-07-25T09:30');
    expect(draft.endAt).toBe('2026-07-25T10:00');
    expect(draft.allDay).toBe(false);
  });

  it('keeps all-day events spanning the full target day', () => {
    const draft = shiftEventToDate(event('e', '2026-07-23T00:00:00', '2026-07-23T23:59:00', true), '2026-07-25');
    expect(draft.startAt).toBe('2026-07-25T00:00');
    expect(draft.endAt).toBe('2026-07-25T23:59');
    expect(draft.allDay).toBe(true);
  });

  it('converts an external all-day exclusive end into an inclusive remote draft', () => {
    const external = {
      ...event('remote', '2026-07-23T00:00:00', '2026-07-23T23:59:00', true),
      subscriptionId: 'google-sub',
      remoteEventId: 'remote-id',
      externalProvider: 'google' as const,
      externalWritable: true,
      externalExclusiveEndAt: '2026-07-24T00:00'
    };
    const draft = shiftEventToDate(external, '2026-07-25');
    expect(draft.startAt).toBe('2026-07-25T00:00');
    expect(draft.endAt).toBe('2026-07-25T23:59');
  });

  it('preserves the multi-day span when moving a multi-day event', () => {
    const draft = shiftEventToDate(event('e', '2026-07-23T09:30:00', '2026-07-25T10:00:00'), '2026-07-28');
    expect(draft.startAt).toBe('2026-07-28T09:30');
    expect(draft.endAt).toBe('2026-07-30T10:00');
  });
});

describe('eventCoversDate', () => {
  it('matches every day between the start and end dates inclusive', () => {
    const multiDay = event('e', '2026-07-23T09:30:00', '2026-07-25T10:00:00');
    expect(eventCoversDate(multiDay, '2026-07-22')).toBe(false);
    expect(eventCoversDate(multiDay, '2026-07-23')).toBe(true);
    expect(eventCoversDate(multiDay, '2026-07-24')).toBe(true);
    expect(eventCoversDate(multiDay, '2026-07-25')).toBe(true);
    expect(eventCoversDate(multiDay, '2026-07-26')).toBe(false);
  });
});

describe('resizeEventEndToDate', () => {
  it('stretches the end date while keeping the start fixed', () => {
    const draft = resizeEventEndToDate(event('e', '2026-07-23T09:30:00', '2026-07-23T10:00:00'), '2026-07-26');
    expect(draft.startAt).toBe('2026-07-23T09:30');
    expect(draft.endAt).toBe('2026-07-26T10:00');
  });

  it('uses the end of the start day when shrinking a cross-midnight event to one day', () => {
    const draft = resizeEventEndToDate(event('e', '2026-09-13T23:00', '2026-09-14T00:00'), '2026-09-13');
    expect(draft.startAt).toBe('2026-09-13T23:00');
    expect(draft.endAt).toBe('2026-09-13T23:59');
  });

  it('clamps an end date that lands before the start back to the start day', () => {
    const draft = resizeEventEndToDate(event('e', '2026-07-23T09:30:00', '2026-07-25T10:00:00'), '2026-07-20');
    expect(draft.startAt).toBe('2026-07-23T09:30');
    expect(draft.endAt).toBe('2026-07-23T10:00');
  });
});

describe('resizeEventEndToHour', () => {
  it('stretches the end to the given hour while keeping the start fixed', () => {
    const draft = resizeEventEndToHour(event('e', '2026-07-23T09:30:00', '2026-07-23T10:15:00'), 12);
    expect(draft.startAt).toBe('2026-07-23T09:30');
    expect(draft.endAt).toBe('2026-07-23T12:00');
    expect(draft.allDay).toBe(false);
  });

  it('ends at 23:59 when stretched to the end of the day', () => {
    const draft = resizeEventEndToHour(event('e', '2026-07-23T21:00', '2026-07-23T22:30'), 24);
    expect(draft.endAt).toBe('2026-07-23T23:59');
  });

  it('pulls the end up to an earlier hour line', () => {
    const draft = resizeEventEndToHour(event('e', '2026-07-23T07:00', '2026-07-23T10:00'), 9);
    expect(draft.startAt).toBe('2026-07-23T07:00');
    expect(draft.endAt).toBe('2026-07-23T09:00');
  });

  it('stops at the first hour line after the start when pulled above it', () => {
    expect(resizeEventEndToHour(event('e', '2026-07-23T07:00', '2026-07-23T10:00'), 0).endAt).toBe('2026-07-23T08:00');
    expect(resizeEventEndToHour(event('e', '2026-07-23T09:30', '2026-07-23T12:00'), 9).endAt).toBe('2026-07-23T10:00');
    // An end already sooner than that line is kept, so pulling up never lengthens it.
    expect(resizeEventEndToHour(event('e', '2026-07-23T09:00', '2026-07-23T09:30'), 9).endAt).toBe('2026-07-23T09:30');
  });

  it('leaves an event that already runs past midnight unchanged at the end of the day', () => {
    const draft = resizeEventEndToHour(event('e', '2026-07-23T22:00', '2026-07-24T01:00'), 24);
    expect(draft.endAt).toBe('2026-07-24T01:00');
  });

  it('pulls an overnight event back into its start day', () => {
    const draft = resizeEventEndToHour(event('e', '2026-07-23T22:00', '2026-07-24T01:00'), 23);
    expect(draft.endAt).toBe('2026-07-23T23:00');
    // Starting in the last hour, the earliest end is the end of that day.
    expect(resizeEventEndToHour(event('e', '2026-07-23T23:00', '2026-07-24T01:00'), 0).endAt).toBe('2026-07-23T23:59');
  });
});

describe('layoutDayTimeline', () => {
  const day = '2026-07-23';
  const place = (items: ReturnType<typeof layoutDayTimeline>) =>
    items.map(({ event: item, start, span, lane, lanes }) => `${item.id} ${start}+${span} ${lane}/${lanes}`);

  it('places each timed event of the day by its start minute and length', () => {
    const items = layoutDayTimeline(
      [
        event('review', '2026-07-23T09:30', '2026-07-23T11:00'),
        event('standup', '2026-07-23T13:00', '2026-07-23T14:00'),
        event('all-day', '2026-07-23T00:00', '2026-07-23T23:59', true),
        event('tomorrow', '2026-07-24T09:00', '2026-07-24T10:00')
      ],
      day
    );
    expect(place(items)).toEqual(['review 570+90 0/1', 'standup 780+60 0/1']);
  });

  it('gives short events a readable minimum length', () => {
    const items = layoutDayTimeline([event('quick', '2026-07-23T09:00', '2026-07-23T09:10')], day);
    expect(place(items)).toEqual(['quick 540+40 0/1']);
  });

  it('runs an event that ends at 23:59 or on a later day to the bottom of the grid', () => {
    const items = layoutDayTimeline(
      [
        event('late', '2026-07-23T21:00', '2026-07-23T23:59'),
        event('overnight', '2026-07-23T22:00', '2026-07-24T02:00')
      ],
      day
    );
    expect(place(items)).toEqual(['late 1260+180 0/2', 'overnight 1320+120 1/2']);
  });

  it('sets overlapping events side by side and lets later free time span the full width', () => {
    const items = layoutDayTimeline(
      [
        event('a', '2026-07-23T09:00', '2026-07-23T11:00'),
        event('b', '2026-07-23T10:00', '2026-07-23T12:00'),
        event('c', '2026-07-23T11:00', '2026-07-23T11:30'),
        event('d', '2026-07-23T14:00', '2026-07-23T15:00')
      ],
      day
    );
    expect(place(items)).toEqual(['a 540+120 0/2', 'b 600+120 1/2', 'c 660+40 0/2', 'd 840+60 0/1']);
  });
});

describe('splitIntoWeeks', () => {
  it('splits a 42-cell month grid into six 7-day rows', () => {
    const cells = Array.from({ length: 42 }, (_, index) => ({
      isoDate: `2026-07-${String(index + 1).padStart(2, '0')}`,
      dayOfMonth: index + 1,
      isCurrentMonth: true,
      isToday: false,
      events: []
    }));
    const weeks = splitIntoWeeks(cells);
    expect(weeks).toHaveLength(6);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    expect(weeks[0][0].isoDate).toBe('2026-07-01');
  });
});

describe('layoutWeekSegments', () => {
  const week = buildWeekDays(new Date(2026, 6, 23)); // Mon 2026-07-20 .. Sun 2026-07-26

  it('lays a multi-day event as one connected bar spanning its columns', () => {
    const { segments } = layoutWeekSegments(week, [
      event('span', '2026-07-21T09:00:00', '2026-07-24T10:00:00')
    ]);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({
      startCol: 1,
      endCol: 4,
      lane: 0,
      continuesBefore: false,
      continuesAfter: false
    });
  });

  it('clips a bar that extends beyond the week and flags the open sides', () => {
    const { segments } = layoutWeekSegments(week, [
      event('span', '2026-07-18T09:00:00', '2026-07-30T10:00:00')
    ]);
    expect(segments[0]).toMatchObject({
      startCol: 0,
      endCol: 6,
      continuesBefore: true,
      continuesAfter: true
    });
  });

  it('packs overlapping events into separate lanes', () => {
    const { segments } = layoutWeekSegments(week, [
      event('a', '2026-07-21T09:00:00', '2026-07-23T10:00:00'),
      event('b', '2026-07-22T09:00:00', '2026-07-24T10:00:00')
    ]);
    const lanes = segments.map((segment) => segment.lane).sort();
    expect(lanes).toEqual([0, 1]);
  });

  it('reports events past the lane cap as per-column overflow', () => {
    const { segments, overflowByCol } = layoutWeekSegments(
      week,
      [
        event('a', '2026-07-22T09:00:00', '2026-07-22T10:00:00'),
        event('b', '2026-07-22T11:00:00', '2026-07-22T12:00:00'),
        event('c', '2026-07-22T13:00:00', '2026-07-22T14:00:00'),
        event('d', '2026-07-22T15:00:00', '2026-07-22T16:00:00')
      ],
      3
    );
    expect(segments).toHaveLength(3);
    expect(overflowByCol[2]).toBe(1); // Wed = column 2
  });
});

describe('layoutWeekRows', () => {
  const week = buildWeekDays(new Date(2026, 6, 23)); // Mon 2026-07-20 .. Sun 2026-07-26

  it('keeps multi-day events in the top span zone and single events per column', () => {
    const { spanning, spanLaneCount, singlesByCol } = layoutWeekRows(week, [
      event('span', '2026-07-21T09:00:00', '2026-07-24T10:00:00'),
      event('solo', '2026-07-22T09:00:00', '2026-07-22T10:00:00')
    ]);
    expect(spanning).toHaveLength(1);
    expect(spanning[0]).toMatchObject({ startCol: 1, endCol: 4, lane: 0 });
    expect(spanLaneCount).toBe(1);
    // Wed = column 2 holds the single-day event.
    expect(singlesByCol[2].map((item) => item.id)).toEqual(['solo']);
    // Other columns have no single-day events.
    expect(singlesByCol[0]).toEqual([]);
  });

  it('groups several single-day events in the same column, sorted by start', () => {
    const { singlesByCol } = layoutWeekRows(week, [
      event('late', '2026-07-22T15:00:00', '2026-07-22T16:00:00'),
      event('early', '2026-07-22T08:00:00', '2026-07-22T09:00:00')
    ]);
    expect(singlesByCol[2].map((item) => item.id)).toEqual(['early', 'late']);
  });

  it('caps single-day events per column and returns the hidden events', () => {
    const hidden = event('c', '2026-07-22T12:00:00', '2026-07-22T13:00:00');
    const { singlesByCol, overflowByCol } = layoutWeekRows(
      week,
      [
        event('a', '2026-07-22T08:00:00', '2026-07-22T09:00:00'),
        event('b', '2026-07-22T10:00:00', '2026-07-22T11:00:00'),
        hidden
      ],
      2
    );
    expect(singlesByCol[2].map((item) => item.id)).toEqual(['a', 'b']);
    expect(overflowByCol[2]).toEqual([hidden]);
  });

  it('counts spanning events toward each date column cap', () => {
    const hiddenSingle = event('hidden', '2026-07-22T12:00:00', '2026-07-22T13:00:00');
    const { spanning, singlesByCol, overflowByCol } = layoutWeekRows(
      week,
      [
        event('span-a', '2026-07-21T09:00:00', '2026-07-24T10:00:00'),
        event('span-b', '2026-07-22T08:00:00', '2026-07-23T09:00:00'),
        event('visible', '2026-07-22T10:00:00', '2026-07-22T11:00:00'),
        hiddenSingle
      ],
      3
    );
    expect(spanning).toHaveLength(2);
    expect(singlesByCol[2].map((item) => item.id)).toEqual(['visible']);
    expect(overflowByCol[2]).toEqual([hiddenSingle]);
  });

  it('hides a spanning event only on capped dates and keeps its visible remainder', () => {
    const partiallyHidden = event('partial', '2026-07-22T09:00:00', '2026-07-24T10:00:00');
    const { spanning, overflowByCol } = layoutWeekRows(
      week,
      [
        event('span-a', '2026-07-20T09:00:00', '2026-07-22T10:00:00'),
        event('span-b', '2026-07-21T08:00:00', '2026-07-22T10:00:00'),
        event('span-c', '2026-07-21T09:00:00', '2026-07-22T11:00:00'),
        partiallyHidden
      ],
      3
    );
    expect(overflowByCol[2]).toEqual([partiallyHidden]);
    expect(overflowByCol[3]).toEqual([]);
    expect(spanning.find((segment) => segment.event.id === 'partial')).toMatchObject({
      startCol: 3,
      endCol: 4
    });
  });

  it('lane-packs overlapping multi-day events into separate lanes', () => {
    const { spanning, spanLaneCount } = layoutWeekRows(week, [
      event('a', '2026-07-21T09:00:00', '2026-07-23T10:00:00'),
      event('b', '2026-07-22T09:00:00', '2026-07-24T10:00:00')
    ]);
    expect(spanning.map((segment) => segment.lane).sort()).toEqual([0, 1]);
    expect(spanLaneCount).toBe(2);
  });
});
