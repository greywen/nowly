import { describe, expect, it } from 'vitest';
import { buildMonthGrid, formatChineseDate } from './date';

describe('date helpers', () => {
  it('builds a 5-week July 2026 grid starting on Monday June 29', () => {
    const days = buildMonthGrid(2026, 6);

    expect(days).toHaveLength(35);
    expect(days[0].isoDate).toBe('2026-06-29');
    expect(days[34].isoDate).toBe('2026-08-02');
  });

  it('formats Chinese date text', () => {
    expect(formatChineseDate(new Date('2026-07-23T09:41:00'))).toBe('2026年7月23日 星期四');
  });
});
