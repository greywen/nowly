import { X } from 'lucide-react';
import { type RefObject, useId, useMemo, useState } from 'react';
import { eventColorPresets, type CalendarEvent, type EditScope, type EventCategory, type EventDraft, type Recurrence, type RecurrenceEnd, type RecurrenceFreq, type Weekday } from '../calendar/calendar-model';
import { t } from '../i18n';
import { ColorPicker } from '../components/ColorPicker';
import type { HexColor } from '../lib/color';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DatePicker } from '../components/DatePicker';
import { Dialog } from '../components/Dialog';
import { Select } from '../components/Select';
import { TimePicker } from '../components/TimePicker';
import type { RepositoryError } from '../data/nowly-repository';
import { createEventDraft, eventToForm, isEventFormDirty, toEventDraft, validateEventForm, type EventFieldErrors, type EventFormDraft } from '../lib/event-draft';
import { presetToRecurrence, recurrenceToPreset, weekdayOf, WEEKDAYS, type RecurrencePreset } from '../lib/recurrence';
import { RecurrenceScopeDialog } from './RecurrenceScopeDialog';
import type { MatrixTask } from '../matrix/matrix-model';

type EventModalProps = {
  mode: { type:'create'; dateIso:string } | { type:'edit'; event:CalendarEvent };
  tasks: MatrixTask[];
  restoreFocusRef?: RefObject<HTMLElement | null>;
  onClose(): void;
  onSaved(): Promise<void> | void;
  onDeleted(event:CalendarEvent): Promise<void> | void;
  createEvent(draft:EventDraft): Promise<CalendarEvent>;
  updateEvent(event:CalendarEvent,draft:EventDraft,scope:EditScope): Promise<void>;
  deleteEvent(event:CalendarEvent,scope:EditScope): Promise<void>;
  now?: () => Date;
  recentColors?: HexColor[];
  onRememberCustomColor?: (color: HexColor) => Promise<void> | void;
};

const categoryOptions = () => [{value:'work',label:t('category.work')},{value:'important',label:t('category.important')},{value:'personal',label:t('category.personal')},{value:'learning',label:t('category.learning')}];
const presetOptions = () => (['none','daily','weekly','monthly','yearly','custom'] as const).map(preset=>({value:preset,label:t(`recurrence.preset.${preset}`)}));
const freqOptions = () => (['daily','weekly','monthly','yearly'] as const).map(freq=>({value:freq,label:t(`recurrence.freq.${freq}`)}));
const weekdayLabels = () => t('recurrence.weekdays').split(',');

function sameEnd(left:RecurrenceEnd,right:RecurrenceEnd){
  if(left.kind==='until')return right.kind==='until'&&left.date===right.date;
  if(left.kind==='count')return right.kind==='count'&&left.count===right.count;
  return right.kind==='never';
}
function sameRecurrence(left:Recurrence|null,right:Recurrence|null){
  if(!left||!right)return left===right;
  return left.freq===right.freq&&left.interval===right.interval&&left.byDay.length===right.byDay.length
    &&left.byDay.every((day,index)=>day===right.byDay[index])&&sameEnd(left.end,right.end);
}

