import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useState } from 'react';
import { X } from '../components/icons';
import { useTranslation } from '../i18n';

const resizeDirections = ['North', 'South', 'East', 'West', 'NorthEast', 'NorthWest', 'SouthEast', 'SouthWest'] as const;

export function PinnedImageApp() {
  const { t } = useTranslation();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let disposed = false;
    let resource: string | null = null;
    void invoke<ArrayBuffer | number[]>('capture_pin_image').then(bytes => {
      if (disposed) return;
      resource = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/bmp' }));
      setUrl(resource);
    }).catch(() => { if (!disposed) setFailed(true); });
    return () => { disposed = true; if (resource) URL.revokeObjectURL(resource); };
  }, []);

  const close = () => { void getCurrentWindow().close(); };
  return (
    <main className="screenshot-pin" onKeyDown={event => { if (event.key === 'Escape') close(); }}>
      <div className="screenshot-pin__toolbar" role="toolbar" aria-label={t('screenshot.action.pin')}>
        <button type="button" className="screenshot-pin__button" aria-label={t('screenshot.pin.close')} onClick={close}><X size={18} /></button>
      </div>
      {failed ? <p className="screenshot-pin__error" role="alert">{t('screenshot.pin.failed')}</p> : null}
      <div className="screenshot-pin__viewport">
        {url ? <img className="screenshot-pin__image" src={url} alt={t('screenshot.pin.image')}         draggable={false} onPointerDown={event => {
          if (event.button === 0) { event.preventDefault(); void getCurrentWindow().startDragging(); }
        }} /> : !failed ? <p role="status">{t('screenshot.pin.loading')}</p> : null}
      </div>
      {resizeDirections.map(direction => (
        <div key={direction} className={`screenshot-pin__resize screenshot-pin__resize--${direction}`} aria-hidden="true"
          onPointerDown={event => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            void getCurrentWindow().startResizeDragging(direction);
          }} />
      ))}
    </main>
  );
}
