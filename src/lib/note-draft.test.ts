import { describe, expect, it } from 'vitest';
import { createNoteForm, isNoteFormDirty, noteToForm, sortNotes, toNoteDraft, validateNoteForm } from './note-draft';
import type { Note } from '../notes/notes-model';

const note: Note = { id:'n1', title:'原则', content:'简单', color:'purple', pinned:true, createdAt:'2026-07-20', updatedAt:'2026-07-21' };

describe('note draft', () => {
  it('creates, copies, validates, and converts drafts', () => {
    expect(createNoteForm()).toEqual({ title:'', content:'', color:'yellow', pinned:false });
    expect(noteToForm(note)).toEqual({ title:'原则', content:'简单', color:'purple', pinned:true });
    expect(validateNoteForm({ ...createNoteForm(), title:'  ' })).toEqual({ title:'请输入便签标题。' });
    expect(toNoteDraft({ ...createNoteForm(), title:'  原则  ', content:' 内容 ' })).toEqual({ title:'原则', content:' 内容 ', color:'yellow', pinned:false });
    expect(isNoteFormDirty(noteToForm(note), { ...noteToForm(note), pinned:false })).toBe(true);
  });

  it('sorts pinned notes before latest updates with stable ids', () => {
    const notes = [
      { ...note, id:'old', pinned:false, updatedAt:'2026-07-20' },
      { ...note, id:'b', updatedAt:'2026-07-22' },
      { ...note, id:'a', updatedAt:'2026-07-22' },
      { ...note, id:'new', pinned:false, updatedAt:'2026-07-23' }
    ];
    expect(sortNotes(notes).map(({ id }) => id)).toEqual(['a','b','new','old']);
  });
});
