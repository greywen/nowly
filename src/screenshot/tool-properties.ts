import type { AnnotationKind } from './annotation-document';
// The fixed output parameters for the drawing tools.
//
// §5.2 of docs/superpowers/specs/2026-09-25-nowly-screenshot-design.md fixes the
// allowed values and the defaults; design.md §14 is the authority for the palette.
//
// Every size here is in **output physical pixels**, not CSS pixels: they describe
// image content, so a scaled display or a zoomed preview must not change them.
//
// Properties are remembered for the session only. There is no persistence and no
// settings page, so a new session starts from these defaults again.

/// The eight approved annotation colours, per design.md §14.
///
/// `--text-primary` (#211f1c) is near-black but not black, so pure black is a
/// separate entry rather than a duplicate.
export const ANNOTATION_COLORS = [
  '#4fc9da', // --color-primary
  '#b8d935', // --color-success
  '#4f55da', // --color-info
  '#e8c444', // --color-warning
  '#f06445', // --color-danger
  '#211f1c', // --text-primary
  '#ffffff', // --text-inverse
  '#000000'
] as const;

export type AnnotationColor = (typeof ANNOTATION_COLORS)[number];

/// §5.2: the default is the danger colour's value.
export const DEFAULT_COLOR: AnnotationColor = '#f06445';

export const STROKE_WIDTHS = [2, 4, 8] as const;
export const DEFAULT_STROKE_WIDTH = 4;

export const FONT_SIZES = [18, 24, 32] as const;
export const DEFAULT_FONT_SIZE = 24;

export const MOSAIC_BLOCK_SIZES = [8, 16, 24] as const;
export const DEFAULT_MOSAIC_BLOCK_SIZE = 16;

/// Text is drawn in the Nowly body face at weight 500, per §5.2.
export const TEXT_FONT_WEIGHT = 500;

/// Rectangles and ellipses start as outlines; fill is opt-in.
export const DEFAULT_FILLED = false;

export type ToolProperties = {
  color: AnnotationColor;
  strokeWidth: number;
  fontSize: number;
  mosaicBlockSize: number;
  /// Whether a rectangle or ellipse is painted solid in its colour.
  filled: boolean;
};

/// What a property control hands back: a palette entry, a size, or the fill toggle.
export type PropertyValue = string | number | boolean;

export function defaultProperties(): ToolProperties {
  return {
    color: DEFAULT_COLOR,
    strokeWidth: DEFAULT_STROKE_WIDTH,
    fontSize: DEFAULT_FONT_SIZE,
    mosaicBlockSize: DEFAULT_MOSAIC_BLOCK_SIZE,
    filled: DEFAULT_FILLED
  };
}

/// Applies a change, rejecting any value outside the fixed sets.
///
/// Rejecting rather than clamping: an unlisted stroke width or block size would
/// silently produce output the spec does not allow, and a clamped value would hide
/// the mistake.
export function withProperty<K extends keyof ToolProperties>(
  properties: ToolProperties,
  key: K,
  value: ToolProperties[K]
): ToolProperties {
  if (!isAllowed(key, value)) return properties;
  return { ...properties, [key]: value };
}

function isAllowed<K extends keyof ToolProperties>(key: K, value: ToolProperties[K]): boolean {
  switch (key) {
    case 'color':
      return (ANNOTATION_COLORS as readonly string[]).includes(value as string);
    case 'strokeWidth':
      return (STROKE_WIDTHS as readonly number[]).includes(value as number);
    case 'fontSize':
      return (FONT_SIZES as readonly number[]).includes(value as number);
    case 'mosaicBlockSize':
      return (MOSAIC_BLOCK_SIZES as readonly number[]).includes(value as number);
    case 'filled':
      return typeof value === 'boolean';
    default:
      return false;
  }
}

/// Which property rows a kind exposes, per §5.2's per-kind editing column.
///
/// Not every kind gets every row, and the differences are real rather than incidental:
/// a mosaic has no stroke or colour the user chooses (its pixels come from the image),
/// and text has a font size instead of a stroke width. Offering a row that does nothing
/// would tell the user a change took effect when it did not.
///
/// The order is the order the panel lays them out in: size first, then the fill
/// toggle, then — after a divider — the palette.
export type PropertyRow = 'color' | 'strokeWidth' | 'fontSize' | 'blockSize' | 'fill';

export function propertyRowsFor(kind: AnnotationKind): readonly PropertyRow[] {
  switch (kind) {
    case 'rect':
    case 'ellipse':
      // Only closed shapes have an interior to fill.
      return ['strokeWidth', 'fill', 'color'];
    case 'arrow':
    case 'pen':
      return ['strokeWidth', 'color'];
    case 'text':
      return ['fontSize', 'color'];
    case 'mosaic':
      // §5.2 gives the mosaic only its block size.
      return ['blockSize'];
  }
}

/// The allowed values for a row, in the order they are offered.
export function valuesForRow(row: PropertyRow): readonly PropertyValue[] {
  switch (row) {
    case 'color':
      return ANNOTATION_COLORS;
    case 'strokeWidth':
      return STROKE_WIDTHS;
    case 'fontSize':
      return FONT_SIZES;
    case 'blockSize':
      return MOSAIC_BLOCK_SIZES;
    case 'fill':
      return [false, true];
  }
}
