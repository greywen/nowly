import type { CalendarEvent } from '../calendar/calendar-model';
import type { ModalState } from '../lib/modal-store';
import type { MatrixTask } from '../matrix/matrix-model';
import { EventModal } from './EventModal';
import { NoteModal } from './NoteModal';
import { TaskModal } from './TaskModal';

type ModalRootProps = {
  modal: ModalState;
  events: CalendarEvent[];
  tasks: MatrixTask[];
  onClose: () => void;
};

export function ModalRoot({ modal, events, tasks, onClose }: ModalRootProps) {
  if (!modal) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-10 bg-slate-950/10">
      {modal.type === 'event' ? <EventModal event={modal.event} tasks={tasks} onClose={onClose} /> : null}
      {modal.type === 'task' ? <TaskModal task={modal.task} events={events} onClose={onClose} /> : null}
      {modal.type === 'note' ? <NoteModal note={modal.note} onClose={onClose} /> : null}
    </div>
  );
}
