import { DESIGN_COLORS, type ColorPreset, type HexColor } from '../lib/color';

export type EventCategory = 'work' | 'important' | 'personal' | 'learning';
export type EventColor = HexColor;
export type CalendarView = 'month' | 'week' | 'day' | 'list';

export const eventCategoryLabels: Record<EventCategory, string> = {
  work: '工作',
  important: '重要',
  personal: '个人',
  learning: '学习'
};

export const eventColorPresets: readonly ColorPreset[] = [
  { value: DESIGN_COLORS.primary, label: '青绿' },
  { value: DESIGN_COLORS.danger, label: '珊瑚红' },
  { value: DESIGN_COLORS.success, label: '草绿' },
  { value: DESIGN_COLORS.warning, label: '暖黄' }
];
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
