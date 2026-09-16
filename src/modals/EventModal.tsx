import { X } from '../components/icons';
import { type RefObject, useId, useMemo, useState } from 'react';
import { eventColorPresets, type CalendarEvent, type EditScope, type EventCategory, type EventDraft, type Recurrence, type RecurrenceEnd, type RecurrenceFreq, type Weekday } from '../calendar/calendar-model';
import { t } from '../i18n';
import { ColorPicker } from '../components/ColorPicker';
import type { HexColor } from '../lib/color';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DatePicker } from '../components/DatePicker';
import { Dialog } from '../components/Dialog';
import { RichEditor } from '../components/rich-text/RichEditor';
import { Select } from '../components/Select';
import { TimePicker } from '../components/TimePicker';
import type { RepositoryError } from '../data/nowly-repository';
import { applyEventDuration, createEventDraft, eventToForm, isEventFormDirty, MAX_REMINDERS, toEventDraft, validateEventForm, type EventFieldErrors, type EventFormDraft } from '../lib/event-draft';
import { presetToRecurrence, recurrenceToPreset, weekdayOf, WEEKDAYS, type RecurrencePreset } from '../lib/recurrence';
import { RecurrenceScopeDialog } from './RecurrenceScopeDialog';
import type { CalendarSubscription } from '../calendar/subscription-model';

type EventModalProps = {
  mode: { type:'create'; dateIso:string } | { type:'edit'; event:CalendarEvent };
  restoreFocusRef?: RefObject<HTMLElement | null>;
  onClose(): void;
  onSaved(): Promise<void> | void;
  onDeleted(event:CalendarEvent): Promise<void> | void;
  createEvent(draft:EventDraft,subscriptionId?:string|null): Promise<CalendarEvent|void>;
  updateEvent(event:CalendarEvent,draft:EventDraft,scope:EditScope): Promise<void>;
  deleteEvent(event:CalendarEvent,scope:EditScope): Promise<void>;
  now?: () => Date;
  recentColors?: HexColor[];
  onRememberCustomColor?: (color: HexColor) => Promise<void> | void;
  subscriptions?: CalendarSubscription[];
};

const categoryOptions = () => [{value:'work',label:t('category.work')},{value:'important',label:t('category.important')},{value:'personal',label:t('category.personal')},{value:'learning',label:t('category.learning')}];

// Reminder offsets are stored as minutes. The editor shows each as a value plus
// a unit, mirroring Google Calendar. Units are ordered largest-last so the
// display picks the coarsest unit that divides the offset evenly.
type ReminderUnit = 'minute' | 'hour' | 'day' | 'week';
const REMINDER_UNIT_MINUTES: Record<ReminderUnit, number> = { minute: 1, hour: 60, day: 1440, week: 10080 };
const reminderUnitOptions = () => (['minute','hour','day','week'] as const).map(unit=>({value:unit,label:t(`reminder.unit.${unit}`)}));
// Default a new reminder to 10 minutes before, matching the common calendar default.
const DEFAULT_REMINDER_MINUTES = 10;

function splitReminder(minutes:number):{value:number;unit:ReminderUnit}{
  for(const unit of ['week','day','hour'] as const){
    const size=REMINDER_UNIT_MINUTES[unit];
    if(minutes>=size&&minutes%size===0)return {value:minutes/size,unit};
  }
  return {value:minutes,unit:'minute'};
}
function joinReminder(value:number,unit:ReminderUnit):number{
  return Math.max(0,Math.round(value))*REMINDER_UNIT_MINUTES[unit];
}
// 已选提醒的可读标签，如「10 分钟前」；提前项使用最粗单位显示。
function reminderLabel(minutes:number):string{
  const {value,unit}=splitReminder(minutes);
  return t('reminder.leadFormat',{value,unit:t(`reminder.unit.${unit}`)});
}
// 常用提醒快捷项，存的是分钟数：10 分钟前、1 小时前。
const REMINDER_PRESETS=[10,60] as const;
// 快捷时长入口（分钟），选择后只调整结束时间。
const DURATION_PRESETS=[30,60] as const;
function durationMinutes(form:EventFormDraft):number{
  const start=new Date(`${form.startDate}T${form.startTime}`).getTime();
  const end=new Date(`${form.endDate}T${form.endTime}`).getTime();
  if(Number.isNaN(start)||Number.isNaN(end))return -1;
  return Math.round((end-start)/60000);
}
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