export function EventModal({ mode,tasks,restoreFocusRef,onClose,onSaved,onDeleted,createEvent,updateEvent,deleteEvent,now=()=>new Date(),recentColors=[],onRememberCustomColor }:EventModalProps) {
  const initial = useMemo(()=>mode.type==='edit'?eventToForm(mode.event):createEventDraft(mode.dateIso,now()),[mode]);
  const [form,setForm]=useState<EventFormDraft>(initial);
  // 预设不是双射（「自定义」的种子就是一条普通周规则），只在打开表单时初始化一次。
  const [preset,setPreset]=useState<RecurrencePreset>(()=>recurrenceToPreset(initial.recurrence,`${initial.startDate}T${initial.startTime}`));
  const [errors,setErrors]=useState<EventFieldErrors>({});
  const [dialogError,setDialogError]=useState('');
  const [openPicker,setOpenPicker]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);
  const [confirm,setConfirm]=useState<'discard'|'delete'|null>(null);
  const [scopeAction,setScopeAction]=useState<'edit'|'delete'|null>(null);
  const titleId=useId();
  const update=<K extends keyof EventFormDraft>(key:K,value:EventFormDraft[K])=>setForm(current=>({...current,[key]:value}));
  const requestClose=()=>{ if(busy)return; if(isEventFormDirty(initial,form))setConfirm('discard'); else onClose(); };
  const message=(error:unknown)=>typeof error==='object'&&error&&'message'in error&&typeof error.message==='string'?error.message:t('common.opFailed');

  const startAt=`${form.startDate}T${form.startTime}`;
  const rule=form.recurrence;
  const recurringInstance=mode.type==='edit'&&mode.event.seriesId!==null;
  // 与后端 `slots_unchanged` 同一条件：完整 start_at 加规则，日期平移也要算变更。
  const slotsChanged=mode.type==='edit'&&(mode.event.startAt!==`${form.startDate}T${form.allDay?'00:00':form.startTime}`||!sameRecurrence(mode.event.recurrence,form.recurrence));
  const changePreset=(next:RecurrencePreset)=>{ setPreset(next); update('recurrence',presetToRecurrence(next,startAt)); };
  const patchRecurrence=(patch:Partial<Recurrence>)=>{ if(form.recurrence)update('recurrence',{...form.recurrence,...patch}); };
  const changeFreq=(freq:RecurrenceFreq)=>patchRecurrence({freq,byDay:freq==='weekly'?[weekdayOf(startAt)]:[]});
  const toggleWeekday=(day:Weekday)=>{ if(!form.recurrence)return; const chosen=new Set(form.recurrence.byDay); if(!chosen.delete(day))chosen.add(day); patchRecurrence({byDay:WEEKDAYS.filter(value=>chosen.has(value))}); };
  const changeEnd=(kind:RecurrenceEnd['kind'])=>patchRecurrence({end:kind==='until'?{kind:'until',date:form.endDate}:kind==='count'?{kind:'count',count:10}:{kind:'never'}});

  function save(){
    const validation=validateEventForm(form); setErrors(validation); setDialogError(''); if(Object.keys(validation).length)return;
    if(recurringInstance){setScopeAction('edit');return;}
    void commit('all');
  }
  async function commit(scope:EditScope){
    setBusy(true);
    try { const draft=toEventDraft(form); if(mode.type==='create')await createEvent(draft); else await updateEvent(mode.event,draft,scope); if(onRememberCustomColor&&!eventColorPresets().some(p=>p.value===draft.color))await onRememberCustomColor(draft.color); await onSaved(); setScopeAction(null); onClose(); }
    catch(error){ const repositoryError=error as RepositoryError; if(repositoryError.code==='validation_error'&&repositoryError.field){setErrors({[repositoryError.field]:repositoryError.message});setScopeAction(null);} else setDialogError(message(error)); }
    finally{setBusy(false);}
  }
  function requestDelete(){ if(recurringInstance)setScopeAction('delete'); else setConfirm('delete'); }
  async function remove(scope:EditScope){ if(mode.type!=='edit')return; setBusy(true); setDialogError(''); try{await deleteEvent(mode.event,scope);await onDeleted(mode.event);setConfirm(null);setScopeAction(null);onClose();}catch(error){setDialogError(message(error));}finally{setBusy(false);} }

  return <>
    <Dialog title={mode.type==='create'?t('eventModal.createTitle'):t('eventModal.editTitle')} ariaLabelledBy={titleId} isTopLayer={!confirm&&!scopeAction} restoreFocusRef={restoreFocusRef} onRequestClose={requestClose} className="event-dialog"
      headerActions={<button type="button" aria-label={t('common.close')} className="good-icon-button" disabled={busy} onClick={requestClose}><X aria-hidden="true"/></button>}
      footer={<div className="event-dialog__actions">{dialogError&&!confirm&&!scopeAction?<div role="alert" className="dialog-error">{dialogError}</div>:null}{mode.type==='edit'?<button type="button" className="good-button good-button--danger-ghost" disabled={busy} onClick={requestDelete}>{t('eventModal.deleteEvent')}</button>:null}<button type="button" className="good-button" disabled={busy} onClick={requestClose}>{t('common.cancel')}</button><button type="button" className="good-button good-button--primary" disabled={busy} onClick={save}>{busy?t('common.saving'):t('eventModal.save')}</button></div>}>
      <form className="event-form" onSubmit={e=>{e.preventDefault();void save();}}>
        <div className="good-field"><label htmlFor="event-title">{t('eventModal.title')}</label><input id="event-title" className="good-input" autoComplete="off" value={form.title} disabled={busy} aria-describedby={errors.title?'event-title-error':undefined} onChange={e=>update('title',e.target.value)}/>{errors.title?<span id="event-title-error" className="field-error">{errors.title}</span>:null}</div>
        <label className="form-check form-check-custom form-check-solid"><input className="form-check-input" type="checkbox" checked={form.allDay} disabled={busy} onChange={e=>update('allDay',e.target.checked)}/><span className="form-check-label">{t('eventModal.allDay')}</span></label>
        <div className="form-row"><DatePicker id="event-start-date" label={t('eventModal.startDate')} value={form.startDate} errorId={errors.startAt?'event-start-error':undefined} disabled={busy} open={openPicker==='startDate'} onOpenChange={open=>setOpenPicker(open?'startDate':null)} onChange={v=>update('startDate',v)}/><DatePicker id="event-end-date" label={t('eventModal.endDate')} value={form.endDate} errorId={errors.endAt?'event-end-error':undefined} disabled={busy} open={openPicker==='endDate'} onOpenChange={open=>setOpenPicker(open?'endDate':null)} onChange={v=>update('endDate',v)}/></div>
        {!form.allDay?<div className="form-row"><TimePicker id="event-start-time" label={t('eventModal.startTime')} value={form.startTime} disabled={busy} open={openPicker==='startTime'} onOpenChange={open=>setOpenPicker(open?'startTime':null)} onChange={v=>update('startTime',v)}/><TimePicker id="event-end-time" label={t('eventModal.endTime')} value={form.endTime} disabled={busy} open={openPicker==='endTime'} onOpenChange={open=>setOpenPicker(open?'endTime':null)} onChange={v=>update('endTime',v)}/></div>:null}
        {errors.startAt?<span id="event-start-error" className="field-error">{errors.startAt}</span>:null}{errors.endAt?<span id="event-end-error" className="field-error">{errors.endAt}</span>:null}
        <div className="recurrence-field">
          <Select id="event-recurrence" label={t('eventModal.recurrence')} options={presetOptions()} value={preset} disabled={busy} onChange={v=>changePreset(v as RecurrencePreset)}/>
          {preset==='custom'&&rule?<div className="recurrence-custom">
            <div className="form-row">
              <Select id="event-recurrence-freq" label={t('recurrence.freqLabel')} options={freqOptions()} value={rule.freq} disabled={busy} onChange={v=>changeFreq(v as RecurrenceFreq)}/>
              <div className="good-field"><label htmlFor="event-recurrence-interval">{t('recurrence.interval')}</label><input id="event-recurrence-interval" className="good-input" type="number" min={1} value={rule.interval} disabled={busy} aria-describedby={errors.recurrence?'event-recurrence-error':undefined} onChange={e=>patchRecurrence({interval:Number(e.target.value)})}/></div>
            </div>
            {rule.freq==='weekly'?<fieldset className="recurrence-weekdays"><legend>{t('recurrence.byDay')}</legend>{WEEKDAYS.map((day,index)=><label key={day} className="form-check form-check-custom form-check-solid"><input className="form-check-input" type="checkbox" checked={rule.byDay.includes(day)} disabled={busy} onChange={()=>toggleWeekday(day)}/><span className="form-check-label">{weekdayLabels()[index]}</span></label>)}</fieldset>:null}
            <fieldset className="recurrence-end"><legend>{t('recurrence.endLabel')}</legend>{(['never','until','count'] as const).map(kind=><label key={kind} className="form-check form-check-custom form-check-solid"><input className="form-check-input" type="radio" name="event-recurrence-end" value={kind} checked={rule.end.kind===kind} disabled={busy} onChange={()=>changeEnd(kind)}/><span className="form-check-label">{t(`recurrence.end.${kind}`)}</span></label>)}</fieldset>
            {rule.end.kind==='until'?<DatePicker id="event-recurrence-until" label={t('recurrence.until')} value={rule.end.date} disabled={busy} open={openPicker==='recurrenceUntil'} onOpenChange={open=>setOpenPicker(open?'recurrenceUntil':null)} onChange={date=>patchRecurrence({end:{kind:'until',date}})}/>:null}
            {rule.end.kind==='count'?<div className="good-field"><label htmlFor="event-recurrence-count">{t('recurrence.count')}</label><input id="event-recurrence-count" className="good-input" type="number" min={1} value={rule.end.count} disabled={busy} onChange={e=>patchRecurrence({end:{kind:'count',count:Number(e.target.value)}})}/></div>:null}
          </div>:null}
          {errors.recurrence?<span id="event-recurrence-error" className="field-error">{errors.recurrence}</span>:null}
        </div>
        <Select id="event-category" label={t('eventModal.category')} options={categoryOptions()} value={form.category} disabled={busy} onChange={v=>update('category',v as EventCategory)}/>{errors.category?<span className="field-error">{errors.category}</span>:null}
        <ColorPicker legend={t('eventModal.color')} name="event-color" value={form.color} presets={eventColorPresets()} recentColors={recentColors} disabled={busy} onChange={color=>update('color',color)} onRememberColor={onRememberCustomColor}/>{errors.color?<span className="field-error">{errors.color}</span>:null}
        <Select id="event-linked-task" label={t('eventModal.linkedTask')} options={[{value:'',label:t('eventModal.noLink')},...tasks.map(task=>({value:task.id,label:task.title}))]} value={form.linkedTaskId??''} searchable disabled={busy} onChange={v=>update('linkedTaskId',v||null)}/>{errors.linkedTaskId?<span className="field-error">{errors.linkedTaskId}</span>:null}
        <div className="good-field"><label htmlFor="event-note">{t('eventModal.note')}</label><textarea id="event-note" className="good-input good-textarea" autoComplete="off" value={form.note} disabled={busy} onChange={e=>update('note',e.target.value)}/></div>
      </form>
    </Dialog>
    {confirm==='discard'?<ConfirmDialog title={t('common.discardTitle')} description={t('common.discardDesc')} confirmLabel={t('common.discard')} busyLabel={t('common.discarding')} onCancel={()=>setConfirm(null)} onConfirm={onClose}/>:null}
    {confirm==='delete'&&mode.type==='edit'?<ConfirmDialog title={t('eventModal.deleteTitle',{title:mode.event.title})} description={<>{t('common.deleteUnrecoverable')}<br/>{t('eventModal.deleteDesc2')}</>} tone="danger" confirmLabel={t('common.permanentDelete')} busyLabel={t('common.deleting')} busy={busy} errorMessage={dialogError} onCancel={()=>{setConfirm(null);setDialogError('');}} onConfirm={()=>void remove('all')}/>:null}
    {scopeAction&&mode.type==='edit'?<RecurrenceScopeDialog action={scopeAction} isFirstOccurrence={mode.event.occurrenceStartAt===mode.event.startAt} slotsChanged={scopeAction==='edit'&&slotsChanged} hasLinkedTask={mode.event.linkedTaskId!==null} busy={busy} errorMessage={dialogError} onCancel={()=>{setScopeAction(null);setDialogError('');}} onConfirm={scope=>{ if(scopeAction==='edit')void commit(scope); else void remove(scope); }}/>:null}
  </>;
}
