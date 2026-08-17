import { useCallback, useEffect, useState } from 'react';
import { Check, Download, Search, X } from 'lucide-react';
import { Dialog } from '../components/Dialog';
import { useNowlyRepository } from '../data/RepositoryContext';
import type { SandboxExtensionDraft, SandboxPermission } from '../data/nowly-repository';
import { InstallRiskDialog, type InstallRiskInfo } from './InstallRiskDialog';
import { parseModuleManifest, manifestToDraft, ManifestError } from './module-manifest';
import { t } from '../i18n';

// One entry in the decentralized registry index. Mirrors the JSON published at
// the registry URL — see docs/custom-modules/SKILL.md for the format.
type RegistryModule = {
  id: string;
  name: string;
  version: string;
  author?: string;
  description?: string;
  permissions?: SandboxPermission[];
  network?: string[];
  sourceUrl: string;
  // Optional integrity hash. When present, the downloaded source must hash to
  // this value or the install is refused — this protects against the file at
  // `sourceUrl` being tampered with after review.
  sha256?: string;
};

type RegistryIndex = {
  version: number;
  modules: RegistryModule[];
};

// Default registry index location. A deployment can override this; kept as a
// constant so the download path is auditable in one place. The registry lives
// in the main repo under `registry/` so module files and their review sit in
// the same pull request.
const DEFAULT_REGISTRY_URL =
  'https://raw.githubusercontent.com/greywen/nowly/main/registry/registry.json';

// Compute the lowercase hex SHA-256 of a string, using the Web Crypto API that
// is available in the app's webview. Used to verify a downloaded module against
// the integrity hash published in the registry.
async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

type Props = {
  installedIds: Set<string>;
  onClose(): void;
  onInstalled(): void;
  registryUrl?: string;
};

type Status =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; modules: RegistryModule[] };

function isRegistryIndex(value: unknown): value is RegistryIndex {
  if (typeof value !== 'object' || value === null) return false;
  const index = value as Record<string, unknown>;
  return Array.isArray(index.modules);
}

export function ModuleMarketDialog({
  installedIds,
  onClose,
  onInstalled,
  registryUrl = DEFAULT_REGISTRY_URL
}: Props) {
  const repository = useNowlyRepository();
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [query, setQuery] = useState('');
  const [installing, setInstalling] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A pending network-module install waiting on the risk dialog confirmation.
  const [pendingRisk, setPendingRisk] = useState<
    { info: InstallRiskInfo; draft: SandboxExtensionDraft; moduleId: string } | null
  >(null);

  const load = useCallback(async () => {
    setStatus({ kind: 'loading' });
    try {
      const raw = await repository.fetchRegistry(registryUrl);
      const parsed: unknown = JSON.parse(raw);
      if (!isRegistryIndex(parsed)) {
        setStatus({ kind: 'error' });
        return;
      }
      setStatus({ kind: 'ready', modules: parsed.modules });
    } catch {
      setStatus({ kind: 'error' });
    }
  }, [repository, registryUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  // Download the module source, parse its manifest, and either install directly
  // or route through the risk dialog when it declares network.
  async function beginInstall(entry: RegistryModule) {
    setError(null);
    setInstalling(entry.id);
    try {
      const source = await repository.downloadModule(entry.sourceUrl);
      // Integrity gate: if the registry published a hash, the download must
      // match it. A mismatch means the hosted file changed since review.
      if (entry.sha256) {
        const actual = await sha256Hex(source);
        if (actual.toLowerCase() !== entry.sha256.toLowerCase()) {
          setError(t('market.integrityError'));
          setInstalling(null);
          return;
        }
      }
      const manifest = parseModuleManifest(source);
      const draft = manifestToDraft(manifest, source);
      if (manifest.permissions.includes('network')) {
        setPendingRisk({
          moduleId: entry.id,
          draft,
          info: {
            name: manifest.name,
            author: manifest.author,
            source: entry.sourceUrl,
            permissions: manifest.permissions,
            allowedHosts: manifest.network
          }
        });
        setInstalling(null);
        return;
      }
      await repository.installExtension(draft);
      onInstalled();
    } catch (reason) {
      if (reason instanceof ManifestError) {
        setError(t(`manifest.${reason.message}` as Parameters<typeof t>[0]));
      } else {
        setError(t('market.installError'));
      }
    } finally {
      setInstalling(null);
    }
  }

  async function confirmRiskInstall() {
    if (!pendingRisk) return;
    const { draft } = pendingRisk;
    setInstalling(pendingRisk.moduleId);
    setPendingRisk(null);
    try {
      await repository.installExtension(draft);
      onInstalled();
    } catch {
      setError(t('market.installError'));
    } finally {
      setInstalling(null);
    }
  }

  const modules =
    status.kind === 'ready'
      ? status.modules.filter((entry) => {
          if (!query.trim()) return true;
          const haystack = `${entry.name} ${entry.description ?? ''} ${entry.author ?? ''}`.toLowerCase();
          return haystack.includes(query.trim().toLowerCase());
        })
      : [];

  return (
    <Dialog
      title={t('market.title')}
      ariaLabelledBy="module-market-title"
      onRequestClose={onClose}
      className="module-market-dialog"
      headerActions={
        <button className="good-icon-button" aria-label={t('market.close')} onClick={onClose}>
          <X aria-hidden="true" />
        </button>
      }
    >
      <div className="module-market">
        <div className="module-market__search">
          <Search aria-hidden="true" />
          <input
            type="text"
            value={query}
            placeholder={t('market.search')}
            aria-label={t('market.search')}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        {error ? (
          <div className="dialog-error" role="alert">
            {error}
          </div>
        ) : null}

        {status.kind === 'loading' ? (
          <p className="module-market__hint">{t('market.loading')}</p>
        ) : null}

        {status.kind === 'error' ? (
          <div className="module-market__error">
            <p className="module-market__hint">{t('market.loadError')}</p>
            <button type="button" className="good-button" onClick={() => void load()}>
              {t('market.retry')}
            </button>
          </div>
        ) : null}

        {status.kind === 'ready' && modules.length === 0 ? (
          <p className="module-market__hint">{t('market.empty')}</p>
        ) : null}

        {status.kind === 'ready' && modules.length > 0 ? (
          <ul className="module-market__list">
            {modules.map((entry) => {
              const installed = installedIds.has(entry.id);
              const hasNetwork = (entry.permissions ?? []).includes('network');
              return (
                <li key={entry.id} className="module-market__item">
                  <div className="module-market__meta">
                    <div className="module-market__heading">
                      <span className="module-market__name">{entry.name}</span>
                      {hasNetwork ? (
                        <span className="module-market__badge">{t('market.network')}</span>
                      ) : null}
                    </div>
                    {entry.description ? (
                      <span className="module-market__desc">{entry.description}</span>
                    ) : null}
                    {entry.author ? (
                      <span className="module-market__author">
                        {t('market.by', { author: entry.author })}
                      </span>
                    ) : null}
                  </div>
                  <div className="module-market__action">
                    {installed ? (
                      <span className="module-market__installed">
                        <Check aria-hidden="true" />
                        {t('market.installed')}
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="good-button"
                        disabled={installing === entry.id}
                        onClick={() => void beginInstall(entry)}
                      >
                        <Download aria-hidden="true" />
                        {installing === entry.id ? t('market.installing') : t('market.install')}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>

      {pendingRisk ? (
        <InstallRiskDialog
          info={pendingRisk.info}
          onConfirm={() => void confirmRiskInstall()}
          onCancel={() => setPendingRisk(null)}
        />
      ) : null}
    </Dialog>
  );
}
