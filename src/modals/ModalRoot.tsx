import { DateDetailDialog } from '../calendar/DateDetailDialog';
import { ExternalEventDialog } from '../calendar/ExternalEventDialog';
import type { CalendarEvent, EditScope, EventDraft } from '../calendar/calendar-model';
import type { ModalState } from '../lib/modal-store';
import { EventModal } from './EventModal';
import { NoteModal } from './NoteModal';
import { NotesManagerDialog } from '../notes/NotesManagerDialog';
import type { Note, NoteDraft } from '../notes/notes-model';
import type { AppSettings, MonitorInfo } from '../data/nowly-repository';
import { SettingsDialog } from '../settings/SettingsDialog';
import { CalendarSettingsDialog } from '../calendar/CalendarSettingsDialog';
import type { CalendarSubscription, SubscriptionDraft } from '../calendar/subscription-model';
import { useTaskWorkspace } from '../tasks/TaskWorkspaceContext';
import { UnifiedTaskDialog } from '../tasks/UnifiedTaskDialog';
import { TaskSettingsDialog } from '../tasks/TaskSettingsDialog';
import { isEventWritable } from '../calendar/calendar-model';

type Props = {
  modal: ModalState;
  events: CalendarEvent[];
  onClose(): void;
  onChangeModal(modal: ModalState): void;
  createEvent(draft: EventDraft, subscriptionId?: string | null): Promise<CalendarEvent | void>;
  updateEvent(event: CalendarEvent, draft: EventDraft, scope: EditScope): Promise<void>;
  deleteEvent(event: CalendarEvent, scope: EditScope): Promise<void>;
  onSaved(): void | Promise<void>;
  onDeleted(event: CalendarEvent): void | Promise<void>;
  notes: Note[];
  createNote(draft: NoteDraft): Promise<Note>;
  updateNote(note: Note, draft: NoteDraft): Promise<Note>;
  deleteNote(note: Note): Promise<void>;
  settings: AppSettings;
  monitors: MonitorInfo[];
  saveSettings(settings: AppSettings): Promise<AppSettings>;
  subscriptions: CalendarSubscription[];
  onSubscriptionsChanged(): void;
  createSubscription(draft: SubscriptionDraft): Promise<CalendarSubscription>;
  updateSubscription(id: string, draft: SubscriptionDraft): Promise<CalendarSubscription>;
  deleteSubscription(id: string): Promise<void>;
  refreshSubscription(id: string): Promise<void>;
  recentColors?: string[];
  onRememberCustomColor?: (color: string) => Promise<void> | void;
};

export function ModalRoot({
  modal, events, onClose, onChangeModal,
  createEvent, updateEvent, deleteEvent, onSaved, onDeleted,
  notes, createNote, updateNote, deleteNote, settings, monitors, saveSettings,
  subscriptions, onSubscriptionsChanged, createSubscription, updateSubscription, deleteSubscription, refreshSubscription,
  recentColors = [], onRememberCustomColor
}: Props) {
  const workspace = useTaskWorkspace();
  if (!modal) return null;
  const isEventChild = modal.type === 'event-create' || modal.type === 'event-edit';
  const isTaskChild = modal.type === 'task-create' || modal.type === 'task-edit' || modal.type === 'workspace-task-edit';
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
        isTopLayer={modal.type === 'date'}
        restoreFocusRef={modal.type === 'date' ? { current:modal.trigger } : undefined}
        onClose={onClose}
        onCreateEvent={(isoDate) => onChangeModal({ type:'event-create', dateIso:isoDate, trigger:null, parentDate:isoDate })}
        onEditEvent={(event, trigger) => onChangeModal(event.subscriptionId && !isEventWritable(event)
          ? { type:'external-detail', event, trigger }
          : { type:'event-edit', event, trigger, parentDate:date })}
      />
    ) : null}
    {isEventChild ? (
      <EventModal
        mode={modal.type === 'event-create' ? { type:'create', dateIso:modal.dateIso } : { type:'edit', event:modal.event }}
        restoreFocusRef={{ current:modal.trigger }}
        onClose={returnFromChild}
        createEvent={createEvent}
        updateEvent={updateEvent}
        deleteEvent={deleteEvent}
        onSaved={onSaved}
        onDeleted={onDeleted}
        recentColors={recentColors}
        onRememberCustomColor={onRememberCustomColor}
        subscriptions={subscriptions}
      />
    ) : null}
    {isTaskChild ? (
      <UnifiedTaskDialog
        mode={modal.type === 'task-create'
          ? { type:'create', originView: 'matrix', dueDate:modal.dueDate }
          : modal.type === 'workspace-task-edit'
            ? { type:'edit', task:modal.task }
            : { type:'edit', task:workspace.workspace.data.tasks.find((task) => task.id === modal.task.id) ?? {
                id:modal.task.id, title:modal.task.title, description:modal.task.note,
                priority:modal.task.quadrant, dueDate:modal.task.dueAt, completed:modal.task.completed,
                laneId:workspace.workspace.data.defaultLaneId, boardPosition:0, tagIds:[], collaboratorIds:[],
                views:['kanban','matrix'],
                createdAt:modal.task.createdAt, updatedAt:modal.task.updatedAt
              } }
        }
        restoreFocusRef={{ current:modal.trigger }}
        onClose={returnFromChild}
      />
    ) : null}
    {modal.type === 'notes-manager' ? <NotesManagerDialog notes={notes} restoreFocusRef={{current:modal.trigger}} onClose={onClose} onCreate={(trigger)=>onChangeModal({type:'note-create',trigger,parentManager:true})} onEdit={(note,trigger)=>onChangeModal({type:'note-edit',note,trigger,parentManager:true})} /> : null}
    {modal.type === 'note-create' || modal.type === 'note-edit' ? <NoteModal mode={modal.type === 'note-create' ? {type:'create'} : {type:'edit',note:modal.note}} restoreFocusRef={{current:modal.trigger}} onClose={()=>modal.parentManager?onChangeModal({type:'notes-manager',trigger:modal.trigger}):onClose()} onSaved={()=>undefined} onDeleted={()=>undefined} createNote={createNote} updateNote={updateNote} deleteNote={deleteNote} recentColors={recentColors} onRememberCustomColor={onRememberCustomColor} /> : null}
    {modal.type === 'settings' ? <SettingsDialog settings={settings} monitors={monitors} onClose={onClose} onSave={saveSettings} /> : null}
    {modal.type === 'external-detail' ? (
      <ExternalEventDialog
        event={modal.event}
        sourceName={subscriptions.find((s) => s.id === modal.event.subscriptionId)?.name ?? ''}
        restoreFocusRef={{ current: modal.trigger }}
        onClose={onClose}
      />
    ) : null}
    {modal.type === 'task-settings' ? (
      <TaskSettingsDialog
        restoreFocusRef={{ current: modal.trigger }}
        onClose={onClose}
        recentColors={recentColors}
        onRememberCustomColor={onRememberCustomColor}
      />
    ) : null}
    {modal.type === 'calendar-settings' ? (
      <CalendarSettingsDialog
        settings={{ weekStart: settings.weekStart, dateFormat: settings.dateFormat, showWeekends: settings.showWeekends }}
        onChange={(next) => void saveSettings({ ...settings, ...next })}
        subscriptions={subscriptions}
        restoreFocusRef={{ current: modal.trigger }}
        onClose={onClose}
        onSubscriptionsChanged={onSubscriptionsChanged}
        createSubscription={createSubscription}
        updateSubscription={updateSubscription}
        deleteSubscription={deleteSubscription}
        refreshSubscription={refreshSubscription}
      />
    ) : null}
  </>;
}
