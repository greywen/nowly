import { useRef, useState } from 'react';
import { Copy, Trash2 } from '../components/icons';
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
  const dateLabel = Number.isNaN(date.valueOf()) ? entry.createdAt : date.toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const timeLabel = Number.isNaN(date.valueOf()) ? entry.createdAt : date.toLocaleTimeString(language === 'zh' ? 'zh-CN' : 'en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  return <article className="screenshot-history-card" aria-label={entry.fileName} tabIndex={0}>
    <div className="screenshot-history-card__thumbnail">
      {!entry.available ? <span>{t('screenshotHistory.unavailable')}</span> : failedThumbnail ? <div>
        <p>{t('screenshotHistory.thumbnailFailed')}</p>
        <button className="good-button" onClick={() => { setRetry(value => value + 1); setLoaded(false); setFailedThumbnail(false); }}>{t('screenshotHistory.retryThumbnail')}</button>
      </div> : <>{!loaded && <span className="screenshot-history-card__placeholder">{t('screenshotHistory.thumbnailLoading')}</span>}<img src={`${thumbnailUrl(entry.id)}${retry ? `?retry=${retry}` : ''}`} alt={entry.fileName} loading="lazy" decoding="async" onLoad={() => setLoaded(true)} onError={() => setFailedThumbnail(true)} /></>}
    </div>
    <div className="screenshot-history-card__body">
      <time dateTime={entry.createdAt} title={dateLabel} aria-label={dateLabel}>{timeLabel}</time>
      <div className="screenshot-history-card__actions">
        <button className="screenshot-history__icon-button" aria-label={t(copying ? 'screenshotHistory.copying' : 'screenshotHistory.copy')} title={t(copying ? 'screenshotHistory.copying' : 'screenshotHistory.copy')} disabled={!entry.available || copying} aria-busy={copying} onClick={() => void copy()}><Copy size={16} /></button>
        <button className="screenshot-history__icon-button" aria-label={t('screenshotHistory.delete')} title={t('screenshotHistory.delete')} disabled={copying} onClick={event => onDelete(entry, event.currentTarget)}><Trash2 size={16} /></button>
      </div>
    </div>
    {feedback && <p role={feedback === 'copyFailed' ? 'alert' : 'status'} className={`screenshot-history-card__feedback${feedback === 'copyFailed' ? ' screenshot-history-card__feedback--error' : ''}`}>{t(`screenshotHistory.${feedback}`)}</p>}
  </article>;
}
