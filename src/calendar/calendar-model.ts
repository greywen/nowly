export type CalendarEvent = {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  categoryId: string | null;
  color: 'blue' | 'red' | 'green' | 'yellow';
  linkedTaskId: string | null;
  note: string;
};

export type CalendarDay = {
  isoDate: string;
  dayOfMonth: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  events: CalendarEvent[];
};
