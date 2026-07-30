import { useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { buildMonthGrid } from '../lib/date';
import {
  eventCategoryLabels,
  type CalendarEvent,
  type EventColor
} from './calendar-model';

const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
const DAY_CLICK_DELAY_MS = 250;

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
  onRetry: () => void;
  onCreateEvent: () => void;
  onPreviousMonth: () => void;
  onNextMonth: () => void;
  onToday: () => void;
  onCreateEventForDate: (isoDate: string) => void;
  onOpenDate: (isoDate: string) => void;
  onOpenEvent: (event: CalendarEvent) => void;
};

function summaryFor(status: LoadStatus, count: number) {
  if (status === 'loading') return '正在读取本地日程';
  return count ? `本月 ${count} 个日程` : '本月暂无日程';
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
  onRetry,
  onCreateEvent,
  onPreviousMonth,
  onNextMonth,
  onToday,
  onCreateEventForDate,
  onOpenDate,
  onOpenEvent
}: CalendarWidgetProps) {
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const days = buildMonthGrid(year, monthIndex, new Date(`${todayIso}T00:00:00`)).map((day) => ({
    ...day,
    events: events.filter((event) => event.startAt.startsWith(day.isoDate))
  }));

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

  useEffect(() => cancelDateClick, []);

  return (
    <div className="calendar-card-content">
      <div className="card-header">
        <div className="heading-group">
          <h1>
            {year} 年 {monthIndex + 1} 月
          </h1>
          <p>{summaryFor(status, events.length)}</p>
        </div>
        <div className="toolbar-actions">
          <button type="button" className="btn btn-icon" aria-label="上一个月" onClick={onPreviousMonth}>
            <ChevronLeft aria-hidden="true" />
          </button>
          <button type="button" className="btn" onClick={onToday}>今天</button>
          <button type="button" className="btn btn-icon" aria-label="下一个月" onClick={onNextMonth}>
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
        <div className="weekdays">
          {weekdays.map((weekday) => <span key={weekday}>{weekday}</span>)}
        </div>
        <div className="calendar-grid">
          {days.map((day) => {
            const visibleEvents = day.events.slice(0, 3);
            const overflowCount = day.events.length - visibleEvents.length;
            return (
              <div
                key={day.isoDate}
                data-calendar-day
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
                <div className="day-events">
                  {visibleEvents.map((event) => (
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
                  {overflowCount > 0 ? (
                    <button
                      type="button"
                      className="event event-overflow"
                      onClick={() => {
                        cancelDateClick();
                        onOpenDate(day.isoDate);
                      }}
                    >
                      另有 {overflowCount} 个
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
