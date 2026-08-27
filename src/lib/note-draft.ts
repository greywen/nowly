import { DEFAULT_NOTE_COLOR, normalizeNoteIcon, type Note, type NoteDraft } from '../notes/notes-model';
import { normalizeHexColor } from './color';
import { t } from '../i18n';

export type NoteFormDraft = NoteDraft;
export type NoteFieldErrors = Partial<Record<keyof NoteDraft, string>>;

export function createNoteForm(): NoteFormDraft {
  return { title:'', content:'', color:DEFAULT_NOTE_COLOR, pinned:false, icon:'' };
}

export function noteToForm(note: Note): NoteFormDraft {
  return { title:note.title, content:note.content, color:note.color, pinned:note.pinned, icon:note.icon };
}

export function validateNoteForm(form: NoteFormDraft): NoteFieldErrors {
  if (!form.title.trim()) return { title:t('noteDraft.errorTitle') };
  if (!normalizeHexColor(form.color)) return { color:t('noteDraft.errorColor') };
  if (!normalizeNoteIcon(form.icon) && form.icon !== '') return { icon:t('noteDraft.errorIcon') };
  return {};
}

export function toNoteDraft(form: NoteFormDraft): NoteDraft {
  return {
    ...form,
    title:form.title.trim(),
    color:normalizeHexColor(form.color) as NoteDraft['color'],
    icon:normalizeNoteIcon(form.icon)
  };
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
