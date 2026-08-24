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
