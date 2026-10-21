import { afterEach, expect, it } from 'vitest';
import { setLanguage } from './store';
import { monthTitle, dayTitle, listDateLabel } from '../calendar/calendar-view';
import { formatChineseDate } from '../lib/date';
import { clockParts, formatClockDate, formatClockTime, formatDifference, timeZoneOptions } from '../time/time-format';

afterEach(() => setLanguage('zh'));

it.each([
  ['fr', 'fr-FR'], ['es', 'es-ES'], ['ar', 'ar'], ['ja', 'ja-JP'], ['ko', 'ko-KR'], ['zh-Hant', 'zh-TW']
] as const)('formats calendar and clock dates in %s', (language, locale) => {
  setLanguage(language);
  const date = new Date(2026, 9, 21, 13, 24, 35);
  expect(monthTitle(2026, 9)).toBe(new Intl.DateTimeFormat(locale, { calendar: 'gregory', month: 'long', year: 'numeric' }).format(date));
  expect(formatChineseDate(date)).toBe(new Intl.DateTimeFormat(locale, { calendar: 'gregory', dateStyle: 'full' }).format(date));
  expect(dayTitle(date)).toContain(new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date));
  expect(listDateLabel('2026-10-21')).toContain(new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date));
  expect(formatClockDate(date, 'UTC')).toBe(new Intl.DateTimeFormat(locale, { timeZone: 'UTC', calendar: 'gregory', month: 'short', day: 'numeric', weekday: 'short' }).format(date));
});

it('does not change machine-readable dates or clock parts in Arabic', () => {
  setLanguage('ar');
  expect(monthTitle(2026, 9, 'iso')).toBe('2026-10');
  expect(clockParts(new Date('2026-10-21T13:24:35Z'), 'UTC')).toEqual({ year: 2026, month: 10, day: 21, hour: 13, minute: 24, second: 35 });
});

it('does not reuse a display formatter from a previous language', () => {
  const date = new Date('2026-10-21T13:24:35Z');
  setLanguage('en');
  const en = formatClockTime(date, 'UTC', { hourCycle: 'h12', showSeconds: false });
  setLanguage('ar');
  const ar = formatClockTime(date, 'UTC', { hourCycle: 'h12', showSeconds: false });
  expect(ar).not.toBe(en);
  expect(ar).toBe(new Intl.DateTimeFormat('ar', { timeZone: 'UTC', calendar: 'gregory', hourCycle: 'h12', hour: '2-digit', minute: '2-digit' }).format(date));
});

it('localizes city names and offset labels without exposing Chinese', () => {
  setLanguage('en');
  expect(timeZoneOptions().find(option => option.value === 'Asia/Tokyo')?.label).toBe('Tokyo');
  expect(formatDifference(new Date('2026-10-21T00:00:00Z'), 'Asia/Tokyo', 'UTC')).toBe('+9 h');
});
