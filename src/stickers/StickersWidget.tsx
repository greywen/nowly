import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { t, useTranslation } from '../i18n';
import { LayoutEditingContext } from '../widgets/LayoutEditingContext';
import { StickerCanvas } from './StickerCanvas';
import { StickerFloatingTools, StickerObjectToolbar } from './StickerObjectToolbar';
import { useStickerAutosave } from './useStickerAutosave';
import { useStickerImages, useStickers, stickerError } from './useStickers';
import { copySticker, fitStickerIntoBounds, MAX_STICKERS, MAX_STICKER_BYTES, newTextSticker, STICKER_HEIGHT, STICKER_STAGE_BOUNDS, STICKER_WIDTH, type StickerBoard, type StickerBounds, type StickerObject } from './sticker-model';
import { STICKER_IMAGE_ACCEPT, validateStickerImage } from './sticker-image';
import './stickers.css';

type Props = { readOnly?: boolean };
export function StickersWidget({ readOnly = false }: Props) {
  useTranslation();
  const { state, load } = useStickers();
  const layoutEditing = useContext(LayoutEditingContext);
  return <div className="widget-content sticker-widget">
    <div className="card-header"><div className="heading-group"><h2>{t('stickers.title')}</h2></div></div>
    {state.status === 'loading' ? <p>{t('stickers.loading')}</p> : null}
    {state.status === 'error' ? <div className="module-message" role="alert"><span>{state.error}</span>
      <button className="btn" onClick={() => void load()}>{t('common.retry')}</button></div> : null}
    {state.status === 'ready' ? <InlineStickerBoard board={state.board} readOnly={readOnly || layoutEditing} /> : null}
  </div>;
}
function InlineStickerBoard({ board, readOnly }: { board: StickerBoard; readOnly: boolean }) {
  const save = useStickerAutosave(board);
  const images = useStickerImages(save.board.objects, save.urls);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overflow, setOverflow] = useState(false);
  const [gesturing, setGesturing] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const replacing = useRef<string | null>(null);
  const defaultOrder = useRef(board.objects.map(object => object.id));
  for (const object of save.board.objects) {
    if (!defaultOrder.current.includes(object.id)) defaultOrder.current.push(object.id);
  }
  const importPoint = useRef<{ x: number; y: number }>({ x: 200, y: 160 });
  const bounds = useRef<StickerBounds>(STICKER_STAGE_BOUNDS);
  const busyRef = useRef(false);
  const latest = useRef(save);
  latest.current = save;
  const readonlyRef = useRef(readOnly);
  readonlyRef.current = readOnly;
  const alive = useRef(true);
  const selected = save.board.objects.find(o => o.id === selectedId);
  const pointerActive = useRef(false);
  const composing = useRef(false);
  const gesture = useCallback((active: boolean) => {
    pointerActive.current = active; setGesturing(active); latest.current.pause(active || composing.current);
  }, []);
  const composition = useCallback((active: boolean) => {
    composing.current = active; latest.current.pause(active || pointerActive.current);
  }, []);
  const updateOverflow = useCallback((ids: string[]) => { setOverflow(ids.length > 0); latest.current.setOverflow(ids.length > 0); }, []);
  const clearTools = useCallback(() => { setSelectedId(null); setEditingId(null); setPoint(null); setLayersOpen(false); }, []);
  useEffect(() => { if (readOnly) { clearTools(); gesture(false); } }, [readOnly, clearTools, gesture]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const outside = (event: globalThis.PointerEvent) => { if (!host.current?.contains(event.target as Node) && !(event.target as Element)?.closest?.('[data-sticker-popup]')) clearTools(); };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.isComposing && !event.defaultPrevented &&
        !document.querySelector('[data-sticker-popup], .sticker-floating-tools [aria-expanded="true"]')) clearTools();
    };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [clearTools]);
  function select(id: string | null) { setSelectedId(id); setPoint(null); if (id !== editingId) setEditingId(null); }
  function change(object: StickerObject) {
    if (readonlyRef.current) return;
    latest.current.change(latest.current.board.objects.map(o => o.id === object.id ? object : o));
  }
  function addText() {
    const current = latest.current;
    if (readOnly) return;
    if (current.board.objects.length >= MAX_STICKERS) { setError(t('stickers.count')); return; }
    const object = fitStickerIntoBounds({ ...newTextSticker(crypto.randomUUID(), t('stickers.newText')), x: point?.x ?? 200, y: point?.y ?? 200 }, bounds.current);
    current.change([...current.board.objects, object]);
    setSelectedId(object.id); setEditingId(object.id); setPoint(null); setError(null);
  }
  async function addFiles(files: File[], at: { x: number; y: number }, replaceId: string | null = null) {
    if (busyRef.current || readonlyRef.current || !files.length) return;
    busyRef.current = true; setBusy(true); setError(null);
    const errors: string[] = [];
    try {
      for (const file of replaceId ? files.slice(0, 1) : files) {
        try {
          const current = latest.current;
          if (!replaceId && current.board.objects.length >= MAX_STICKERS) throw new Error(t('stickers.count'));
          if (!file.size || file.size > MAX_STICKER_BYTES) throw new Error(t('stickers.fileSize'));
          const bytes = new Uint8Array(await file.arrayBuffer());
          const header = await validateStickerImage(bytes, file.name);
          if (!alive.current || readonlyRef.current) return;
          const target = latest.current.board.objects.find(o => o.id === replaceId);
          if (replaceId && (!target || target.kind !== 'image' || target.locked)) return;
          const id = crypto.randomUUID().replace(/-/g, '');
          const ratio = Math.min(320 / header.width, 240 / header.height);
          const width = header.width * ratio, height = header.height * ratio;
          const object: StickerObject = fitStickerIntoBounds({ id: replaceId ?? crypto.randomUUID(), kind: 'image', assetId: id,
            style: target?.kind === 'image' ? target.style : 'original', locked: false, rotation: 0,
            opacity: target?.opacity ?? 100, width, height, x: target?.x ?? at.x, y: target?.y ?? at.y }, bounds.current);
          const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: header.mime }));
          latest.current.addImage(id, { bytes, fileName: file.name, url });
          const objects = latest.current.board.objects;
          latest.current.change(replaceId ? objects.map(o => o.id === replaceId ? object : o) : [...objects, object]);
          setSelectedId(object.id); setEditingId(null); setPoint(null);
        } catch (failure) { errors.push(`${file.name}: ${stickerError(failure)}`); }
      }
      if (alive.current) setError(errors.length ? errors.join('\n') : null);
    } finally { busyRef.current = false; if (alive.current) setBusy(false); }
  }
  function action(action: 'copy' | 'delete' | 'lock' | 'front' | 'back' | 'default') {
    if (!selected || readOnly || (selected.locked && action !== 'lock')) return;
    const objects = latest.current.board.objects;
    if (action === 'lock') { change({ ...selected, locked: !selected.locked }); setEditingId(null); }
    else if (action === 'copy') {
      if (objects.length >= MAX_STICKERS) { setError(t('stickers.count')); return; }
      const copy = copySticker(selected, crypto.randomUUID(), bounds.current); latest.current.change([...objects, copy]); select(copy.id);
    } else if (action === 'delete') { latest.current.change(objects.filter(o => o.id !== selected.id)); clearTools(); }
    else {
      const rest = objects.filter(o => o.id !== selected.id);
      if (action === 'default') {
        const rank = defaultOrder.current.indexOf(selected.id);
        const before = rest.findIndex(object => defaultOrder.current.indexOf(object.id) > rank);
        rest.splice(before < 0 ? rest.length : before, 0, selected);
        latest.current.change(rest);
      } else latest.current.change(action === 'front' ? [...rest, selected] : [selected, ...rest]);
    }
  }
  function pickFiles(replaceId: string | null = null) {
    replacing.current = replaceId;
    importPoint.current = point ?? { x: 200, y: 160 };
    fileInput.current?.click();
  }
  function screenPoint(x: number, y: number) {
    const rect = host.current?.querySelector('.sticker-canvas__stage')?.getBoundingClientRect();
    return rect && rect.width > 0 ? { x: (x - rect.left) * STICKER_WIDTH / rect.width, y: (y - rect.top) * STICKER_HEIGHT / rect.height } : { x: 200, y: 160 };
  }
  return <div ref={host} className="sticker-widget__body" tabIndex={readOnly ? undefined : 0} aria-label={t('stickers.canvas')}
    onDragOver={event => { if (!readOnly && event.dataTransfer.types.includes('Files')) event.preventDefault(); }}
    onDrop={event => { if (readOnly) return; event.preventDefault(); event.stopPropagation(); void addFiles(Array.from(event.dataTransfer.files), screenPoint(event.clientX, event.clientY)); }}
    onPaste={event => {
      if (readOnly || (event.target as HTMLElement).closest('textarea, input, [contenteditable="true"]')) return;
      const files = Array.from(event.clipboardData.files);
      if (files.length) { event.preventDefault(); void addFiles(files, point ?? { x: 200, y: 160 }); }
    }}>
    <StickerCanvas objects={save.board.objects} urls={images.urls} imageFailures={images.failures}
      selectedId={readOnly ? null : selectedId} disabled={readOnly} onSelect={readOnly ? undefined : select}
      onChange={readOnly ? undefined : change} onOverflow={updateOverflow} editingId={editingId}
      onEditText={setEditingId} onGesture={gesture} onComposition={composition} onBounds={value => { bounds.current = value; }}
      onCancel={object => latest.current.change(latest.current.board.objects.map(o => o.id === object.id ? object : o))}
      onBlank={readOnly ? undefined : at => { setPoint(at); setSelectedId(null); setEditingId(null); host.current?.focus(); }} />
    {!save.board.objects.length ? <p className="sticker-widget__empty">{t(readOnly ? 'stickers.empty' : 'stickers.blankHint')}</p> : null}
    {!readOnly && point ? <StickerFloatingTools host={host} point={point} label={t('stickers.add')}>
      <button className="btn" onClick={addText}>{t('stickers.addText')}</button>
      <button className="btn" disabled={busy} onClick={() => pickFiles()}>{t('stickers.uploadImage')}</button>
    </StickerFloatingTools> : null}
    {!readOnly && selected && !gesturing ? <StickerObjectToolbar host={host} object={selected} onChange={change} onAction={action}
      busy={busy} onReplace={() => pickFiles(selected.id)} onEditText={() => setEditingId(selected.id)} /> : null}
    {!readOnly ? <>
      {save.board.objects.length ? <div className="sticker-widget__layers">
        <button className="btn" aria-expanded={layersOpen} onClick={() => { setLayersOpen(!layersOpen); setPoint(null); }}>{t('stickers.layers')}</button>
        {layersOpen ? <div className="sticker-widget__layer-list" aria-label={t('stickers.layers')}>
          {save.board.objects.map((object, index) => <button className="btn" key={object.id} aria-pressed={selectedId === object.id}
            onClick={() => { select(object.id); setLayersOpen(false); }}>
            {`${index + 1}. ${object.kind === 'text' ? object.text.slice(0, 40) : t('stickers.image')}${object.locked ? ` · ${t('stickers.locked')}` : ''}`}
          </button>)}
        </div> : null}
      </div> : null}
      <input ref={fileInput} className="visually-hidden" type="file" accept={STICKER_IMAGE_ACCEPT} multiple={!replacing.current}
        aria-label={t('stickers.chooseImage')} tabIndex={-1} onChange={event => {
          const files = Array.from(event.target.files ?? []); event.target.value = '';
          void addFiles(files, importPoint.current, replacing.current); replacing.current = null;
        }} />
      <div className="sticker-widget__status" role="status" aria-live="polite">
        {busy ? t('stickers.validating') : t(`stickers.${save.status}`)}
      </div>
      {error || save.error || overflow ? <div className="sticker-widget__feedback sticker-error" role="alert">
        <span>{error ?? save.error ?? t('stickers.overflow')}</span>
        {save.error ? <button className="btn" onClick={save.retry}>{t('common.retry')}</button> : null}
      </div> : null}
      {save.cleanupError ? <div className="sticker-widget__feedback sticker-error" role="alert">{t('stickers.cleanupError')}
        <button className="btn" onClick={() => void save.retryCleanup()}>{t('stickers.retryCleanup')}</button></div> : null}
    </> : null}
    {Object.values(images.failures).length ? <div className="sticker-widget__feedback module-message" role="alert">
      <span>{Object.values(images.failures).join('\n')}</span><button className="btn" onClick={images.retry}>{t('stickers.retryImages')}</button>
    </div> : null}
  </div>;
}
