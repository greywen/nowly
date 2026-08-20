import type { CalendarEvent, Recurrence, RecurrenceFreq, Weekday } from '../calendar/calendar-model';
import { t } from '../i18n';

export type RecurrencePreset = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom';

const WEEKDAYS: Weekday[] = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

/** 从本地朴素时间字符串取出星期，避免依赖时区解析。 */
export function weekdayOf(startAt: string): Weekday {
  const [year, month, day] = startAt.slice(0, 10).split('-').map(Number);
  const index = new Date(year, month - 1, day).getDay(); // 0 = 周日
  return WEEKDAYS[(index + 6) % 7];
}

/**
 * 渲染用的唯一 key。一次区间查询会返回多条 `id` 相同的实例（整个系列共用系列行
 * 的 id），所以列表 key、去重与查找都必须用它而不是 `id`。命令层始终使用结构化的
 * `{ id, occurrenceStartAt }`，绝不解析此串。
 */
export function occurrenceKey(event: CalendarEvent): string {
  if (!event.occurrenceStartAt) return event.id;
  return `${event.id}@${event.occurrenceStartAt}`;
}

export function presetToRecurrence(preset: RecurrencePreset, startAt: string): Recurrence | null {
  if (preset === 'none') return null;
  // 「自定义」只是展开细项的入口，不是独立数据形态：先给一条最常见的周规则做种子。
  const freq: RecurrenceFreq = preset === 'custom' ? 'weekly' : preset;
  return {
    freq,
    interval: 1,
    byDay: freq === 'weekly' ? [weekdayOf(startAt)] : [],
    end: { kind: 'never' }
  };
}

export function recurrenceToPreset(recurrence: Recurrence | null, startAt: string): RecurrencePreset {
  if (!recurrence) return 'none';
  if (recurrence.interval !== 1 || recurrence.end.kind !== 'never') return 'custom';
  if (recurrence.freq === 'weekly') {
    return recurrence.byDay.length === 1 && recurrence.byDay[0] === weekdayOf(startAt) ? 'weekly' : 'custom';
  }
  return recurrence.byDay.length === 0 ? recurrence.freq : 'custom';
}

export function validateRecurrence(recurrence: Recurrence | null, startAt: string): string | undefined {
  if (!recurrence) return undefined;
  if (!Number.isInteger(recurrence.interval) || recurrence.interval < 1) {
    return t('recurrence.errorInterval');
  }
  if (recurrence.freq === 'weekly' && recurrence.byDay.length === 0) {
    return t('recurrence.errorWeekday');
  }
  if (recurrence.end.kind === 'count' && (!Number.isInteger(recurrence.end.count) || recurrence.end.count < 1)) {
    return t('recurrence.errorCount');
  }
  if (recurrence.end.kind === 'until' && recurrence.end.date < startAt.slice(0, 10)) {
    return t('recurrence.errorUntil');
  }
  return undefined;
}