export function EventModal({ mode,restoreFocusRef,onClose,onSaved,onDeleted,createEvent,updateEvent,deleteEvent,now=()=>new Date(),recentColors=[],onRememberCustomColor,subscriptions=[] }:EventModalProps) {
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
  const [targetSubscriptionId,setTargetSubscriptionId]=useState<string|null>(null);
  // 预设外的提醒（例如历史自定义值）需要展开精确控件，开表单时判一次。
  const [remindersCustomOpen,setRemindersCustomOpen]=useState(()=>initial.reminders.some(minutes=>!REMINDER_PRESETS.includes(minutes as (typeof REMINDER_PRESETS)[number])));
  // 重复及更多设置默认折叠；编辑重复日程或已配置规则时展开。
  const [advancedOpen,setAdvancedOpen]=useState(()=>(mode.type==='edit'&&Boolean(mode.event.seriesId&&mode.event.recurrence))||Boolean(initial.recurrence));
  const titleId=useId();
  const advancedId=useId();
  const update=<K extends keyof EventFormDraft>(key:K,value:EventFormDraft[K])=>setForm(current=>({...current,[key]:value}));
  const requestClose=()=>{ if(busy)return; if(isEventFormDirty(initial,form))setConfirm('discard'); else onClose(); };
  const message=(error:unknown)=>typeof error==='object'&&error&&'message'in error&&typeof error.message==='string'?error.message:t('common.opFailed');

  const startAt=`${form.startDate}T${form.startTime}`;
  const rule=form.recurrence;
  const remoteEdit=mode.type==='edit'&&Boolean(mode.event.subscriptionId);
  const remoteTarget=remoteEdit||Boolean(targetSubscriptionId);
  const writableTargets=useMemo(()=>subscriptions.filter(source=>source.provider!=='ics'),[subscriptions]);
  const targetOptions=useMemo(()=>[
    {value:'local',label:t('eventModal.targetLocal')},
    ...writableTargets.map(source=>({value:source.id,label:source.name}))
  ],[writableTargets]);
  // 后端只有在 RRULE 成功解析后才会提供可编辑的重复规则；孤立的 seriesId
  //（例如历史数据或损坏 RRULE）不能把单次日程带入重复范围流程。
  const recurringInstance=mode.type==='edit'&&Boolean(mode.event.seriesId&&mode.event.recurrence);
  // 与后端 `slots_unchanged` 同一条件：完整 start_at 加规则，日期平移也要算变更。
  const slotsChanged=mode.type==='edit'&&(mode.event.startAt!==`${form.startDate}T${form.allDay?'00:00':form.startTime}`||!sameRecurrence(mode.event.recurrence,form.recurrence));
  const changePreset=(next:RecurrencePreset)=>{ setPreset(next); update('recurrence',presetToRecurrence(next,startAt)); };
  const patchRecurrence=(patch:Partial<Recurrence>)=>{ if(form.recurrence)update('recurrence',{...form.recurrence,...patch}); };
  const changeFreq=(freq:RecurrenceFreq)=>patchRecurrence({freq,byDay:freq==='weekly'?[weekdayOf(startAt)]:[]});
  const toggleWeekday=(day:Weekday)=>{ if(!form.recurrence)return; const chosen=new Set(form.recurrence.byDay); if(!chosen.delete(day))chosen.add(day); patchRecurrence({byDay:WEEKDAYS.filter(value=>chosen.has(value))}); };
  const changeEnd=(kind:RecurrenceEnd['kind'])=>patchRecurrence({end:kind==='until'?{kind:'until',date:form.endDate}:kind==='count'?{kind:'count',count:10}:{kind:'never'}});
  const addReminder=()=>update('reminders',[...form.reminders,DEFAULT_REMINDER_MINUTES]);
  const removeReminder=(index:number)=>update('reminders',form.reminders.filter((_,position)=>position!==index));
  const changeReminder=(index:number,minutes:number)=>update('reminders',form.reminders.map((value,position)=>position===index?minutes:value));
  const toggleReminderPreset=(minutes:number)=>{ if(form.reminders.includes(minutes))update('reminders',form.reminders.filter(value=>value!==minutes)); else if(form.reminders.length<MAX_REMINDERS)update('reminders',[...form.reminders,minutes]); };
  const applyDuration=(minutes:number)=>setForm(current=>applyEventDuration(current,minutes));
  const currentDuration=durationMinutes(form);

  function save(){
    const validation=validateEventForm(form); setErrors(validation); setDialogError(''); if(validation.recurrence)setAdvancedOpen(true); if(Object.keys(validation).length)return;
    if(recurringInstance){setScopeAction('edit');return;}
    void commit('all');
  }
  async function commit(scope:EditScope){
    setBusy(true);
    try { const draft=toEventDraft(form); if(mode.type==='create')await createEvent({...draft,recurrence:remoteTarget?null:draft.recurrence},targetSubscriptionId); else await updateEvent(mode.event,{...draft,recurrence:remoteEdit?null:draft.recurrence},scope); if(!remoteTarget&&onRememberCustomColor&&!eventColorPresets().some(p=>p.value===draft.color))await onRememberCustomColor(draft.color); await onSaved(); setScopeAction(null); onClose(); }
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
        <div className={`event-form__lead${mode.type==='create'&&writableTargets.length?'':' event-form__lead--single'}`}>
          <div className="good-field event-form__title"><label htmlFor="event-title">{t('eventModal.title')}</label><input id="event-title" className="good-input" autoComplete="off" value={form.title} disabled={busy} aria-describedby={errors.title?'event-title-error':undefined} onChange={e=>update('title',e.target.value)}/>{errors.title?<span id="event-title-error" className="field-error">{errors.title}</span>:null}</div>
          {mode.type==='create'&&writableTargets.length?<Select id="event-target-calendar" label={t('eventModal.targetCalendar')} options={targetOptions} value={targetSubscriptionId??'local'} disabled={busy} onChange={value=>setTargetSubscriptionId(value==='local'?null:value)}/>:null}
          {remoteEdit?<p className="event-form__note-hint">{t('eventModal.remoteCurrentOnly')}</p>:null}
        </div>
        <section className="event-form__time-range" aria-labelledby="event-time-heading">
          <div className="event-form__row-heading">
            <h3 id="event-time-heading">{t('eventModal.timeSection')}</h3>
            <label className="form-check form-check-custom form-check-solid"><input className="form-check-input" type="checkbox" checked={form.allDay} disabled={busy} onChange={e=>update('allDay',e.target.checked)}/><span className="form-check-label">{t('eventModal.allDay')}</span></label>
          </div>
          <div className="event-form__range">
            <div className="event-form__range-end">
              <DatePicker id="event-start-date" label={t('eventModal.startDate')} value={form.startDate} errorId={errors.startAt?'event-start-error':undefined} disabled={busy} open={openPicker==='startDate'} onOpenChange={open=>setOpenPicker(open?'startDate':null)} onChange={v=>update('startDate',v)}/>
              {!form.allDay?<TimePicker id="event-start-time" label={t('eventModal.startTime')} value={form.startTime} disabled={busy} open={openPicker==='startTime'} onOpenChange={open=>setOpenPicker(open?'startTime':null)} onChange={v=>update('startTime',v)}/>:null}
            </div>
            <span className="event-form__range-arrow" aria-hidden="true">→</span>
            <div className="event-form__range-end">
              <DatePicker id="event-end-date" label={t('eventModal.endDate')} value={form.endDate} errorId={errors.endAt?'event-end-error':undefined} disabled={busy} open={openPicker==='endDate'} onOpenChange={open=>setOpenPicker(open?'endDate':null)} onChange={v=>update('endDate',v)}/>
              {!form.allDay?<TimePicker id="event-end-time" label={t('eventModal.endTime')} value={form.endTime} disabled={busy} open={openPicker==='endTime'} onOpenChange={open=>setOpenPicker(open?'endTime':null)} onChange={v=>update('endTime',v)}/>:null}
            </div>
          </div>
          {!form.allDay?<div className="event-form__durations" role="group" aria-label={t('eventModal.durationLabel')}>{DURATION_PRESETS.map(minutes=><button key={minutes} type="button" className="good-chip" aria-pressed={currentDuration===minutes} disabled={busy} onClick={()=>applyDuration(minutes)}>{t(`eventModal.duration.${minutes}`)}</button>)}</div>:null}
          {errors.startAt?<span id="event-start-error" className="field-error">{errors.startAt}</span>:null}{errors.endAt?<span id="event-end-error" className="field-error">{errors.endAt}</span>:null}
        </section>
        <section className="event-form__note">
          <h3 id="event-note-heading">{t('eventModal.note')}</h3>
          <div className="good-field"><label id="event-note-label" className="visually-hidden">{t('eventModal.note')}</label><RichEditor id="event-note" labelledBy="event-note-label" value={form.note} disabled={busy} placeholder={t('richEditor.placeholder')} onChange={markdown=>update('note',markdown)}/></div>
        </section>
        <section className="event-form__quick-settings">
          <div className="event-form__setting reminder-field">
            <span className="reminder-field__label">{t('eventModal.reminders')}</span>
            <div className="reminder-field__quick">
              {REMINDER_PRESETS.map(minutes=><button key={minutes} type="button" className="good-chip" aria-pressed={form.reminders.includes(minutes)} disabled={busy||(!form.reminders.includes(minutes)&&form.reminders.length>=MAX_REMINDERS)} onClick={()=>toggleReminderPreset(minutes)}>{reminderLabel(minutes)}</button>)}
              <button type="button" className="good-chip" aria-expanded={remindersCustomOpen} disabled={busy} onClick={()=>setRemindersCustomOpen(open=>!open)}>{t('reminder.custom')}</button>
            </div>
            {form.reminders.length===0?<p className="reminder-field__empty">{t('reminder.none')}</p>:null}
            {remindersCustomOpen?<div className="reminder-field__rows">
              {form.reminders.map((minutes,index)=>{
                const {value,unit}=splitReminder(minutes);
                return <div key={index} className="reminder-row">
                  <span className="reminder-row__summary">{reminderLabel(minutes)}</span>
                  <input className="good-input reminder-row__value" type="number" min={0} value={value} disabled={busy} aria-label={t('reminder.valueLabel')} onChange={e=>changeReminder(index,joinReminder(Number(e.target.value),unit))}/>
                  <Select id={`event-reminder-unit-${index}`} label={t('reminder.unitLabel')} hideLabel options={reminderUnitOptions()} value={unit} disabled={busy} onChange={v=>changeReminder(index,joinReminder(value,v as ReminderUnit))}/>
                  <button type="button" className="good-icon-button reminder-row__remove" aria-label={t('reminder.remove')} disabled={busy} onClick={()=>removeReminder(index)}><X aria-hidden="true"/></button>
                </div>;
              })}
              {form.reminders.length<MAX_REMINDERS?<button type="button" className="good-button reminder-field__add" disabled={busy} onClick={addReminder}>{t('reminder.add')}</button>:null}
            </div>:null}
            {errors.reminders?<span className="field-error">{errors.reminders}</span>:null}
          </div>
          {!remoteTarget?<div className="event-form__setting event-form__category-color">
            <div><Select id="event-category" label={t('eventModal.category')} options={categoryOptions()} value={form.category} disabled={busy} onChange={v=>update('category',v as EventCategory)}/>{errors.category?<span className="field-error">{errors.category}</span>:null}</div>
            <div><ColorPicker legend={t('eventModal.color')} name="event-color" value={form.color} presets={eventColorPresets()} recentColors={recentColors} disabled={busy} onChange={color=>update('color',color)} onRememberColor={onRememberCustomColor}/>{errors.color?<span className="field-error">{errors.color}</span>:null}</div>
          </div>:null}
        </section>
        {!remoteTarget?<section className="event-form__advanced">
          <button type="button" className="event-form__disclosure" aria-label={t('eventModal.advancedToggle')} aria-expanded={advancedOpen} aria-controls={advancedId} disabled={busy} onClick={()=>setAdvancedOpen(open=>!open)}>
            <span className="event-form__disclosure-title">{t('eventModal.advancedToggle')}</span>
            <span className="event-form__disclosure-summary">{t(`recurrence.preset.${preset}`)}</span>
          </button>
          {advancedOpen?<div id={advancedId} className="recurrence-field">
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
          </div>:null}
        </section>:null}
      </form>
    </Dialog>
    {confirm==='discard'?<ConfirmDialog title={t('common.discardTitle')} description={t('common.discardDesc')} confirmLabel={t('common.discard')} busyLabel={t('common.discarding')} onCancel={()=>setConfirm(null)} onConfirm={onClose}/>:null}
    {confirm==='delete'&&mode.type==='edit'?<ConfirmDialog title={t('eventModal.deleteTitle',{title:mode.event.title})} description={t('common.deleteUnrecoverable')} tone="danger" confirmLabel={t('common.permanentDelete')} busyLabel={t('common.deleting')} busy={busy} errorMessage={dialogError} onCancel={()=>{setConfirm(null);setDialogError('');}} onConfirm={()=>void remove('all')}/>:null}
    {scopeAction&&mode.type==='edit'?<RecurrenceScopeDialog action={scopeAction} isFirstOccurrence={mode.event.occurrenceStartAt===mode.event.seriesStartAt} slotsChanged={scopeAction==='edit'&&slotsChanged} busy={busy} errorMessage={dialogError} onCancel={()=>{setScopeAction(null);setDialogError('');}} onConfirm={scope=>{ if(scopeAction==='edit')void commit(scope); else void remove(scope); }}/>:null}
  </>;
}
