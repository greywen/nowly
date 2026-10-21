import { afterEach, describe, expect, it } from 'vitest';
import { setLanguage } from '../i18n';
import { analogAngles, clockParts, formatClockDisplay, formatClockTime, formatOffset, isValidTimeZone, timeZoneOptions } from './time-format';

afterEach(() => setLanguage('zh'));

describe('time-format', () => {
  it('preserves non-hour and quarter-hour offsets for the same instant', () => {
    const now = new Date('2026-10-11T00:00:00Z');
    expect(clockParts(now, 'Asia/Shanghai')).toMatchObject({ hour: 8, minute: 0, second: 0 });
    expect(clockParts(now, 'Europe/London')).toMatchObject({ hour: 1, minute: 0, second: 0 });
    expect(clockParts(now, 'Asia/Kathmandu')).toMatchObject({ hour: 5, minute: 45, second: 0 });
  });

  it('handles cross-year conversion, DST and invalid zones explicitly', () => {
    expect(clockParts(new Date('2026-12-31T16:30:00Z'), 'Asia/Shanghai')).toMatchObject({
      year: 2027,
      month: 1,
      day: 1,
      hour: 0,
      minute: 30
    });
    expect(clockParts(new Date('2026-03-29T01:30:00Z'), 'Europe/London')).toMatchObject({ hour: 2, minute: 30 });
    expect(() => clockParts(new Date('2026-10-11T00:00:00Z'), 'Mars/Olympus')).toThrow(/Invalid time zone/);
    expect(isValidTimeZone('local')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
  });

  it('formats 12-hour and 24-hour readings without mixing location text into the primary time', () => {
    const now = new Date('2026-10-11T13:05:09Z');
    expect(formatClockTime(now, 'UTC', { hourCycle: 'h23', showSeconds: false })).toBe('13:05');
    expect(formatClockTime(now, 'UTC', { hourCycle: 'h12', showSeconds: true })).toBe('下午01:05:09');
  });

  it.each([
    ['02:02:00', '上午02:02'],
    ['02:10:00', '上午02:10'],
    ['11:02:00', '上午11:02'],
    ['00:02:00', '上午12:02'],
    ['12:02:00', '下午12:02'],
    ['14:02:00', '下午02:02']
  ])('pads twelve-hour readings at %s', (time, expected) => {
    expect(formatClockTime(new Date(`2026-10-21T${time}Z`), 'UTC', { hourCycle: 'h12', showSeconds: false })).toBe(expected);
  });

  it.each(['zh', 'en', 'fr', 'es', 'ar', 'ja', 'ko', 'zh-Hant'] as const)('pads twelve-hour digits without losing localization in %s', language => {
    setLanguage(language);
    const now = new Date('2026-10-21T02:02:09Z');
    const locale = new Intl.DateTimeFormat(language === 'zh-Hant' ? 'zh-TW' : language, {
      timeZone: 'UTC', calendar: 'gregory', hourCycle: 'h12', hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    expect(formatClockTime(now, 'UTC', { hourCycle: 'h12', showSeconds: true })).toBe(locale.format(now));
  });

  it.each(['zh', 'en', 'fr', 'es', 'ar', 'ja', 'ko', 'zh-Hant'] as const)('separates localized digits and periods in %s', language => {
    setLanguage(language);
    const now = new Date('2026-10-21T14:02:09Z');
    const display = formatClockDisplay(now, 'UTC', { hourCycle: 'h12', showSeconds: true });
    expect(display.time).toBe('02:02:09');
    expect(display.dayPeriod).not.toBe('');
    expect(display.time).not.toContain(display.dayPeriod);
    expect(display.accessibleTime).toBe(formatClockTime(now, 'UTC', { hourCycle: 'h12', showSeconds: true }));
    expect(formatClockDisplay(now, 'UTC', { hourCycle: 'h23', showSeconds: false })).toMatchObject({ time: '14:02', dayPeriod: '' });
  });

  it('computes analog angles and UTC offsets from the same instant', () => {
    expect(analogAngles({ hour: 3, minute: 30, second: 15 })).toEqual({ hour: 105, minute: 181.5, second: 90 });
    expect(formatOffset(new Date('2026-10-11T00:00:00Z'), 'Asia/Kathmandu')).toBe('UTC+05:45');
    expect(formatOffset(new Date('2026-10-11T00:00:00Z'), 'Europe/London')).toBe('UTC+01:00');
  });

  it('builds a searchable IANA zone list and keeps the selected custom zone available', () => {
    const options = timeZoneOptions('Pacific/Chatham');
    expect(options).toContainEqual(expect.objectContaining({ value: 'local', label: '本地' }));
    expect(options).toContainEqual(expect.objectContaining({ value: 'Pacific/Chatham' }));
    expect(options.some((option) => option.label.includes('Chatham'))).toBe(true);
  });
});
