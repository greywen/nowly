import { useCallback, useEffect, useRef, useState } from 'react';
import { useNowlyRepository } from '../data/RepositoryContext';
import { sortNotes } from '../lib/note-draft';
import type { Note, NoteDraft } from './notes-model';

type NotesResource =
  | { status:'loading'; data:Note[] }
  | { status:'ready'; data:Note[] }
  | { status:'error'; data:Note[]; message:string };

function messageFrom(error: unknown) {
  return typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
    ? error.message : '无法读取本地便签，请重试。';
}

export function useNotes() {
  const repository = useNowlyRepository();
  const [notes, setNotes] = useState<NotesResource>({status:'loading', data:[]});
  const requestIdRef = useRef(0);

  const loadNotes = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setNotes((current) => ({status:'loading', data:current.data}));
    try {
      const data = sortNotes(await repository.listNotes());
      if (requestId === requestIdRef.current) setNotes({status:'ready', data});
    } catch (error) {
      if (requestId === requestIdRef.current) setNotes((current) => ({status:'error', data:current.data, message:messageFrom(error)}));
    }
  }, [repository]);

  useEffect(() => { void loadNotes(); }, [loadNotes]);

  const createNote = useCallback(async (draft: NoteDraft) => {
    const created = await repository.createNote(draft);
    await loadNotes();
    return created;
  }, [loadNotes, repository]);

  const updateNote = useCallback(async (note: Note, draft: NoteDraft) => {
    const updated = await repository.updateNote(note.id, draft);
    await loadNotes();
    return updated;
  }, [loadNotes, repository]);

  const deleteNote = useCallback(async (note: Note) => {
    await repository.deleteNote(note.id);
    await loadNotes();
  }, [loadNotes, repository]);

  return { notes, retryNotes:loadNotes, createNote, updateNote, deleteNote };
}
