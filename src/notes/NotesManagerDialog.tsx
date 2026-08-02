import { Pin, Plus, X } from 'lucide-react';
import { type RefObject, useId } from 'react';
import { Dialog } from '../components/Dialog';
import { sortNotes } from '../lib/note-draft';
import type { Note } from './notes-model';

export function NotesManagerDialog({notes,onClose,onCreate,onEdit,restoreFocusRef}:{
  notes:Note[]; onClose():void; onCreate(trigger:HTMLElement):void;
  onEdit(note:Note, trigger:HTMLElement):void; restoreFocusRef?:RefObject<HTMLElement|null>;
}) {
  const titleId=useId();
  return <Dialog title="全部便签" ariaLabelledBy={titleId} onRequestClose={onClose} restoreFocusRef={restoreFocusRef} className="notes-manager-dialog"
    headerActions={<>
      <button type="button" className="good-button good-button--primary" onClick={(e)=>onCreate(e.currentTarget)}><Plus aria-hidden="true" />新增便签</button>
      <button type="button" aria-label="关闭" className="good-icon-button" onClick={onClose}><X aria-hidden="true" /></button>
    </>}>
    <div data-testid="notes-manager-scroll" className="notes-manager-list">
      {notes.length === 0 ? <div className="empty-state"><p>还没有便签</p></div> : sortNotes(notes).map(note =>
        <button key={note.id} type="button" className={`note note--${note.color}`} aria-label={`编辑便签：${note.title}`} onClick={(e)=>onEdit(note,e.currentTarget)}>
          <div className="note-title">{note.pinned ? <Pin aria-label="已置顶" /> : null}{note.title}</div>
          <div className="note-content">{note.content || '无内容'}</div>
        </button>)}
    </div>
  </Dialog>;
}
