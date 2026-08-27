import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRESET_ID,
  PREVIEW_CELL_H,
  PREVIEW_CELL_W,
  PREVIEW_GAP,
  SIZE_PRESETS,
  findPreset,
  gearsToPixels
} from './size-presets';

describe('gearsToPixels', () => {
  it('sums cells plus the gaps between them', () => {
    // 3 cells wide = 3*89 + 2*16 = 299; 2 cells tall = 2*63 + 1*16 = 142.
    expect(gearsToPixels(3, 2)).toEqual({ width: 299, height: 142 });
  });

  it('has no gap for a single cell', () => {
    expect(gearsToPixels(1, 1)).toEqual({ width: PREVIEW_CELL_W, height: PREVIEW_CELL_H });
  });

  it('accepts a custom cell metric', () => {
    expect(gearsToPixels(2, 2, { w: 100, h: 50, gap: 10 })).toEqual({ width: 210, height: 110 });
  });

  it('uses the exported default metrics', () => {
    const { width } = gearsToPixels(2, 1);
    expect(width).toBe(2 * PREVIEW_CELL_W + PREVIEW_GAP);
  });
});

describe('SIZE_PRESETS', () => {
  it('exposes the four design-spec gears', () => {
    expect(SIZE_PRESETS.map((p) => p.id)).toEqual(['3x2', '4x3', '6x4', '12x8']);
  });

  it('labels each preset with its cell counts', () => {
    expect(SIZE_PRESETS[0].label).toBe('3×2');
    expect(SIZE_PRESETS[3].label).toBe('12×8');
  });

  it('computes width/height from the gear math', () => {
    const twelveByEight = SIZE_PRESETS[3];
    expect(twelveByEight).toMatchObject(gearsToPixels(12, 8));
  });
});

describe('findPreset', () => {
  it('finds a preset by id', () => {
    expect(findPreset('6x4').cellsW).toBe(6);
  });

  it('falls back to the first preset for an unknown id', () => {
    expect(findPreset('nope')).toBe(SIZE_PRESETS[0]);
  });

  it('has a default that resolves to a real preset', () => {
    expect(findPreset(DEFAULT_PRESET_ID).id).toBe(DEFAULT_PRESET_ID);
  });
});
