import type { CalendarEvent } from '../calendar/calendar-model';
import type { MatrixTask } from '../matrix/matrix-model';
import type { Note } from '../notes/notes-model';

export type ModalState =
  | { type: 'event'; event: CalendarEvent }
  | { type: 'task'; task: MatrixTask }
  | { type: 'note'; note: Note }
  | { type: 'date'; isoDate: string }
  | { type: 'settings' }
  | null;
