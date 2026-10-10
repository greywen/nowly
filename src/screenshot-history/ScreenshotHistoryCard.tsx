import { useRef, useState } from 'react';
import { GalleryCircle, Trash2 } from '../components/icons';
import { useTranslation } from '../i18n';
import { copyScreenshotHistory, thumbnailUrl, type ScreenshotHistoryEntry } from './client';

export function ScreenshotHistoryCard({ entry, onDelete }: {
  entry: ScreenshotHistoryEntry;
  onDelete: (entry: ScreenshotHistoryEntry, trigger: HTMLButtonElement) => void;
}) {
  const { t, language } = useTranslation();
  const [failedThumbnail, setFailedThumbnail] = useState(false);
  const [retry, setRetry] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [copying, setCopying] = useState(false);
  const busy = useRef(false);
  const [feedback, setFeedback] = useState<'copied' | 'copyFailed' | null>(null);
  const copy = async () => {
    if (busy.current || !entry.available) return;
    busy.current = true;
    setCopying(true);
    setFeedback(null);
    try { await copyScreenshotHistory(entry.id); setFeedback('copied'); }
    catch { setFeedback('copyFailed'); }
    finally { busy.current = false; setCopying(false); }
  };
  const date = new Date(entry.createdAt);
  const dateLabel = Number.isNaN(date.valueOf()) ? entry.createdAt : date.toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US');
  return <article className="screenshot-history-card" aria-label={entry.fileName}>
    <div className="screenshot-history-card__thumbnail">
      {!entry.available ? <span>{t('screenshotHistory.unavailable')}</span> : failedThumbnail ? <div>
        <p>{t('screenshotHistory.thumbnailFailed')}</p>
        <button className="good-button" onClick={() => { setRetry(value => value + 1); setLoaded(false); setFailedThumbnail(false); }}>{t('screenshotHistory.retryThumbnail')}</button>
      </div> : <>{!loaded && <span className="screenshot-history-card__placeholder">{t('screenshotHistory.thumbnailLoading')}</span>}<img src={`${thumbnailUrl(entry.id)}${retry ? `?retry=${retry}` : ''}`} alt={entry.fileName} loading="lazy" decoding="async" onLoad={() => setLoaded(true)} onError={() => setFailedThumbnail(true)} /></>}
    </div>
    <div className="screenshot-history-card__body">
      <time dateTime={entry.createdAt}>{dateLabel}</time>
      <p className="screenshot-history-card__metadata"><span>{entry.width} × {entry.height}</span><span>{t('screenshotHistory.bytes', { count: entry.byteSize })}</span></p>
      <div className="screenshot-history-card__actions">
        <button className="good-button" disabled={!entry.available || copying} aria-busy={copying} onClick={() => void copy()}><GalleryCircle size={18} />{t(copying ? 'screenshotHistory.copying' : 'screenshotHistory.copy')}</button>
        <button className="good-button" disabled={copying} onClick={event => onDelete(entry, event.currentTarget)}><Trash2 size={18} />{t('screenshotHistory.delete')}</button>
      </div>
      {feedback && <p role={feedback === 'copyFailed' ? 'alert' : 'status'} className={`screenshot-history-card__feedback${feedback === 'copyFailed' ? ' screenshot-history-card__feedback--error' : ''}`}>{t(`screenshotHistory.${feedback}`)}</p>}
    </div>
  </article>;
}
