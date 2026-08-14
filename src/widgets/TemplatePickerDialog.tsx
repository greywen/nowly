import { useRef, useState } from 'react';
import { Check, Minus, Plus, Trash2, Upload, X } from 'lucide-react';
import { Dialog } from '../components/Dialog';
import type { SandboxExtension, SandboxExtensionDraft } from '../data/nowly-repository';
import {
  builtinDefinitions,
  extensionDefinitions,
  kanbanDefinition,
  sandboxExtensionToDefinition,
  type WidgetDefinition,
  type WidgetId
} from './widget-registry';
import { t } from '../i18n';

type Props = {
  presentIds: Set<WidgetId>;
  sandboxExtensions: SandboxExtension[];
  onClose(): void;
  onAdd(id: WidgetId): void;
  onRemove(id: WidgetId): void;
  onInstallExtension(draft: SandboxExtensionDraft): Promise<unknown>;
  onUninstallExtension(extension: SandboxExtension): void;
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

function errorMessage(error: unknown) {
  return typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
    ? (error.message as string)
    : t('template.uploadError');
}

export function TemplatePickerDialog({
  presentIds,
  sandboxExtensions,
  onClose,
  onAdd,
  onRemove,
  onInstallExtension,
  onUninstallExtension
}: Props) {
  const builtinModules = [...builtinDefinitions, kanbanDefinition, ...extensionDefinitions];
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  function toggle(id: WidgetId) {
    if (presentIds.has(id)) onRemove(id);
    else onAdd(id);
  }

  // Directly upload a module file: read its source, derive the name from the
  // file name, and install it with sensible defaults. No extra form needed.
  async function uploadFile(file: File) {
    setError(null);
    try {
      const source = await file.text();
      const name = file.name.replace(/\.[^.]+$/, '').trim() || t('template.unnamed');
      await onInstallExtension({
        name,
        description: '',
        source,
        permissions: ['state', 'today'],
        defaultW: 4,
        defaultH: 4
      });
    } catch (reason) {
      setError(errorMessage(reason));
    }
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
          <h3>{t('template.builtin')}</h3>
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

        <section className="template-picker__group">
          <div className="template-picker__group-head">
            <h3>{t('template.myModules')}</h3>
            <button
              type="button"
              className="good-button"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload aria-hidden="true" />
              {t('template.upload')}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".js,text/javascript,application/javascript"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadFile(file);
                event.target.value = '';
              }}
            />
          </div>
          {error ? (
            <div className="dialog-error" role="alert">
              {error}
            </div>
          ) : null}
          {sandboxExtensions.length === 0 ? (
            <p className="template-picker__empty">
              {t('template.uploadHint')}
            </p>
          ) : (
            <div className="template-grid">
              {sandboxExtensions.map((extension) => {
                const definition = sandboxExtensionToDefinition(extension);
                const added = presentIds.has(definition.id);
                return (
                  <div key={extension.id} className="template-card-wrap">
                    <ModuleCard definition={definition} added={added} onToggle={() => toggle(definition.id)} />
                    <div className="template-card-wrap__tools">
                      <button
                        type="button"
                        className="good-icon-button"
                        aria-label={t('template.deleteModule', { name: extension.name })}
                        onClick={() => onUninstallExtension(extension)}
                      >
                        <Trash2 aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </Dialog>
  );
}
