import { DESIGN_COLORS, type ColorPreset, type HexColor } from '../lib/color';
import { t } from '../i18n';

export type EventCategory = 'work' | 'important' | 'personal' | 'learning';
export type EventColor = HexColor;
export type CalendarView = 'month' | 'week' | 'day' | 'list';

// Language-aware category label. Reads the active language at call time.
export function eventCategoryLabel(category: EventCategory): string {
  return t(`category.${category}`);
}

export function eventColorPresets(): readonly ColorPreset[] {
  return [
    { value: DESIGN_COLORS.primary, label: t('color.teal') },
    { value: DESIGN_COLORS.danger, label: t('color.coral') },
    { value: DESIGN_COLORS.success, label: t('color.green') },
    { value: DESIGN_COLORS.warning, label: t('color.amber') }
  ];
}
export const DEFAULT_EVENT_COLOR = DESIGN_COLORS.primary;

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
  linkedTaskId: string | null;
  note: string;
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
  linkedTaskId: string | null;
  note: string;
  createdAt: string;
  updatedAt: string;
  recurrence: Recurrence | null;
  // Row id of the series this instance belongs to; null for single events.
  // `id` is always the database row id, so a whole series shares one id.
  seriesId: string | null;
  // The slot this instance was originally due at, i.e. the exception identity.
  occurrenceStartAt: string | null;
  isOverridden: boolean;
};

export type CalendarDay = {
  isoDate: string;
  dayOfMonth: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  events: CalendarEvent[];
};
