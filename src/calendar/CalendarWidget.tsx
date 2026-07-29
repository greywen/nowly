import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { CalendarEvent, EventColor } from './calendar-model';
import { buildMonthGrid } from '../lib/date';

const weekdays = ['一', '二', '三', '四', '五', '六', '日'];

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
  onOpenDate: (isoDate: string) => void;
  onOpenEvent: (event: CalendarEvent) => void;
};

function summaryFor(status: LoadStatus, count: number) {
  if (status === 'loading') return '正在读取本地日程';
  return count ? `本月 ${count} 个日程` : '本月暂无日程';
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
  onOpenDate,
  onOpenEvent
}: CalendarWidgetProps) {
  const days = buildMonthGrid(year, monthIndex, new Date(`${todayIso}T00:00:00`)).map((day) => ({
    ...day,
    events: events.filter((event) => event.startAt.startsWith(day.isoDate))
  }));

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
          <button type="button" className="btn btn-icon" aria-label="上一个月">
            <ChevronLeft aria-hidden="true" />
          </button>
          <button type="button" className="btn">今天</button>
          <button type="button" className="btn btn-icon" aria-label="下一个月">
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
          {weekdays.map((weekday) => (
            <span key={weekday}>{weekday}</span>
          ))}
        </div>
        <div className="calendar-grid">
          {days.map((day) => (
            <button
              type="button"
              key={day.isoDate}
              onClick={() => onOpenDate(day.isoDate)}
              className={`day${day.isCurrentMonth ? '' : ' outside'}${day.isToday ? ' today' : ''}`}
            >
              <span className="day-number">{day.dayOfMonth}</span>
              {day.events.slice(0, 3).map((event) => (
                <span
                  role="button"
                  tabIndex={0}
                  key={event.id}
                  onClick={(clickEvent) => {
                    clickEvent.stopPropagation();
                    onOpenEvent(event);
                  }}
                  className={`event ${eventToneClass[event.color]}`}
                >
                  {event.title}
                </span>
              ))}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
