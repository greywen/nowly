import type { CalendarEvent } from '../calendar/calendar-model';
import type { MatrixTask } from '../matrix/matrix-model';
import type { Note } from '../notes/notes-model';

export type ModalState =
  | { type: 'date'; isoDate: string; trigger: HTMLElement | null }
  | { type: 'event-create'; dateIso: string; trigger: HTMLElement | null; parentDate?: string }
  | { type: 'event-edit'; event: CalendarEvent; trigger: HTMLElement | null; parentDate?: string }
  | { type: 'task-create'; dueDate: string | null; trigger: HTMLElement | null; parentDate?: string }
  | { type: 'task-edit'; task: MatrixTask; trigger: HTMLElement | null; parentDate?: string }
  | { type: 'note'; note: Note }
  | { type: 'settings' }
  | null;
