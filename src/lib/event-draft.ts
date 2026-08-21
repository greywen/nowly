import {
  DEFAULT_EVENT_COLOR,
  type CalendarEvent,
  type EventCategory,
  type EventColor,
  type EventDraft,
  type Recurrence
} from '../calendar/calendar-model';
import { normalizeHexColor } from './color';
import { validateRecurrence } from './recurrence';
import { t } from '../i18n';

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
  reminders: number[];
  recurrence: Recurrence | null;
};

export type EventFieldErrors = Partial<
  Record<'title' | 'startAt' | 'endAt' | 'category' | 'color' | 'linkedTaskId' | 'reminders' | 'recurrence', string>
>;

const categories: EventCategory[] = ['work', 'important', 'personal', 'learning'];

// The most a reminder may lead the start by: four weeks, in minutes. Kept in
// lockstep with the backend `MAX_REMINDER_MINUTES`.
export const MAX_REMINDER_MINUTES = 4 * 7 * 24 * 60;
// The most reminders a single event may carry, matching the backend cap.
export const MAX_REMINDERS = 5;

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
    color: DEFAULT_EVENT_COLOR,
    linkedTaskId: null,
    note: '',
    reminders: [],
    recurrence: null
  };
}

/** 表单里代表这条日程开始时刻的本地朴素时间，与 `toEventDraft` 的组装方式保持一致。 */
function formStartAt(form: EventFormDraft) {
  return `${form.startDate}T${form.allDay ? '00:00' : form.startTime}`;
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
    note: event.note,
    reminders: [...event.reminders],
    recurrence: event.recurrence
  };
}

export function toEventDraft(form: EventFormDraft): EventDraft {
  return {
    title: form.title.trim(),
    startAt: formStartAt(form),
    endAt: `${form.endDate}T${form.allDay ? '23:59' : form.endTime}`,
    allDay: form.allDay,
    category: form.category,
    color: normalizeHexColor(form.color) as EventColor,
    linkedTaskId: form.linkedTaskId,
    note: form.note,
    reminders: normalizeReminders(form.reminders),
    recurrence: form.recurrence
  };
}

/** Sort, de-duplicate, and drop negatives so the draft matches backend storage. */
function normalizeReminders(reminders: number[]): number[] {
  return [...new Set(reminders.filter((value) => Number.isFinite(value) && value >= 0))].sort(
    (left, right) => left - right
  );
}

export function validateEventForm(form: EventFormDraft): EventFieldErrors {
  if (!form.title.trim()) return { title: t('eventDraft.errorTitle') };
  if (!form.startDate) return { startAt: t('eventDraft.errorStartDate') };
  if (!form.endDate) return { endAt: t('eventDraft.errorEndDate') };
  if (form.endDate < form.startDate) return { endAt: t('eventDraft.errorEndBeforeStart') };
  if (!form.allDay && !form.startTime) return { startAt: t('eventDraft.errorStartTime') };
  if (!form.allDay && !form.endTime) return { endAt: t('eventDraft.errorEndTime') };
  if (!form.allDay && form.startDate === form.endDate && form.endTime < form.startTime) {
    return { endAt: t('eventDraft.errorEndTimeBeforeStart') };
  }
  if (!categories.includes(form.category)) return { category: t('eventDraft.errorCategory') };
  if (!normalizeHexColor(form.color)) return { color: t('eventDraft.errorColor') };
  if (form.reminders.some((value) => value < 0 || value > MAX_REMINDER_MINUTES)) {
    return { reminders: t('eventDraft.errorReminderRange') };
  }
  if (new Set(form.reminders).size !== form.reminders.length) {
    return { reminders: t('eventDraft.errorReminderDuplicate') };
  }
  if (form.reminders.length > MAX_REMINDERS) {
    return { reminders: t('eventDraft.errorReminderCount', { count: MAX_REMINDERS }) };
  }
  const recurrenceError = validateRecurrence(form.recurrence, formStartAt(form));
  if (recurrenceError) return { recurrence: recurrenceError };
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
