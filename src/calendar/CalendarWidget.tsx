import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { CalendarEvent } from './calendar-model';
import { buildMonthGrid } from '../lib/date';

const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const weekdays = ['一', '二', '三', '四', '五', '六', '日'];

const eventColorClass: Record<CalendarEvent['color'], string> = {
  blue: 'bg-sky-100 text-sky-600',
  red: 'bg-rose-50 text-rose-500',
  green: 'bg-emerald-50 text-emerald-500',
  yellow: 'bg-amber-50 text-amber-700'
};

type CalendarWidgetProps = {
  year: number;
  monthIndex: number;
  todayIso: string;
  events: CalendarEvent[];
  onOpenDate: (isoDate: string) => void;
  onOpenEvent: (event: CalendarEvent) => void;
};

export function CalendarWidget({ year, monthIndex, todayIso, events, onOpenDate, onOpenEvent }: CalendarWidgetProps) {
  const days = buildMonthGrid(year, monthIndex, new Date(`${todayIso}T00:00:00`)).map((day) => ({
    ...day,
    events: events.filter((event) => event.startAt.startsWith(day.isoDate))
  }));

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] p-3 xl:p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-[-0.02em] text-ink xl:text-3xl">{monthNames[monthIndex]} {year}</h1>
          <p className="mt-1 text-xs font-bold text-muted">日历主视图</p>
        </div>
        <div className="flex gap-2">
          <button aria-label="上一月" className="grid h-9 w-9 place-items-center rounded-xl bg-white/80 text-slate-700 shadow-sm ring-1 ring-slate-200/80"><ChevronLeft className="h-4 w-4" /></button>
          <button className="h-9 rounded-xl bg-brand px-3 text-sm font-black text-white shadow-sm">今天</button>
          <button aria-label="下一月" className="grid h-9 w-9 place-items-center rounded-xl bg-white/80 text-slate-700 shadow-sm ring-1 ring-slate-200/80"><ChevronRight className="h-4 w-4" /></button>
        </div>
      </div>
      <div className="grid min-h-0 grid-rows-[auto_repeat(5,minmax(0,1fr))] gap-1.5 xl:gap-2">
        <div className="grid grid-cols-7 gap-1.5 xl:gap-2">
          {weekdays.map((weekday) => <div key={weekday} className="text-center text-xs font-black text-muted">{weekday}</div>)}
        </div>
        {Array.from({ length: 5 }).map((_, weekIndex) => (
          <div key={weekIndex} className="grid min-h-0 grid-cols-7 gap-1.5 xl:gap-2">
            {days.slice(weekIndex * 7, weekIndex * 7 + 7).map((day) => (
              <button
                type="button"
                key={day.isoDate}
                onClick={() => onOpenDate(day.isoDate)}
                className={`min-h-0 overflow-hidden rounded-2xl border p-1.5 text-left ${day.isCurrentMonth ? 'border-slate-100 bg-white/60' : 'border-slate-100 bg-white/30 opacity-50'} ${day.isToday ? 'border-sky-300 bg-sky-50 ring-1 ring-sky-200' : ''}`}
              >
                <div className="flex items-center justify-between text-xs font-black text-slate-700">
                  <span>{day.dayOfMonth}</span>
                  {day.isToday ? <span className="h-1.5 w-1.5 rounded-full bg-brand" /> : null}
                </div>
                <div className="mt-1 grid gap-1 overflow-hidden">
                  {day.events.slice(0, 3).map((event) => (
                    <span
                      role="button"
                      tabIndex={0}
                      key={event.id}
                      onClick={(clickEvent) => {
                        clickEvent.stopPropagation();
                        onOpenEvent(event);
                      }}
                      className={`truncate rounded-lg px-1.5 py-0.5 text-[10px] font-black ${eventColorClass[event.color]}`}
                    >
                      {event.title}
                    </span>
                  ))}
                </div>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
