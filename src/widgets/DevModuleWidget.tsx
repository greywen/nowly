import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNowlyRepository } from '../data/RepositoryContext';
import type { DevModuleFile } from '../data/nowly-repository';
import { SandboxModule } from './sandbox/SandboxModule';
import { createPreviewHost } from '../preview/preview-host';
import { parseModuleManifest, ManifestError, type ModuleManifest } from './module-manifest';
import { lintModuleSource, type LintIssue } from '../../registry/lint.mjs';
import { t } from '../i18n';

// The developer module (channel A, dev builds only). Unlike the old workbench
// dialog it is a real, resizable dashboard module: it lives on the grid at the
// size the user drags it to, so a draft runs at a genuine in-use size next to
// the other modules. It sources drafts from `dev-modules/` via `listDevModules`
// (dev build: the repo's own folder, shared with channel B; installed build:
// the app-data folder — see src-tauri/src/dev_modules.rs) and renders the
// selected one through the same `SandboxModule` the app uses for installed
// modules, so what runs here runs unchanged after publishing.
//
// State runs through the in-memory preview host (like channel B): drafts are
// throwaway, so nothing pollutes the real module-state table and every remount
// starts clean. See docs/custom-modules/preview.md (通道 A).
//
// Polling, not a file watcher: `listDevModules` is a cheap directory read, and
// polling keeps the whole feature on the existing IPC surface with no new event
// plumbing. One second is imperceptible for a manual edit-save-look loop.
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

export function DevModuleWidget() {
  const repository = useNowlyRepository();
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [dir, setDir] = useState<string>('');
  const [selectedName, setSelectedName] = useState<string | null>(null);

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

  // Initial load plus a poll so an external edit-save shows up without any
  // manual reload. Cleared on unmount so no timer outlives the module.
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  // The drop-here directory is OS- and build-specific, so we ask the backend
  // once for its resolved absolute path and show it in the empty state. A
  // missing method (browser shim / test doubles) just leaves the path blank.
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

  // A fresh in-memory host per selected id + source, so switching or editing a
  // draft starts it from a clean state.
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
    <div className="widget-content dev-module">
      <div className="card-header dev-module__header">
        <div className="heading-group">
          <h2>{t('widget.devModule.name')}</h2>
        </div>
        {drafts && drafts.length > 0 ? (
          <select
            className="dev-module__select"
            aria-label={t('devModule.selectLabel')}
            value={selected?.name ?? ''}
            onChange={(event) => setSelectedName(event.target.value)}
          >
            {drafts.map((draft) => (
              <option key={draft.name} value={draft.name}>
                {(draft.manifest?.name ?? draft.name) + (draft.error ? ' ⚠' : '')}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      <div className="panel-body dev-module__body">
        {drafts === null ? (
          <p className="dev-module__hint">{t('devModule.loading')}</p>
        ) : drafts.length === 0 ? (
          <div className="dev-module__hint">
            <p>{t('devModule.none')}</p>
            {dir ? <code className="dev-module__path">{dir}</code> : null}
          </div>
        ) : !selected ? (
          <p className="dev-module__hint">{t('devModule.selectPrompt')}</p>
        ) : selected.error || !selected.manifest || !host ? (
          <div className="dev-module__error" role="alert">
            {t('devModule.manifestError', {
              message: selected.error
                ? t(`manifest.${selected.error}` as Parameters<typeof t>[0])
                : ''
            })}
          </div>
        ) : (
          <SandboxModule
            key={`${selected.name}:${selected.source.length}`}
            host={host}
            source={selected.source}
            title={selected.manifest.name}
            permissions={selected.manifest.permissions}
            allowedHosts={selected.manifest.network}
          />
        )}
      </div>

      <div className="dev-module__lint" aria-label={t('devModule.lintResults')}>
        {selected
          ? lint.length === 0
            ? t('devModule.lintPass')
            : t('devModule.lintCount', { count: String(lint.length) })
          : null}
      </div>
    </div>
  );
}
