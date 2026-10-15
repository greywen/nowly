import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { t } from '../i18n';
import { Select } from '../components/Select';
import { ColorPicker } from '../components/ColorPicker';
import { Copy, Lock, Trash2, Unlock } from '../components/icons';
import type { HexColor } from '../lib/color';
import type { StickerObject } from './sticker-model';

type FloatingProps = { host: RefObject<HTMLDivElement | null>; objectId?: string; point?: { x: number; y: number }; children: ReactNode; label: string };
export function StickerFloatingTools({ host, objectId, point, children, label }: FloatingProps) {
  const tools = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  useLayoutEffect(() => {
    const element = host.current;
    const toolbar = tools.current;
    if (!element || !toolbar) return;
    const measure = () => {
      const bounds = element.getBoundingClientRect();
      const object = Array.from(element.querySelectorAll<HTMLElement>('[data-object-id]')).find(item => item.dataset.objectId === objectId);
      const anchor = object?.getBoundingClientRect();
      const stage = element.querySelector('.sticker-canvas__stage')?.getBoundingClientRect();
      const x = anchor ? anchor.left - bounds.left : stage && point ? stage.left - bounds.left + point.x * stage.width / 800 : 8;
      const below = anchor ? anchor.bottom - bounds.top + 8 : stage && point ? stage.top - bounds.top + point.y * stage.height / 600 + 8 : 8;
      const above = anchor ? anchor.top - bounds.top - toolbar.offsetHeight - 8 : below - toolbar.offsetHeight - 16;
      const fitsBelow = below + toolbar.offsetHeight <= bounds.height - 8;
      const fitsAbove = above >= 8;
      const top = fitsBelow ? below : fitsAbove ? above
        : bounds.height - below >= (anchor?.top ?? bounds.top) - bounds.top ? below : above;
      const next = { left: Math.max(8, Math.min(x, bounds.width - toolbar.offsetWidth - 8)),
        top: Math.max(8, Math.min(top, bounds.height - toolbar.offsetHeight - 8)) };
      setPosition(current => current.left === next.left && current.top === next.top ? current : next);
    };
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    observer?.observe(element); observer?.observe(toolbar);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); };
  }, [host, objectId, point, children]);
  return <div ref={tools} className="sticker-floating-tools" style={position} role="toolbar" aria-label={label}
    onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
    {children}
  </div>;
}

type Props = { host: RefObject<HTMLDivElement | null>; object: StickerObject; onChange: (object: StickerObject) => void;
  onAction: (action: 'copy' | 'delete' | 'lock' | 'default' | 'front' | 'back') => void; onReplace: () => void; onEditText?: () => void; busy: boolean };
const fontSizes = Array.from({ length: 149 }, (_, index) => ({ value: String(index + 12), label: String(index + 12) }));
const opacities = Array.from({ length: 101 }, (_, index) => ({ value: String(index), label: `${index}%` }));
const textStyles = Array.from({ length: 8 }, (_, mask) => ({
  value: String(mask), bold: Boolean(mask & 1), italic: Boolean(mask & 2), underline: Boolean(mask & 4)
}));

export function StickerObjectToolbar({ host, object, onChange, onAction, onReplace, busy }: Props) {
  const locked = object.locked;
  const LockIcon = locked ? Unlock : Lock;
  return <StickerFloatingTools host={host} objectId={object.id} label={t('stickers.properties')}>
    <div className="sticker-object-tools__row">
      {object.kind === 'text' ? <>
        <Select fitContent id={`sticker-text-style-${object.id}`} label={t('stickers.textStyle')} hideLabel disabled={locked}
          value={String(Number(object.bold) + Number(object.italic) * 2 + Number(object.underline) * 4)}
          options={textStyles.map(style => ({ value: style.value,
            label: (['bold', 'italic', 'underline'] as const).filter(key => style[key]).map(key => t(`stickers.${key}`)).join(' / ') || t('stickers.regular') }))}
          onChange={value => {
            const style = textStyles[Number(value)];
            onChange({ ...object, bold: style.bold, italic: style.italic, underline: style.underline });
          }} />
        <Select fitContent id={`sticker-font-size-${object.id}`} label={t('stickers.fontSize')} hideLabel searchable disabled={locked}
          value={String(object.fontSize)} options={fontSizes} onChange={value => onChange({ ...object, fontSize: Number(value) })} />
        <ColorPicker compact stickerPopup legend={t('stickers.color')} name={`sticker-color-${object.id}`}
          value={object.color as HexColor} presets={[]} recentColors={[]} disabled={locked}
          onChange={color => onChange({ ...object, color })} />
        <Select fitContent id={`sticker-align-${object.id}`} label={t('stickers.align')} hideLabel value={object.align} disabled={locked}
          options={(['left', 'center', 'right'] as const).map(value => ({ value, label: t(`stickers.${value}`) }))}
          onChange={value => onChange({ ...object, align: value as 'left' | 'center' | 'right' })} />
      </> : <>
        <button type="button" className="btn" disabled={locked || busy} onClick={onReplace}>{t('stickers.replaceImage')}</button>
        <Select fitContent id={`sticker-style-${object.id}`} label={t('stickers.style')} hideLabel value={object.style} disabled={locked}
          options={(['original', 'rounded', 'circle', 'photo'] as const).map(value => ({ value, label: t(`stickers.${value}`) }))}
          onChange={value => onChange({ ...object, style: value as 'original' | 'rounded' | 'circle' | 'photo' })} />
      </>}
      <button type="button" className="btn btn-icon" aria-label={t(locked ? 'stickers.unlock' : 'stickers.lock')}
        title={t(locked ? 'stickers.unlock' : 'stickers.lock')} aria-pressed={locked} onClick={() => onAction('lock')}><LockIcon size={18} /></button>
      <Select fitContent id={`sticker-opacity-${object.id}`} label={t('stickers.opacity')} hideLabel value={String(object.opacity)} disabled={locked}
        options={opacities} searchable onChange={value => onChange({ ...object, opacity: Number(value) })} />
      <Select fitContent id={`sticker-layer-${object.id}`} label={t('stickers.layers')} hideLabel value="default" disabled={locked}
        options={(['default', 'front', 'back'] as const).map(value => ({ value, label: t(`stickers.${value}`) }))}
        onChange={value => onAction(value as 'default' | 'front' | 'back')} />
      <button type="button" className="btn btn-icon" aria-label={t('stickers.copy')} title={t('stickers.copy')}
        disabled={locked} onClick={() => onAction('copy')}><Copy size={18} /></button>
      <button type="button" className="btn btn-icon btn-danger" aria-label={t('common.delete')} title={t('common.delete')}
        disabled={locked} onClick={() => onAction('delete')}><Trash2 size={18} /></button>
    </div>
  </StickerFloatingTools>;
}
