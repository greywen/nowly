import type { HexColor } from '../lib/color';

export type SubscriptionStatus = 'ok' | 'failed';

export type CalendarSubscription = {
  id: string;
  name: string;
  url: string;
  color: HexColor;
  refreshIntervalMinutes: number;
  lastSyncedAt: string | null;
  lastStatus: SubscriptionStatus | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SubscriptionDraft = {
  name: string;
  url: string;
  color: HexColor;
  refreshIntervalMinutes: number;
};

import type { CalendarEvent, EventCategory } from './calendar-model';

export type ExternalEvent = {
  id: string;
  subscriptionId: string;
  title: string;
  startAt: string;
  endAt: string;
  startTz: string | null;
  endTz: string | null;
  allDay: boolean;
  location: string | null;
  description: string | null;
  color: HexColor;
};

// External subscription events reuse the calendar rendering pipeline, so map
// each into a read-only CalendarEvent. They carry no recurrence/link/reminder
// semantics; location and description are kept as dedicated fields for the
// read-only detail popup. `note` stays empty so nothing conflates the two.
export function externalToCalendarEvent(external: ExternalEvent): CalendarEvent {
  return {
    id: external.id,
    title: external.title,
    startAt: external.startAt,
    endAt: external.endAt,
    allDay: external.allDay,
    // Subscription events have a fixed source color, not a category color; use a
    // neutral category so category-based styling never fights the source color.
    category: 'personal' as EventCategory,
    color: external.color,
    linkedTaskId: null,
    note: '',
    reminders: [],
    createdAt: '',
    updatedAt: '',
    recurrence: null,
    startTz: external.startTz,
    endTz: external.endTz,
    rrule: null,
    seriesId: null,
    seriesStartAt: null,
    occurrenceStartAt: null,
    isOverridden: false,
    subscriptionId: external.subscriptionId,
    externalLocation: external.location,
    externalDescription: external.description
  };
}
