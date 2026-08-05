export type EventCategory = 'work' | 'important' | 'personal' | 'learning';
export type EventColor = 'blue' | 'red' | 'green' | 'yellow';
export type CalendarView = 'month' | 'week' | 'day' | 'list';

export const eventCategoryLabels: Record<EventCategory, string> = {
  work: '工作',
  important: '重要',
  personal: '个人',
  learning: '学习'
};

export const eventColorLabels: Record<EventColor, string> = {
  blue: '蓝色',
  red: '红色',
  green: '绿色',
  yellow: '黄色'
};

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
