export type FocusStatus = 'idle' | 'running' | 'paused' | 'completed';

export type FocusSessionRecord = {
  id: string;
  plannedSeconds: number;
  focusedSeconds: number;
  status: 'completed' | 'interrupted';
  startedAt: string;
  endedAt: string;
  createdAt: string;
};

export type FocusState = {
  status: FocusStatus;
  sessionId: string | null;
  plannedSeconds: number;
  accumulatedMs: number;
  runStartedMonoMs: number | null;
  startedAt: string | null;
};

type StartFocusInput = {
  id: string;
  nowWallMs: number;
  nowMonoMs: number;
};

export function isValidFocusMinutes(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 720;
}

export function initialFocusState(minutes: number): FocusState {
  if (!isValidFocusMinutes(minutes)) throw new RangeError('Focus duration must be between 1 and 720 minutes.');
  return {
    status: 'idle',
    sessionId: null,
    plannedSeconds: minutes * 60,
    accumulatedMs: 0,
    runStartedMonoMs: null,
    startedAt: null
  };
}

export function startFocus(state: FocusState, input: StartFocusInput): FocusState {
  if (state.status !== 'idle') return state;
  return {
    ...state,
    status: 'running',
    sessionId: input.id,
    accumulatedMs: 0,
    runStartedMonoMs: input.nowMonoMs,
    startedAt: new Date(input.nowWallMs).toISOString()
  };
}

export function focusedMilliseconds(state: FocusState, nowMonoMs: number): number {
  const currentRun = state.status === 'running' && state.runStartedMonoMs !== null
    ? Math.max(0, nowMonoMs - state.runStartedMonoMs)
    : 0;
  return Math.min(state.plannedSeconds * 1_000, state.accumulatedMs + currentRun);
}

export function remainingSeconds(state: FocusState, nowMonoMs: number): number {
  return Math.max(0, Math.ceil((state.plannedSeconds * 1_000 - focusedMilliseconds(state, nowMonoMs)) / 1_000));
}

export function pauseFocus(state: FocusState, nowMonoMs: number): FocusState {
  if (state.status !== 'running') return state;
  return {
    ...state,
    status: 'paused',
    accumulatedMs: focusedMilliseconds(state, nowMonoMs),
    runStartedMonoMs: null
  };
}

export function resumeFocus(state: FocusState, nowMonoMs: number): FocusState {
  if (state.status !== 'paused') return state;
  return { ...state, status: 'running', runStartedMonoMs: nowMonoMs };
}

export function completeFocus(state: FocusState, nowMonoMs: number): FocusState {
  if (state.status !== 'running') return state;
  return {
    ...state,
    status: 'completed',
    accumulatedMs: state.plannedSeconds * 1_000,
    runStartedMonoMs: null
  };
}

export function snapshotFocus(
  state: FocusState,
  nowMonoMs: number,
  endedWallMs: number
): FocusSessionRecord {
  if (!state.sessionId || !state.startedAt) throw new Error('An active focus session is required.');
  const status = state.status === 'completed' ? 'completed' : 'interrupted';
  return {
    id: state.sessionId,
    plannedSeconds: state.plannedSeconds,
    focusedSeconds: Math.floor(focusedMilliseconds(state, nowMonoMs) / 1_000),
    status,
    startedAt: state.startedAt,
    endedAt: new Date(endedWallMs).toISOString(),
    createdAt: new Date(endedWallMs).toISOString()
  };
}

export function interruptFocus(
  state: FocusState,
  nowMonoMs: number,
  endedWallMs: number
): { state: FocusState; record: FocusSessionRecord | null } {
  if (state.status !== 'running' && state.status !== 'paused') return { state, record: null };
  const focusedSeconds = Math.floor(focusedMilliseconds(state, nowMonoMs) / 1_000);
  const record = focusedSeconds > 0 ? snapshotFocus(state, nowMonoMs, endedWallMs) : null;
  return { state: initialFocusState(state.plannedSeconds / 60), record };
}
