import { invoke } from '@tauri-apps/api/core';
import { useRef, useState } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { GalleryCircle } from '../components/icons';
import { useTranslation } from '../i18n';
import { deleteScreenshotHistory, type ScreenshotHistoryEntry } from './client';
import { ScreenshotHistoryCard } from './ScreenshotHistoryCard';
import { SurfaceIconProvider } from './SurfaceIconProvider';
import { useScreenshotHistory } from './useScreenshotHistory';
import './styles.css';

export function ScreenshotHistoryApp({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const history = useScreenshotHistory();
  const [target, setTarget] = useState<ScreenshotHistoryEntry | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const deleteLock = useRef(false);
  const folderLock = useRef(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(false);
  const [openingFolder, setOpeningFolder] = useState(false);
  const [folderError, setFolderError] = useState(false);
  const remove = async () => {
    if (!target || deleteLock.current) return;
    deleteLock.current = true;
    setDeleting(true);
    setDeleteError(false);
    try {
      await deleteScreenshotHistory(target.id);
      history.removeItem(target.id);
      history.refresh();
      setTarget(null);
    } catch { setDeleteError(true); }
    finally { deleteLock.current = false; setDeleting(false); }
  };
  const openFolder = async () => {
    if (folderLock.current) return;
    folderLock.current = true;
    setOpeningFolder(true);
    setFolderError(false);
    try { await invoke('open_screenshot_folder'); }
    catch { setFolderError(true); }
    finally { folderLock.current = false; setOpeningFolder(false); }
  };
  return <SurfaceIconProvider><section className={`screenshot-history${compact ? ' screenshot-history--compact' : ''}`} aria-label={t('screenshotHistory.title')}>
    <header className="screenshot-history__header"><h1>{t('screenshotHistory.title')}</h1>
      {!compact && <button className="good-button" disabled={openingFolder} onClick={() => void openFolder()}><GalleryCircle size={18} />{t('screenshotHistory.openFolder')}</button>}
    </header>
    <div className="screenshot-history__content" aria-busy={history.loading}>
      {compact && <button className="good-button screenshot-history__folder" disabled={openingFolder} onClick={() => void openFolder()}><GalleryCircle size={16} />{t('screenshotHistory.openFolder')}</button>}
      {folderError && <p role="alert" className="screenshot-history__error">{t('screenshotHistory.folderFailed')}</p>}
      {history.error && <div role="alert" className="screenshot-history__error"><p>{t('screenshotHistory.loadFailed')}</p><button className="good-button" onClick={history.refresh}>{t('common.retry')}</button></div>}
      {!history.loading && !history.error && history.items.length === 0 && <p className="screenshot-history__empty">{t('screenshotHistory.empty')}</p>}
      <div className="screenshot-history__grid">{history.items.map(entry => <ScreenshotHistoryCard key={entry.id} entry={entry} onDelete={(item, trigger) => { restoreFocusRef.current = trigger; setDeleteError(false); setTarget(item); }} />)}</div>
      <footer className="screenshot-history__footer">
        {history.loading ? <p role="status">{t('screenshotHistory.loading')}</p> : history.nextCursor && <button className="good-button" onClick={history.loadMore}>{t('screenshotHistory.loadMore')}</button>}
      </footer>
    </div>
    {target && <ConfirmDialog className={compact ? 'screenshot-history-confirm' : undefined} title={t('screenshotHistory.confirmTitle')} description={t('screenshotHistory.confirmDescription', { fileName: target.fileName })} tone="danger" confirmLabel={t('screenshotHistory.confirmDelete')} busyLabel={t('screenshotHistory.deleting')} busy={deleting} errorMessage={deleteError ? t('screenshotHistory.deleteFailed') : undefined} restoreFocusRef={restoreFocusRef} onCancel={() => setTarget(null)} onConfirm={() => void remove()} />}
  </section></SurfaceIconProvider>;
}
