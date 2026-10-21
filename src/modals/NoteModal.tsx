import { Pin, SmileCircle, X } from '../components/icons';
import { isContentEmpty } from '../components/rich-text/content';
import { noteTitle } from '../notes/note-title';
import { type RefObject, useId, useMemo, useState } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Dialog } from '../components/Dialog';
import { RichEditor } from '../components/rich-text/RichEditor';
import { Select } from '../components/Select';
import type { RepositoryError } from '../data/nowly-repository';
import { createNoteForm,isNoteFormDirty,noteToForm,toNoteDraft,validateNoteForm,type NoteFieldErrors,type NoteFormDraft } from '../lib/note-draft';
import { noteColorPresets, noteIconOptions, noteIconSymbol, type Note, type NoteDraft } from '../notes/notes-model';
import { ColorPicker } from '../components/ColorPicker';
import type { HexColor } from '../lib/color';
import { t } from '../i18n';

const message=(error:unknown)=>typeof error==='object'&&error!==null&&'message'in error&&typeof error.message==='string'?error.message:t('common.opFailed');
export function NoteModal({mode,onClose,onSaved,onDeleted,createNote,updateNote,deleteNote,restoreFocusRef,recentColors=[],onRememberCustomColor}:{
 mode:{type:'create'}|{type:'edit';note:Note}; onClose():void; onSaved(note:Note):void|Promise<void>; onDeleted(note:Note):void|Promise<void>;
 createNote(draft:NoteDraft):Promise<Note>; updateNote(note:Note,draft:NoteDraft):Promise<Note>; deleteNote(note:Note):Promise<void>; restoreFocusRef?:RefObject<HTMLElement|null>; recentColors?:HexColor[]; onRememberCustomColor?:(color:HexColor)=>Promise<void>|void;
}){
 const initial=useMemo(()=>mode.type==='edit'?noteToForm(mode.note):createNoteForm(),[mode]);
 const [form,setForm]=useState<NoteFormDraft>(initial);const [errors,setErrors]=useState<NoteFieldErrors>({});const [dialogError,setDialogError]=useState('');const [busy,setBusy]=useState(false);const [confirm,setConfirm]=useState<'discard'|'delete'|null>(null);const titleId=useId();
 const update=<K extends keyof NoteFormDraft>(key:K,value:NoteFormDraft[K])=>setForm(current=>({...current,[key]:value}));
 function requestClose(){if(busy)return;if(isNoteFormDirty(initial,form))setConfirm('discard');else onClose();}
 async function save(){const validation=validateNoteForm(form,mode.type==='edit'&&isContentEmpty(initial.content)&&form.content===initial.content);setErrors(validation);setDialogError('');if(Object.keys(validation).length)return;setBusy(true);try{const saved=mode.type==='create'?await createNote(toNoteDraft(form)):await updateNote(mode.note,toNoteDraft(form));if(onRememberCustomColor&&!noteColorPresets().some(p=>p.value===saved.color))await onRememberCustomColor(saved.color);await onSaved(saved);onClose();}catch(error){const repositoryError=error as RepositoryError;if(repositoryError.code==='validation_error'&&repositoryError.field)setErrors({[repositoryError.field]:repositoryError.message});else setDialogError(message(error));}finally{setBusy(false);}}
 async function remove(){if(mode.type!=='edit')return;setBusy(true);setDialogError('');try{await deleteNote(mode.note);await onDeleted(mode.note);setConfirm(null);onClose();}catch(error){setDialogError(message(error));}finally{setBusy(false);}}
 return <><Dialog title={mode.type==='create'?t('noteModal.createTitle'):t('noteModal.editTitle')} ariaLabelledBy={titleId} isTopLayer={!confirm} restoreFocusRef={restoreFocusRef} onRequestClose={requestClose} className="note-dialog" headerActions={<button type="button" aria-label={t('common.close')} className="good-icon-button" disabled={busy} onClick={requestClose}><X aria-hidden="true"/></button>} footer={<>
 <div className="note-dialog__options">
  <ColorPicker compact legend={t('noteModal.color')} name="note-color" value={form.color} presets={noteColorPresets()} recentColors={recentColors} disabled={busy} onChange={color=>update('color',color)} onRememberColor={onRememberCustomColor} portalWithinDialog/>
  <Select id="note-icon" label={t('noteModal.icon')} hideLabel fitContent triggerIcon={form.icon?<span className="note-dialog__icon" aria-hidden="true">{noteIconSymbol(form.icon)}</span>:<SmileCircle size={16} aria-hidden="true"/>} value={form.icon} disabled={busy} options={noteIconOptions().map(option=>({value:option.value,label:option.symbol?`${option.symbol} ${option.label}`:option.label}))} onChange={value=>update('icon',value as NoteFormDraft['icon'])}/>
  <label className="form-check note-dialog__pin" title={t(form.pinned?'noteModal.unpin':'noteModal.pinned')}>
   <input className="form-check-input" type="checkbox" aria-label={t('noteModal.pinned')} checked={form.pinned} disabled={busy} onChange={event=>update('pinned',event.target.checked)}/>
   <Pin size={16} aria-hidden="true"/>
  </label>
 </div>
 <div className="note-dialog__actions">{dialogError&&!confirm?<div role="alert" className="dialog-error">{dialogError}</div>:null}{mode.type==='edit'?<button type="button" className="good-button good-button--danger-ghost" disabled={busy} onClick={()=>setConfirm('delete')}>{t('noteModal.deleteNote')}</button>:null}<button type="button" className="good-button" disabled={busy} onClick={requestClose}>{t('common.cancel')}</button><button type="button" className="good-button good-button--primary" disabled={busy} onClick={()=>void save()}>{busy?t('common.saving'):t('noteModal.saveNote')}</button></div></>}>
 <form className="note-form" onSubmit={event=>{event.preventDefault();void save();}}>
  <div className="good-field">
   <label className="visually-hidden" id="note-content-label">{t('noteModal.content')}</label>
   <RichEditor id="note-content" labelledBy="note-content-label" value={form.content} disabled={busy} placeholder={t('richEditor.placeholder')} onChange={content=>update('content',content)}/>
   {errors.content?<span role="alert" className="field-error">{errors.content}</span>:null}
  </div>
  {errors.color||errors.icon?<span role="alert" className="field-error">{errors.color||errors.icon}</span>:null}
 </form>
 </Dialog>{confirm==='discard'?<ConfirmDialog title={t('common.discardTitle')} description={t('common.discardDesc')} confirmLabel={t('common.discard')} busyLabel={t('common.discarding')} onCancel={()=>setConfirm(null)} onConfirm={onClose}/>:null}{confirm==='delete'&&mode.type==='edit'?<ConfirmDialog title={t('noteModal.deleteTitle',{title:noteTitle(mode.note.content)})} description={t('common.deleteUnrecoverable')} tone="danger" confirmLabel={t('common.permanentDelete')} busyLabel={t('common.deleting')} busy={busy} errorMessage={dialogError} onCancel={()=>{setConfirm(null);setDialogError('');}} onConfirm={()=>void remove()}/>:null}</>;
}
