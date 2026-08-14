import { Plus } from 'lucide-react';
import type { Note } from './notes-model';
import { colorStyle } from '../lib/color';
import { t } from '../i18n';

type LoadStatus = 'loading' | 'ready' | 'error';

type NotesWidgetProps = {
  notes: Note[];
  status: LoadStatus;
  errorMessage?: string;
  onRetry: () => void;
  onCreateNote: () => void;
  onOpenNote: (note: Note, trigger: HTMLElement) => void;
  onViewAll: (trigger: HTMLElement) => void;
};

export function NotesWidget({
  notes,
  status,
  errorMessage,
  onRetry,
  onCreateNote,
  onOpenNote,
  onViewAll
}: NotesWidgetProps) {
  const sortedNotes = [...notes].sort((left, right) => Number(right.pinned) - Number(left.pinned));

  return (
    <div className="widget-content">
      <div className="card-header card-header--actions-only">
        <div className="toolbar-actions">
          <button type="button" className="link-btn" onClick={(event) => onViewAll(event.currentTarget)}>{t('notesWidget.viewAll')}</button>
          <button type="button" className="btn btn-icon" aria-label={t('notesWidget.newNote')} onClick={onCreateNote}>
            <Plus aria-hidden="true" />
          </button>
        </div>
      </div>
      <div data-testid="notes-scroll" className="panel-body">
        {status === 'error' ? (
          <div className="module-message" role="alert">
            <span>{errorMessage ?? t('notesWidget.errorLoad')}</span>
            <button type="button" className="link-btn" aria-label={t('notesWidget.retryLoad')} onClick={onRetry}>
              {t('common.retry')}
            </button>
          </div>
        ) : null}
        {status === 'loading' ? <p className="empty-copy">{t('notesWidget.loading')}</p> : null}
        {status === 'ready' && sortedNotes.length === 0 ? (
          <div className="empty-state">
            <p>{t('notesWidget.empty')}</p>
            <button
              type="button"
              className="link-btn"
              aria-label={t('notesWidget.createNote')}
              onClick={onCreateNote}
            >
              {t('notesWidget.createNote')}
            </button>
          </div>
        ) : null}
        <div className="notes-list">
          {sortedNotes.map((note) => (
            <button
              key={note.id}
              type="button"
              onClick={(event) => onOpenNote(note, event.currentTarget)}
              className="note"
              style={colorStyle(note.color)}
            >
              <div className="note-title">{note.title}</div>
              <div className="note-content">{note.content}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
