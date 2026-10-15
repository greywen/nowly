import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { t } from '../i18n';
import { fitStickerIntoBounds, geometryFits, STICKER_HEIGHT, STICKER_STAGE_BOUNDS, STICKER_STORAGE_BOUNDS, STICKER_WIDTH, visibleStickerBounds, type StickerBounds, type StickerObject } from './sticker-model';

type Props = {
  objects: StickerObject[];
  urls: Record<string, string>;
  imageFailures?: Record<string, string>;
  selectedId?: string | null;
  disabled?: boolean;
  onSelect?: (id: string | null) => void;
  onChange?: (object: StickerObject) => void;
  onOverflow?: (ids: string[]) => void;
  onBlank?: (point: { x: number; y: number }) => void;
  editingId?: string | null;
  onEditText?: (id: string | null) => void;
  onGesture?: (active: boolean) => void;
  onComposition?: (active: boolean) => void;
  onCancel?: (object: StickerObject) => void;
  onBounds?: (bounds: StickerBounds) => void;
};
type Gesture = { mode: 'move' | 'resize' | 'rotate'; original: StickerObject; x: number; y: number; scale: number; bounds: StickerBounds; pointerId: number; captureTarget: HTMLElement; angle: number; centerX: number; centerY: number };

export function StickerCanvas({ objects, urls, imageFailures, selectedId, disabled, onSelect, onChange, onOverflow, onBlank, editingId, onEditText, onGesture, onComposition, onCancel, onBounds }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [scale, setScale] = useState(1);
  const [bounds, setBounds] = useState<StickerBounds>(STICKER_STAGE_BOUNDS);
  const [preview, setPreview] = useState<StickerObject | null>(null);
  const previewRef = useRef<StickerObject | null>(null);
  const previewFrame = useRef<number | null>(null);
  const movingElement = useRef<HTMLElement | null>(null);
  function clearPreview(rotation = gesture.current?.original.rotation ?? 0) {
    if (previewFrame.current !== null) cancelAnimationFrame(previewFrame.current);
    previewFrame.current = null;
    if (movingElement.current) {
      movingElement.current.style.transform = `rotate(${rotation}deg)`;
      movingElement.current = null;
    }
    previewRef.current = null;
    setPreview(null);
  }
  const textInput = useRef<HTMLTextAreaElement>(null);
  const suppressClick = useRef(false);
  const compositionRef = useRef(onComposition);
  compositionRef.current = onComposition;
  useLayoutEffect(() => () => { compositionRef.current?.(false); }, [editingId, disabled]);
  const currentObjects = useRef(objects);
  currentObjects.current = objects;
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const textLayout = JSON.stringify(objects.filter(o => o.kind === 'text').map(o =>
    [o.id, o.text, o.fontSize, o.bold, o.italic, o.underline, o.locked]));
  useLayoutEffect(() => {
    if (disabled || !changeRef.current) return;
    for (const object of currentObjects.current) {
      if (object.kind !== 'text' || object.locked) continue;
      const measure = Array.from(stage.current?.querySelectorAll<HTMLElement>('[data-measure-id]') ?? [])
        .find(element => element.dataset.measureId === object.id);
      if (!measure) continue;
      const rect = measure.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      const width = Math.min(STICKER_WIDTH, Math.ceil(rect.width / scale) + 2);
      const height = Math.ceil(rect.height / scale);
      // Only the measured size is persisted here; visibility is handled at render time so a resize never rewrites positions.
      const next = fitStickerIntoBounds({ ...object, width, height }, STICKER_STORAGE_BOUNDS);
      if (geometryFits(next, STICKER_STORAGE_BOUNDS) && (width !== object.width || height !== object.height || next.x !== object.x || next.y !== object.y)) changeRef.current(next);
    }
  }, [textLayout, scale, disabled]);
  useLayoutEffect(() => {
    if (editingId) { textInput.current?.focus(); textInput.current?.select(); }
  }, [editingId]);
  useEffect(() => {
    if (!disabled || !gesture.current) return;
    (onCancel ?? onChange)?.(gesture.current.original); clearPreview(); gesture.current = null; onGesture?.(false);
  }, [disabled, onChange, onGesture, onCancel]);
  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      if (width > 0 && height > 0) {
        setScale(Math.min(width / STICKER_WIDTH, height / STICKER_HEIGHT));
        const next = visibleStickerBounds(width, height);
        setBounds(current => current.left === next.left && current.top === next.top && current.right === next.right && current.bottom === next.bottom ? current : next);
      }
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { onBounds?.(bounds); }, [bounds, onBounds]);
  useLayoutEffect(() => {
    if (!onOverflow) return;
    const overflowing = Array.from(stage.current?.querySelectorAll<HTMLElement>('[data-text-id]') ?? [])
      .filter(element => {
        const content = element.querySelector('textarea') ?? element;
        return content.clientHeight > 0 && (content.scrollHeight > content.clientHeight + 1 || content.scrollWidth > content.clientWidth + 1);
      })
      .map(element => element.dataset.textId!);
    onOverflow(overflowing);
  }, [objects, scale, onOverflow]);
  useEffect(() => () => {
    if (previewFrame.current !== null) cancelAnimationFrame(previewFrame.current);
    gesture.current = null;
  }, []);

  function start(event: PointerEvent<HTMLElement>, object: StickerObject, mode: Gesture['mode']) {
    if (disabled) return;
    onSelect?.(object.id);
    if (!onChange || object.locked || (object.id === editingId && mode === 'move' && !event.currentTarget.classList.contains('sticker-object__edge')) || event.button !== 0) return;
    if (mode !== 'move') onEditText?.(null);
    event.preventDefault();
    event.stopPropagation();
    onSelect?.(object.id);
    const rect = stage.current!.getBoundingClientRect();
    const centerX = rect.left + (object.x + object.width / 2) * scale;
    const centerY = rect.top + (object.y + object.height / 2) * scale;
    suppressClick.current = false;
    if (mode === 'move') movingElement.current = event.currentTarget.closest<HTMLElement>('.sticker-object');
    onGesture?.(true);
    gesture.current = { mode, original: object, x: event.clientX, y: event.clientY, scale, bounds, pointerId: event.pointerId, captureTarget: event.currentTarget,
      centerX, centerY, angle: Math.atan2(event.clientY - centerY, event.clientX - centerX) * 180 / Math.PI };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const drag = gesture.current;
    if (!drag || drag.pointerId !== event.pointerId || !onChange) return;
    const { original } = drag;
    if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 3) suppressClick.current = true;
    const dx = (event.clientX - drag.x) / drag.scale;
    const dy = (event.clientY - drag.y) / drag.scale;
    let next: StickerObject;
    if (drag.mode === 'move') {
      // Clamp to the visible module so an overshooting drag slides along the edge instead of freezing.
      next = fitStickerIntoBounds({ ...original, x: original.x + dx, y: original.y + dy }, drag.bounds);
    } else if (drag.mode === 'rotate') {
      const angle = Math.atan2(event.clientY - drag.centerY, event.clientX - drag.centerX) * 180 / Math.PI;
      const rotation = ((Math.round(original.rotation + angle - drag.angle) + 540) % 360) - 180;
      next = { ...original, rotation };
    } else {
      const radians = original.rotation * Math.PI / 180;
      const localX = dx * Math.cos(radians) + dy * Math.sin(radians);
      const localY = -dx * Math.sin(radians) + dy * Math.cos(radians);
      const width = Math.max(24, original.width + localX);
      const height = original.kind === 'image' ? width * original.height / original.width : Math.max(24, original.height + localY);
      const dw = width - original.width;
      const dh = height - original.height;
      next = original.kind === 'text'
        ? { ...original, fontSize: Math.max(12, Math.min(160, Math.round(original.fontSize * width / original.width))),
          width, height: original.height * width / original.width }
        : { ...original, width, height,
          x: original.x + (dw * Math.cos(radians) - dh * Math.sin(radians) - dw) / 2,
          y: original.y + (dw * Math.sin(radians) + dh * Math.cos(radians) - dh) / 2 };
    }
    if (geometryFits(next, drag.bounds)) {
      previewRef.current = next;
      if (drag.mode !== 'move') setPreview(next);
      else if (previewFrame.current === null) {
        previewFrame.current = requestAnimationFrame(() => {
          previewFrame.current = null;
          const latest = previewRef.current;
          if (!latest || !movingElement.current) return;
          movingElement.current.style.transform = `translate(${latest.x - original.x}px, ${latest.y - original.y}px) rotate(${original.rotation}deg)`;
        });
      }
    }
  }
  function end(event: PointerEvent<HTMLDivElement>, cancel: boolean) {
    const drag = gesture.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    gesture.current = null;
    if (cancel) { (onCancel ?? onChange)?.(drag.original); suppressClick.current = true; }
    else if (previewRef.current) onChange?.(previewRef.current);
    clearPreview(drag.original.rotation);
    onGesture?.(false);
    if (drag.captureTarget.hasPointerCapture?.(event.pointerId)) drag.captureTarget.releasePointerCapture(event.pointerId);
  }
  return (
    <div className={`sticker-canvas${onSelect ? ' sticker-canvas--editing' : ''}`} ref={host} data-testid="sticker-canvas"
      onClick={event => {
        if (disabled || !onBlank || (event.target as HTMLElement).closest('.sticker-object')) return;
        if (suppressClick.current) { suppressClick.current = false; return; }
        const rect = stage.current!.getBoundingClientRect();
        onBlank({ x: Math.max(bounds.left, Math.min(bounds.right, (event.clientX - rect.left) / scale)),
          y: Math.max(bounds.top, Math.min(bounds.bottom, (event.clientY - rect.top) / scale)) });
      }}
      onKeyDown={event => { if (event.key === 'Escape' && gesture.current) {
        const original = gesture.current.original; clearPreview(); gesture.current = null; suppressClick.current = true;
        (onCancel ?? onChange)?.(original); onGesture?.(false); event.stopPropagation();
      } }}
      onPointerMove={move} onPointerUp={event => end(event, false)} onPointerCancel={event => end(event, true)}
      onLostPointerCapture={event => end(event, true)}>
      <div className="sticker-canvas__viewport" style={{ width: STICKER_WIDTH * scale, height: STICKER_HEIGHT * scale }}>
        <div ref={stage} className="sticker-canvas__stage" style={{ width: STICKER_WIDTH, height: STICKER_HEIGHT, transform: `scale(${scale})` }}
          onPointerDown={event => { if (event.target === event.currentTarget) onSelect?.(null); }}>
          {objects.filter((object): object is Extract<StickerObject, { kind: 'text' }> => object.kind === 'text').map(object =>
            <div key={`measure-${object.id}`} className="sticker-object__measure" data-measure-id={object.id} aria-hidden="true"
              data-content={`${object.text || '\u200b'}${object.text.endsWith('\n') ? '\u200b' : ''}`}
              style={{ fontSize: `${object.fontSize / 13}rem`, fontWeight: object.bold ? 700 : 400, fontStyle: object.italic ? 'italic' : 'normal' }} />)}
          {objects.filter(object => geometryFits(object, STICKER_STORAGE_BOUNDS)).map(savedObject => {
            const object = preview?.id === savedObject.id ? preview : fitStickerIntoBounds(savedObject, bounds);
            const selected = object.id === selectedId;
            const style: CSSProperties = { left: object.x, top: object.y, width: object.width, height: object.height, transform: `rotate(${object.rotation}deg)` };
            return (
              <div key={object.id} className={`sticker-object${selected ? ' sticker-object--selected' : ''}`} style={style}
                data-testid="sticker-object" data-object-id={object.id}
                tabIndex={onSelect && !disabled ? 0 : undefined} role={onSelect ? 'button' : undefined}
                aria-label={onSelect ? `${object.kind === 'text' ? object.text.slice(0, 40) : t('stickers.image')}${object.locked ? ` · ${t('stickers.locked')}` : ''}` : undefined}
                onClick={event => { event.stopPropagation(); if (!disabled && !suppressClick.current) {
                  onSelect?.(object.id); if (object.kind === 'text' && !object.locked) onEditText?.(object.id);
                } suppressClick.current = false; }}
                onDoubleClick={event => { event.stopPropagation(); if (!disabled && !object.locked && object.kind === 'text') onEditText?.(object.id); }}
                onKeyDown={event => {
                  if (disabled || event.target !== event.currentTarget) return;
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault(); onSelect?.(object.id);
                    if (event.key === 'Enter' && object.kind === 'text' && !object.locked) onEditText?.(object.id);
                  }
                  if (!object.locked && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
                    event.preventDefault(); event.stopPropagation();
                    const step = event.shiftKey ? 10 : 1;
                    let next: StickerObject = { ...object };
                    if (event.altKey) {
                      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') next.rotation = Math.max(-180, Math.min(180, object.rotation + (event.key === 'ArrowLeft' ? -step : step)));
                      else {
                        const factor = event.key === 'ArrowUp' ? 1 : -1;
                        if (next.kind === 'text') next.fontSize = Math.max(12, Math.min(160, next.fontSize + factor * step));
                        else { next.width = Math.max(24, object.width + factor * step); next.height = next.width * object.height / object.width; }
                      }
                    } else if (event.key === 'ArrowLeft') next.x -= step;
                    else if (event.key === 'ArrowRight') next.x += step;
                    else if (event.key === 'ArrowUp') next.y -= step;
                    else next.y += step;
                    if (geometryFits(next, bounds)) onChange?.(next);
                  }
                }}
                onPointerDown={event => start(event, object, 'move')}>
                {object.kind === 'text'
                  ? <div className="sticker-object__text" data-text-id={object.id} style={{
                    opacity: object.opacity / 100, fontSize: `${object.fontSize / 13}rem`, color: object.color,
                    fontWeight: object.bold ? 700 : 400, fontStyle: object.italic ? 'italic' : 'normal',
                    textDecoration: object.underline ? 'underline' : 'none', textAlign: object.align
                  }}>{editingId === object.id && !disabled && !object.locked
                    ? <textarea ref={textInput} className="sticker-object__input" aria-label={t('stickers.text')} value={object.text}
                      onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}
                      onChange={event => onChange?.({ ...object, text: event.target.value })}
                      onCompositionStart={() => onComposition?.(true)} onCompositionEnd={() => onComposition?.(false)}
                      onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape' && !event.nativeEvent.isComposing) { onEditText?.(null); onComposition?.(false); } }}
                      onBlur={() => onComposition?.(false)} /> : object.text}</div>
                  : <div className={`sticker-object__image sticker-object__image--${object.style}`} style={{ opacity: object.opacity / 100 }}>
                    {urls[object.assetId] ? <img src={urls[object.assetId]} alt={t('stickers.image')} draggable={false} />
                      : <span className="sticker-object__missing">{imageFailures?.[object.assetId] ? t('stickers.missingImage') : t('stickers.loading')}</span>}
                  </div>}
                {selected && !object.locked && !disabled && onChange ? <>
                  {object.kind === 'text' ? (['top', 'right', 'bottom', 'left'] as const).map(edge =>
                    <span key={edge} aria-hidden="true" className={`sticker-object__edge sticker-object__edge--${edge}`}
                      onPointerDown={event => { onEditText?.(null); start(event, object, 'move'); }} />) : null}
                  <span aria-hidden="true" title={t('stickers.resize')} className="sticker-object__handle sticker-object__handle--resize" onPointerDown={event => start(event, object, 'resize')} />
                  <span aria-hidden="true" title={t('stickers.rotate')} className="sticker-object__handle sticker-object__handle--rotate" onPointerDown={event => start(event, object, 'rotate')} />
                </> : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
