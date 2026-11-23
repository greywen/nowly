import { Paperclip, Pin, Plus, X } from '../components/icons';
import { type RefObject, useId, useRef, useState } from 'react';
import { Dialog } from '../components/Dialog';
import { colorStyle } from '../lib/color';
import { sortNotes } from '../lib/note-draft';
import { noteIconSymbol, type Note } from './notes-model';
import { useNotePreviews } from './useNotePreviews';
import { t } from '../i18n';
import { noteTitle } from './note-title';
import { NoteExportControls } from './export/NoteExportControls';

export function NotesManagerDialog({notes,onClose,onCreate,onEdit,restoreFocusRef}:{
  notes:Note[]; onClose():void; onCreate(trigger:HTMLElement):void;
  onEdit(note:Note, trigger:HTMLElement):void; restoreFocusRef?:RefObject<HTMLElement|null>;
}) {
  const titleId=useId();
  const [exporting,setExporting]=useState(false);
  const [busy,setBusy]=useState(false);
  const [selected,setSelected]=useState<Set<string>>(()=>new Set());
  const exportTrigger=useRef<HTMLButtonElement>(null);
  const sorted=sortNotes(notes);
  const chosen=sorted.filter(note=>selected.has(note.id));
  const all=notes.length>0&&chosen.length===notes.length;
  const List = exporting ? 'fieldset' : 'div';
  function exitExport(){if(busy)return;setExporting(false);setSelected(new Set());exportTrigger.current?.focus();}
  // Same previews as the widget, so a note reads the same way in both places.
  const previews=useNotePreviews(notes);
  return <Dialog title={t('notesManager.title')} ariaLabelledBy={titleId} onRequestClose={()=>{if(!busy){if(exporting)exitExport();else onClose();}}} restoreFocusRef={restoreFocusRef} className={`notes-manager-dialog${exporting?' notes-manager-dialog--exporting':''}`}
    footer={exporting?<NoteExportControls notes={chosen} onBusyChange={setBusy}/>:undefined}
    headerActions={<>
      <button ref={exportTrigger} type="button" className="good-button" disabled={busy||!notes.length} onClick={()=>exporting?exitExport():setExporting(true)}>{t(exporting?'noteExport.exit':'noteExport.open')}</button>
      {!exporting?<button type="button" className="good-button good-button--primary" onClick={(e)=>onCreate(e.currentTarget)}><Plus aria-hidden="true" />{t('notesManager.newNote')}</button>:null}
      <button type="button" aria-label={t('common.close')} className="good-icon-button" disabled={busy} onClick={onClose}><X aria-hidden="true" /></button>
    </>}>
    {exporting?<div className="notes-export-selection">
      <label className="form-check"><input className="form-check-input" type="checkbox" disabled={busy} checked={all}
        ref={element=>{if(element)element.indeterminate=chosen.length>0&&!all;}}
        onChange={()=>setSelected(all?new Set():new Set(notes.map(note=>note.id)))}/><span>{t('noteExport.all')}</span></label>
      <span className="notes-export-selection__count">{t('noteExport.count',{selected:chosen.length,total:notes.length})}</span>
    </div>:null}
    <List data-testid="notes-manager-scroll" className="notes-manager-list">
      {exporting?<legend className="visually-hidden">{t('noteExport.open')}</legend>:null}
      {notes.length === 0 ? <div className="empty-state"><p>{t('notesManager.empty')}</p></div> : sorted.map(note => {
        const preview = previews.get(note.id);
        const content=<>
          <div className="note-title">{note.pinned ? <Pin aria-label={t('notesManager.pinned')} /> : null}{noteIconSymbol(note.icon) ? <span className="note-icon" aria-hidden="true">{noteIconSymbol(note.icon)}</span> : null}<span className="note-title__text">{noteTitle(note.content)}</span></div>
          <div className="note-row">
            {preview?.thumbnailUrl ? <img className="note-thumb" src={preview.thumbnailUrl} alt="" /> : null}
            <div className="note-content">{preview?.text || t('notesManager.noContent')}</div>
          </div>
          {preview?.attachmentCount ? (
            <span className="note-clip" aria-label={t('notesWidget.attachments', { count: preview.attachmentCount })}>
              <Paperclip aria-hidden="true" />
              {preview.attachmentCount}
            </span>
          ) : null}
        </>;
        return exporting?<label key={note.id} className="note notes-export-choice" style={colorStyle(note.color)}>
          <input className="form-check-input" type="checkbox" disabled={busy} checked={selected.has(note.id)}
            aria-label={t('noteExport.select',{title:noteTitle(note.content)})}
            onChange={()=>setSelected(current=>{const next=new Set(current);if(next.has(note.id))next.delete(note.id);else next.add(note.id);return next;})}/>
          <div className="notes-export-choice__content">{content}</div>
        </label>:<button key={note.id} type="button" className="note" style={colorStyle(note.color)} aria-label={t('notesManager.editNote', { title: noteTitle(note.content) })} onClick={(e)=>onEdit(note,e.currentTarget)}>{content}</button>;
      })}
    </List>
  </Dialog>;
}
