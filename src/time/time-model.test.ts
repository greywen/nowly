import { describe, expect, it } from 'vitest';
import { defaultWorldClock, normalizeTimeSettings } from './time-model';

describe('time-model visual settings', () => {
  it('normalizes visual layout and manual font settings while preserving legacy clocks', () => {
    const [clock] = normalizeTimeSettings({ clocks: [{ ...defaultWorldClock(), id: 'legacy' }] }).clocks;
    expect(clock.layout).toBe('horizontal');
    expect(clock.fontMode).toBe('auto');
    expect(clock.fontSize).toBe(96);
  });

  it('clamps manual font sizes to the approved range', () => {
    const [clock] = normalizeTimeSettings({ clocks: [{ ...defaultWorldClock(), fontMode: 'manual', fontSize: 999 }] }).clocks;
    expect(clock.fontSize).toBe(160);
  });
});
