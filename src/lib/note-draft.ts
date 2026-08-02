import type { Note, NoteDraft } from '../notes/notes-model';

export type NoteFormDraft = NoteDraft;
export type NoteFieldErrors = Partial<Record<keyof NoteDraft, string>>;

export function createNoteForm(): NoteFormDraft {
  return { title:'', content:'', color:'yellow', pinned:false };
}

export function noteToForm(note: Note): NoteFormDraft {
  return { title:note.title, content:note.content, color:note.color, pinned:note.pinned };
}

export function validateNoteForm(form: NoteFormDraft): NoteFieldErrors {
  return form.title.trim() ? {} : { title:'请输入便签标题。' };
}

export function toNoteDraft(form: NoteFormDraft): NoteDraft {
  return { ...form, title:form.title.trim() };
}

export function isNoteFormDirty(initial: NoteFormDraft, current: NoteFormDraft) {
  return JSON.stringify(initial) !== JSON.stringify(current);
}

export function sortNotes(notes: Note[]) {
  return [...notes].sort((left, right) =>
    Number(right.pinned) - Number(left.pinned)
    || right.updatedAt.localeCompare(left.updatedAt)
    || left.id.localeCompare(right.id)
  );
}
