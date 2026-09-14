import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CalendarEvent } from '../calendar/calendar-model';
import { externalToCalendarEvent, type ExternalEvent } from '../calendar/subscription-model';
import type { FocusStatus } from '../focus/focus-model';
import type { Task } from '../tasks/task-model';
import {
  deriveStatusIslandModel,
  type StatusIslandDisplayMode,
  type StatusIslandModel,
  type StatusIslandReminderState
} from '../app/status-island-model';

export type NativeStatusIslandSnapshot = {
  sampledAt: string;
  localDate?: string;
  events: CalendarEvent[];
  externalEvents: ExternalEvent[];
  tasks: Task[];
  focus: {
    status: FocusStatus;
    remainingSeconds: number;
    plannedSeconds?: number;
    sessionId: string | null;
    stageSequence?: number;
    stageChangedAt?: string | null;
  };
  // Reminder lifecycle comes from the native coordinator, which owns the store
  // file and is the single source of truth across the two windows.
  reminders?: StatusIslandReminderState[];
  // The user's notification setting, forwarded so the island window does not have
  // to read the database itself. Absent on an older backend, which the model
  // treats as `detail`.
  notificationDisplay?: StatusIslandDisplayMode;
  notificationMode?: 'persistent' | 'notification';
};

type SnapshotResource =
  | { status: 'loading'; data: NativeStatusIslandSnapshot | null; error: '' }
  | { status: 'ready'; data: NativeStatusIslandSnapshot; error: '' }
  | { status: 'error'; data: NativeStatusIslandSnapshot | null; error: string };

const emptyModel = deriveStatusIslandModel({
  now: new Date(),
  events: [],
  tasks: [],
  focus: { status: 'idle', remainingSeconds: 0 },
  loading: true
});
const errorModel = deriveStatusIslandModel({
  now: new Date(),
  events: [],
  tasks: [],
  focus: { status: 'idle', remainingSeconds: 0 }
});

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === 'string' ? error : '状态读取失败';
}

export function useStatusIslandSnapshot(): {
  model: StatusIslandModel;
  status: SnapshotResource['status'];
  error: string;
  refresh: () => Promise<void>;
  notificationMode: 'persistent' | 'notification';
} {
  const [resource, setResource] = useState<SnapshotResource>({ status: 'loading', data: null, error: '' });
  const [now, setNow] = useState(() => new Date());
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    try {
      const data = await invoke<NativeStatusIslandSnapshot>('get_status_island_snapshot');
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      setResource({ status: 'ready', data, error: '' });
    } catch (error) {
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      setResource(current => ({ status: 'error', data: current.data, error: errorMessage(error) }));
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    const refreshTimer = window.setInterval(() => void refresh(), 15_000);
    const clockTimer = window.setInterval(() => setNow(new Date()), 1_000);
    let disposed = false;
    const removers: Array<() => void> = [];
    const keep = (remove: () => void) => disposed ? remove() : removers.push(remove);
    void listen('status-island-invalidated', () => void refresh()).then(keep);
    // Sleep/wake, tray restore and timezone changes all reappear as a resumed
    // document. Everything is recomputed from the current local wall clock.
    const refreshOnResume = () => {
      setNow(new Date());
      void refresh();
    };
    window.addEventListener('pageshow', refreshOnResume);
    document.addEventListener('visibilitychange', refreshOnResume);
    return () => {
      disposed = true;
      mountedRef.current = false;
      requestIdRef.current += 1;
      removers.forEach(remove => remove());
      window.clearInterval(refreshTimer);
      window.clearInterval(clockTimer);
      window.removeEventListener('pageshow', refreshOnResume);
      document.removeEventListener('visibilitychange', refreshOnResume);
    };
  }, [refresh]);

  const model = useMemo(() => {
    if (!resource.data) return resource.status === 'loading' ? emptyModel : errorModel;
    const sampledAt = new Date(resource.data.sampledAt).getTime();
    const elapsedSeconds = resource.data.focus.status === 'running' && Number.isFinite(sampledAt)
      ? Math.max(0, Math.floor((now.getTime() - sampledAt) / 1000))
      : 0;
    const remainingSeconds = Math.max(0, resource.data.focus.remainingSeconds - elapsedSeconds);
    return deriveStatusIslandModel({
      now,
      events: [...resource.data.events, ...resource.data.externalEvents.map(externalToCalendarEvent)],
      tasks: resource.data.tasks,
      focus: {
        ...resource.data.focus,
        status: resource.data.focus.status === 'running' && remainingSeconds === 0
          ? 'completed'
          : resource.data.focus.status,
        remainingSeconds
      },
      reminderStates: resource.data.reminders ?? [],
      displayMode: resource.data.notificationDisplay ?? 'detail'
    });
  }, [now, resource.data, resource.status]);

  return { model, status: resource.status, error: resource.error, refresh, notificationMode: resource.data?.notificationMode ?? 'persistent' };
}
