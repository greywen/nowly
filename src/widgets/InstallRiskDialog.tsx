import { AlertTriangle, X } from 'lucide-react';
import { Dialog } from '../components/Dialog';
import type { SandboxPermission } from '../data/nowly-repository';
import { t } from '../i18n';

// The details a user must see before installing a module that can reach the
// network. Shown for any install (local upload or market download) whose module
// declares the `network` permission, so granting network is always a deliberate,
// informed choice.
export type InstallRiskInfo = {
  name: string;
  author: string;
  source: string;
  permissions: SandboxPermission[];
  allowedHosts: string[];
};

function permissionLabel(permission: SandboxPermission): string {
  return t(`risk.permission.${permission}`);
}

export function InstallRiskDialog({
  info,
  onConfirm,
  onCancel
}: {
  info: InstallRiskInfo;
  onConfirm(): void;
  onCancel(): void;
}) {
  return (
    <Dialog
      title={t('risk.title')}
      ariaLabelledBy="install-risk-title"
      onRequestClose={onCancel}
      className="install-risk-dialog"
      headerActions={
        <button className="good-icon-button" aria-label={t('risk.cancel')} onClick={onCancel}>
          <X aria-hidden="true" />
        </button>
      }
      footer={
        <div className="install-risk__actions">
          <button type="button" className="good-button" onClick={onCancel}>
            {t('risk.cancel')}
          </button>
          <button type="button" className="good-button good-button--danger" onClick={onConfirm}>
            {t('risk.confirm')}
          </button>
        </div>
      }
    >
      <div className="install-risk">
        <div className="install-risk__warning" role="alert">
          <AlertTriangle aria-hidden="true" />
          <p>{t('risk.warning')}</p>
        </div>

        <dl className="install-risk__meta">
          <div className="install-risk__row">
            <dt>{t('risk.source')}</dt>
            <dd>{info.name}</dd>
          </div>
          {info.author ? (
            <div className="install-risk__row">
              <dt>{t('risk.author')}</dt>
              <dd>{info.author}</dd>
            </div>
          ) : null}
          <div className="install-risk__row">
            <dt>{t('risk.permissions')}</dt>
            <dd>
              <ul className="install-risk__permissions">
                {info.permissions.map((permission) => (
                  <li key={permission}>{permissionLabel(permission)}</li>
                ))}
              </ul>
            </dd>
          </div>
          <div className="install-risk__row">
            <dt>{t('risk.hosts')}</dt>
            <dd>
              <ul className="install-risk__hosts">
                {info.allowedHosts.map((host) => (
                  <li key={host}>
                    <span className="install-risk__host-tag">{host}</span>
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        </dl>
      </div>
    </Dialog>
  );
}
