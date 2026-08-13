import { X } from 'lucide-react';
import { type RefObject, useId, useMemo, useState } from 'react';
import { eventColorPresets, type CalendarEvent, type EventCategory, type EventDraft } from '../calendar/calendar-model';
import { ColorPicker } from '../components/ColorPicker';
import type { HexColor } from '../lib/color';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DatePicker } from '../components/DatePicker';
import { Dialog } from '../components/Dialog';
import { Select } from '../components/Select';
import { TimePicker } from '../components/TimePicker';
import type { RepositoryError } from '../data/nowly-repository';
import { createEventDraft, eventToForm, isEventFormDirty, toEventDraft, validateEventForm, type EventFieldErrors, type EventFormDraft } from '../lib/event-draft';
import type { MatrixTask } from '../matrix/matrix-model';

type EventModalProps = {
  mode: { type:'create'; dateIso:string } | { type:'edit'; event:CalendarEvent };
  tasks: MatrixTask[];
  restoreFocusRef?: RefObject<HTMLElement | null>;
  onClose(): void;
  onSaved(event:CalendarEvent, previousLinkedTaskId:string|null): Promise<void> | void;
  onDeleted(event:CalendarEvent): Promise<void> | void;
  createEvent(draft:EventDraft): Promise<CalendarEvent>;
  updateEvent(event:CalendarEvent,draft:EventDraft): Promise<CalendarEvent>;
  deleteEvent(event:CalendarEvent): Promise<void>;
  now?: () => Date;
  recentColors?: HexColor[];
  onRememberCustomColor?: (color: HexColor) => Promise<void> | void;
};

const categoryOptions = [{value:'work',label:'工作'},{value:'important',label:'重要'},{value:'personal',label:'个人'},{value:'learning',label:'学习'}];

