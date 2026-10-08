import { describe, expect, it } from 'vitest';
import {
  ANNOTATION_COLORS,
  DEFAULT_COLOR,
  DEFAULT_FONT_SIZE,
  DEFAULT_MOSAIC_BLOCK_SIZE,
  DEFAULT_STROKE_WIDTH,
  defaultProperties,
  FONT_SIZES,
  MOSAIC_BLOCK_SIZES,
  propertyRowsFor,
  valuesForRow,
  STROKE_WIDTHS,
  TEXT_FONT_WEIGHT,
  withProperty
} from './tool-properties';

describe('the fixed parameter sets', () => {
  it('matches §5.2 exactly', () => {
    expect(STROKE_WIDTHS).toEqual([2, 4, 8]);
    expect(FONT_SIZES).toEqual([18, 24, 32]);
    expect(MOSAIC_BLOCK_SIZES).toEqual([8, 16, 24]);
    expect(TEXT_FONT_WEIGHT).toBe(500);
  });

  it('defaults to the values §5.2 names', () => {
    expect(defaultProperties()).toEqual({
      // --color-danger
      color: '#f06445',
      strokeWidth: 4,
      fontSize: 24,
      mosaicBlockSize: 16,
      filled: false
    });
  });

  it('keeps every default inside its own set', () => {
    expect(STROKE_WIDTHS).toContain(DEFAULT_STROKE_WIDTH);
    expect(FONT_SIZES).toContain(DEFAULT_FONT_SIZE);
    expect(MOSAIC_BLOCK_SIZES).toContain(DEFAULT_MOSAIC_BLOCK_SIZE);
    expect(ANNOTATION_COLORS).toContain(DEFAULT_COLOR);
  });

  it('offers the eight approved colours and no more', () => {
    // design.md §14: primary, the four functional colours, --text-primary,
    // --text-inverse and pure black. No new theme token.
    expect(ANNOTATION_COLORS).toEqual([
      '#4fc9da',
      '#b8d935',
      '#4f55da',
      '#e8c444',
      '#f06445',
      '#211f1c',
      '#ffffff',
      '#000000'
    ]);
    expect(new Set(ANNOTATION_COLORS).size).toBe(8);
  });

  it('keeps near-black and black apart', () => {
    // --text-primary is #211f1c, so pure black is a distinct eighth entry rather
    // than a duplicate of it.
    expect(ANNOTATION_COLORS).toContain('#211f1c');
    expect(ANNOTATION_COLORS).toContain('#000000');
  });

  it('shares the mosaic block sizes with the Rust implementation', () => {
    // src-tauri/src/screen_capture/mosaic.rs tests the same three sizes; if these
    // ever diverge, the preview would offer a block size the exporter cannot honour.
    expect(MOSAIC_BLOCK_SIZES).toEqual([8, 16, 24]);
  });

  it('mentions no mutable state, so a session starts fresh', () => {
    // §5.2 forbids cross-session persistence, so two calls must be independent.
    const first = defaultProperties();
    first.strokeWidth = 8;

    expect(defaultProperties().strokeWidth).toBe(4);
  });
});

describe('changing a property', () => {
  it('accepts every listed value', () => {
    for (const width of STROKE_WIDTHS) {
      expect(withProperty(defaultProperties(), 'strokeWidth', width).strokeWidth).toBe(width);
    }
    for (const size of FONT_SIZES) {
      expect(withProperty(defaultProperties(), 'fontSize', size).fontSize).toBe(size);
    }
    for (const block of MOSAIC_BLOCK_SIZES) {
      expect(
        withProperty(defaultProperties(), 'mosaicBlockSize', block).mosaicBlockSize
      ).toBe(block);
    }
    for (const color of ANNOTATION_COLORS) {
      expect(withProperty(defaultProperties(), 'color', color).color).toBe(color);
    }
  });

  it('rejects an unlisted value instead of clamping it', () => {
    // Clamping would silently produce output §5.2 does not allow.
    const properties = defaultProperties();

    expect(withProperty(properties, 'strokeWidth', 3).strokeWidth).toBe(4);
    expect(withProperty(properties, 'strokeWidth', 999).strokeWidth).toBe(4);
    expect(withProperty(properties, 'fontSize', 20).fontSize).toBe(24);
    expect(withProperty(properties, 'mosaicBlockSize', 12).mosaicBlockSize).toBe(16);
    // A colour outside the palette, including a new theme token.
    expect(
      withProperty(properties, 'color', '#123456' as (typeof ANNOTATION_COLORS)[number]).color
    ).toBe('#f06445');
  });

  it('leaves the other properties untouched', () => {
    const changed = withProperty(defaultProperties(), 'strokeWidth', 8);

    expect(changed).toEqual({
      color: '#f06445',
      strokeWidth: 8,
      fontSize: 24,
      mosaicBlockSize: 16,
      filled: false
    });
  });

  it('does not mutate the input', () => {
    // The session remembers the last value by holding a new object, so an earlier
    // snapshot must not change under it.
    const original = defaultProperties();

    withProperty(original, 'strokeWidth', 8);

    expect(original.strokeWidth).toBe(4);
  });
});

describe('propertyRowsFor', () => {
  it('gives closed shapes a stroke width, a fill toggle and a colour', () => {
    for (const kind of ['rect', 'ellipse'] as const) {
      expect(propertyRowsFor(kind)).toEqual(['strokeWidth', 'fill', 'color']);
    }
  });

  it('gives the arrow and the pen a stroke width and a colour, with no fill', () => {
    for (const kind of ['arrow', 'pen'] as const) {
      expect(propertyRowsFor(kind)).toEqual(['strokeWidth', 'color']);
    }
  });

  it('gives text a font size instead of a stroke width', () => {
    // §5.2: text has no stroke the user picks, so offering one would be a control that
    // changes nothing.
    expect(propertyRowsFor('text')).toEqual(['fontSize', 'color']);
  });

  it('gives the mosaic only its block size', () => {
    // A mosaic's pixels come from the image, so it has no colour to choose. A colour row
    // here would tell the user a change took effect when nothing changed.
    expect(propertyRowsFor('mosaic')).toEqual(['blockSize']);
  });

  it('offers no row that has no values', () => {
    for (const kind of ['rect', 'ellipse', 'arrow', 'pen', 'text', 'mosaic'] as const) {
      for (const row of propertyRowsFor(kind)) {
        expect(valuesForRow(row).length).toBeGreaterThan(0);
      }
    }
  });
});

describe('valuesForRow', () => {
  it('offers exactly the documented sets', () => {
    // Hand-written from §5.2 rather than read back from the constants, so a change to
    // either has to be deliberate.
    expect(valuesForRow('strokeWidth')).toEqual([2, 4, 8]);
    expect(valuesForRow('fontSize')).toEqual([18, 24, 32]);
    expect(valuesForRow('blockSize')).toEqual([8, 16, 24]);
    expect(valuesForRow('color').length).toBe(8);
  });
});
