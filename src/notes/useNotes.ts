import { useCallback, useEffect, useRef, useState } from 'react';
import { useNowlyRepository } from '../data/RepositoryContext';
import { sortNotes } from '../lib/note-draft';
import { t } from '../i18n';
import type { Note, NoteDraft } from './notes-model';

type NotesResource =
  | { status:'loading'; data:Note[] }
  | { status:'ready'; data:Note[] }
  | { status:'error'; data:Note[]; message:string };

function messageFrom(error: unknown) {
  return typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
    ? error.message : t('notesWidget.readError');
}

export function useNotes() {
  const repository = useNowlyRepository();
  const [notes, setNotes] = useState<NotesResource>({status:'loading', data:[]});
  const requestIdRef = useRef(0);

  const readNotes = useCallback(async (silent: boolean) => {
    const requestId = ++requestIdRef.current;
    if (!silent) setNotes((current) => ({status:'loading', data:current.data}));
    try {
      const data = sortNotes(await repository.listNotes());
      if (requestId === requestIdRef.current) setNotes({status:'ready', data});
    } catch (error) {
      // A silent refresh keeps what is on screen; only an explicit read reports the failure.
      if (!silent && requestId === requestIdRef.current) setNotes((current) => ({status:'error', data:current.data, message:messageFrom(error)}));
    }
  }, [repository]);
  const loadNotes = useCallback(() => readNotes(false), [readNotes]);
  // For notes written by another window.
  const refreshNotes = useCallback(() => readNotes(true), [readNotes]);

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

  return { notes, retryNotes:loadNotes, refreshNotes, createNote, updateNote, deleteNote };
}
