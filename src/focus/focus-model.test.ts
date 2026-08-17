import { describe, expect, it } from 'vitest';
import {
  completeFocus,
  focusedMilliseconds,
  initialFocusState,
  interruptFocus,
  isValidFocusMinutes,
  pauseFocus,
  remainingSeconds,
  resumeFocus,
  snapshotFocus,
  startFocus
} from './focus-model';

describe('focus duration validation', () => {
  it.each([
    [1, true],
    [720, true],
    [0, false],
    [721, false],
    [1.5, false],
    [Number.NaN, false]
  ])('validates %s minutes', (minutes, valid) => {
    expect(isValidFocusMinutes(minutes)).toBe(valid);
  });
});

describe('focus timer state machine', () => {
  it('starts a session and derives remaining time from the monotonic clock', () => {
    const state = startFocus(initialFocusState(25), {
      id: 'session-1',
      nowWallMs: Date.UTC(2026, 7, 14, 9),
      nowMonoMs: 100
    });

    expect(state.status).toBe('running');
    expect(state.sessionId).toBe('session-1');
    expect(state.startedAt).toBe('2026-08-14T09:00:00.000Z');
    expect(remainingSeconds(state, 1_100)).toBe(24 * 60 + 59);
  });

  it('excludes paused time and resumes from accumulated focus time', () => {
    let state = startFocus(initialFocusState(25), {
      id: 'session-1',
      nowWallMs: 1_000,
      nowMonoMs: 10
    });
    state = pauseFocus(state, 10_010);

    expect(focusedMilliseconds(state, 20_010)).toBe(10_000);

    state = resumeFocus(state, 20_010);
    expect(snapshotFocus(state, 25_010, 26_000).focusedSeconds).toBe(15);
  });

  it('keeps invalid and duplicate transitions unchanged', () => {
    const idle = initialFocusState(25);
    expect(pauseFocus(idle, 10)).toBe(idle);
    expect(resumeFocus(idle, 10)).toBe(idle);
    expect(completeFocus(idle, 10)).toBe(idle);

    const running = startFocus(idle, { id: 'session-1', nowWallMs: 1_000, nowMonoMs: 10 });
    expect(startFocus(running, { id: 'session-2', nowWallMs: 2_000, nowMonoMs: 20 })).toBe(running);
    expect(resumeFocus(running, 30)).toBe(running);
  });

  it('completes once and freezes the planned focus duration', () => {
    const running = startFocus(initialFocusState(1), {
      id: 'session-1',
      nowWallMs: 1_000,
      nowMonoMs: 10
    });
    const completed = completeFocus(running, 60_010);

    expect(completed.status).toBe('completed');
    expect(focusedMilliseconds(completed, 100_000)).toBe(60_000);
    expect(remainingSeconds(completed, 100_000)).toBe(0);
    expect(completeFocus(completed, 110_000)).toBe(completed);
  });

  it('creates an interrupted snapshot only after effective focus time', () => {
    const running = startFocus(initialFocusState(25), {
      id: 'session-1',
      nowWallMs: 1_000,
      nowMonoMs: 10
    });

    expect(interruptFocus(running, 10, 1_000).record).toBeNull();
    const interrupted = interruptFocus(running, 5_010, 6_000);
    expect(interrupted.record).toMatchObject({
      id: 'session-1',
      plannedSeconds: 1_500,
      focusedSeconds: 5,
      status: 'interrupted',
      startedAt: '1970-01-01T00:00:01.000Z',
      endedAt: '1970-01-01T00:00:06.000Z'
    });
    expect(interrupted.state.status).toBe('idle');
  });

  it('keeps focus state independent from presentation modes', () => {
    expect(initialFocusState(25)).toEqual({
      status: 'idle',
      sessionId: null,
      plannedSeconds: 1500,
      accumulatedMs: 0,
      runStartedMonoMs: null,
      startedAt: null
    });
  });
});
