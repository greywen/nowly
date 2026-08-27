import { describe, expect, it } from 'vitest';
import { createNoteForm, isNoteFormDirty, noteToForm, sortNotes, toNoteDraft, validateNoteForm } from './note-draft';
import type { Note } from '../notes/notes-model';

const note: Note = { id:'n1', title:'原则', content:'简单', color:'#4F55DA', pinned:true, styleVariant:2, icon:'star', createdAt:'2026-07-20', updatedAt:'2026-07-21' };

describe('note draft', () => {
  it('creates, copies, validates, and converts drafts', () => {
    expect(createNoteForm()).toEqual({ title:'', content:'', color:'#E8C444', pinned:false, icon:'' });
    expect(noteToForm(note)).toEqual({ title:'原则', content:'简单', color:'#4F55DA', pinned:true, icon:'star' });
    expect(validateNoteForm({ ...createNoteForm(), title:'  ' })).toEqual({ title:'请输入便签标题。' });
    expect(validateNoteForm({ ...createNoteForm(), title:'原则', color:'yellow' as never })).toEqual({ color:'请选择有效颜色。' });
    expect(toNoteDraft({ ...createNoteForm(), title:'原则', color:'#7c5cfc' })).toMatchObject({ color:'#7C5CFC' });
    expect(toNoteDraft({ ...createNoteForm(), title:'原则', icon:'STAR' as never })).toMatchObject({ icon:'star' });
    expect(toNoteDraft({ ...createNoteForm(), title:'  原则  ', content:' 内容 ' })).toEqual({ title:'原则', content:' 内容 ', color:'#E8C444', pinned:false, icon:'' });
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
