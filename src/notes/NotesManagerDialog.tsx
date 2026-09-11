import { Paperclip, Pin, Plus, X } from '../components/icons';
import { type RefObject, useId } from 'react';
import { Dialog } from '../components/Dialog';
import { colorStyle } from '../lib/color';
import { sortNotes } from '../lib/note-draft';
import { noteIconSymbol, type Note } from './notes-model';
import { useNotePreviews } from './useNotePreviews';
import { t } from '../i18n';

export function NotesManagerDialog({notes,onClose,onCreate,onEdit,restoreFocusRef}:{
  notes:Note[]; onClose():void; onCreate(trigger:HTMLElement):void;
  onEdit(note:Note, trigger:HTMLElement):void; restoreFocusRef?:RefObject<HTMLElement|null>;
}) {
  const titleId=useId();
  // Same previews as the widget, so a note reads the same way in both places.
  const previews=useNotePreviews(notes);
  return <Dialog title={t('notesManager.title')} ariaLabelledBy={titleId} onRequestClose={onClose} restoreFocusRef={restoreFocusRef} className="notes-manager-dialog"
    headerActions={<>
      <button type="button" className="good-button good-button--primary" onClick={(e)=>onCreate(e.currentTarget)}><Plus aria-hidden="true" />{t('notesManager.newNote')}</button>
      <button type="button" aria-label={t('common.close')} className="good-icon-button" onClick={onClose}><X aria-hidden="true" /></button>
    </>}>
    <div data-testid="notes-manager-scroll" className="notes-manager-list">
      {notes.length === 0 ? <div className="empty-state"><p>{t('notesManager.empty')}</p></div> : sortNotes(notes).map(note => {
        const preview = previews.get(note.id);
        return (
        <button key={note.id} type="button" className="note" style={colorStyle(note.color)} aria-label={t('notesManager.editNote', { title: note.title })} onClick={(e)=>onEdit(note,e.currentTarget)}>
          <div className="note-title">{note.pinned ? <Pin aria-label={t('notesManager.pinned')} /> : null}{noteIconSymbol(note.icon) ? <span className="note-icon" aria-hidden="true">{noteIconSymbol(note.icon)}</span> : null}{note.title}</div>
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
        </button>
        );
      })}
    </div>
  </Dialog>;
}
