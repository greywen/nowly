import { buildMonthGrid, toIsoDate, type WeekStart } from '../lib/date';
import { getLanguage } from '../i18n';
import type { CalendarDay, CalendarEvent, CalendarView, EventDraft, EventRange } from './calendar-model';

export type DateFormat = 'localized' | 'iso';

const weekdayNames = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
const weekdayNamesEn = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const monthNamesEn = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];
const monthShortEn = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

function weekdayName(dayIndex: number): string {
  return getLanguage() === 'en' ? weekdayNamesEn[dayIndex] : weekdayNames[dayIndex];
}

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

/** Start of the week that contains the given date, honoring the week-start setting. */
export function startOfWeek(date: Date, weekStart: WeekStart = 'monday'): Date {
  const startDow = weekStart === 'sunday' ? 0 : 1;
  const offset = (date.getDay() - startDow + 7) % 7;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - offset);
}

export function weekRange(anchor: Date, weekStart: WeekStart = 'monday'): EventRange {
  const start = startOfWeek(anchor, weekStart);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
  return { startAt: midnightIso(start), endAtExclusive: midnightIso(end) };
}

export function dayRange(anchor: Date): EventRange {
  const start = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  const end = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + 1);
  return { startAt: midnightIso(start), endAtExclusive: midnightIso(end) };
}

export function rangeFor(view: CalendarView, anchor: Date, weekStart: WeekStart = 'monday'): EventRange {
  if (view === 'week') return weekRange(anchor, weekStart);
  if (view === 'day') return dayRange(anchor);
  return monthRange(anchor.getFullYear(), anchor.getMonth());
}

export function buildWeekDays(anchor: Date, today = new Date(), weekStart: WeekStart = 'monday'): CalendarDay[] {
  const start = startOfWeek(anchor, weekStart);
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

/** Format a Date as a plain calendar date honoring the date-format setting. */
function formatDate(date: Date, dateFormat: DateFormat) {
  if (dateFormat === 'iso') {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }
  if (getLanguage() === 'en') {
    return `${monthShortEn[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
  }
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

export function monthTitle(year: number, monthIndex: number, dateFormat: DateFormat = 'localized') {
  if (dateFormat === 'iso') return `${year}-${pad(monthIndex + 1)}`;
  if (getLanguage() === 'en') return `${monthNamesEn[monthIndex]} ${year}`;
  return `${year}年${monthIndex + 1}月`;
}

export function weekTitle(anchor: Date, weekStart: WeekStart = 'monday', dateFormat: DateFormat = 'localized') {
  const start = startOfWeek(anchor, weekStart);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  return `${formatDate(start, dateFormat)} - ${formatDate(end, dateFormat)}`;
}

export function dayTitle(anchor: Date, dateFormat: DateFormat = 'localized') {
  return `${formatDate(anchor, dateFormat)} ${weekdayName(anchor.getDay())}`;
}

export function viewTitle(
  view: CalendarView,
  year: number,
  monthIndex: number,
  anchor: Date,
  weekStart: WeekStart = 'monday',
  dateFormat: DateFormat = 'localized'
) {
  if (view === 'week') return weekTitle(anchor, weekStart, dateFormat);
  if (view === 'day') return dayTitle(anchor, dateFormat);
  return monthTitle(year, monthIndex, dateFormat);
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
  /** Events hidden past the total per-date cap, per column. */
  overflowByCol: CalendarEvent[][];
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
  const overflowByCol: CalendarEvent[][] = Array.from({ length: 7 }, () => []);
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

    if (!Number.isFinite(maxSingles) || lane < maxSingles) {
      for (let col = startCol; col <= endCol; col += 1) laneOccupancy[lane][col] = true;
      spanning.push({
        event,
        startCol,
        endCol,
        lane,
        continuesBefore: start < weekStart,
        continuesAfter: end > weekEnd
      });
      continue;
    }

    // No one lane can carry the entire bar below the date cap. Preserve every
    // visible remainder as a connected run and report only the saturated dates
    // as overflow, rather than hiding the whole multi-day event for the week.
    let runStart = -1;
    let runLane = -1;
    const flushRun = (runEnd: number) => {
      if (runStart < 0) return;
      spanning.push({
        event,
        startCol: runStart,
        endCol: runEnd,
        lane: runLane,
        continuesBefore: start < weekStart || runStart > startCol,
        continuesAfter: end > weekEnd || runEnd < endCol
      });
      runStart = -1;
      runLane = -1;
    };
    for (let col = startCol; col <= endCol; col += 1) {
      let freeLane = -1;
      for (let candidate = 0; candidate < maxSingles; candidate += 1) {
        if (!laneOccupancy[candidate]) laneOccupancy[candidate] = new Array(7).fill(false);
        if (!laneOccupancy[candidate][col]) {
          freeLane = candidate;
          break;
        }
      }
      if (freeLane < 0) {
        flushRun(col - 1);
        overflowByCol[col].push(event);
      } else {
        if (runStart >= 0 && runLane !== freeLane) flushRun(col - 1);
        if (runStart < 0) {
          runStart = col;
          runLane = freeLane;
        }
        laneOccupancy[freeLane][col] = true;
      }
    }
    flushRun(endCol);
  }
  const spanLaneCount = spanning.reduce((max, segment) => Math.max(max, segment.lane + 1), 0);
  const spanLanesByCol = new Array(7).fill(0);
  for (const segment of spanning) {
    for (let col = segment.startCol; col <= segment.endCol; col += 1) {
      spanLanesByCol[col] = Math.max(spanLanesByCol[col], segment.lane + 1);
    }
  }

  // Group single-day events per column and use only the capacity left after
  // visible spanning lanes have counted toward that date's total limit.
  const singlesByCol: CalendarEvent[][] = Array.from({ length: 7 }, () => []);
  for (const event of singleEvents) {
    const col = dayDiff(weekStart, event.startAt.slice(0, 10));
    if (col >= 0 && col <= 6) singlesByCol[col].push(event);
  }
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
    if (Number.isFinite(maxSingles)) {
      const visibleSingles = Math.max(0, maxSingles - spanLanesByCol[col]);
      overflowByCol[col].push(...singlesByCol[col].slice(visibleSingles));
      singlesByCol[col] = singlesByCol[col].slice(0, visibleSingles);
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
    note: event.note,
    recurrence: event.recurrence
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
    note: event.note,
    recurrence: event.recurrence
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
    note: event.note,
    recurrence: event.recurrence
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

export function listDateLabel(isoDate: string, dateFormat: DateFormat = 'localized') {
  const date = localDate(isoDate);
  if (dateFormat === 'iso') {
    return `${toIsoDate(date)} ${weekdayName(date.getDay())}`;
  }
  if (getLanguage() === 'en') {
    return `${monthShortEn[date.getMonth()]} ${date.getDate()}, ${weekdayName(date.getDay())}`;
  }
  return `${date.getMonth() + 1}月${date.getDate()}日 ${weekdayName(date.getDay())}`;
}
