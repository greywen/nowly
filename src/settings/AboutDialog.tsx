import { Download, Mail, X } from '../components/icons';
import { useId } from 'react';
import { Dialog } from '../components/Dialog';
import type { UpdateInfo } from '../data/nowly-repository';
import { FEEDBACK_EMAIL, FEEDBACK_REPO_URL, openExternal } from '../lib/feedback';
import { t } from '../i18n';

type Props = {
  onClose(): void;
  // The launch-time update check result. Null while it is pending or when
  // GitHub could not be reached; the dialog then falls back to the build
  // version.
  update?: UpdateInfo | null;
};

// About / feedback entry. Shows the current software version (with an update
// badge and a one-click open of the release page when a newer version exists),
// and a contact email. The links open in the OS default handler.
export function AboutDialog({ onClose, update }: Props) {
  const titleId = useId();
  const mailto = `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(t('about.mailSubject'))}`;
  const currentVersion = update?.currentVersion ?? __APP_VERSION__;
  const updateAvailable = update?.updateAvailable ?? false;

  return (
    <Dialog
      title={t('about.title')}
      ariaLabelledBy={titleId}
      onRequestClose={onClose}
      className="about-dialog"
      headerActions={
        <button type="button" aria-label={t('common.close')} className="good-icon-button" onClick={onClose}>
          <X aria-hidden="true" />
        </button>
      }
      footer={
        <div className="about-dialog__actions">
          <button type="button" className="good-button good-button--primary" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      }
    >
      <div className="about-info">
        <section className="about-version">
          <div className="about-version__row">
            <span className="about-version__label">{t('about.versionLabel')}</span>
            <span className="about-version__value">{currentVersion}</span>
            {updateAvailable ? (
              <span className="about-version__badge">{t('about.updateAvailable')}</span>
            ) : (
              <span className="about-version__latest">{t('about.upToDate')}</span>
            )}
          </div>
          {updateAvailable ? (
            <button
              type="button"
              className="good-button good-button--primary about-version__download"
              onClick={() => void openExternal(update?.releaseUrl ?? FEEDBACK_REPO_URL)}
            >
              <Download aria-hidden="true" />
              {t('about.download')}
            </button>
          ) : null}
        </section>

        <div className="feedback-channels">
          <button
            type="button"
            className="feedback-channel"
            onClick={() => void openExternal(mailto)}
          >
            <span className="feedback-channel__icon"><Mail aria-hidden="true" /></span>
            <span className="feedback-channel__body">
              <span className="feedback-channel__label">{t('about.emailLabel')}</span>
              <span className="feedback-channel__value">{FEEDBACK_EMAIL}</span>
            </span>
          </button>
        </div>

        {/* CC BY 4.0 requires visible attribution for the icon set. */}
        <p className="about-attribution">{t('about.iconCredit')}</p>
      </div>
    </Dialog>
  );
}
