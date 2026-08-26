import { useCallback, useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { Dialog } from '../components/Dialog';
import { useNowlyRepository } from '../data/RepositoryContext';
import type { DevModuleFile } from '../data/nowly-repository';
import { PreviewSandbox } from '../preview/PreviewSandbox';
import { createPreviewHost } from '../preview/preview-host';
import { SIZE_PRESETS, DEFAULT_PRESET_ID, findPreset } from '../preview/size-presets';
import { parseModuleManifest, ManifestError, type ModuleManifest } from './module-manifest';
import { lintModuleSource, type LintIssue } from '../../registry/lint.mjs';
import { t } from '../i18n';

// The in-app module workbench (channel A). It mirrors the standalone preview
// page (channel B) but lives inside the desktop app and sources drafts from the
// user's real app-data `dev-modules/` directory (Windows:
// `%APPDATA%/com.nowly.app/dev-modules/`) via `list_dev_modules`,
// rather than Vite's compile-time glob. Left: the draft list plus this build's
// lint results. Right: a real-pixel preview at the selected gear, remounted
// whenever the file on disk changes. See spec §9 (通道 A).
//
// Polling, not a file watcher: the command is cheap (a directory read of small
// text files) and polling keeps the whole feature in the existing IPC surface
// with no new event plumbing. One second is imperceptible for a manual
// edit-save-look loop and far below the cost that would matter.
const POLL_MS = 1000;

type Draft = {
  name: string;
  source: string;
  manifest: ModuleManifest | null;
  error: string | null;
};

function toDraft(file: DevModuleFile): Draft {
  let manifest: ModuleManifest | null = null;
  let error: string | null = null;
  try {
    manifest = parseModuleManifest(file.source);
  } catch (reason) {
    error = reason instanceof ManifestError ? reason.message : String(reason);
  }
  return { name: file.name, source: file.source, manifest, error };
}

function todayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function ModuleWorkbenchDialog({ onClose }: { onClose(): void }) {
  const repository = useNowlyRepository();
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [dir, setDir] = useState<string>('');
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [presetId, setPresetId] = useState<string>(DEFAULT_PRESET_ID);

  const refresh = useCallback(async () => {
    if (!repository.listDevModules) {
      setDrafts([]);
      return;
    }
    try {
      const files = await repository.listDevModules();
      setDrafts(files.map(toDraft));
    } catch {
      setDrafts([]);
    }
  }, [repository]);

  // Initial load plus a poll so an external edit-save shows up without the user
  // reopening the dialog. Cleared on unmount so no timer outlives the workbench.
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  // The drop-here directory is OS-specific, so we ask the backend once for its
  // resolved absolute path and show it in the empty state. A missing method
  // (browser shim / test doubles) just leaves the path blank.
  useEffect(() => {
    if (!repository.devModulesDir) return;
    let cancelled = false;
    void repository
      .devModulesDir()
      .then((path) => {
        if (!cancelled) setDir(path);
      })
      .catch(() => {
        /* leave the path blank; the generic empty message still shows */
      });
    return () => {
      cancelled = true;
    };
  }, [repository]);

  const selected = useMemo(() => {
    if (!drafts || drafts.length === 0) return undefined;
    return drafts.find((draft) => draft.name === selectedName) ?? drafts[0];
  }, [drafts, selectedName]);

  const preset = findPreset(presetId);

  // A fresh host per selected module id + source, so switching or editing a
  // draft starts it from a clean in-memory state.
  const host = useMemo(() => {
    if (!selected?.manifest) return null;
    return createPreviewHost({
      moduleId: selected.manifest.id,
      todayIso: todayIso(),
      allowedHosts: selected.manifest.network
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.manifest?.id, selected?.source]);

  const lint: LintIssue[] = useMemo(
    () => (selected ? lintModuleSource(selected.source) : []),
    [selected]
  );

  return (
    <Dialog
      title={t('workbench.title')}
      ariaLabelledBy="module-workbench-title"
      onRequestClose={onClose}
      className="module-workbench-dialog"
      headerActions={
        <button className="good-icon-button" aria-label={t('workbench.close')} onClick={onClose}>
          <X aria-hidden="true" />
        </button>
      }
    >
      <div className="module-workbench">
        <aside className="module-workbench__sidebar">
          {drafts === null ? (
            <p className="module-workbench__hint">{t('workbench.loading')}</p>
          ) : drafts.length === 0 ? (
            <div className="module-workbench__hint">
              <p>{t('workbench.empty')}</p>
              {dir ? <code className="module-workbench__path">{dir}</code> : null}
            </div>
          ) : (
            <ul className="module-workbench__list" aria-label={t('workbench.draftList')}>
              {drafts.map((draft) => {
                const active = draft.name === selected?.name;
                return (
                  <li key={draft.name}>
                    <button
                      type="button"
                      className={`module-workbench__draft${active ? ' is-active' : ''}`}
                      aria-current={active}
                      onClick={() => setSelectedName(draft.name)}
                    >
                      <span className="module-workbench__draft-name">
                        {draft.manifest?.name ?? draft.name}
                      </span>
                      <span className="module-workbench__draft-file">{draft.name}</span>
                      {draft.error ? (
                        <span className="module-workbench__badge module-workbench__badge--error">
                          {t('workbench.manifestError')}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <section className="module-workbench__lint" aria-label={t('workbench.lintResults')}>
            <h3 className="module-workbench__lint-title">
              {lint.length === 0 ? t('workbench.lintPass') : t('workbench.lintCount', { count: String(lint.length) })}
            </h3>
            {selected && lint.length > 0 ? (
              <ul className="module-workbench__lint-list">
                {lint.map((issue, index) => (
                  <li key={index} className="module-workbench__lint-item">
                    <code>{issue.rule}</code>
                    {t('workbench.lintLine', { line: String(issue.line) })}
                    {issue.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        </aside>

        <main className="module-workbench__main">
          <div className="module-workbench__toolbar">
            <div className="module-workbench__sizes" role="group" aria-label={t('workbench.sizeGroup')}>
              {SIZE_PRESETS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className={`module-workbench__size${entry.id === preset.id ? ' is-active' : ''}`}
                  aria-pressed={entry.id === preset.id}
                  onClick={() => setPresetId(entry.id)}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </div>

          {!selected ? (
            <p className="module-workbench__hint">{t('workbench.selectDraft')}</p>
          ) : selected.error || !selected.manifest || !host ? (
            <div className="module-workbench__error" role="alert">
              <strong>{t('workbench.manifestError')}</strong>
              <p>
                {selected.error
                  ? t(`manifest.${selected.error}` as Parameters<typeof t>[0])
                  : t('workbench.manifestErrorBody')}
              </p>
            </div>
          ) : (
            <PreviewSandbox
              key={`${selected.name}:${selected.source.length}:${preset.id}`}
              host={host}
              source={selected.source}
              permissions={selected.manifest.permissions}
              allowedHosts={selected.manifest.network}
              width={preset.width}
              height={preset.height}
            />
          )}
        </main>
      </div>
    </Dialog>
  );
}
