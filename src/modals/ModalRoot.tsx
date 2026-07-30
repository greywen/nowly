import { DateDetailDialog } from '../calendar/DateDetailDialog';
import type { CalendarEvent, EventDraft } from '../calendar/calendar-model';
import type { ModalState } from '../lib/modal-store';
import type { MatrixTask } from '../matrix/matrix-model';
import { EventModal } from './EventModal';
import { NoteModal } from './NoteModal';
import { TaskModal } from './TaskModal';

type Props={modal:ModalState;events:CalendarEvent[];tasks:MatrixTask[];onClose():void;onChangeModal(modal:ModalState):void;createEvent(d:EventDraft):Promise<CalendarEvent>;updateEvent(e:CalendarEvent,d:EventDraft):Promise<CalendarEvent>;deleteEvent(e:CalendarEvent):Promise<void>;onSaved(e:CalendarEvent,old:string|null):void|Promise<void>;onDeleted(e:CalendarEvent):void|Promise<void>};
export function ModalRoot({modal,events,tasks,onClose,onChangeModal,createEvent,updateEvent,deleteEvent,onSaved,onDeleted}:Props){
 if(!modal)return null;
 const parentDate=modal.type==='event-create'||modal.type==='event-edit'?modal.parentDate:undefined;
 const eventTrigger=modal.type==='event-create'||modal.type==='event-edit'?modal.trigger:null;
 const returnFromEvent=()=>parentDate?onChangeModal({type:'date',isoDate:parentDate,trigger:eventTrigger}):onClose();
 const date=modal.type==='date'?modal.isoDate:parentDate;
 return <>
  {date?<DateDetailDialog isoDate={date} events={events} tasks={tasks} isTopLayer={modal.type==='date'} restoreFocusRef={modal.type==='date'?{current:modal.trigger}:undefined} onClose={onClose} onCreateEvent={(isoDate)=>onChangeModal({type:'event-create',dateIso:isoDate,trigger:null,parentDate:isoDate})} onEditEvent={(event,trigger)=>onChangeModal({type:'event-edit',event,trigger,parentDate:date})}/>:null}
  {modal.type==='event-create'||modal.type==='event-edit'?<EventModal mode={modal.type==='event-create'?{type:'create',dateIso:modal.dateIso}:{type:'edit',event:modal.event}} tasks={tasks} restoreFocusRef={{current:modal.trigger}} onClose={returnFromEvent} createEvent={createEvent} updateEvent={updateEvent} deleteEvent={deleteEvent} onSaved={async(e,old)=>{await onSaved(e,old);returnFromEvent();}} onDeleted={async(e)=>{await onDeleted(e);returnFromEvent();}}/>:null}
  {modal.type==='task'?<TaskModal mode={{type:'edit',task:modal.task}} events={events} onClose={onClose} onSaved={()=>undefined} onDeleted={()=>undefined} createTask={async()=>{throw new Error('任务创建尚未连接。');}} updateTask={async()=>{throw new Error('任务更新尚未连接。');}} deleteTask={async()=>{throw new Error('任务删除尚未连接。');}}/>:null}
  {modal.type==='note'?<NoteModal note={modal.note} onClose={onClose}/>:null}
 </>;
}
