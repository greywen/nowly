import { useCallback, useEffect, useRef, useState } from 'react';
import { useNowlyRepository } from '../data/RepositoryContext';
import type { CalendarEvent, CalendarView, EventDraft } from './calendar-model';
import { monthRange, rangeFor, resizeEventEndToDate, shiftEventToDate, shiftEventToHour } from './calendar-view';

type EventsResource =
  | { status: 'loading'; data: CalendarEvent[] }
  | { status: 'ready'; data: CalendarEvent[] }
  | { status: 'error'; data: CalendarEvent[]; message: string };

type ViewState = { view: CalendarView; anchor: Date };

export { monthRange };

function messageFrom(error: unknown) {
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return '无法读取本地日程，请重试。';
}

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function isoOf(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function useEvents({
  now = () => new Date(),
  onRefreshTasks
}: {
  now?: () => Date;
  onRefreshTasks: () => Promise<unknown>;
}) {
  const repository = useNowlyRepository();
  const initialDateRef = useRef(now());
  const [state, setState] = useState<ViewState>({
    view: 'month',
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
        const data = await repository.listEventsInRange(rangeFor(target.view, target.anchor));
        if (requestId === requestIdRef.current) setEvents({ status: 'ready', data });
      } catch (error) {
        if (requestId === requestIdRef.current) {
          setEvents({ status: 'error', data: [], message: messageFrom(error) });
        }
      }
    },
    [repository, state]
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
    setState((current) => {
      if (current.view === view) return current;
      requestIdRef.current += 1;
      setEvents({ status: 'loading', data: [] });
      return { view, anchor: current.anchor };
    });
  }, []);

  const refreshAfterWrite = useCallback(
    async (refreshTasks: boolean) => {
      // Silent reload keeps the current events on screen so shared consumers
      // (matrix, today summary, calendar) don't flash empty during a write.
      await loadEvents(state, { silent: true });
      if (refreshTasks) await onRefreshTasks();
    },
    [loadEvents, onRefreshTasks, state]
  );

  const createEvent = useCallback(
    async (draft: EventDraft) => {
      const created = await repository.createEvent(draft);
      await refreshAfterWrite(created.linkedTaskId !== null || draft.linkedTaskId !== null);
      return created;
    },
    [refreshAfterWrite, repository]
  );

  const updateEvent = useCallback(
    async (event: CalendarEvent, draft: EventDraft) => {
      const updated = await repository.updateEvent(event.id, draft);
      await refreshAfterWrite(event.linkedTaskId !== null || updated.linkedTaskId !== null);
      return updated;
    },
    [refreshAfterWrite, repository]
  );

  const deleteEvent = useCallback(
    async (event: CalendarEvent) => {
      await repository.deleteEvent(event.id);
      await refreshAfterWrite(event.linkedTaskId !== null);
    },
    [refreshAfterWrite, repository]
  );

  const moveEvent = useCallback(
    async (event: CalendarEvent, isoDate: string) => {
      if (event.startAt.slice(0, 10) === isoDate) return event;
      const updated = await repository.updateEvent(event.id, shiftEventToDate(event, isoDate));
      const refreshTasks = event.linkedTaskId !== null || updated.linkedTaskId !== null;
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
        if (refreshTasks) await onRefreshTasks();
      } else {
        await refreshAfterWrite(refreshTasks);
      }
      return updated;
    },
    [onRefreshTasks, refreshAfterWrite, repository, state]
  );

  const moveEventToHour = useCallback(
    async (event: CalendarEvent, isoDate: string, startHour: number) => {
      if (event.allDay) return event;
      const draft = shiftEventToHour(event, isoDate, startHour);
      if (draft.startAt === event.startAt.slice(0, 16) && draft.endAt === event.endAt.slice(0, 16)) {
        return event;
      }
      const updated = await repository.updateEvent(event.id, draft);
      await refreshAfterWrite(event.linkedTaskId !== null || updated.linkedTaskId !== null);
      return updated;
    },
    [refreshAfterWrite, repository]
  );

  const resizeEvent = useCallback(
    async (event: CalendarEvent, endIsoDate: string) => {
      // Stretch or shrink the event so it ends on the dropped day; the end date
      // is clamped so it never lands before the start date.
      const endDate = endIsoDate < event.startAt.slice(0, 10) ? event.startAt.slice(0, 10) : endIsoDate;
      if (endDate === event.endAt.slice(0, 10)) return event;
      const updated = await repository.updateEvent(event.id, resizeEventEndToDate(event, endDate));
      await refreshAfterWrite(event.linkedTaskId !== null || updated.linkedTaskId !== null);
      return updated;
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
