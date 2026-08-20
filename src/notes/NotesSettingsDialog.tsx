import { LayoutGrid, List, X } from 'lucide-react';
import { useId } from 'react';
import { Dialog } from '../components/Dialog';
import { notesViewOptions, type NotesViewMode } from './notes-model';
import { t } from '../i18n';

const viewIcons = { list: List, board: LayoutGrid } as const;

type NotesSettingsDialogProps = {
  view: NotesViewMode;
  onSelect: (view: NotesViewMode) => void;
  onClose: () => void;
};

// Picks how the notes module lays out its notes. The choice reads as a plain
// option list rather than a pair of toolbar icons, so the intent stays legible.
// Selection applies immediately; there is no transition anywhere.
export function NotesSettingsDialog({ view, onSelect, onClose }: NotesSettingsDialogProps) {
  const titleId = useId();
  return (
    <Dialog
      title={t('notesWidget.settingsTitle')}
      ariaLabelledBy={titleId}
      onRequestClose={onClose}
      className="notes-settings-dialog"
      headerActions={
        <button type="button" className="good-icon-button" aria-label={t('common.close')} onClick={onClose}>
          <X aria-hidden="true" />
        </button>
      }
    >
      <div className="notes-settings__options" role="radiogroup" aria-label={t('notesWidget.switchView')}>
        {notesViewOptions().map((option) => {
          const Icon = viewIcons[option.view];
          const selected = option.view === view;
          return (
            <button
              key={option.view}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`notes-settings__tile${selected ? ' is-active' : ''}`}
              onClick={() => onSelect(option.view)}
            >
              <Icon className="notes-settings__tile-icon" aria-hidden="true" />
              <span className="notes-settings__tile-label">{option.label}</span>
            </button>
          );
        })}
      </div>
    </Dialog>
  );
}
