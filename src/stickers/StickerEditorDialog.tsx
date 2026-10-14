import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dialog } from '../components/Dialog';
import { X } from '../components/icons';
import { useNowlyRepository } from '../data/RepositoryContext';
import { t, useTranslation } from '../i18n';
import { copySticker, MAX_STICKERS, newTextSticker, validateStickerBoard, type StickerAsset, type StickerBoard, type StickerObject } from './sticker-model';
import { STICKER_IMAGE_ACCEPT, validateStickerImage } from './sticker-image';
import { StickerCanvas } from './StickerCanvas';
import { StickerProperties } from './StickerProperties';
import { stickerError, useStickerImages } from './useStickers';
import './stickers.css';

type PendingImage = { fileName: string; bytes: Uint8Array; url: string; uploaded?: StickerAsset };
type Props = { board: StickerBoard; onClose: () => void; onSaved: (board: StickerBoard) => void; trigger?: HTMLElement | null };

export function StickerEditorDialog({ board, onClose, onSaved, trigger }: Props) {
  useTranslation();
  const repository = useNowlyRepository();
  const [draft, setDraft] = useState<StickerBoard>(() => structuredClone(board));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [overflow, setOverflow] = useState<string[]>([]);
  const [pendingVersion, setPendingVersion] = useState(0);
  const pending = useRef(new Map<string, PendingImage>());
  const imageRatios = useRef(new Map<string, number>(board.objects.flatMap(object =>
    object.kind === 'image' ? [[object.id, object.width / object.height] as const] : [])));
  const cleanupIds = useRef<string[]>([]);
  const persisted = useRef(board);
  const [cleanupFailed, setCleanupFailed] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const textInputContainer = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  const restoreFocusRef = useMemo(() => trigger ? { current: trigger } : undefined, [trigger]);
  const selected = draft.objects.find(o => o.id === selectedId);
  const problem = validateStickerBoard(draft);
  const problemMessage = problem ? t(`stickers.${problem === 'text' ? 'textError' : problem === 'image' ? 'imageError' : problem}`) : overflow.length ? t('stickers.overflow') : null;
  const localUrls = useMemo(() => Object.fromEntries([...pending.current.entries()].map(([id, image]) => [id, image.url])), [pendingVersion]);
  const images = useStickerImages(draft.objects, localUrls);
  const updateOverflow = useCallback((ids: string[]) => setOverflow(current => current.join(',') === ids.join(',') ? current : ids), []);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; pending.current.forEach(image => URL.revokeObjectURL(image.url)); };
  }, []);

  function change(object: StickerObject) {
    if (busyRef.current) return;
    const previous = draft.objects.find(item => item.id === object.id);
    if (previous?.kind === 'image' && previous.width > 0 && previous.height > 0 &&
      Number.isFinite(previous.width) && Number.isFinite(previous.height)) {
      imageRatios.current.set(previous.id, previous.width / previous.height);
    }
    setDraft(current => ({ ...current, objects: current.objects.map(o => o.id === object.id ? object : o) }));
    setError(null);
  }
  function addText() {
    if (draft.objects.length >= MAX_STICKERS) { setError(t('stickers.count')); return; }
    const object = newTextSticker(crypto.randomUUID(), t('stickers.newText'));
    setDraft(current => ({ ...current, objects: [...current.objects, object] }));
    setSelectedId(object.id);
    setError(null);
    setTimeout(() => {
      const input = textInputContainer.current?.querySelector('textarea');
      input?.focus(); input?.select();
    }, 0);
  }
  async function addFiles(files: File[]) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    const errors: string[] = [];
    const additions: StickerObject[] = [];
    try {
      for (const file of files) {
        if (draft.objects.length + additions.length >= MAX_STICKERS) { errors.push(`${file.name}: ${t('stickers.count')}`); continue; }
        try {
          if (!file.size || file.size > 10 * 1024 * 1024) throw new Error(t('stickers.fileSize'));
          const bytes = new Uint8Array(await file.arrayBuffer());
          const header = await validateStickerImage(bytes, file.name);
          if (!alive.current) return;
          const id = crypto.randomUUID().replace(/-/g, '');
          const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: header.mime }));
          pending.current.set(id, { bytes, fileName: file.name, url });
          const ratio = Math.min(320 / header.width, 240 / header.height);
          additions.push({ id: crypto.randomUUID(), kind: 'image', assetId: id, style: 'original', x: 200, y: 160,
            width: header.width * ratio, height: header.height * ratio, rotation: 0, opacity: 100, locked: false });
        } catch (failure) { errors.push(`${file.name}: ${stickerError(failure)}`); }
      }
      if (alive.current) {
        setDraft(current => ({ ...current, objects: [...current.objects, ...additions] }));
        if (additions.length) setSelectedId(additions[additions.length - 1].id);
        setPendingVersion(value => value + 1);
        setError(errors.length ? errors.join('\n') : null);
      }
    } finally { busyRef.current = false; if (alive.current) setBusy(false); }
  }

  function requestClose() {
    if (busyRef.current) return;
    if (JSON.stringify(draft) !== JSON.stringify(persisted.current)) setDiscarding(true);
    else void discard();
  }
  async function discard() {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try {
      const ids = [...new Set([...cleanupIds.current,
        ...[...pending.current.values()].flatMap(image => image.uploaded ? [image.uploaded.id] : [])])];
      if (ids.length) {
        if (!repository.discardStickerImages) throw new Error(t('stickers.unavailable'));
        await repository.discardStickerImages(ids);
      }
      onClose();
    } catch (failure) { setError(stickerError(failure)); }
    finally { busyRef.current = false; if (alive.current) setBusy(false); }
  }
  async function save() {
    if (busyRef.current) return;
    if (problemMessage) { setError(problemMessage); return; }
    busyRef.current = true; setBusy(true); setError(null);
    let committed = false;
    try {
      if (!repository.saveStickerBoard || !repository.uploadStickerImage || !repository.discardStickerImages) {
        // Text-only repositories still support the text editor without image methods.
        if (!repository.saveStickerBoard || draft.objects.some(o => o.kind === 'image')) throw new Error(t('stickers.unavailable'));
      }
      const objects: StickerObject[] = [];
      for (const object of draft.objects) {
        if (object.kind !== 'image') { objects.push(object); continue; }
        const image = pending.current.get(object.assetId);
        if (!image) { objects.push(object); continue; }
        if (!image.uploaded) image.uploaded = await repository.uploadStickerImage!(image.fileName, image.bytes);
        objects.push({ ...object, assetId: image.uploaded.id });
      }
      const saved = await repository.saveStickerBoard!({ ...draft, objects });
      committed = true;
      persisted.current = saved;
      onSaved(saved);
      setDraft(saved);
      cleanupIds.current = [...new Set([
        ...board.objects.flatMap(o => o.kind === 'image' ? [o.assetId] : []),
        ...[...pending.current.values()].flatMap(image => image.uploaded ? [image.uploaded.id] : [])
      ])];
      if (cleanupIds.current.length) await repository.discardStickerImages!(cleanupIds.current);
      cleanupIds.current = [];
      onClose();
    } catch (failure) {
      setCleanupFailed(committed);
      setError(committed ? `${t('stickers.cleanupError')} ${stickerError(failure)}` : stickerError(failure));
    } finally { busyRef.current = false; if (alive.current) setBusy(false); }
  }
  async function retryCleanup() {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try {
      if (!repository.discardStickerImages) throw new Error(t('stickers.unavailable'));
      await repository.discardStickerImages(cleanupIds.current);
      cleanupIds.current = [];
      setCleanupFailed(false);
      onClose();
    } catch (failure) { setError(`${t('stickers.cleanupError')} ${stickerError(failure)}`); }
    finally { busyRef.current = false; if (alive.current) setBusy(false); }
  }
  function layerAction(action: 'front' | 'back' | 'copy' | 'delete') {
    if (!selected || selected.locked || busyRef.current) return;
    const rest = draft.objects.filter(o => o.id !== selected.id);
    if (action === 'copy') {
      if (draft.objects.length >= MAX_STICKERS) { setError(t('stickers.count')); return; }
      const copy = copySticker(selected, crypto.randomUUID());
      if (selected.kind === 'image') imageRatios.current.set(copy.id, imageRatios.current.get(selected.id) ?? selected.width / selected.height);
      setDraft({ ...draft, objects: [...draft.objects, copy] }); setSelectedId(copy.id);
    } else {
      setDraft({ ...draft, objects: action === 'front' ? [...rest, selected] : action === 'back' ? [selected, ...rest] : rest });
      if (action === 'delete') setSelectedId(null);
    }
  }
  return <Dialog title={t('stickers.editor')} ariaLabelledBy="sticker-editor-title" className="sticker-editor-dialog"
    restoreFocusRef={restoreFocusRef} onRequestClose={() => { if (discarding) setDiscarding(false); else requestClose(); }}
    headerActions={<button type="button" className="good-icon-button" disabled={busy} aria-label={t('common.close')} onClick={requestClose}><X aria-hidden="true" /></button>}
    footer={<><span className="sticker-editor__hint">{t('stickers.draftHint')}</span>
      <button className="btn" disabled={busy} onClick={requestClose}>{t('common.cancel')}</button>
      <button className="btn btn-primary" disabled={busy || discarding} onClick={() => void (cleanupFailed ? retryCleanup() : save())}>
        {busy ? t('common.saving') : cleanupFailed ? t('stickers.retryCleanup') : t('common.save')}</button></>}>
    <div className="sticker-editor" ref={textInputContainer}>
      {discarding ? <section className="sticker-editor__confirm" role="alertdialog" aria-label={t('common.discardTitle')}>
        <h3>{t('common.discardTitle')}</h3><p>{t('common.discardDesc')}</p>
        <div className="sticker-editor__actions"><button className="btn" disabled={busy} onClick={() => setDiscarding(false)}>{t('stickers.keepEditing')}</button>
          <button className="btn btn-danger" disabled={busy} onClick={() => void discard()}>{t('stickers.discard')}</button></div>
      </section> : null}
      {error || problemMessage ? <p className="sticker-error" role="alert">{error ?? problemMessage}</p> : null}
      {Object.entries(images.failures).map(([id, message]) => <p className="sticker-error" key={id} role="alert">{message}</p>)}
      {Object.keys(images.failures).length ? <button className="btn" onClick={images.retry}>{t('stickers.retryImages')}</button> : null}
      <fieldset disabled={busy || discarding || cleanupFailed} className="sticker-editor__fieldset">
        <legend className="visually-hidden">{t('stickers.editor')}</legend>
        <div className="sticker-editor__actions">
          <button type="button" className="btn" onClick={() => fileInput.current?.click()}>{t('stickers.addImage')}</button>
          <button type="button" className="btn" onClick={addText}>{t('stickers.addText')}</button>
          <input ref={fileInput} type="file" multiple accept={STICKER_IMAGE_ACCEPT} className="visually-hidden" tabIndex={-1}
            aria-label={t('stickers.addImage')} onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; void addFiles(files); }} />
        </div>
        <p className="sticker-editor__hint">{t('stickers.uploadHint')}</p>
        <div className="sticker-editor__layout">
          <div className="sticker-editor__canvas" onDragOver={event => { if (!busy && !discarding) event.preventDefault(); }}
            onDrop={event => { event.preventDefault(); if (!discarding) void addFiles(Array.from(event.dataTransfer.files)); }}>
            <StickerCanvas objects={draft.objects} urls={images.urls} imageFailures={images.failures} selectedId={selectedId} disabled={busy || discarding || cleanupFailed}
              onSelect={setSelectedId} onChange={change} onOverflow={updateOverflow} />
          </div>
          <aside className="sticker-editor__sidebar">
            {selected ? <>
              <button type="button" className="btn" onClick={() => change({ ...selected, locked: !selected.locked })}>{t(selected.locked ? 'stickers.unlock' : 'stickers.lock')}</button>
              <StickerProperties object={selected} imageAspectRatio={imageRatios.current.get(selected.id)} disabled={busy || discarding} onChange={change} />
              <div className="sticker-editor__actions">
                {(['front', 'back', 'copy', 'delete'] as const).map(action => <button type="button"
                  key={action} className={`btn${action === 'delete' ? ' btn-danger' : ''}`} disabled={selected.locked}
                  onClick={() => layerAction(action)}>{t(action === 'delete' ? 'common.delete' : `stickers.${action}`)}</button>)}
              </div>
            </> : <p>{t('stickers.select')}</p>}
            <section className="sticker-layers"><h3>{t('stickers.layers')}</h3>
              {[...draft.objects].reverse().map((object, i) => <button type="button" className="sticker-layers__item"
                key={object.id} aria-pressed={selectedId === object.id} onClick={() => setSelectedId(object.id)}>
                {i + 1}. {object.kind === 'text' ? object.text.slice(0, 30) || t('stickers.newText') : t('stickers.image')}
                {object.locked ? ` · ${t('stickers.locked')}` : ''}
              </button>)}
            </section>
          </aside>
        </div>
      </fieldset>
    </div>
  </Dialog>;
}
