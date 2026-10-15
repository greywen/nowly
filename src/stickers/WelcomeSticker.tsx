import { useState } from 'react';
import { useTranslation } from '../i18n';
import { StickerCanvas } from './StickerCanvas';
import { STICKER_STAGE_BOUNDS } from './sticker-model';
import { buildWelcomeStickers, WELCOME_LOGO_ASSET } from './welcome-sticker-model';
import './stickers.css';
import './welcome-sticker.css';

export function WelcomeSticker({ loading = true }: { loading?: boolean }) {
  const { t } = useTranslation();
  const [bounds, setBounds] = useState(STICKER_STAGE_BOUNDS);
  return <section className="card welcome-sticker" data-testid="welcome-sticker" aria-label={t('welcome.title')}>
    <div className="widget-content">
      <div className="card-header"><div className="heading-group"><h2>{t('stickers.title')}</h2></div></div>
      <div className="welcome-sticker__body">
        <h1 className="visually-hidden">{t('welcome.title')}</h1>
        <div className="welcome-sticker__artwork" aria-hidden="true">
          <StickerCanvas objects={buildWelcomeStickers(bounds)} urls={{ [WELCOME_LOGO_ASSET]: '/logo.png' }} disabled onBounds={setBounds} />
        </div>
        <p className="welcome-sticker__status" role="status"><span aria-hidden="true" />{t(loading ? 'welcome.loading' : 'welcome.empty')}</p>
      </div>
    </div>
  </section>;
}
