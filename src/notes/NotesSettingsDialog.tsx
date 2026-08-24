import { Check, LayoutGrid, List, X } from 'lucide-react';
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

// Picks how the notes module lays out its notes. Each option is a full-width
// row carrying icon, name and what it does, so the choice reads as a setting
// rather than a pair of toolbar icons. Selection applies immediately.
export function NotesSettingsDialog({ view, onSelect, onClose }: NotesSettingsDialogProps) {
  const titleId = useId();
  return (
    <Dialog
      title={t('notesWidget.settingsDialogTitle')}
      ariaLabelledBy={titleId}
      onRequestClose={onClose}
      className="notes-settings-dialog"
      headerActions={
        <button type="button" className="good-icon-button" aria-label={t('common.close')} onClick={onClose}>
          <X aria-hidden="true" />
        </button>
      }
    >
      <div className="notes-settings">
        <span className="notes-settings__title">{t('notesWidget.settingsTitle')}</span>
        <p className="notes-settings__intro">{t('notesWidget.settingsIntro')}</p>
        <div className="notes-settings__options" role="radiogroup" aria-label={t('notesWidget.switchView')}>
          {notesViewOptions().map((option) => {
            const Icon = viewIcons[option.view];
            const selected = option.view === view;
            const descriptionId = `${titleId}-${option.view}-desc`;
            return (
              <button
                key={option.view}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={option.label}
                aria-describedby={descriptionId}
                className={`notes-settings__option${selected ? ' is-active' : ''}`}
                onClick={() => onSelect(option.view)}
              >
                <span className="notes-settings__option-icon" aria-hidden="true">
                  <Icon />
                </span>
                <span className="notes-settings__option-text">
                  <span className="notes-settings__option-label">{option.label}</span>
                  <span id={descriptionId} className="notes-settings__option-desc">{option.description}</span>
                </span>
                {selected ? <Check className="notes-settings__option-check" aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
      </div>
    </Dialog>
  );
}
