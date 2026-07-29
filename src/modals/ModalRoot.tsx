import type { ModalState } from '../lib/modal-store';
import { EventModal } from './EventModal';
import { NoteModal } from './NoteModal';
import { TaskModal } from './TaskModal';

type ModalRootProps = {
  modal: ModalState;
  onClose: () => void;
};

export function ModalRoot({ modal, onClose }: ModalRootProps) {
  if (!modal) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-10 bg-slate-950/10">
      {modal.type === 'event' ? <EventModal event={modal.event} onClose={onClose} /> : null}
      {modal.type === 'task' ? <TaskModal task={modal.task} onClose={onClose} /> : null}
      {modal.type === 'note' ? <NoteModal note={modal.note} onClose={onClose} /> : null}
    </div>
  );
}
