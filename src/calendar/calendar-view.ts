import { buildMonthGrid, toIsoDate } from '../lib/date';
import type { CalendarDay, CalendarEvent, CalendarView, EventDraft, EventRange } from './calendar-model';

const weekdayNames = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function localDate(isoDate: string) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function midnightIso(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T00:00`;
}

export function monthRange(year: number, monthIndex: number): EventRange {
  const nextMonth = new Date(year, monthIndex + 1, 1);
  return {
    startAt: `${year}-${pad(monthIndex + 1)}-01T00:00`,
    endAtExclusive: `${nextMonth.getFullYear()}-${pad(nextMonth.getMonth() + 1)}-01T00:00`
  };
}

/** Monday-based start of the week that contains the given date. */
export function startOfWeek(date: Date): Date {
  const mondayOffset = (date.getDay() + 6) % 7;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - mondayOffset);
}

export function weekRange(anchor: Date): EventRange {
  const start = startOfWeek(anchor);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
  return { startAt: midnightIso(start), endAtExclusive: midnightIso(end) };
}

export function dayRange(anchor: Date): EventRange {
  const start = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  const end = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + 1);
  return { startAt: midnightIso(start), endAtExclusive: midnightIso(end) };
}

export function rangeFor(view: CalendarView, anchor: Date): EventRange {
  if (view === 'week') return weekRange(anchor);
  if (view === 'day') return dayRange(anchor);
  return monthRange(anchor.getFullYear(), anchor.getMonth());
}

export function buildWeekDays(anchor: Date, today = new Date()): CalendarDay[] {
  const start = startOfWeek(anchor);
  const todayIso = toIsoDate(today);
  const anchorMonth = anchor.getMonth();
  const result: CalendarDay[] = [];
  for (let index = 0; index < 7; index += 1) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    result.push({
      isoDate: toIsoDate(date),
      dayOfMonth: date.getDate(),
      isCurrentMonth: date.getMonth() === anchorMonth,
      isToday: toIsoDate(date) === todayIso,
      events: []
    });
  }
  return result;
}

export { buildMonthGrid };

export function monthTitle(year: number, monthIndex: number) {
  return `${year} 年 ${monthIndex + 1} 月`;
}

export function weekTitle(anchor: Date) {
  const start = startOfWeek(anchor);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  const startPart = `${start.getFullYear()} 年 ${start.getMonth() + 1} 月 ${start.getDate()} 日`;
  const endPart =
    start.getFullYear() === end.getFullYear()
      ? `${end.getMonth() + 1} 月 ${end.getDate()} 日`
      : `${end.getFullYear()} 年 ${end.getMonth() + 1} 月 ${end.getDate()} 日`;
  return `${startPart} – ${endPart}`;
}

export function dayTitle(anchor: Date) {
  return `${anchor.getFullYear()} 年 ${anchor.getMonth() + 1} 月 ${anchor.getDate()} 日 ${weekdayNames[anchor.getDay()]}`;
}

export function viewTitle(view: CalendarView, year: number, monthIndex: number, anchor: Date) {
  if (view === 'week') return weekTitle(anchor);
  if (view === 'day') return dayTitle(anchor);
  return monthTitle(year, monthIndex);
}

function dayDiff(fromIso: string, toIso: string) {
  const from = localDate(fromIso);
  const to = localDate(toIso);
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

function addDaysIso(isoDate: string, days: number) {
  const date = localDate(isoDate);
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

/** True when the event's date span (start date through end date) covers isoDate. */
export function eventCoversDate(event: CalendarEvent, isoDate: string) {
  const startDate = event.startAt.slice(0, 10);
  const endDate = event.endAt.slice(0, 10);
  return startDate <= isoDate && isoDate <= endDate;
}

/** True when the event spans more than one calendar day. */
export function isMultiDay(event: CalendarEvent) {
  return event.endAt.slice(0, 10) > event.startAt.slice(0, 10);
}

export type EventSegment = {
  event: CalendarEvent;
  /** First column (0-6) the bar occupies within this week row. */
  startCol: number;
  /** Last column (0-6, inclusive) the bar occupies within this week row. */
  endCol: number;
  /** Vertical stacking lane (0-based). */
  lane: number;
  /** The event starts before this week (bar is clipped on the left). */
  continuesBefore: boolean;
  /** The event ends after this week (bar is clipped on the right). */
  continuesAfter: boolean;
};

export type WeekLayout = {
  segments: EventSegment[];
  /** Count of events hidden past the lane cap, per column (0-6). */
  overflowByCol: number[];
};

/**
 * Assign every event that intersects a 7-day week row to a horizontal bar
 * segment (start/end column) and a vertical lane, packing bars greedily so that
 * a multi-day event renders as a single connected bar spanning several columns.
 * Events past the lane cap are reported as per-column overflow counts instead.
 */
export function layoutWeekSegments(
  weekDays: CalendarDay[],
  events: CalendarEvent[],
  maxLanes = 3
): WeekLayout {
  const weekStart = weekDays[0].isoDate;
  const weekEnd = weekDays[weekDays.length - 1].isoDate;

  const covering = events.filter((event) => {
    const start = event.startAt.slice(0, 10);
    const end = event.endAt.slice(0, 10);
    return start <= weekEnd && end >= weekStart;
  });

  // Earlier start first, then longer span first (so wide bars claim low lanes),
  // then start time and id for a stable order.
  const sorted = [...covering].sort((left, right) => {
    const leftStart = left.startAt.slice(0, 10);
    const rightStart = right.startAt.slice(0, 10);
    if (leftStart !== rightStart) return leftStart.localeCompare(rightStart);
    const leftSpan = dayDiff(left.startAt.slice(0, 10), left.endAt.slice(0, 10));
    const rightSpan = dayDiff(right.startAt.slice(0, 10), right.endAt.slice(0, 10));
    if (leftSpan !== rightSpan) return rightSpan - leftSpan;
    return left.startAt.localeCompare(right.startAt) || left.id.localeCompare(right.id);
  });

  const laneOccupancy: boolean[][] = [];
  const segments: EventSegment[] = [];
  const overflowByCol = new Array(7).fill(0);

  for (const event of sorted) {
    const start = event.startAt.slice(0, 10);
    const end = event.endAt.slice(0, 10);
    const startCol = Math.max(0, dayDiff(weekStart, start));
    const endCol = Math.min(6, dayDiff(weekStart, end));

    let lane = 0;
    for (;;) {
      if (!laneOccupancy[lane]) laneOccupancy[lane] = new Array(7).fill(false);
      let free = true;
      for (let col = startCol; col <= endCol; col += 1) {
        if (laneOccupancy[lane][col]) {
          free = false;
          break;
        }
      }
      if (free) break;
      lane += 1;
    }

    if (lane >= maxLanes) {
      for (let col = startCol; col <= endCol; col += 1) overflowByCol[col] += 1;
      continue;
    }

    for (let col = startCol; col <= endCol; col += 1) laneOccupancy[lane][col] = true;
    segments.push({
      event,
      startCol,
      endCol,
      lane,
      continuesBefore: start < weekStart,
      continuesAfter: end > weekEnd
    });
  }

  return { segments, overflowByCol };
}

export type WeekRowLayout = {
  /** Multi-day bars, lane-packed and top-anchored so they stay connected. */
  spanning: EventSegment[];
  /** Number of lanes the multi-day bars occupy (height of the top zone). */
  spanLaneCount: number;
  /** Single-day events per column (0-6), sorted, to be centered per cell. */
  singlesByCol: CalendarEvent[][];
  /** Single-day events hidden past the per-column cap, per column. */
  overflowByCol: number[];
};

/**
 * Lay out a week row for centered rendering: multi-day events are lane-packed
 * into a top zone (so a spanning event stays one connected bar), while
 * single-day events are grouped per column so each cell can vertically center
 * its own stack independently. This lets a lone event sit in the middle of its
 * cell while a busy cell stacks its events with an even gap.
 */
export function layoutWeekRows(
  weekDays: CalendarDay[],
  events: CalendarEvent[],
  maxSingles = Number.POSITIVE_INFINITY
): WeekRowLayout {
  const weekStart = weekDays[0].isoDate;
  const weekEnd = weekDays[weekDays.length - 1].isoDate;

  const covering = events.filter((event) => {
    const start = event.startAt.slice(0, 10);
    const end = event.endAt.slice(0, 10);
    return start <= weekEnd && end >= weekStart;
  });

  const spanningEvents = covering.filter((event) => isMultiDay(event));
  const singleEvents = covering.filter((event) => !isMultiDay(event));

  // Lane-pack the multi-day bars, widest first, so wide bars claim low lanes.
  const sorted = [...spanningEvents].sort((left, right) => {
    const leftStart = left.startAt.slice(0, 10);
    const rightStart = right.startAt.slice(0, 10);
    if (leftStart !== rightStart) return leftStart.localeCompare(rightStart);
    const leftSpan = dayDiff(left.startAt.slice(0, 10), left.endAt.slice(0, 10));
    const rightSpan = dayDiff(right.startAt.slice(0, 10), right.endAt.slice(0, 10));
    if (leftSpan !== rightSpan) return rightSpan - leftSpan;
    return left.startAt.localeCompare(right.startAt) || left.id.localeCompare(right.id);
  });

  const laneOccupancy: boolean[][] = [];
  const spanning: EventSegment[] = [];
  for (const event of sorted) {
    const start = event.startAt.slice(0, 10);
    const end = event.endAt.slice(0, 10);
    const startCol = Math.max(0, dayDiff(weekStart, start));
    const endCol = Math.min(6, dayDiff(weekStart, end));
    let lane = 0;
    for (;;) {
      if (!laneOccupancy[lane]) laneOccupancy[lane] = new Array(7).fill(false);
      let free = true;
      for (let col = startCol; col <= endCol; col += 1) {
        if (laneOccupancy[lane][col]) {
          free = false;
          break;
        }
      }
      if (free) break;
      lane += 1;
    }
    for (let col = startCol; col <= endCol; col += 1) laneOccupancy[lane][col] = true;
    spanning.push({
      event,
      startCol,
      endCol,
      lane,
      continuesBefore: start < weekStart,
      continuesAfter: end > weekEnd
    });
  }
  const spanLaneCount = spanning.reduce((max, segment) => Math.max(max, segment.lane + 1), 0);

  // Group single-day events per column and cap each column independently.
  const singlesByCol: CalendarEvent[][] = Array.from({ length: 7 }, () => []);
  for (const event of singleEvents) {
    const col = dayDiff(weekStart, event.startAt.slice(0, 10));
    if (col >= 0 && col <= 6) singlesByCol[col].push(event);
  }
  const overflowByCol = new Array(7).fill(0);
  for (let col = 0; col < 7; col += 1) {
    // All-day events first, then the rest by nearest start time (earliest
    // first), with id as a stable tiebreaker.
    singlesByCol[col].sort((left, right) => {
      if (left.allDay !== right.allDay) return left.allDay ? -1 : 1;
      return (
        left.startAt.localeCompare(right.startAt) ||
        left.endAt.localeCompare(right.endAt) ||
        left.id.localeCompare(right.id)
      );
    });
    if (Number.isFinite(maxSingles) && singlesByCol[col].length > maxSingles) {
      overflowByCol[col] = singlesByCol[col].length - maxSingles;
      singlesByCol[col] = singlesByCol[col].slice(0, maxSingles);
    }
  }

  return { spanning, spanLaneCount, singlesByCol, overflowByCol };
}

/** Split a 42-cell month grid into six 7-day week rows. */
export function splitIntoWeeks(days: CalendarDay[]): CalendarDay[][] {
  const weeks: CalendarDay[][] = [];
  for (let index = 0; index < days.length; index += 7) {
    weeks.push(days.slice(index, index + 7));
  }
  return weeks;
}

/**
 * Build an EventDraft that moves an event so its start date becomes isoDate,
 * keeping its time-of-day and its multi-day span (end date shifts by the same
 * number of days).
 */
export function shiftEventToDate(event: CalendarEvent, isoDate: string): EventDraft {
  const startTime = event.allDay ? '00:00' : event.startAt.slice(11, 16);
  const endTime = event.allDay ? '23:59' : event.endAt.slice(11, 16);
  const span = dayDiff(event.startAt.slice(0, 10), event.endAt.slice(0, 10));
  return {
    title: event.title,
    startAt: `${isoDate}T${startTime}`,
    endAt: `${addDaysIso(isoDate, Math.max(0, span))}T${endTime}`,
    allDay: event.allDay,
    category: event.category,
    color: event.color,
    linkedTaskId: event.linkedTaskId,
    note: event.note
  };
}

/**
 * Build an EventDraft that stretches (or shrinks) an event's end date to
 * isoDate, keeping the start fixed. The end date is clamped so it never falls
 * before the start date.
 */
export function resizeEventEndToDate(event: CalendarEvent, isoDate: string): EventDraft {
  const startDate = event.startAt.slice(0, 10);
  const endDate = isoDate < startDate ? startDate : isoDate;
  const startTime = event.allDay ? '00:00' : event.startAt.slice(11, 16);
  const endTime = event.allDay ? '23:59' : event.endAt.slice(11, 16);
  return {
    title: event.title,
    startAt: `${startDate}T${startTime}`,
    endAt: `${endDate}T${endTime}`,
    allDay: event.allDay,
    category: event.category,
    color: event.color,
    linkedTaskId: event.linkedTaskId,
    note: event.note
  };
}

function minutesToTime(minutes: number) {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

function timeToMinutes(time: string) {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

/**
 * Build an EventDraft that moves a timed event to a new start hour on the same
 * day, keeping its duration. The event is clamped so it never crosses midnight,
 * matching the event form validation rules.
 */
export function shiftEventToHour(event: CalendarEvent, isoDate: string, startHour: number): EventDraft {
  const previousStart = timeToMinutes(event.startAt.slice(11, 16));
  const previousEnd = timeToMinutes(event.endAt.slice(11, 16));
  const duration = Math.max(5, previousEnd - previousStart);
  let startMinutes = startHour * 60;
  let endMinutes = startMinutes + duration;
  if (endMinutes > 23 * 60 + 59) {
    endMinutes = 23 * 60 + 59;
    startMinutes = Math.max(0, endMinutes - duration);
  }
  return {
    title: event.title,
    startAt: `${isoDate}T${minutesToTime(startMinutes)}`,
    endAt: `${isoDate}T${minutesToTime(endMinutes)}`,
    allDay: false,
    category: event.category,
    color: event.color,
    linkedTaskId: event.linkedTaskId,
    note: event.note
  };
}

export function sortEvents(events: CalendarEvent[]): CalendarEvent[] {
  return [...events].sort((left, right) => {
    if (left.allDay !== right.allDay) return left.allDay ? -1 : 1;
    return (
      left.startAt.localeCompare(right.startAt) ||
      left.endAt.localeCompare(right.endAt) ||
      left.id.localeCompare(right.id)
    );
  });
}

export function groupEventsByDate(events: CalendarEvent[]): Array<{ isoDate: string; events: CalendarEvent[] }> {
  const map = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const key = event.startAt.slice(0, 10);
    const bucket = map.get(key);
    if (bucket) bucket.push(event);
    else map.set(key, [event]);
  }
  return [...map.keys()]
    .sort((left, right) => left.localeCompare(right))
    .map((isoDate) => ({ isoDate, events: sortEvents(map.get(isoDate) ?? []) }));
}

export function listDateLabel(isoDate: string) {
  const date = localDate(isoDate);
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日 ${weekdayNames[date.getDay()]}`;
}
