import { Plus, Settings } from 'lucide-react';
import { useState } from 'react';
import { DEFAULT_NOTES_VIEW, type Note, type NotesViewMode } from './notes-model';
import { NotesSettingsDialog } from './NotesSettingsDialog';
import { colorStyle } from '../lib/color';
import { t } from '../i18n';

type LoadStatus = 'loading' | 'ready' | 'error';

type NotesWidgetProps = {
  notes: Note[];
  status: LoadStatus;
  errorMessage?: string;
  view?: NotesViewMode;
  onSetView?: (view: NotesViewMode) => void;
  onRetry: () => void;
  onCreateNote: () => void;
  onOpenNote: (note: Note, trigger: HTMLElement) => void;
  onViewAll: (trigger: HTMLElement) => void;
};

// Sticky notes hang at a few fixed angles so the board reads as paper instead
// of a card grid. The tilt is static; nothing animates.
const BOARD_TILTS = 4;

export function NotesWidget({
  notes,
  status,
  errorMessage,
  view = DEFAULT_NOTES_VIEW,
  onSetView,
  onRetry,
  onCreateNote,
  onOpenNote,
  onViewAll
}: NotesWidgetProps) {
  const sortedNotes = [...notes].sort((left, right) => Number(right.pinned) - Number(left.pinned));
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div className="widget-content">
      <div className="card-header">
        <div className="heading-group">
          <p>{t('notesWidget.count', { count: notes.length })}</p>
        </div>
        <div className="toolbar-actions">
          <button type="button" className="link-btn" onClick={(event) => onViewAll(event.currentTarget)}>{t('notesWidget.viewAll')}</button>
          {onSetView ? (
            <button
              type="button"
              className="btn btn-icon"
              aria-label={t('notesWidget.settings')}
              onClick={() => setSettingsOpen(true)}
            >
              <Settings aria-hidden="true" />
            </button>
          ) : null}
          <button type="button" className="btn btn-icon btn-primary" aria-label={t('notesWidget.newNote')} onClick={onCreateNote}>
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
        {view === 'board' ? (
          <div data-testid="notes-board" className="notes-board">
            {sortedNotes.map((note, index) => (
              <button
                key={note.id}
                type="button"
                onClick={(event) => onOpenNote(note, event.currentTarget)}
                className={`sticky-note sticky-note--tilt-${index % BOARD_TILTS}`}
                style={colorStyle(note.color)}
              >
                <span className="sticky-note__tape" aria-hidden="true" />
                <span className="sticky-note__title">{note.title}</span>
                <span className="sticky-note__content">{note.content}</span>
              </button>
            ))}
          </div>
        ) : (
          <div data-testid="notes-list" className="notes-list">
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
        )}
      </div>
      {onSetView && settingsOpen ? (
        <NotesSettingsDialog
          view={view}
          onSelect={onSetView}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
    </div>
  );
}
