import { useCallback, useEffect, useRef, useState } from 'react';
import { useNowlyRepository } from '../data/RepositoryContext';
import type { WeekStart } from '../lib/date';
import type { CalendarEvent, CalendarView, EditScope, EventDraft, EventTarget } from './calendar-model';
import { monthRange, rangeFor, resizeEventEndToDate, shiftEventToDate, shiftEventToHour } from './calendar-view';
import { externalToCalendarEvent } from './subscription-model';
import { t } from '../i18n';

type EventsResource =
  | { status: 'loading'; data: CalendarEvent[] }
  | { status: 'ready'; data: CalendarEvent[] }
  | { status: 'error'; data: CalendarEvent[]; message: string };

type ViewState = { view: CalendarView; anchor: Date };

export { monthRange };

// The chosen calendar layout is a local look preference, so it is stored next
// to the other UI preferences (notes view, blur, onboarding) instead of the
// database. Restored on open; defaults to month when absent or invalid.
export const CALENDAR_VIEW_STORAGE_KEY = 'nowly:calendar-view';
const DEFAULT_CALENDAR_VIEW: CalendarView = 'month';

function isCalendarView(value: unknown): value is CalendarView {
  return value === 'month' || value === 'week' || value === 'day' || value === 'list';
}

function readStoredView(): CalendarView {
  try {
    const raw = localStorage.getItem(CALENDAR_VIEW_STORAGE_KEY);
    return isCalendarView(raw) ? raw : DEFAULT_CALENDAR_VIEW;
  } catch {
    return DEFAULT_CALENDAR_VIEW;
  }
}

