import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { t } from '../i18n';
import { geometryFits, STICKER_HEIGHT, STICKER_WIDTH, type StickerObject } from './sticker-model';

type Props = {
  objects: StickerObject[];
  urls: Record<string, string>;
  imageFailures?: Record<string, string>;
  selectedId?: string | null;
  disabled?: boolean;
  onSelect?: (id: string | null) => void;
  onChange?: (object: StickerObject) => void;
  onOverflow?: (ids: string[]) => void;
};
type Gesture = { mode: 'move' | 'resize' | 'rotate'; original: StickerObject; x: number; y: number; scale: number; pointerId: number; angle: number };

export function StickerCanvas({ objects, urls, imageFailures, selectedId, disabled, onSelect, onChange, onOverflow }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      if (width > 0 && height > 0) setScale(Math.min(width / STICKER_WIDTH, height / STICKER_HEIGHT));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (!onOverflow) return;
    const overflowing = Array.from(stage.current?.querySelectorAll<HTMLElement>('[data-text-id]') ?? [])
      .filter(element => element.clientHeight > 0 && (element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1))
      .map(element => element.dataset.textId!);
    onOverflow(overflowing);
  }, [objects, scale, onOverflow]);
  useEffect(() => () => { gesture.current = null; }, []);

  function start(event: PointerEvent<HTMLElement>, object: StickerObject, mode: Gesture['mode']) {
    if (!onChange || disabled || object.locked || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect?.(object.id);
    const rect = stage.current!.getBoundingClientRect();
    const centerX = rect.left + (object.x + object.width / 2) * scale;
    const centerY = rect.top + (object.y + object.height / 2) * scale;
    gesture.current = { mode, original: object, x: event.clientX, y: event.clientY, scale, pointerId: event.pointerId,
      angle: Math.atan2(event.clientY - centerY, event.clientX - centerX) * 180 / Math.PI };
    host.current?.setPointerCapture?.(event.pointerId);
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const drag = gesture.current;
    if (!drag || drag.pointerId !== event.pointerId || !onChange) return;
    const { original } = drag;
    const dx = (event.clientX - drag.x) / drag.scale;
    const dy = (event.clientY - drag.y) / drag.scale;
    let next: StickerObject;
    if (drag.mode === 'move') next = { ...original, x: original.x + dx, y: original.y + dy };
    else if (drag.mode === 'rotate') {
      const rect = stage.current!.getBoundingClientRect();
      const angle = Math.atan2(event.clientY - rect.top - (original.y + original.height / 2) * drag.scale,
        event.clientX - rect.left - (original.x + original.width / 2) * drag.scale) * 180 / Math.PI;
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
      next = { ...original, width, height,
        x: original.x + (dw * Math.cos(radians) - dh * Math.sin(radians) - dw) / 2,
        y: original.y + (dw * Math.sin(radians) + dh * Math.cos(radians) - dh) / 2 };
    }
    if (geometryFits(next)) onChange(next);
  }
  function end(event: PointerEvent<HTMLDivElement>, cancel: boolean) {
    const drag = gesture.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    gesture.current = null;
    if (cancel) onChange?.(drag.original);
    if (host.current?.hasPointerCapture?.(event.pointerId)) host.current.releasePointerCapture(event.pointerId);
  }
  return (
    <div className={`sticker-canvas${onSelect ? ' sticker-canvas--editing' : ''}`} ref={host} data-testid="sticker-canvas"
      onPointerMove={move} onPointerUp={event => end(event, false)} onPointerCancel={event => end(event, true)}
      onLostPointerCapture={event => end(event, true)}>
      <div className="sticker-canvas__viewport" style={{ width: STICKER_WIDTH * scale, height: STICKER_HEIGHT * scale }}>
        <div ref={stage} className="sticker-canvas__stage" style={{ width: STICKER_WIDTH, height: STICKER_HEIGHT, transform: `scale(${scale})` }}
          onPointerDown={event => { if (event.target === event.currentTarget) onSelect?.(null); }}>
          {objects.filter(geometryFits).map(object => {
            const selected = object.id === selectedId;
            const style: CSSProperties = { left: object.x, top: object.y, width: object.width, height: object.height, transform: `rotate(${object.rotation}deg)` };
            return (
              <div key={object.id} className={`sticker-object${selected ? ' sticker-object--selected' : ''}`} style={style}
                data-testid="sticker-object" data-object-id={object.id}
                tabIndex={onSelect && !disabled ? 0 : undefined} role={onSelect ? 'button' : undefined}
                aria-label={onSelect ? `${object.kind === 'text' ? object.text.slice(0, 40) : t('stickers.image')}${object.locked ? ` · ${t('stickers.locked')}` : ''}` : undefined}
                onClick={() => { if (!disabled) onSelect?.(object.id); }}
                onKeyDown={event => { if (!disabled && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onSelect?.(object.id); } }}
                onPointerDown={event => start(event, object, 'move')}>
                {object.kind === 'text'
                  ? <div className="sticker-object__text" data-text-id={object.id} style={{
                    opacity: object.opacity / 100, fontSize: `${object.fontSize / 13}rem`, color: object.color,
                    fontWeight: object.bold ? 700 : 400, fontStyle: object.italic ? 'italic' : 'normal',
                    textDecoration: object.underline ? 'underline' : 'none', textAlign: object.align
                  }}>{object.text}</div>
                  : <div className={`sticker-object__image sticker-object__image--${object.style}`} style={{ opacity: object.opacity / 100 }}>
                    {urls[object.assetId] ? <img src={urls[object.assetId]} alt={t('stickers.image')} draggable={false} />
                      : <span className="sticker-object__missing">{imageFailures?.[object.assetId] ? t('stickers.missingImage') : t('stickers.loading')}</span>}
                  </div>}
                {selected && !object.locked && !disabled && onChange ? <>
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
