import { describe, expect, it } from 'vitest';
import { buildMonthGrid, formatChineseDate } from './date';

describe('date helpers', () => {
  it('always builds a 6-week grid starting on Monday', () => {
    const july = buildMonthGrid(2026, 6);
    const august = buildMonthGrid(2026, 7);

    expect(july).toHaveLength(42);
    expect(july[0].isoDate).toBe('2026-06-29');
    expect(july[41].isoDate).toBe('2026-08-09');
    expect(august).toHaveLength(42);
  });

  it('starts the month grid on Sunday when configured', () => {
    // July 2026 starts on a Wednesday; a Sunday-first grid backfills to the
    // preceding Sunday (2026-06-28).
    const july = buildMonthGrid(2026, 6, new Date(2026, 6, 23), 'sunday');
    expect(july).toHaveLength(42);
    expect(july[0].isoDate).toBe('2026-06-28');
  });

  it('formats Chinese date text', () => {
    expect(formatChineseDate(new Date('2026-07-23T09:41:00'))).toBe('2026年7月23日 星期四');
  });
});
