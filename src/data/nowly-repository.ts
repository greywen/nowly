import type { CalendarEvent, EventDraft, EventRange } from '../calendar/calendar-model';
import type { MatrixTask, TaskDraft } from '../matrix/matrix-model';
import type { Note } from '../notes/notes-model';

export type AppSettings = {
  wallpaperEnabled: boolean;
  launchAtLogin: boolean;
  targetMonitorId: string | null;
  density: 'balanced' | 'comfortable';
  weekStart: 'monday' | 'sunday';
  dateFormat: 'localized' | 'iso';
  showWeekends: boolean;
  calendarEnabled: boolean;
  matrixEnabled: boolean;
  notesEnabled: boolean;
};

export type RepositoryError = {
  code: 'validation_error' | 'not_found' | 'conflict' | 'database_error' | 'system_error';
  message: string;
  field?: string;
};

export type NowlyRepository = {
  listEventsInRange(range: EventRange): Promise<CalendarEvent[]>;
  createEvent(draft: EventDraft): Promise<CalendarEvent>;
  updateEvent(id: string, draft: EventDraft): Promise<CalendarEvent>;
  deleteEvent(id: string): Promise<void>;
  listTasks(): Promise<MatrixTask[]>;
  createTask(draft: TaskDraft): Promise<MatrixTask>;
  updateTask(id: string, draft: TaskDraft): Promise<MatrixTask>;
  deleteTask(id: string): Promise<void>;
  setTaskCompleted(id: string, completed: boolean): Promise<MatrixTask>;
  listNotes(): Promise<Note[]>;
  getSettings(): Promise<AppSettings>;
};
