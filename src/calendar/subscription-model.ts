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

// External subscription events reuse the calendar rendering pipeline, so map
// each into a read-only CalendarEvent. Reminders come straight from the source
// (Google/Microsoft/ICS VALARM); location and description are kept as dedicated
// fields for the read-only detail popup. `note` stays empty so nothing
// conflates the two.
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
    note: '',
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
    externalLocation: external.location,
    externalDescription: external.description
  };
}
