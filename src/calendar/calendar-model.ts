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

export type EventDraft = {
  title: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  category: EventCategory;
  color: EventColor;
  linkedTaskId: string | null;
  note: string;
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
};

export type CalendarDay = {
  isoDate: string;
  dayOfMonth: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  events: CalendarEvent[];
};