export function EventModal({ mode,tasks,restoreFocusRef,onClose,onSaved,onDeleted,createEvent,updateEvent,deleteEvent,now=()=>new Date(),recentColors=[],onRememberCustomColor }:EventModalProps) {
  const initial = useMemo(()=>mode.type==='edit'?eventToForm(mode.event):createEventDraft(mode.dateIso,now()),[mode]);
  const [form,setForm]=useState<EventFormDraft>(initial);
  const [errors,setErrors]=useState<EventFieldErrors>({});
  const [dialogError,setDialogError]=useState('');
  const [openPicker,setOpenPicker]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);
  const [confirm,setConfirm]=useState<'discard'|'delete'|null>(null);
  const titleId=useId();
  const update=<K extends keyof EventFormDraft>(key:K,value:EventFormDraft[K])=>setForm(current=>({...current,[key]:value}));
  const requestClose=()=>{ if(busy)return; if(isEventFormDirty(initial,form))setConfirm('discard'); else onClose(); };
  const message=(error:unknown)=>typeof error==='object'&&error&&'message'in error&&typeof error.message==='string'?error.message:'操作失败，请重试。';

  async function save(){
    const validation=validateEventForm(form); setErrors(validation); setDialogError(''); if(Object.keys(validation).length)return;
    setBusy(true);
    try { const draft=toEventDraft(form); const saved=mode.type==='create'?await createEvent(draft):await updateEvent(mode.event,draft); if(onRememberCustomColor&&!eventColorPresets.some(p=>p.value===saved.color))await onRememberCustomColor(saved.color); await onSaved(saved,mode.type==='edit'?mode.event.linkedTaskId:null); onClose(); }
    catch(error){ const repositoryError=error as RepositoryError; if(repositoryError.code==='validation_error'&&repositoryError.field)setErrors({[repositoryError.field]:repositoryError.message}); else setDialogError(message(error)); }
    finally{setBusy(false);}
  }
  async function remove(){ if(mode.type!=='edit')return; setBusy(true); setDialogError(''); try{await deleteEvent(mode.event);await onDeleted(mode.event);setConfirm(null);onClose();}catch(error){setDialogError(message(error));}finally{setBusy(false);} }

  return <>
    <Dialog title={mode.type==='create'?'新建日程':'编辑日程'} ariaLabelledBy={titleId} isTopLayer={!confirm} restoreFocusRef={restoreFocusRef} onRequestClose={requestClose} className="event-dialog"
      headerActions={<button type="button" aria-label="关闭" className="good-icon-button" disabled={busy} onClick={requestClose}><X aria-hidden="true"/></button>}
      footer={<div className="event-dialog__actions">{dialogError&&!confirm?<div role="alert" className="dialog-error">{dialogError}</div>:null}{mode.type==='edit'?<button type="button" className="good-button good-button--danger-ghost" disabled={busy} onClick={()=>setConfirm('delete')}>删除日程</button>:null}<button type="button" className="good-button" disabled={busy} onClick={requestClose}>取消</button><button type="button" className="good-button good-button--primary" disabled={busy} onClick={save}>{busy?'正在保存':'保存'}</button></div>}>
      <form className="event-form" onSubmit={e=>{e.preventDefault();void save();}}>
        <div className="good-field"><label htmlFor="event-title">日程标题</label><input id="event-title" className="good-input" value={form.title} disabled={busy} aria-describedby={errors.title?'event-title-error':undefined} onChange={e=>update('title',e.target.value)}/>{errors.title?<span id="event-title-error" className="field-error">{errors.title}</span>:null}</div>
        <label className="form-check form-check-custom form-check-solid"><input className="form-check-input" type="checkbox" checked={form.allDay} disabled={busy} onChange={e=>update('allDay',e.target.checked)}/><span className="form-check-label">全天事件</span></label>
        <div className="form-row"><DatePicker id="event-start-date" label="开始日期" value={form.startDate} errorId={errors.startAt?'event-start-error':undefined} disabled={busy} open={openPicker==='startDate'} onOpenChange={open=>setOpenPicker(open?'startDate':null)} onChange={v=>update('startDate',v)}/><DatePicker id="event-end-date" label="结束日期" value={form.endDate} errorId={errors.endAt?'event-end-error':undefined} disabled={busy} open={openPicker==='endDate'} onOpenChange={open=>setOpenPicker(open?'endDate':null)} onChange={v=>update('endDate',v)}/></div>
        {!form.allDay?<div className="form-row"><TimePicker id="event-start-time" label="开始时间" value={form.startTime} disabled={busy} open={openPicker==='startTime'} onOpenChange={open=>setOpenPicker(open?'startTime':null)} onChange={v=>update('startTime',v)}/><TimePicker id="event-end-time" label="结束时间" value={form.endTime} disabled={busy} open={openPicker==='endTime'} onOpenChange={open=>setOpenPicker(open?'endTime':null)} onChange={v=>update('endTime',v)}/></div>:null}
        {errors.startAt?<span id="event-start-error" className="field-error">{errors.startAt}</span>:null}{errors.endAt?<span id="event-end-error" className="field-error">{errors.endAt}</span>:null}
        <Select id="event-category" label="分类" options={categoryOptions} value={form.category} disabled={busy} onChange={v=>update('category',v as EventCategory)}/>{errors.category?<span className="field-error">{errors.category}</span>:null}
        <ColorPicker legend="颜色" name="event-color" value={form.color} presets={eventColorPresets} recentColors={recentColors} disabled={busy} onChange={color=>update('color',color)} onRememberColor={onRememberCustomColor}/>{errors.color?<span className="field-error">{errors.color}</span>:null}
        <Select id="event-linked-task" label="关联任务" options={[{value:'',label:'无关联'},...tasks.map(t=>({value:t.id,label:t.title}))]} value={form.linkedTaskId??''} searchable disabled={busy} onChange={v=>update('linkedTaskId',v||null)}/>{errors.linkedTaskId?<span className="field-error">{errors.linkedTaskId}</span>:null}
        <div className="good-field"><label htmlFor="event-note">备注</label><textarea id="event-note" className="good-input good-textarea" value={form.note} disabled={busy} onChange={e=>update('note',e.target.value)}/></div>
      </form>
    </Dialog>
    {confirm==='discard'?<ConfirmDialog title="放弃更改？" description="未保存的内容将丢失。" confirmLabel="放弃更改" busyLabel="正在放弃" onCancel={()=>setConfirm(null)} onConfirm={onClose}/>:null}
    {confirm==='delete'&&mode.type==='edit'?<ConfirmDialog title={`永久删除“${mode.event.title}”？`} description={<>删除后无法恢复。<br/>若存在关联，只解除关联，不删除关联任务。</>} tone="danger" confirmLabel="永久删除" busyLabel="正在删除" busy={busy} errorMessage={dialogError} onCancel={()=>{setConfirm(null);setDialogError('');}} onConfirm={()=>void remove()}/>:null}
  </>;
}
