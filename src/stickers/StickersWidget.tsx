import { t, useTranslation } from '../i18n';
import { useEffect, useRef } from 'react';
import { StickerCanvas } from './StickerCanvas';
import { StickerEditorDialog } from './StickerEditorDialog';
import { useStickerImages, useStickers } from './useStickers';
import './stickers.css';

type Props = {
  editing: boolean; trigger?: HTMLElement | null; error?: string | null;
  onEdit: () => void; onClose: () => void;
};
export function StickersWidget({ editing, trigger, error, onEdit, onClose }: Props) {
  useTranslation();
  const { state, load, saved } = useStickers();
  const images = useStickerImages(state.board.objects);
  const editButton = useRef<HTMLButtonElement>(null);
  const previousEditing = useRef(false);
  const editorTrigger = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (editing) editorTrigger.current = trigger ?? null;
    else if (previousEditing.current) {
      (editorTrigger.current?.isConnected ? editorTrigger.current : editButton.current)?.focus();
    }
    previousEditing.current = editing;
  }, [editing, trigger]);
  return <div className="widget-content sticker-widget">
    <div className="card-header">
      <div className="heading-group"><h2>{t('stickers.title')}</h2></div>
      <div className="toolbar-actions"><button ref={editButton} type="button" className="btn" onClick={onEdit} disabled={state.status !== 'ready'}>{t('stickers.edit')}</button></div>
    </div>
    <div className="sticker-widget__body">
      {error ? <p className="sticker-error" role="alert">{error}</p> : null}
      {state.status === 'loading' ? <p>{t('stickers.loading')}</p> : null}
      {state.status === 'error' ? <div className="module-message" role="alert">
        <span>{state.error}</span><button className="btn" onClick={() => void load()}>{t('common.retry')}</button>
      </div> : null}
      {state.status === 'ready' && state.board.objects.length === 0 ? <div className="sticker-widget__empty">
        <p>{t('stickers.empty')}</p><div className="sticker-editor__actions">
          <button className="btn" onClick={onEdit}>{t('stickers.addImage')}</button>
          <button className="btn" onClick={onEdit}>{t('stickers.addText')}</button>
        </div>
      </div> : null}
      {state.status === 'ready' && state.board.objects.length > 0 ? <StickerCanvas objects={state.board.objects} urls={images.urls} imageFailures={images.failures} /> : null}
      {Object.values(images.failures).length ? <div className="module-message" role="alert">
        <span>{Object.values(images.failures).join('\n')}</span><button className="btn" onClick={images.retry}>{t('stickers.retryImages')}</button>
      </div> : null}
    </div>
    {editing && state.status === 'ready' ? <StickerEditorDialog board={state.board} trigger={trigger} onSaved={saved} onClose={onClose} /> : null}
  </div>;
}
