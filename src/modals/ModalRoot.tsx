import { DateDetailDialog } from '../calendar/DateDetailDialog';
import type { CalendarEvent, EventDraft } from '../calendar/calendar-model';
import type { ModalState } from '../lib/modal-store';
import type { MatrixTask, TaskDraft } from '../matrix/matrix-model';
import { EventModal } from './EventModal';
import { NoteModal } from './NoteModal';
import { TaskModal } from './TaskModal';

type Props = {
  modal: ModalState;
  events: CalendarEvent[];
  tasks: MatrixTask[];
  onClose(): void;
  onChangeModal(modal: ModalState): void;
  createEvent(draft: EventDraft): Promise<CalendarEvent>;
  updateEvent(event: CalendarEvent, draft: EventDraft): Promise<CalendarEvent>;
  deleteEvent(event: CalendarEvent): Promise<void>;
  onSaved(event: CalendarEvent, oldLink: string | null): void | Promise<void>;
  onDeleted(event: CalendarEvent): void | Promise<void>;
  createTask(draft: TaskDraft): Promise<MatrixTask>;
  updateTask(task: MatrixTask, draft: TaskDraft): Promise<MatrixTask>;
  deleteTask(task: MatrixTask): Promise<void>;
  onTaskSaved(task: MatrixTask, oldLink: string | null): void | Promise<void>;
  onTaskDeleted(task: MatrixTask): void | Promise<void>;
};

export function ModalRoot({
  modal, events, tasks, onClose, onChangeModal,
  createEvent, updateEvent, deleteEvent, onSaved, onDeleted,
  createTask, updateTask, deleteTask, onTaskSaved, onTaskDeleted
}: Props) {
  if (!modal) return null;
  const isEventChild = modal.type === 'event-create' || modal.type === 'event-edit';
  const isTaskChild = modal.type === 'task-create' || modal.type === 'task-edit';
  const parentDate = isEventChild || isTaskChild ? modal.parentDate : undefined;
  const childTrigger = isEventChild || isTaskChild ? modal.trigger : null;
  const date = modal.type === 'date' ? modal.isoDate : parentDate;
  const returnFromChild = () => parentDate
    ? onChangeModal({ type:'date', isoDate:parentDate, trigger:childTrigger })
    : onClose();

  return <>
    {date ? (
      <DateDetailDialog
        isoDate={date}
        events={events}
        tasks={tasks}
        isTopLayer={modal.type === 'date'}
        restoreFocusRef={modal.type === 'date' ? { current:modal.trigger } : undefined}
        onClose={onClose}
        onCreateEvent={(isoDate) => onChangeModal({ type:'event-create', dateIso:isoDate, trigger:null, parentDate:isoDate })}
        onCreateTask={(dueDate, trigger) => onChangeModal({ type:'task-create', dueDate, trigger, parentDate:dueDate })}
        onEditEvent={(event, trigger) => onChangeModal({ type:'event-edit', event, trigger, parentDate:date })}
      />
    ) : null}
    {isEventChild ? (
      <EventModal
        mode={modal.type === 'event-create' ? { type:'create', dateIso:modal.dateIso } : { type:'edit', event:modal.event }}
        tasks={tasks}
        restoreFocusRef={{ current:modal.trigger }}
        onClose={returnFromChild}
        createEvent={createEvent}
        updateEvent={updateEvent}
        deleteEvent={deleteEvent}
        onSaved={onSaved}
        onDeleted={onDeleted}
      />
    ) : null}
    {isTaskChild ? (
      <TaskModal
        mode={modal.type === 'task-create' ? { type:'create', dueDate:modal.dueDate } : { type:'edit', task:modal.task }}
        events={events}
        restoreFocusRef={{ current:modal.trigger }}
        onClose={returnFromChild}
        createTask={createTask}
        updateTask={updateTask}
        deleteTask={deleteTask}
        onSaved={onTaskSaved}
        onDeleted={onTaskDeleted}
      />
    ) : null}
    {modal.type === 'note' ? <NoteModal note={modal.note} onClose={onClose} /> : null}
  </>;
}
