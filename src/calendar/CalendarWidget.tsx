import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  buildMonthGrid,
  buildWeekDays,
  groupEventsByDate,
  layoutWeekRows,
  listDateLabel,
  shiftEventToHour,
  sortEvents,
  splitIntoWeeks,
  viewTitle,
  type EventSegment
} from './calendar-view';
import {
  eventCategoryLabels,
  type CalendarDay,
  type CalendarEvent,
  type CalendarView,
  type EventColor
} from './calendar-model';

const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
const hours = Array.from({ length: 24 }, (_, index) => index);

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function isoAddDays(isoDate: string, days: number) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(year, month - 1, day + days);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function isoDayDiff(fromIso: string, toIso: string) {
  const [fy, fm, fd] = fromIso.split('-').map(Number);
  const [ty, tm, td] = toIso.split('-').map(Number);
  const from = new Date(fy, fm - 1, fd);
  const to = new Date(ty, tm - 1, td);
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

const DAY_CLICK_DELAY_MS = 250;
// One stacked event bar is 20px tall with a 4px gap below it, so lanes step by
// 24px. Multi-day bars in the top zone use this to stack; single-day events use
// flex layout with the same 4px gap.
const LANE_HEIGHT_PX = 24;
// How many single-day events a month cell shows before collapsing to "+N".
const MONTH_MAX_SINGLES = 3;

const viewOptions: Array<{ view: CalendarView; label: string }> = [
  { view: 'month', label: '月' },
  { view: 'week', label: '周' },
  { view: 'day', label: '天' },
  { view: 'list', label: '列表' }
];

const navLabels: Record<CalendarView, { previous: string; next: string }> = {
  month: { previous: '上一个月', next: '下一个月' },
  week: { previous: '上一周', next: '下一周' },
  day: { previous: '前一天', next: '后一天' },
  list: { previous: '上一个月', next: '下一个月' }
};

const eventToneClass: Record<EventColor, string> = {
  blue: 'event--work',
  red: 'event--important',
  green: 'event--personal',
  yellow: 'event--learning'
};

type LoadStatus = 'loading' | 'ready' | 'error';

type CalendarWidgetProps = {
  year: number;
  monthIndex: number;
  todayIso: string;
  events: CalendarEvent[];
  status: LoadStatus;
  errorMessage?: string;
  view?: CalendarView;
  anchorIso?: string;
  onRetry: () => void;
  onCreateEvent: () => void;
  onSetView?: (view: CalendarView) => void;
  onPreviousMonth: () => void;
  onNextMonth: () => void;
  onToday: () => void;
  onCreateEventForDate: (isoDate: string) => void;
  onOpenDate: (isoDate: string) => void;
  onOpenEvent: (event: CalendarEvent) => void;
  onMoveEvent?: (event: CalendarEvent, isoDate: string) => void;
  onMoveEventToHour?: (event: CalendarEvent, isoDate: string, startHour: number) => void;
  onResizeEvent?: (event: CalendarEvent, endIsoDate: string) => void;
};

function summaryFor(status: LoadStatus, count: number, view: CalendarView) {
  const scope = view === 'week' ? '本周' : view === 'day' ? '当天' : '本月';
  if (status === 'loading') return '正在读取本地日程';
  return count ? `${scope} ${count} 个日程` : `${scope}暂无日程`;
}

function dateLabel(isoDate: string) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return `${year}年${month}月${day}日`;
}

function eventLabel(event: CalendarEvent) {
  const time = event.allDay ? '全天' : event.startAt.slice(11, 16);
  return `${time} ${event.title}，${eventCategoryLabels[event.category]}`;
}

