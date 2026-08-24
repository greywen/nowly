import { Download, Mail, X } from 'lucide-react';
import { useId } from 'react';
import { Dialog } from '../components/Dialog';
import type { UpdateInfo } from '../data/nowly-repository';
import { FEEDBACK_EMAIL, FEEDBACK_REPO_URL, openExternal } from '../lib/feedback';
import { t } from '../i18n';

type Props = {
  onClose(): void;
  // The launch-time update check result. Null while it is pending or when
  // GitHub could not be reached; the dialog then falls back to the build
  // version and shows no changelog.
  update?: UpdateInfo | null;
};

// GitHub's brand mark as an inline SVG. lucide-react dropped its brand icons, so
// we ship the logo directly to keep the channel recognizable.
function GithubMark() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
      <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58 0-.29-.01-1.05-.02-2.06-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.2.08 1.84 1.24 1.84 1.24 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.12-.31-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 3-.4c1.02 0 2.05.14 3 .4 2.29-1.55 3.3-1.23 3.3-1.23.66 1.66.24 2.87.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.63-5.49 5.93.43.37.81 1.1.81 2.22 0 1.61-.01 2.9-.01 3.29 0 .32.22.7.83.58A12 12 0 0 0 24 12.5C24 5.87 18.63.5 12 .5z" />
    </svg>
  );
}

// About / feedback entry. Shows the current software version (with an update
// badge and a one-click open of the release page when a newer version exists),
// the latest changelog, and how to reach the project: the GitHub repository and
// a contact email. The links open in the OS default handler.
export function AboutDialog({ onClose, update }: Props) {
  const titleId = useId();
  const mailto = `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(t('about.mailSubject'))}`;
  const currentVersion = update?.currentVersion ?? __APP_VERSION__;
  const updateAvailable = update?.updateAvailable ?? false;
  const releaseNotes = update?.releaseNotes ?? null;

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

        <section className="about-changelog">
          <h3 className="about-changelog__title">{t('about.changelogTitle')}</h3>
          {releaseNotes ? (
            <pre className="about-changelog__body">{releaseNotes}</pre>
          ) : (
            <p className="about-changelog__empty">{t('about.changelogEmpty')}</p>
          )}
        </section>

        <div className="feedback-channels">
          <button
            type="button"
            className="feedback-channel"
            onClick={() => void openExternal(FEEDBACK_REPO_URL)}
          >
            <span className="feedback-channel__icon"><GithubMark /></span>
            <span className="feedback-channel__body">
              <span className="feedback-channel__label">{t('about.githubLabel')}</span>
              <span className="feedback-channel__value">{FEEDBACK_REPO_URL}</span>
            </span>
          </button>

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
      </div>
    </Dialog>
  );
}
