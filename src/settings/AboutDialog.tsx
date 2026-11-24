import { Download, Mail, X } from '../components/icons';
import { useId } from 'react';
import { Dialog } from '../components/Dialog';
import type { UpdateCheckState } from './useUpdateCheck';
import { FEEDBACK_EMAIL, openExternal } from '../lib/feedback';
import { t } from '../i18n';

type Props = {
  onClose(): void;
  update?: UpdateCheckState;
};

export function AboutDialog({ onClose, update }: Props) {
  const titleId = useId();
  const mailto = `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(t('about.mailSubject'))}`;
  const currentVersion = update?.version?.currentVersion
    ?? t(update?.status === 'error' ? 'about.versionError' : 'about.loadingVersion');
  const updateAvailable = update?.updateAvailable ?? false;
  const status = update?.status ?? 'loading';

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
            ) : null}
          </div>
          <p className="about-version__message" role="status">{t(status === 'upToDate' ? 'about.noUpdates'
            : status === 'unsupported' ? 'about.storeManaged'
              : status === 'error' ? 'about.checkError'
                : status === 'available' ? 'about.updateAvailable' : 'about.checking')}</p>
          {update?.error ? <p className="about-version__message about-version__message--error" role="alert">{update.error}</p> : null}
          {status === 'error' ? (
            <button type="button" className="good-button" onClick={() => void update?.retry()}>{t('about.retry')}</button>
          ) : null}
          <button
            type="button"
            className="good-button good-button--primary about-version__download"
            disabled={!update || update.opening}
            onClick={() => void update?.openStore()}
          >
            <Download aria-hidden="true" />
            {t(update?.opening ? 'about.openingStore' : updateAvailable ? 'about.storeUpdate' : 'about.storeView')}
          </button>
          {update?.version?.distribution === 'unpackaged' ? <p className="about-version__message">{t('about.storeSeparate')}</p> : null}
          {update?.openError ? <p className="about-version__message about-version__message--error" role="alert">{t('about.openError')} {update.openError}</p> : null}
          {update?.openedInBrowser ? <p className="about-version__message" role="status">{t('about.storeBrowser')}</p> : null}
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
