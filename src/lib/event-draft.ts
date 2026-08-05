import type {
  CalendarEvent,
  EventCategory,
  EventColor,
  EventDraft
} from '../calendar/calendar-model';

export type EventFormDraft = {
  title: string;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  category: EventCategory;
  color: EventColor;
  linkedTaskId: string | null;
  note: string;
};

export type EventFieldErrors = Partial<
  Record<'title' | 'startAt' | 'endAt' | 'category' | 'color' | 'linkedTaskId', string>
>;

const categories: EventCategory[] = ['work', 'important', 'personal', 'learning'];
const colors: EventColor[] = ['blue', 'red', 'green', 'yellow'];

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function minutesToTime(minutes: number) {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

export function createEventDraft(dateIso: string, now: Date): EventFormDraft {
  let startMinutes = Math.ceil((now.getHours() * 60 + now.getMinutes()) / 5) * 5;
  let endMinutes = startMinutes + 60;
  if (endMinutes >= 24 * 60) {
    startMinutes = 22 * 60 + 55;
    endMinutes = 23 * 60 + 55;
  }
  return {
    title: '',
    startDate: dateIso,
    endDate: dateIso,
    startTime: minutesToTime(startMinutes),
    endTime: minutesToTime(endMinutes),
    allDay: false,
    category: 'work',
    color: 'blue',
    linkedTaskId: null,
    note: ''
  };
}

export function eventToForm(event: CalendarEvent): EventFormDraft {
  return {
    title: event.title,
    startDate: event.startAt.slice(0, 10),
    endDate: event.endAt.slice(0, 10),
    startTime: event.startAt.slice(11, 16),
    endTime: event.endAt.slice(11, 16),
    allDay: event.allDay,
    category: event.category,
    color: event.color,
    linkedTaskId: event.linkedTaskId,
    note: event.note
  };
}

export function toEventDraft(form: EventFormDraft): EventDraft {
  return {
    title: form.title.trim(),
    startAt: `${form.startDate}T${form.allDay ? '00:00' : form.startTime}`,
    endAt: `${form.endDate}T${form.allDay ? '23:59' : form.endTime}`,
    allDay: form.allDay,
    category: form.category,
    color: form.color,
    linkedTaskId: form.linkedTaskId,
    note: form.note
  };
}

export function validateEventForm(form: EventFormDraft): EventFieldErrors {
  if (!form.title.trim()) return { title: '请输入日程标题。' };
  if (!form.startDate) return { startAt: '请选择开始日期。' };
  if (!form.endDate) return { endAt: '请选择结束日期。' };
  if (form.endDate < form.startDate) return { endAt: '结束日期不能早于开始日期。' };
  if (!form.allDay && !form.startTime) return { startAt: '请选择开始时间。' };
  if (!form.allDay && !form.endTime) return { endAt: '请选择结束时间。' };
  if (!form.allDay && form.startDate === form.endDate && form.endTime < form.startTime) {
    return { endAt: '结束时间不能早于开始时间。' };
  }
  if (!categories.includes(form.category)) return { category: '请选择有效分类。' };
  if (!colors.includes(form.color)) return { color: '请选择有效颜色。' };
  return {};
}

function normalizedForDirtyCheck(form: EventFormDraft) {
  return form.allDay
    ? { ...form, startTime: '', endTime: '' }
    : form;
}

export function isEventFormDirty(initial: EventFormDraft, current: EventFormDraft) {
  return JSON.stringify(normalizedForDirtyCheck(initial)) !== JSON.stringify(normalizedForDirtyCheck(current));
}