function messageFrom(error: unknown) {
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return t('calendar.readError');
}

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function isoOf(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// The command layer identifies an instance structurally; `occurrenceKey` is a
// render-only key and is never sent back.
function targetOf(event: CalendarEvent): EventTarget {
  return { id: event.id, occurrenceStartAt: event.occurrenceStartAt };
}

// Dragging moves the instance the user grabbed, not the series behind it.
// Single events have no slot, so the whole-series scope is their only legal one.
function dragScope(event: CalendarEvent): EditScope {
  return event.occurrenceStartAt === null ? 'all' : 'occurrence';
}

function remoteIdentity(event: CalendarEvent): { subscriptionId: string; remoteEventId: string } | null {
  if (!event.subscriptionId || !event.externalWritable || !event.remoteEventId) return null;
  return { subscriptionId: event.subscriptionId, remoteEventId: event.remoteEventId };
}

function unsupportedRemoteWrite(): never {
  throw new Error(t('calendar.remoteWriteUnsupported'));
}

export function useEvents({
  now = () => new Date(),
  weekStart = 'monday'
}: {
  now?: () => Date;
  weekStart?: WeekStart;
}) {
  const repository = useNowlyRepository();
  const initialDateRef = useRef(now());
  const [state, setState] = useState<ViewState>({
    view: readStoredView(),
    anchor: new Date(
      initialDateRef.current.getFullYear(),
      initialDateRef.current.getMonth(),
      initialDateRef.current.getDate()
    )
  });
  const [events, setEvents] = useState<EventsResource>({ status: 'loading', data: [] });
  const requestIdRef = useRef(0);

  const loadEvents = useCallback(
    async (target = state, { silent = false } = {}) => {
      const requestId = ++requestIdRef.current;
      // A silent reload (after a write) keeps the current data on screen so the
      // shared summary, matrix, and calendar do not flash empty and shift.
      if (!silent) setEvents({ status: 'loading', data: [] });
      try {
        const targetRange = rangeFor(target.view, target.anchor, weekStart);
        const [local, external] = await Promise.all([
          repository.listEventsInRange(targetRange),
          repository.listExternalEventsInRange(targetRange).catch(() => [])
        ]);
        const merged = [...local, ...external.map(externalToCalendarEvent)];
        if (requestId === requestIdRef.current) setEvents({ status: 'ready', data: merged });
      } catch (error) {
        if (requestId === requestIdRef.current) {
          setEvents({ status: 'error', data: [], message: messageFrom(error) });
        }
      }
    },
    [repository, state, weekStart]
  );

  useEffect(() => {
    void loadEvents(state);
  }, [loadEvents, state]);

  const goToPreviousMonth = useCallback(() => {
    setState((current) => {
      const date = new Date(current.anchor.getFullYear(), current.anchor.getMonth() - 1, 1);
      requestIdRef.current += 1;
      setEvents({ status: 'loading', data: [] });
      return { view: current.view, anchor: date };
    });
  }, []);

  const goToNextMonth = useCallback(() => {
    setState((current) => {
      const date = new Date(current.anchor.getFullYear(), current.anchor.getMonth() + 1, 1);
      requestIdRef.current += 1;
      setEvents({ status: 'loading', data: [] });
      return { view: current.view, anchor: date };
    });
  }, []);

  const goToToday = useCallback(() => {
    const date = now();
    setState((current) => {
      requestIdRef.current += 1;
      setEvents({ status: 'loading', data: [] });
      return { view: current.view, anchor: new Date(date.getFullYear(), date.getMonth(), date.getDate()) };
    });
  }, [now]);

  const goToMonthContaining = useCallback(
    (isoDate: string) => {
      const [year, month] = isoDate.split('-').map(Number);
      setState((current) => {
        requestIdRef.current += 1;
        setEvents({ status: 'loading', data: [] });
        return { view: current.view, anchor: new Date(year, month - 1, 1) };
      });
    },
    []
  );

  const goToPrevious = useCallback(() => {
    setState((current) => {
      requestIdRef.current += 1;
      setEvents({ status: 'loading', data: [] });
      const { view, anchor } = current;
      if (view === 'week') {
        return { view, anchor: new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() - 7) };
      }
      if (view === 'day') {
        return { view, anchor: new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() - 1) };
      }
      return { view, anchor: new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1) };
    });
  }, []);

  const goToNext = useCallback(() => {
    setState((current) => {
      requestIdRef.current += 1;
      setEvents({ status: 'loading', data: [] });
      const { view, anchor } = current;
      if (view === 'week') {
        return { view, anchor: new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + 7) };
      }
      if (view === 'day') {
        return { view, anchor: new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + 1) };
      }
      return { view, anchor: new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1) };
    });
  }, []);

  const setView = useCallback((view: CalendarView) => {
    try {
      localStorage.setItem(CALENDAR_VIEW_STORAGE_KEY, view);
    } catch {
      /* persistence is best-effort; the live view still applies */
    }
    setState((current) => {
      if (current.view === view) return current;
      requestIdRef.current += 1;
      setEvents({ status: 'loading', data: [] });
      return { view, anchor: current.anchor };
    });
  }, []);

  const refreshAfterWrite = useCallback(
    async () => {
      // Silent reload keeps the current events on screen so shared consumers
      // (today summary, calendar) don't flash empty during a write.
      await loadEvents(state, { silent: true });
    },
    [loadEvents, state]
  );

  const createEvent = useCallback(
    async (draft: EventDraft, subscriptionId: string | null = null) => {
      if (subscriptionId) {
        if (!repository.createRemoteEvent) unsupportedRemoteWrite();
        await repository.createRemoteEvent(subscriptionId, { ...draft, recurrence: null });
        await refreshAfterWrite();
        return undefined;
      }
      const created = await repository.createEvent(draft);
      await refreshAfterWrite();
      return created;
    },
    [refreshAfterWrite, repository]
  );

  const updateEvent = useCallback(
    async (event: CalendarEvent, draft: EventDraft, scope: EditScope) => {
      const remote = remoteIdentity(event);
      if (remote) {
        if (!repository.updateRemoteEvent) unsupportedRemoteWrite();
        await repository.updateRemoteEvent(
          remote.subscriptionId,
          remote.remoteEventId,
          { ...draft, recurrence: null },
          draft.note !== (event.externalDescription ?? '')
        );
      }
      else await repository.updateEvent(targetOf(event), draft, scope);
      await refreshAfterWrite();
    },
    [refreshAfterWrite, repository]
  );

  const deleteEvent = useCallback(
    async (event: CalendarEvent, scope: EditScope) => {
      const remote = remoteIdentity(event);
      if (remote) {
        if (!repository.deleteRemoteEvent) unsupportedRemoteWrite();
        await repository.deleteRemoteEvent(remote.subscriptionId, remote.remoteEventId);
      }
      else await repository.deleteEvent(targetOf(event), scope);
      await refreshAfterWrite();
    },
    [refreshAfterWrite, repository]
  );

  const moveEvent = useCallback(
    async (event: CalendarEvent, isoDate: string) => {
      if (event.startAt.slice(0, 10) === isoDate) return;
      const draft = shiftEventToDate(event, isoDate);
      const remote = remoteIdentity(event);
      if (remote) {
        if (!repository.updateRemoteEvent) unsupportedRemoteWrite();
        await repository.updateRemoteEvent(remote.subscriptionId, remote.remoteEventId, { ...draft, recurrence: null }, false);
      }
      else await repository.updateEvent(targetOf(event), draft, dragScope(event));
      const [targetYear, targetMonth] = isoDate.split('-').map(Number);
      const outsideVisibleMonth =
        state.view === 'month' &&
        (targetYear !== state.anchor.getFullYear() || targetMonth - 1 !== state.anchor.getMonth());
      if (outsideVisibleMonth) {
        // The dropped date belongs to an adjacent month (an outside grid day),
        // so jump to that month; the effect reloads its range and keeps the
        // moved event visible instead of dropping out of the current range.
        requestIdRef.current += 1;
        setEvents({ status: 'loading', data: [] });
        setState({ view: 'month', anchor: new Date(targetYear, targetMonth - 1, 1) });
      } else {
        await refreshAfterWrite();
      }
    },
    [refreshAfterWrite, repository, state]
  );

  const moveEventToHour = useCallback(
    async (event: CalendarEvent, isoDate: string, startHour: number) => {
      if (event.allDay) return;
      const draft = shiftEventToHour(event, isoDate, startHour);
      if (draft.startAt === event.startAt.slice(0, 16) && draft.endAt === event.endAt.slice(0, 16)) {
        return;
      }
      const remote = remoteIdentity(event);
      if (remote) {
        if (!repository.updateRemoteEvent) unsupportedRemoteWrite();
        await repository.updateRemoteEvent(remote.subscriptionId, remote.remoteEventId, { ...draft, recurrence: null }, false);
      }
      else await repository.updateEvent(targetOf(event), draft, dragScope(event));
      await refreshAfterWrite();
    },
    [refreshAfterWrite, repository]
  );

  const resizeEvent = useCallback(
    async (event: CalendarEvent, endIsoDate: string) => {
      // Stretch or shrink the event so it ends on the dropped day; the end date
      // is clamped so it never lands before the start date.
      const endDate = endIsoDate < event.startAt.slice(0, 10) ? event.startAt.slice(0, 10) : endIsoDate;
      if (endDate === event.endAt.slice(0, 10)) return;
      const draft = resizeEventEndToDate(event, endDate);
      const remote = remoteIdentity(event);
      if (remote) {
        if (!repository.updateRemoteEvent) unsupportedRemoteWrite();
        await repository.updateRemoteEvent(remote.subscriptionId, remote.remoteEventId, { ...draft, recurrence: null }, false);
      }
      else await repository.updateEvent(targetOf(event), draft, dragScope(event));
      await refreshAfterWrite();
    },
    [refreshAfterWrite, repository]
  );

  return {
    view: state.view,
    anchorIso: isoOf(state.anchor),
    year: state.anchor.getFullYear(),
    monthIndex: state.anchor.getMonth(),
    events,
    retryEvents: () => loadEvents(state),
    setView,
    goToPrevious,
    goToNext,
    goToPreviousMonth,
    goToNextMonth,
    goToToday,
    goToMonthContaining,
    createEvent,
    updateEvent,
    deleteEvent,
    moveEvent,
    moveEventToHour,
    resizeEvent
  };
}
