import { useTranslation } from '../i18n';
import type { Annotation } from './annotation-document';
import {
  propertyRowsFor,
  valuesForRow,
  type PropertyRow,
  type PropertyValue,
  type ToolProperties
} from './tool-properties';

// The per-kind property bar, laid out as one horizontal strip under the toolbar:
//
//   [size × 3] [fill] │ [swatches]
//
// §5.2 of docs/superpowers/specs/2026-09-25-nowly-screenshot-design.md fixes the value
// sets, so these are discrete choices rather than sliders or a colour picker: a free
// picker would let the user choose a colour the spec does not allow, and a slider implies
// intermediate values that do not exist.
//
// Sizes are shown as what they mean rather than as numbers: a stroke width or mosaic
// block as a dot of growing size, a font size as 小 / 中 / 大. The real value stays in
// the accessible name, so assistive tech and tests still read the exact number.

export type PropertyPanelProps = {
  /// The kind whose rows are shown: the selected object's, or the active tool's.
  kind: Annotation['kind'] | null;
  properties: ToolProperties;
  onChange: (row: PropertyRow, value: PropertyValue) => void;
};

/// The property a row reads from the defaults.
function currentValue(row: PropertyRow, properties: ToolProperties): PropertyValue {
  switch (row) {
    case 'color':
      return properties.color;
    case 'strokeWidth':
      return properties.strokeWidth;
    case 'fontSize':
      return properties.fontSize;
    case 'blockSize':
      return properties.mosaicBlockSize;
    case 'fill':
      return properties.filled;
  }
}

const ROW_LABEL_KEYS: Readonly<Record<PropertyRow, string>> = {
  color: 'screenshot.property.color',
  strokeWidth: 'screenshot.property.strokeWidth',
  fontSize: 'screenshot.property.fontSize',
  blockSize: 'screenshot.property.blockSize',
  fill: 'screenshot.property.fill'
};

/// 小 / 中 / 大, by position in the fixed three-value set.
const SIZE_STEP_KEYS = [
  'screenshot.property.small',
  'screenshot.property.medium',
  'screenshot.property.large'
] as const;

/// The dot diameters, in CSS pixels, for the three steps of a size row. They describe
/// the step, not the output size: an 8px stroke drawn as an 8px dot would be lost
/// next to the swatches at 2px.
const DOT_SIZES = [6, 10, 16] as const;

function SizeRow({
  row,
  active,
  label,
  onChange
}: {
  row: 'strokeWidth' | 'fontSize' | 'blockSize';
  active: PropertyValue;
  label: string;
  onChange: (value: PropertyValue) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="screenshot-properties__group" role="radiogroup" aria-label={label}>
      {valuesForRow(row).map((value, index) => {
        const selected = value === active;
        return (
          <button
            key={String(value)}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={`${label} ${value}`}
            title={`${label} ${value}`}
            className={`screenshot-properties__size screenshot-properties__size--${
              row === 'fontSize' ? 'text' : 'dot'
            }`}
            data-row={row}
            data-value={String(value)}
            onClick={() => onChange(value)}
          >
            {row === 'fontSize' ? (
              t(SIZE_STEP_KEYS[index])
            ) : (
              <span
                className="screenshot-properties__dot"
                style={{ width: DOT_SIZES[index], height: DOT_SIZES[index] }}
                aria-hidden="true"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

export function PropertyPanel({ kind, properties, onChange }: PropertyPanelProps) {
  const { t } = useTranslation();
  if (!kind) return null;
  const rows = propertyRowsFor(kind);
  if (rows.length === 0) return null;

  const leading = rows.filter((row) => row !== 'color');
  const hasColor = rows.includes('color');

  return (
    <div
      className="screenshot-properties"
      role="group"
      aria-label={t('screenshot.propertyPanelLabel')}
    >
      {leading.map((row) => {
        const label = t(ROW_LABEL_KEYS[row]);
        if (row === 'fill') {
          const filled = properties.filled;
          return (
            <button
              key={row}
              type="button"
              aria-pressed={filled}
              aria-label={label}
              title={label}
              className="screenshot-properties__fill"
              data-row="fill"
              data-value={String(filled)}
              onClick={() => onChange('fill', !filled)}
            >
              <span className="screenshot-properties__fill-glyph" aria-hidden="true" />
            </button>
          );
        }
        return (
          <SizeRow
            key={row}
            row={row}
            active={currentValue(row, properties)}
            label={label}
            onChange={(value) => onChange(row, value)}
          />
        );
      })}
      {hasColor && leading.length > 0 ? (
        <span className="screenshot-properties__divider" aria-hidden="true" />
      ) : null}
      {hasColor ? (
        <div
          className="screenshot-properties__group"
          role="radiogroup"
          aria-label={t(ROW_LABEL_KEYS.color)}
        >
          {valuesForRow('color').map((value) => {
            const selected =
              String(value).toLowerCase() === String(properties.color).toLowerCase();
            return (
              <button
                key={String(value)}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={`${t(ROW_LABEL_KEYS.color)} ${value}`}
                className="screenshot-properties__swatch"
                data-row="color"
                data-value={String(value)}
                onClick={() => onChange('color', value)}
              >
                <span
                  className="screenshot-properties__swatch-chip"
                  style={{ background: String(value) }}
                  aria-hidden="true"
                />
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
