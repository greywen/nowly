import { useCallback, useState } from 'react';
import { DEFAULT_NOTES_VIEW, isNotesViewMode, type NotesViewMode } from './notes-model';

// The chosen notes layout is a local look preference, so it is stored next to
// the other UI preferences (`useBlur`, `useOnboarding`) instead of the database.
export const NOTES_VIEW_STORAGE_KEY = 'nowly:notes-view';
export { DEFAULT_NOTES_VIEW };

function readStoredView(): NotesViewMode {
  try {
    const raw = localStorage.getItem(NOTES_VIEW_STORAGE_KEY);
    return isNotesViewMode(raw) ? raw : DEFAULT_NOTES_VIEW;
  } catch {
    return DEFAULT_NOTES_VIEW;
  }
}

export function useNotesView() {
  const [view, setViewState] = useState<NotesViewMode>(() => readStoredView());

  const setView = useCallback((next: NotesViewMode) => {
    setViewState(next);
    try {
      localStorage.setItem(NOTES_VIEW_STORAGE_KEY, next);
    } catch {
      /* persistence is best-effort; the live view still applies */
    }
  }, []);

  return { view, setView };
}
