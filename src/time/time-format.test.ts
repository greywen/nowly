import { describe, expect, it } from 'vitest';
import { analogAngles, clockParts, formatClockTime, formatOffset, isValidTimeZone, timeZoneOptions } from './time-format';

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
    expect(formatClockTime(now, 'UTC', { hourCycle: 'h12', showSeconds: true })).toBe('1:05:09 PM');
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
