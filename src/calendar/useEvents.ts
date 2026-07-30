import { useCallback, useEffect, useRef, useState } from 'react';
import { useNowlyRepository } from '../data/RepositoryContext';
import type { CalendarEvent, EventDraft, EventRange } from './calendar-model';

type EventsResource =
  | { status: 'loading'; data: CalendarEvent[] }
  | { status: 'ready'; data: CalendarEvent[] }
  | { status: 'error'; data: CalendarEvent[]; message: string };

type VisibleMonth = { year: number; monthIndex: number };

function pad(value: number) {
  return String(value).padStart(2, '0');
}

export function monthRange(year: number, monthIndex: number): EventRange {
  const nextMonth = new Date(year, monthIndex + 1, 1);
  return {
    startAt: `${year}-${pad(monthIndex + 1)}-01T00:00`,
    endAtExclusive: `${nextMonth.getFullYear()}-${pad(nextMonth.getMonth() + 1)}-01T00:00`
  };
}

function messageFrom(error: unknown) {
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return '无法读取本地日程，请重试。';
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
  const [visibleMonth, setVisibleMonth] = useState<VisibleMonth>({
    year: initialDateRef.current.getFullYear(),
    monthIndex: initialDateRef.current.getMonth()
  });
  const [events, setEvents] = useState<EventsResource>({ status: 'loading', data: [] });
  const requestIdRef = useRef(0);

  const loadEvents = useCallback(
    async (month = visibleMonth) => {
      const requestId = ++requestIdRef.current;
      setEvents({ status: 'loading', data: [] });
      try {
        const data = await repository.listEventsInRange(monthRange(month.year, month.monthIndex));
        if (requestId === requestIdRef.current) setEvents({ status: 'ready', data });
      } catch (error) {
        if (requestId === requestIdRef.current) {
          setEvents({ status: 'error', data: [], message: messageFrom(error) });
        }
      }
    },
    [repository, visibleMonth]
  );

  useEffect(() => {
    void loadEvents(visibleMonth);
  }, [loadEvents, visibleMonth]);

  const showMonth = useCallback((next: VisibleMonth) => {
    requestIdRef.current += 1;
    setEvents({ status: 'loading', data: [] });
    setVisibleMonth(next);
  }, []);

  const goToPreviousMonth = useCallback(() => {
    const date = new Date(visibleMonth.year, visibleMonth.monthIndex - 1, 1);
    showMonth({ year: date.getFullYear(), monthIndex: date.getMonth() });
  }, [showMonth, visibleMonth]);

  const goToNextMonth = useCallback(() => {
    const date = new Date(visibleMonth.year, visibleMonth.monthIndex + 1, 1);
    showMonth({ year: date.getFullYear(), monthIndex: date.getMonth() });
  }, [showMonth, visibleMonth]);

  const goToToday = useCallback(() => {
    const date = now();
    showMonth({ year: date.getFullYear(), monthIndex: date.getMonth() });
  }, [now, showMonth]);

  const goToMonthContaining = useCallback(
    (isoDate: string) => {
      const [year, month] = isoDate.split('-').map(Number);
      showMonth({ year, monthIndex: month - 1 });
    },
    [showMonth]
  );

  const refreshAfterWrite = useCallback(
    async (refreshTasks: boolean) => {
      await loadEvents(visibleMonth);
      if (refreshTasks) await onRefreshTasks();
    },
    [loadEvents, onRefreshTasks, visibleMonth]
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

  return {
    year: visibleMonth.year,
    monthIndex: visibleMonth.monthIndex,
    events,
    retryEvents: () => loadEvents(visibleMonth),
    goToPreviousMonth,
    goToNextMonth,
    goToToday,
    goToMonthContaining,
    createEvent,
    updateEvent,
    deleteEvent
  };
}
