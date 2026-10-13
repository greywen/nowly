import { describe, expect, it } from 'vitest';
import { computeClockLayout, computeDigitalFontSize } from './clock-layout';

describe('clock-layout', () => {
  it('fits full strings including seconds and day periods and respects manual limits', () => {
    const manual = { fontMode: 'manual' as const, fontSize: 96 };
    expect(computeDigitalFontSize(1000, 600, '11:59:59 PM', manual, 'horizontal')).toBeCloseTo(96 / 13);
    const fitted = computeDigitalFontSize(200, 120, '11:59:59 PM', manual, 'horizontal');
    expect(fitted * 13 * 11 * 0.75).toBeLessThanOrEqual(200);
    expect(computeDigitalFontSize(200, 120, '11:59:59 PM', manual, 'stacked')).toBeGreaterThan(fitted);
  });
  it('fits the complete 12-hour time with seconds at the selected font size', () => {
    const formats = [{ mode: 'digital' as const, hourCycle: 'h12' as const, showSeconds: true }];
    const layout = computeClockLayout({ width: 420, height: 260, count: 4, mode: 'digital', formats });
    expect(layout.columns).toBe(2);
    expect((420 - (layout.columns - 1) * 12) / layout.columns).toBeGreaterThanOrEqual(layout.minCellWidth);
    expect(layout.minCellWidth).toBeGreaterThan(96);
    const short = computeClockLayout({ width: 420, height: 80, count: 8, mode: 'digital', formats });
    expect(short.columns).toBe(2);
    expect(short.scroll).toBe(true);
    const narrow = computeClockLayout({ width: 96, height: 260, count: 1, mode: 'digital', formats });
    expect(narrow.scroll).toBe(true);
    expect(narrow.minCellWidth).toBeGreaterThan(96);
  });

  it('leaves a rounding guard for stacked glyph line boxes', () => {
    const font = computeDigitalFontSize(200, 179, '11:59:59 PM', { fontMode: 'manual', fontSize: 96 }, 'stacked');
    expect(font * 13 * 1.25 * 3).toBeLessThanOrEqual(177);
  });

  it('reserves taller rows for stacked digital strings', () => {
    const layout = computeClockLayout({ width: 180, height: 120, count: 4, mode: 'digital', formats: [{ mode: 'digital', hourCycle: 'h12', showSeconds: true, layout: 'stacked' }] });
    expect(layout.rowMinHeight).toBeGreaterThanOrEqual(116);
    expect(layout.scroll).toBe(true);
  });

  it('reserves analog labels and gaps before choosing a face size', () => {
    const layout = computeClockLayout({ width: 360, height: 100, count: 1, mode: 'analog', formats: [{ mode: 'analog', hourCycle: 'h23', showSeconds: false, showLabel: true }] });
    expect(layout.faceSize + 0.95 * 13 * 1.5 + 8).toBeLessThanOrEqual(100);
    expect(layout.rowMinHeight).toBeGreaterThanOrEqual(99);
  });

  it('includes mixed labels, time and gaps in its readable row height', () => {
    const layout = computeClockLayout({ width: 360, height: 116, count: 1, mode: 'mixed', formats: [{ mode: 'mixed', hourCycle: 'h23', showSeconds: false, showLabel: true, showDate: true, showDifference: true }] });
    expect(layout.scroll).toBe(true);
    expect(layout.faceSize).toBeGreaterThanOrEqual(72);
    expect(layout.rowMinHeight).toBeGreaterThan(116);
  });

  it('uses both width and height to choose readable columns', () => {
    expect(computeClockLayout({ width: 620, height: 360, count: 4, mode: 'mixed' })).toMatchObject({
      columns: 2,
      showOptionalInfo: true,
      scroll: false
    });
    expect(computeClockLayout({ width: 620, height: 150, count: 4, mode: 'mixed' })).toMatchObject({
      columns: 4,
      showOptionalInfo: false,
      scroll: false
    });
    expect(computeClockLayout({ width: 180, height: 420, count: 4, mode: 'analog' }).columns).toBe(1);
  });

  it('preserves minimum readable sizes and scrolls the module body instead of clipping', () => {
    const layout = computeClockLayout({ width: 140, height: 120, count: 6, mode: 'mixed' });
    expect(layout.scroll).toBe(true);
    expect(layout.fontSize).toBeGreaterThanOrEqual(0.85);
    expect(layout.faceSize).toBeGreaterThanOrEqual(72);
  });

  it('adapts per mode so digital clocks get text priority and analog clocks get face priority', () => {
    const digital = computeClockLayout({ width: 260, height: 130, count: 1, mode: 'digital' });
    const analog = computeClockLayout({ width: 260, height: 130, count: 1, mode: 'analog' });
    expect(digital.faceSize).toBe(0);
    expect(digital.fontSize).toBeGreaterThan(analog.fontSize);
    expect(analog.faceSize).toBeGreaterThanOrEqual(96);
  });

  it('keeps digital columns wide enough to read instead of overfitting by count', () => {
    const layout = computeClockLayout({ width: 240, height: 180, count: 4, mode: 'digital' });
    expect(layout.columns).toBe(2);
    expect(layout.rowMinHeight).toBeGreaterThanOrEqual(52);
    expect(layout.scroll).toBe(false);
  });

  it('marks short digital grids scrollable when readable rows exceed available height', () => {
    const layout = computeClockLayout({ width: 420, height: 80, count: 8, mode: 'digital' });
    expect(layout.columns).toBeGreaterThan(1);
    expect(layout.rowMinHeight).toBeGreaterThanOrEqual(52);
    expect(layout.scroll).toBe(true);
  });

  it('uses scrollable readable rows for compact mixed grids instead of shrinking faces into short tiles', () => {
    const layout = computeClockLayout({ width: 320, height: 120, count: 4, mode: 'mixed' });
    expect(layout.columns).toBe(2);
    expect(layout.rowMinHeight).toBeGreaterThanOrEqual(116);
    expect(layout.faceSize).toBeGreaterThanOrEqual(72);
    expect(layout.scroll).toBe(true);
  });
});
