import { useRef, useState } from 'react';
import { Check, FlaskConical, Minus, Plus, Trash2, Upload, X } from 'lucide-react';
import { Dialog } from '../components/Dialog';
import { ModuleWorkbenchDialog } from './ModuleWorkbenchDialog';
import type { SandboxExtension, SandboxExtensionDraft } from '../data/nowly-repository';
import {
  builtinDefinitions,
  extensionDefinitions,
  kanbanDefinition,
  sandboxExtensionToDefinition,
  type WidgetDefinition,
  type WidgetId
} from './widget-registry';
import { parseModuleManifest, manifestToDraft, ManifestError } from './module-manifest';
import { InstallRiskDialog, type InstallRiskInfo } from './InstallRiskDialog';
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
  if (error instanceof ManifestError) {
    return t(`manifest.${error.message}` as Parameters<typeof t>[0]);
  }
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
  const [workbenchOpen, setWorkbenchOpen] = useState(false);
  // A pending network-module install waiting on the risk dialog confirmation.
  const [pendingRisk, setPendingRisk] = useState<
    { info: InstallRiskInfo; draft: SandboxExtensionDraft } | null
  >(null);

  function toggle(id: WidgetId) {
    if (presentIds.has(id)) onRemove(id);
    else onAdd(id);
  }

  // Upload a module file: read its source, parse the manifest header for its
  // metadata and permissions, then install. Modules that declare `network` are
  // routed through the risk dialog so granting network is always deliberate.
  async function uploadFile(file: File) {
    setError(null);
    try {
      const source = await file.text();
      const manifest = parseModuleManifest(source);
      const draft = manifestToDraft(manifest, source);
      if (manifest.permissions.includes('network')) {
        setPendingRisk({
          draft,
          info: {
            name: manifest.name,
            author: manifest.author,
            source: file.name,
            permissions: manifest.permissions,
            allowedHosts: manifest.network
          }
        });
        return;
      }
      await onInstallExtension(draft);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  async function confirmRiskInstall() {
    if (!pendingRisk) return;
    const { draft } = pendingRisk;
    setPendingRisk(null);
    try {
      await onInstallExtension(draft);
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
              onClick={() => setWorkbenchOpen(true)}
            >
              <FlaskConical aria-hidden="true" />
              {t('workbench.open')}
            </button>
          </div>
          <p className="template-picker__empty">{t('template.uploadComingSoon')}</p>
          {sandboxExtensions.length === 0 ? null : (
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

      {pendingRisk ? (
        <InstallRiskDialog
          info={pendingRisk.info}
          onConfirm={() => void confirmRiskInstall()}
          onCancel={() => setPendingRisk(null)}
        />
      ) : null}

      {workbenchOpen ? <ModuleWorkbenchDialog onClose={() => setWorkbenchOpen(false)} /> : null}
    </Dialog>
  );
}
