import { Check, Minus, Plus, X } from '../components/icons';
import { Dialog } from '../components/Dialog';
import {
  builtinDefinitions,
  extensionDefinitions,
  kanbanDefinition,
  type WidgetDefinition,
  type WidgetId
} from './widget-registry';
import { t } from '../i18n';

type Props = {
  presentIds: Set<WidgetId>;
  onClose(): void;
  onAdd(id: WidgetId): void;
  onRemove(id: WidgetId): void;
};

// A single module preview card. Clicking the card toggles placement: modules
// that are not on the canvas get added, and modules already present get
// removed. This lets the user cancel an addition right inside the dialog
// without hunting for the module on the canvas.
function ModuleCard({
  definition,
  added,
  onToggle
}: {
  definition: WidgetDefinition;
  added: boolean;
  onToggle(): void;
}) {
  return (
    <button
      type="button"
      className={`template-card${added ? ' is-added' : ''}`}
      aria-pressed={added}
      aria-label={added ? t('template.remove', { name: definition.name }) : t('template.add', { name: definition.name })}
      onClick={onToggle}
    >
      <div className="template-card__meta">
        <span className="template-card__name">{definition.name}</span>
        <span className="template-card__desc">{definition.description}</span>
      </div>
      <span className="template-card__action">
        {added ? (
          <>
            <Check aria-hidden="true" className="template-card__action-added" />
            <Minus aria-hidden="true" className="template-card__action-remove" />
            <span className="template-card__action-added">{t('template.added')}</span>
            <span className="template-card__action-remove">{t('template.removeShort')}</span>
          </>
        ) : (
          <>
            <Plus aria-hidden="true" /> {t('template.addShort')}
          </>
        )}
      </span>
    </button>
  );
}

// Every module Nowly offers is built in, so the picker is a single list: add a
// module to the canvas or take it off again.
export function TemplatePickerDialog({ presentIds, onClose, onAdd, onRemove }: Props) {
  const builtinModules = [...builtinDefinitions, kanbanDefinition, ...extensionDefinitions];

  function toggle(id: WidgetId) {
    if (presentIds.has(id)) onRemove(id);
    else onAdd(id);
  }

  return (
    <Dialog
      title={t('template.title')}
      ariaLabelledBy="template-picker-title"
      onRequestClose={onClose}
      className="template-picker-dialog"
      headerActions={
        <button className="good-icon-button" aria-label={t('template.close')} onClick={onClose}>
          <X aria-hidden="true" />
        </button>
      }
    >
      <div className="template-picker">
        <section className="template-picker__group">
          <div className="template-grid">
            {builtinModules.map((definition) => (
              <ModuleCard
                key={definition.id}
                definition={definition}
                added={presentIds.has(definition.id)}
                onToggle={() => toggle(definition.id)}
              />
            ))}
          </div>
        </section>
      </div>
    </Dialog>
  );
}
