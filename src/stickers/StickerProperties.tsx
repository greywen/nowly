import { ColorPicker } from '../components/ColorPicker';
import { Select } from '../components/Select';
import { t } from '../i18n';
import { DESIGN_COLORS } from '../lib/color';
import { useRecentColors } from '../settings/useRecentColors';
import type { StickerObject } from './sticker-model';

type Props = { object: StickerObject; imageAspectRatio?: number; disabled: boolean; onChange: (object: StickerObject) => void };
export function StickerProperties({ object, imageAspectRatio, disabled, onChange }: Props) {
  const { recentColors, rememberColor } = useRecentColors();
  const locked = disabled || object.locked;
  const geometryFields = ['x', 'y', 'width', 'height', 'rotation', 'opacity'] as const;
  function numberChange(field: typeof geometryFields[number], value: string) {
    const number = value.trim() === '' ? NaN : Number(value);
    const next = { ...object, [field]: number };
    if (object.kind === 'image') {
      const ratio = imageAspectRatio ?? object.width / object.height;
      if (field === 'width') next.height = number / ratio;
      if (field === 'height') next.width = number * ratio;
    }
    onChange(next);
  }
  return <section className="sticker-properties">
    <h3>{t('stickers.properties')}</h3>
    <div className="sticker-properties__geometry">
      {geometryFields.map(field => <label className="sticker-field" key={field}>
        <span>{t(`stickers.${field}`)}</span>
        <input className="good-input" type="number" step={field === 'rotation' || field === 'opacity' ? 1 : 'any'}
          disabled={locked} value={Number.isFinite(object[field]) ? object[field] : ''}
          onChange={event => numberChange(field, event.target.value)} />
      </label>)}
    </div>
    {object.kind === 'text' ? <>
      <label className="sticker-field"><span>{t('stickers.text')}</span>
        <textarea className="good-input" aria-label={t('stickers.text')} disabled={locked} value={object.text}
          onChange={event => onChange({ ...object, text: event.target.value })} />
      </label>
      <label className="sticker-field"><span>{t('stickers.fontSize')}</span>
        <input className="good-input" type="number" min={12} max={160} step={1} disabled={locked}
          value={Number.isFinite(object.fontSize) ? object.fontSize : ''}
          onChange={event => onChange({ ...object, fontSize: event.target.value.trim() ? Number(event.target.value) : NaN })} />
      </label>
      <div className="sticker-properties__format">
        {(['bold', 'italic', 'underline'] as const).map(key => <button type="button" className="btn"
          key={key} aria-pressed={object[key]} disabled={locked} onClick={() => onChange({ ...object, [key]: !object[key] })}>{t(`stickers.${key}`)}</button>)}
      </div>
      <ColorPicker legend={t('stickers.color')} name="sticker-text-color" value={object.color} disabled={locked}
        presets={Object.entries(DESIGN_COLORS).map(([label, value]) => ({ value, label: t(`stickers.color.${label}`) }))}
        recentColors={recentColors} onRememberColor={rememberColor}
        onChange={color => onChange({ ...object, color })} />
      <Select id="sticker-text-align" label={t('stickers.align')} value={object.align} disabled={locked}
        options={(['left', 'center', 'right'] as const).map(value => ({ value, label: t(`stickers.${value}`) }))}
        onChange={value => { if (value === 'left' || value === 'center' || value === 'right') onChange({ ...object, align: value }); }} />
    </> : <Select id="sticker-image-style" label={t('stickers.style')} value={object.style} disabled={locked}
      options={(['original', 'rounded', 'circle', 'photo'] as const).map(value => ({ value, label: t(`stickers.${value}`) }))}
      onChange={value => { if (value === 'original' || value === 'rounded' || value === 'circle' || value === 'photo') onChange({ ...object, style: value }); }} />}
  </section>;
}
