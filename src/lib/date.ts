import type { CalendarDay } from '../calendar/calendar-model';

const weekdayNames = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

export function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatChineseDate(date: Date): string {
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${weekdayNames[date.getDay()]}`;
}

export type WeekStart = 'monday' | 'sunday';

export function buildMonthGrid(
  year: number,
  monthIndex: number,
  today = new Date(),
  weekStart: WeekStart = 'monday'
): CalendarDay[] {
  const first = new Date(year, monthIndex, 1);
  const startDow = weekStart === 'sunday' ? 0 : 1;
  const offset = (first.getDay() - startDow + 7) % 7;
  const start = new Date(year, monthIndex, 1 - offset);
  const result: CalendarDay[] = [];
  const todayIso = toIsoDate(today);

  for (let index = 0; index < 42; index += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    result.push({
      isoDate: toIsoDate(date),
      dayOfMonth: date.getDate(),
      isCurrentMonth: date.getMonth() === monthIndex,
      isToday: toIsoDate(date) === todayIso,
      events: []
    });
  }

  return result;
}
