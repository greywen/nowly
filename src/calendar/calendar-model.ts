import { type HexColor } from '../lib/color';

// A category is a user-defined record owning a name and a color. Choosing a
// category is the single act that colors an event or subscription: "category"
// and "color" are one concept. There are no default categories. An event's
// category is the chosen category id, or '' when nothing is selected (which
// means no color either).
export type EventCategory = string;
export type EventColor = HexColor;
export type CalendarView = 'month' | 'week' | 'day' | 'list';

export type Category = {
  id: string;
  name: string;
  color: HexColor;
  position: number;
  createdAt: string;
  updatedAt: string;
};

export type CategoryDraft = {
  name: string;
  color: HexColor;
};

// Resolve a category id to its display name using the loaded category list.
// Returns '' for the unselected/unknown case so callers can treat it as "none".
export function categoryNameOf(categoryId: EventCategory, categories: readonly Category[]): string {
  if (!categoryId) return '';
  return categories.find((category) => category.id === categoryId)?.name ?? '';
}

export type Weekday = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU';
export type RecurrenceFreq = 'daily' | 'weekly' | 'monthly' | 'yearly';

export type RecurrenceEnd =
  | { kind: 'never' }
  | { kind: 'until'; date: string }
  | { kind: 'count'; count: number };

export type Recurrence = {
  freq: RecurrenceFreq;
  interval: number;
  byDay: Weekday[];
  end: RecurrenceEnd;
};

export type EditScope = 'occurrence' | 'thisAndFollowing' | 'all';

// Structured identity the command layer accepts. `occurrenceStartAt` is null for
// single events, in which case the scope must be 'all'.
export type EventTarget = { id: string; occurrenceStartAt: string | null };

export type EventDraft = {
  title: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  category: EventCategory;
  color: EventColor;
  note: string;
  // Minute offsets before the start at which to remind, e.g. [10, 60].
  reminders: number[];
  recurrence: Recurrence | null;
};

export type EventRange = {
  startAt: string;
  endAtExclusive: string;
};

export type CalendarEvent = {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  category: EventCategory;
  color: EventColor;
  note: string;
  // Minute offsets before the start at which to remind, e.g. [10, 60].
  reminders: number[];
  createdAt: string;
  updatedAt: string;
  recurrence: Recurrence | null;
  // The event's own named IANA timezone; null for floating/all-day events. Used
  // for detail annotation only, not month-grid rendering (startAt/endAt are
  // already the device-timezone display wall clock).
  startTz: string | null;
  endTz: string | null;
  // Standard RFC 5545 RRULE string; null for single events. For detail display
  // and the Spec B editor UI.
  rrule: string | null;
  // Row id of the series this instance belongs to; null for single events.
  // `id` is always the database row id, so a whole series shares one id.
  seriesId: string | null;
  // The series' own start (dtstart); null for single events. Equal to
  // `occurrenceStartAt` exactly on the first occurrence of the series.
  seriesStartAt: string | null;
  // The slot this instance was originally due at, i.e. the exception identity.
  occurrenceStartAt: string | null;
  isOverridden: boolean;
  // Non-null when this event comes from a read-only calendar subscription; the
  // value is the source subscription id. Local events are always null.
  subscriptionId: string | null;
  // External source identity. OAuth events can be writable when the connected
  // account granted a write scope; ICS subscriptions remain read-only.
  externalProvider?: 'ics' | 'google' | 'microsoft';
  remoteEventId?: string | null;
  externalWritable?: boolean;
  // Provider/ICS all-day DTEND before conversion to the calendar grid's
  // inclusive end. The read-only detail view uses it for RFC 5545 semantics.
  externalExclusiveEndAt?: string | null;
  // Read-only structured fields from a subscription source, shown in the
  // external detail popup. Absent for local events (the backend never sends
  // them). Kept separate from `note` so location and description are never
  // conflated by string splitting.
  externalLocation?: string | null;
  externalDescription?: string | null;
};

export function isEventWritable(event: CalendarEvent): boolean {
  return event.subscriptionId === null || event.externalWritable === true;
}

export type CalendarDay = {
  isoDate: string;
  dayOfMonth: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  events: CalendarEvent[];
};