export function CalendarWidget({
  year,
  monthIndex,
  todayIso,
  events,
  status,
  errorMessage,
  view = 'month',
  anchorIso,
  onRetry,
  onCreateEvent,
  onSetView,
  onPreviousMonth,
  onNextMonth,
  onToday,
  onCreateEventForDate,
  onOpenDate,
  onOpenEvent,
  onMoveEvent,
  onMoveEventToHour,
  onResizeEvent
}: CalendarWidgetProps) {
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const anchor = anchorIso ? new Date(`${anchorIso}T00:00:00`) : new Date(year, monthIndex, 1);
  const today = new Date(`${todayIso}T00:00:00`);
  const title = viewTitle(view, year, monthIndex, anchor);

  function cancelDateClick() {
    if (clickTimerRef.current !== null) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
  }

  function scheduleDateOpen(isoDate: string) {
    cancelDateClick();
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null;
      onOpenDate(isoDate);
    }, DAY_CLICK_DELAY_MS);
  }

  function createForDate(isoDate: string) {
    cancelDateClick();
    onCreateEventForDate(isoDate);
  }

  const dropEnabled = Boolean(onMoveEvent);
  const hourDropEnabled = Boolean(onMoveEventToHour);
  const resizeEnabled = Boolean(onResizeEvent);

  // All views drive move/resize with pointer events instead of native HTML5
  // drag-and-drop. Native DnD is unreliable in the Tauri webview (drags often
  // never start), which is why moving and stretching failed there. A pointer
  // gesture plus window listeners makes every view deterministic and gives a
  // live preview as the pointer sweeps across day columns or hour rows.
  type PointerGesture =
    | { kind: 'move-date'; event: CalendarEvent; spanDays: number; startIso: string; moved: boolean; downX: number; downY: number }
    | { kind: 'resize-date'; event: CalendarEvent; endIso: string; moved: boolean; downX: number; downY: number }
    | { kind: 'move-hour'; event: CalendarEvent; isoDate: string; startHour: number; moved: boolean; downX: number; downY: number };
  const gestureRef = useRef<PointerGesture | null>(null);
  // Preview carries full start/end datetimes so date moves, stretches, and
  // hour moves all render live through the same displayEvents mapping.
  const [preview, setPreview] = useState<{ eventId: string; startAt: string; endAt: string } | null>(null);
  const [pointerActive, setPointerActive] = useState(false);
  // Set right after a move/resize gesture so the trailing click does not also
  // open the event.
  const suppressClickRef = useRef(false);
  // Safety timer: retire a committed preview even if the reload never matches
  // it (e.g. a rejected write), so a stale preview can't stick forever.
  const previewClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const DRAG_THRESHOLD_PX = 4;

  const dayIsoFromPoint = useCallback((clientX: number, clientY: number) => {
    const element = document.elementFromPoint(clientX, clientY);
    const cell = element?.closest('[data-iso-date]') as HTMLElement | null;
    return cell?.dataset.isoDate ?? null;
  }, []);

  const hourFromPoint = useCallback((clientX: number, clientY: number) => {
    const element = document.elementFromPoint(clientX, clientY);
    const slot = element?.closest('[data-hour]') as HTMLElement | null;
    if (!slot?.dataset.hour) return null;
    return Number(slot.dataset.hour);
  }, []);

  const handleGesturePointerMove = useCallback(
    (moveEvent: PointerEvent) => {
      const gesture = gestureRef.current;
      if (!gesture) return;
      if (!gesture.moved) {
        const far =
          Math.abs(moveEvent.clientX - gesture.downX) > DRAG_THRESHOLD_PX ||
          Math.abs(moveEvent.clientY - gesture.downY) > DRAG_THRESHOLD_PX;
        if (!far) return;
        gesture.moved = true;
        // Once a real drag begins, chips stop catching pointer events so
        // elementFromPoint can read the cell/slot underneath.
        setPointerActive(true);
      }
      const { event } = gesture;
      if (gesture.kind === 'move-date') {
        const iso = dayIsoFromPoint(moveEvent.clientX, moveEvent.clientY);
        if (!iso || iso === gesture.startIso) return;
        gesture.startIso = iso;
        setPreview({
          eventId: event.id,
          startAt: `${iso}T${event.startAt.slice(11)}`,
          endAt: `${isoAddDays(iso, gesture.spanDays)}T${event.endAt.slice(11)}`
        });
      } else if (gesture.kind === 'resize-date') {
        const iso = dayIsoFromPoint(moveEvent.clientX, moveEvent.clientY);
        if (!iso) return;
        const minIso = event.startAt.slice(0, 10);
        const endIso = iso < minIso ? minIso : iso;
        if (endIso === gesture.endIso) return;
        gesture.endIso = endIso;
        setPreview({
          eventId: event.id,
          startAt: event.startAt.slice(0, 16),
          endAt: `${endIso}T${event.endAt.slice(11)}`
        });
      } else {
        const hour = hourFromPoint(moveEvent.clientX, moveEvent.clientY);
        if (hour === null || hour === gesture.startHour) return;
        gesture.startHour = hour;
        const draft = shiftEventToHour(event, gesture.isoDate, hour);
        setPreview({ eventId: event.id, startAt: draft.startAt, endAt: draft.endAt });
      }
    },
    [dayIsoFromPoint, hourFromPoint]
  );

  const handleGesturePointerUp = useCallback(() => {
    window.removeEventListener('pointermove', handleGesturePointerMove);
    window.removeEventListener('pointerup', handleGesturePointerUp);
    const gesture = gestureRef.current;
    gestureRef.current = null;
    setPointerActive(false);
    if (!gesture || !gesture.moved) {
      // No real drag happened: drop the (empty) preview immediately.
      setPreview(null);
      return;
    }
    // A gesture that actually moved should not also fire the chip's click.
    suppressClickRef.current = true;
    const { event } = gesture;
    let committed = false;
    if (gesture.kind === 'move-date') {
      if (gesture.startIso !== event.startAt.slice(0, 10) && onMoveEvent) {
        onMoveEvent(event, gesture.startIso);
        committed = true;
      }
    } else if (gesture.kind === 'resize-date') {
      if (gesture.endIso !== event.endAt.slice(0, 10) && onResizeEvent) {
        onResizeEvent(event, gesture.endIso);
        committed = true;
      }
    } else if (gesture.startHour !== Number(event.startAt.slice(11, 13)) && onMoveEventToHour) {
      onMoveEventToHour(event, gesture.isoDate, gesture.startHour);
      committed = true;
    }
    // Keep the preview on screen until the reloaded events reflect the new
    // position. Clearing it here would snap the bar back to its old spot for a
    // frame (the "flash") before the async write + reload lands.
    if (committed) {
      if (previewClearTimer.current) clearTimeout(previewClearTimer.current);
      previewClearTimer.current = setTimeout(() => {
        previewClearTimer.current = null;
        setPreview(null);
      }, 2500);
    } else {
      setPreview(null);
    }
  }, [handleGesturePointerMove, onMoveEvent, onResizeEvent, onMoveEventToHour]);

  const beginGesture = useCallback(
    (pointerEvent: React.PointerEvent, gesture: PointerGesture) => {
      // Only react to the primary (left) button; let others fall through.
      if (pointerEvent.button !== 0) return;
      cancelDateClick();
      gestureRef.current = gesture;
      window.addEventListener('pointermove', handleGesturePointerMove);
      window.addEventListener('pointerup', handleGesturePointerUp);
    },
    [handleGesturePointerMove, handleGesturePointerUp]
  );

  const handleMovePointerDown = useCallback(
    (pointerEvent: React.PointerEvent, event: CalendarEvent) => {
      const startIso = event.startAt.slice(0, 10);
      const spanDays = Math.max(0, isoDayDiff(startIso, event.endAt.slice(0, 10)));
      beginGesture(pointerEvent, {
        kind: 'move-date',
        event,
        spanDays,
        startIso,
        moved: false,
        downX: pointerEvent.clientX,
        downY: pointerEvent.clientY
      });
    },
    [beginGesture]
  );

  const handleResizePointerDown = useCallback(
    (pointerEvent: React.PointerEvent, event: CalendarEvent) => {
      // Keep the resize gesture from also starting a move.
      pointerEvent.stopPropagation();
      beginGesture(pointerEvent, {
        kind: 'resize-date',
        event,
        endIso: event.endAt.slice(0, 10),
        moved: false,
        downX: pointerEvent.clientX,
        downY: pointerEvent.clientY
      });
    },
    [beginGesture]
  );

  const handleHourMovePointerDown = useCallback(
    (pointerEvent: React.PointerEvent, event: CalendarEvent, isoDate: string) => {
      beginGesture(pointerEvent, {
        kind: 'move-hour',
        event,
        isoDate,
        startHour: Number(event.startAt.slice(11, 13)),
        moved: false,
        downX: pointerEvent.clientX,
        downY: pointerEvent.clientY
      });
    },
    [beginGesture]
  );

  const handleBarClick = useCallback(
    (event: CalendarEvent) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      onOpenEvent(event);
    },
    [onOpenEvent]
  );

  // While a gesture is active, preview the dragged event's new span so the bar
  // moves/stretches before the write lands.
  const displayEvents = useMemo(() => {
    if (!preview) return events;
    return events.map((event) =>
      event.id === preview.eventId
        ? { ...event, startAt: preview.startAt, endAt: preview.endAt }
        : event
    );
  }, [events, preview]);

  useEffect(() => cancelDateClick, []);

  // Once the reloaded events show the dragged event at its committed position,
  // retire the preview so we render straight from props (no visible snap).
  useEffect(() => {
    if (!preview) return;
    const updated = events.find((item) => item.id === preview.eventId);
    if (
      updated &&
      updated.startAt.slice(0, 16) === preview.startAt.slice(0, 16) &&
      updated.endAt.slice(0, 16) === preview.endAt.slice(0, 16)
    ) {
      if (previewClearTimer.current) {
        clearTimeout(previewClearTimer.current);
        previewClearTimer.current = null;
      }
      setPreview(null);
    }
  }, [events, preview]);

  useEffect(
    () => () => {
      window.removeEventListener('pointermove', handleGesturePointerMove);
      window.removeEventListener('pointerup', handleGesturePointerUp);
      if (previewClearTimer.current) clearTimeout(previewClearTimer.current);
    },
    [handleGesturePointerMove, handleGesturePointerUp]
  );

  // A multi-day bar in the top "spanning" zone. Absolutely positioned by lane
  // and column so it stays one connected bar across the days it covers.
  function renderSegmentBar(segment: EventSegment) {
    const { event, startCol, endCol, lane, continuesBefore, continuesAfter } = segment;
    // Position the bar across the columns it spans. Percentages map columns to
    // the 7-column week row so a multi-day event is one continuous bar.
    const left = (startCol / 7) * 100;
    const width = ((endCol - startCol + 1) / 7) * 100;
    // A bar that runs off the right edge of the week keeps that side square and
    // hides the resize handle there (you resize from the true end segment).
    const resizableHere = resizeEnabled && !continuesAfter;
    return (
      <button
        type="button"
        key={event.id}
        draggable={false}
        aria-label={eventLabel(event)}
        onPointerDown={dropEnabled ? (pointerEvent) => handleMovePointerDown(pointerEvent, event) : undefined}
        onClick={() => handleBarClick(event)}
        style={{
          left: `calc(${left}% + 4px)`,
          width: `calc(${width}% - 8px)`,
          top: `${lane * LANE_HEIGHT_PX}px`
        }}
        className={
          `event event-bar event--spanning ${eventToneClass[event.color]}` +
          `${dropEnabled ? ' event--movable' : ''}` +
          `${continuesBefore ? ' event-bar--open-start' : ''}` +
          `${continuesAfter ? ' event-bar--open-end' : ''}`
        }
      >
        <span className="event__title">{event.title}</span>
        {resizableHere ? (
          <span
            className="event-bar__resize-handle"
            aria-hidden="true"
            onPointerDown={(pointerEvent) => handleResizePointerDown(pointerEvent, event)}
            onClick={(clickEvent) => clickEvent.stopPropagation()}
            onDragStart={(dragEvent) => dragEvent.preventDefault()}
          />
        ) : null}
      </button>
    );
  }

  // A single-day event that flows inside a per-column stack so each cell can
  // vertically center its own events (with an even gap) independently.
  function renderCellEvent(event: CalendarEvent) {
    return (
      <button
        type="button"
        key={event.id}
        draggable={false}
        aria-label={eventLabel(event)}
        onPointerDown={dropEnabled ? (pointerEvent) => handleMovePointerDown(pointerEvent, event) : undefined}
        onClick={() => handleBarClick(event)}
        className={
          `event event-cell ${eventToneClass[event.color]}` +
          `${dropEnabled ? ' event--movable' : ''}`
        }
      >
        <span className="event__title">{event.title}</span>
        {resizeEnabled ? (
          <span
            className="event-bar__resize-handle"
            aria-hidden="true"
            onPointerDown={(pointerEvent) => handleResizePointerDown(pointerEvent, event)}
            onClick={(clickEvent) => clickEvent.stopPropagation()}
            onDragStart={(dragEvent) => dragEvent.preventDefault()}
          />
        ) : null}
      </button>
    );
  }

  function renderMonthWeek(week: CalendarDay[]) {
    // Multi-day bars stay connected in a top zone; single-day events are grouped
    // per column so every cell can center its own stack. First lay out the
    // spanning bars so we know how many lanes they claim, then cap the singles
    // so the spanning zone plus the visible singles never exceed the cell.
    const { spanning, singlesByCol, overflowByCol } = layoutWeekRows(
      week,
      displayEvents,
      MONTH_MAX_SINGLES
    );
    // Push the single-event stack below any spanning bars in that column. Both
    // layers start at 36px, so one 20px bar plus the standard 4px gap is 24px.
    // Computing this per column means a cell with no spanning bar keeps its
    // single event at the shared baseline instead of inheriting a neighbor's
    // offset.
    const spanLanesByCol = new Array(7).fill(0);
    for (const segment of spanning) {
      for (let col = segment.startCol; col <= segment.endCol; col += 1) {
        spanLanesByCol[col] = Math.max(spanLanesByCol[col], segment.lane + 1);
      }
    }
    const singlesPadTopByCol = spanLanesByCol.map((lanes) =>
      lanes > 0 ? 24 + (lanes - 1) * LANE_HEIGHT_PX : 0
    );
    return (
      <div className="calendar-week-row" key={week[0].isoDate}>
        <div className="calendar-week-row__cells">
          {week.map((day, col) => (
            <div
              key={day.isoDate}
              data-calendar-day
              data-iso-date={day.isoDate}
              aria-current={day.isToday ? 'date' : undefined}
              className={`day${day.isCurrentMonth ? '' : ' outside'}${day.isToday ? ' today' : ''}`}
            >
              <button
                type="button"
                className="day-underlay"
                aria-label={dateLabel(day.isoDate)}
                onClick={() => scheduleDateOpen(day.isoDate)}
                onDoubleClick={() => createForDate(day.isoDate)}
              >
                <span className="day-number">{day.dayOfMonth}</span>
              </button>
              {/* Per-column stack of single-day events, centered in the space
                  below the shared spanning zone. */}
              <div
                className={`day-singles${pointerActive ? ' is-dragging' : ''}`}
                style={{ paddingTop: `${singlesPadTopByCol[col]}px` }}
              >
                {singlesByCol[col].map((event) => renderCellEvent(event))}
                {overflowByCol[col].length > 0 ? (
                  <button
                    type="button"
                    className="event-overflow-dots"
                    aria-label={`另有 ${overflowByCol[col].length} 个日程`}
                    onClick={() => {
                      cancelDateClick();
                      onOpenDate(day.isoDate);
                    }}
                  >
                    {overflowByCol[col].map((event) => (
                      <span
                        key={event.id}
                        className={`event-overflow-dot ${eventToneClass[event.color]}`}
                        aria-hidden="true"
                      />
                    ))}
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
        {spanning.length > 0 ? (
          <div className={`calendar-week-row__bars${pointerActive ? ' is-dragging' : ''}`}>
            {spanning.map((segment) => renderSegmentBar(segment))}
          </div>
        ) : null}
      </div>
    );
  }

  function renderMonth() {
    const weeks = splitIntoWeeks(buildMonthGrid(year, monthIndex, today));
    return (
      <>
        <div className="weekdays">
          {weekdays.map((weekday) => <span key={weekday}>{weekday}</span>)}
        </div>
        <div className="calendar-grid calendar-scroll-region">
          {weeks.map((week) => renderMonthWeek(week))}
        </div>
      </>
    );
  }

  function renderWeek() {
    const weekDays = buildWeekDays(anchor, today);
    // Same split as month view: multi-day events stay connected in a top zone,
    // single-day events center per column. The tall week body has room for many
    // single events, so no per-column cap.
    const { spanning, singlesByCol } = layoutWeekRows(weekDays, displayEvents);
    // Offset each column's single-event stack by only the spanning lanes that
    // actually cover that column, so a day with no spanning bar keeps its
    // events centered in the full cell.
    const spanLanesByCol = new Array(7).fill(0);
    for (const segment of spanning) {
      for (let col = segment.startCol; col <= segment.endCol; col += 1) {
        spanLanesByCol[col] = Math.max(spanLanesByCol[col], segment.lane + 1);
      }
    }
    return (
      <div className={`calendar-week calendar-scroll-region${pointerActive ? ' is-dragging' : ''}`}>
        <div className="calendar-week__heads">
          {weekDays.map((day, index) => (
            <button
              key={day.isoDate}
              type="button"
              className={`week-column__head${day.isToday ? ' today' : ''}`}
              aria-label={dateLabel(day.isoDate)}
              onClick={() => scheduleDateOpen(day.isoDate)}
              onDoubleClick={() => createForDate(day.isoDate)}
            >
              <span className="week-column__weekday">{weekdays[index]}</span>
              <span className="week-column__date">{day.dayOfMonth}</span>
            </button>
          ))}
        </div>
        <div className="calendar-week__body">
          <div className="calendar-week__cells">
            {weekDays.map((day, col) => (
              <div
                key={day.isoDate}
                data-calendar-day
                data-iso-date={day.isoDate}
                aria-current={day.isToday ? 'date' : undefined}
                className={`week-column${day.isToday ? ' today' : ''}`}
              >
                <button
                  type="button"
                  className="week-column__underlay"
                  aria-label={dateLabel(day.isoDate)}
                  onClick={() => scheduleDateOpen(day.isoDate)}
                  onDoubleClick={() => createForDate(day.isoDate)}
                />
                <div
                  className={`day-singles${pointerActive ? ' is-dragging' : ''}`}
                  style={{ paddingTop: `${spanLanesByCol[col] * LANE_HEIGHT_PX}px` }}
                >
                  {singlesByCol[col].map((event) => renderCellEvent(event))}
                </div>
              </div>
            ))}
          </div>
          {spanning.length > 0 ? (
            <div className={`calendar-week__bars${pointerActive ? ' is-dragging' : ''}`}>
              {spanning.map((segment) => renderSegmentBar(segment))}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  function renderDay() {
    const iso = anchorIso ?? '';
    const dayEvents = displayEvents.filter((event) => event.startAt.startsWith(iso));
    const allDayEvents = sortEvents(dayEvents.filter((event) => event.allDay));
    const timedEvents = dayEvents.filter((event) => !event.allDay);
    const eventsByHour = new Map<number, CalendarEvent[]>();
    for (const event of timedEvents) {
      const hour = Number(event.startAt.slice(11, 13));
      const bucket = eventsByHour.get(hour);
      if (bucket) bucket.push(event);
      else eventsByHour.set(hour, [event]);
    }
    return (
      <div className="calendar-day-view calendar-scroll-region">
        {allDayEvents.length > 0 ? (
          <div className="day-grid__allday">
            {allDayEvents.map((event) => (
              <button
                type="button"
                key={event.id}
                aria-label={eventLabel(event)}
                onClick={() => onOpenEvent(event)}
                className={`event ${eventToneClass[event.color]}`}
              >
                {event.title}
              </button>
            ))}
          </div>
        ) : null}
        <div className={`day-grid day-grid--full-day${pointerActive ? ' is-dragging' : ''}`} aria-label="当日日程">
          {hours.map((hour) => {
            const hourEvents = sortEvents(eventsByHour.get(hour) ?? []);
            return (
              <div className="day-grid__row" key={hour}>
                <span className="day-grid__hour">{pad(hour)}:00</span>
                <div
                  className="day-grid__slot"
                  data-hour={hour}
                  onDoubleClick={() => createForDate(iso)}
                >
                  {hourEvents.map((event) => (
                    <button
                      type="button"
                      key={event.id}
                      draggable={false}
                      aria-label={eventLabel(event)}
                      onPointerDown={hourDropEnabled ? (pointerEvent) => handleHourMovePointerDown(pointerEvent, event, iso) : undefined}
                      onClick={() => handleBarClick(event)}
                      className={`day-grid__event ${eventToneClass[event.color]}${hourDropEnabled ? ' event--movable' : ''}`}
                    >
                      <span className="day-grid__event-time">
                        {event.startAt.slice(11, 16)} – {event.endAt.slice(11, 16)}
                      </span>
                      <span className="day-grid__event-title">{event.title}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  function renderList() {
    const groups = groupEventsByDate(events);
    return (
      <div className="calendar-list-view calendar-scroll-region">
        {groups.length === 0 ? (
          <div className="calendar-empty">本月暂无日程</div>
        ) : (
          groups.map((group) => (
            <section key={group.isoDate} className="calendar-list-group">
              <h3 className="calendar-list-group__date">{listDateLabel(group.isoDate)}</h3>
              <ul className="calendar-list-group__items">
                {group.events.map((event) => (
                  <li key={event.id}>
                    <button
                      type="button"
                      aria-label={eventLabel(event)}
                      onClick={() => onOpenEvent(event)}
                      className="calendar-list-item"
                    >
                      <span className="calendar-list-item__time">
                        {event.allDay ? '全天' : event.startAt.slice(11, 16)}
                      </span>
                      <span className="calendar-list-item__title">{event.title}</span>
                      <span className={`calendar-list-item__category date-detail-dialog__category--${event.category}`}>
                        {eventCategoryLabels[event.category]}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    );
  }

  return (
    <div className="calendar-card-content">
      <div className="card-header">
        <div className="heading-group">
          <h1>{title}</h1>
          <p>{summaryFor(status, events.length, view)}</p>
        </div>
        <div className="toolbar-actions">
          {onSetView ? (
            <div className="view-switch" role="group" aria-label="切换视图">
              {viewOptions.map((option) => (
                <button
                  key={option.view}
                  type="button"
                  className={`view-switch__btn${view === option.view ? ' is-active' : ''}`}
                  aria-pressed={view === option.view}
                  onClick={() => onSetView(option.view)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          ) : null}
          <button type="button" className="btn btn-icon" aria-label={navLabels[view].previous} onClick={onPreviousMonth}>
            <ChevronLeft aria-hidden="true" />
          </button>
          <button type="button" className="btn" onClick={onToday}>今天</button>
          <button type="button" className="btn btn-icon" aria-label={navLabels[view].next} onClick={onNextMonth}>
            <ChevronRight aria-hidden="true" />
          </button>
          <button type="button" className="btn btn-primary" onClick={onCreateEvent}>
            新建日程
          </button>
        </div>
      </div>
      <div className="calendar-body">
        {status === 'error' ? (
          <div className="module-message" role="alert">
            <span>{errorMessage ?? '无法读取日程。'}</span>
            <button type="button" className="link-btn" aria-label="重试读取日程" onClick={onRetry}>
              重试
            </button>
          </div>
        ) : null}
        {view === 'month' ? renderMonth() : null}
        {view === 'week' ? renderWeek() : null}
        {view === 'day' ? renderDay() : null}
        {view === 'list' ? renderList() : null}
      </div>
    </div>
  );
}
