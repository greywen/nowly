import type { HexColor } from '../lib/color';

export type SubscriptionStatus = 'ok' | 'failed';

// 'ics'：直连密钥地址；'google'/'microsoft'：OAuth API 接入。
export type SubscriptionProvider = 'ics' | 'google' | 'microsoft';

export type CalendarSubscription = {
  id: string;
  name: string;
  url: string;
  color: HexColor;
  refreshIntervalMinutes: number;
  provider: SubscriptionProvider;
  accountId: string | null;
  remoteCalendarId: string | null;
  lastSyncedAt: string | null;
  lastAttemptedAt: string | null;
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

// 一个已连接的 OAuth 账户（一次登录 = 一个账户，可暴露多个日历）。
export type OAuthAccount = {
  id: string;
  provider: 'google' | 'microsoft';
  accountLabel: string;
  createdAt: string;
  updatedAt: string;
};

// OAuth 授权后可勾选的远端日历。
export type RemoteCalendar = {
  id: string;
  name: string;
  color: string | null;
};

import type { CalendarEvent, EventCategory } from './calendar-model';

export type ExternalEvent = {
  id: string;
  subscriptionId: string;
  remoteEventId: string | null;
  provider: SubscriptionProvider;
  writable: boolean;
  title: string;
  startAt: string;
  endAt: string;
  startTz: string | null;
  endTz: string | null;
  allDay: boolean;
  location: string | null;
  description: string | null;
  color: HexColor;
  // Minute offsets before the start at which the source calendar reminds.
  reminders: number[];
};

function addDaysIso(isoDate: string, days: number) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(year, month - 1, day + days);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// External subscription events reuse the calendar rendering pipeline, so map
// each into a CalendarEvent. OAuth sources may be writable; ICS stays read-only.
// (Google/Microsoft/ICS VALARM); location and description are kept as dedicated
// fields for the read-only detail popup. `note` stays empty so nothing
// conflates the two.
export function externalToCalendarEvent(external: ExternalEvent): CalendarEvent {
  const inclusiveEndAt = external.allDay
    ? `${addDaysIso(external.endAt.slice(0, 10), -1)}T23:59`
    : external.endAt;
  return {
    id: external.id,
    title: external.title,
    startAt: external.startAt,
    endAt: inclusiveEndAt,
    allDay: external.allDay,
    // Subscription events have a fixed source color, not a category color; use a
    // neutral category so category-based styling never fights the source color.
    category: 'personal' as EventCategory,
    color: external.color,
    note: external.description ?? '',
    reminders: external.reminders ?? [],
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
    externalProvider: external.provider,
    remoteEventId: external.remoteEventId,
    externalWritable: external.writable,
    externalExclusiveEndAt: external.allDay ? external.endAt : null,
    externalLocation: external.location,
    externalDescription: external.description
  };
}
