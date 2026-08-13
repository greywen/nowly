import { describe, expect, it } from 'vitest';
import {
  addRecentColor,
  DESIGN_COLORS,
  DESIGN_PRESET_VALUES,
  contrastRatio,
  deriveColorTone,
  isHexColor,
  normalizeHexColor,
  sanitizeRecentColors
} from './color';

describe('HEX colors', () => {
  it('accepts only six-digit HEX and normalizes it to uppercase', () => {
    expect(isHexColor('#7c5cfc')).toBe(true);
    expect(normalizeHexColor('#7c5cfc')).toBe('#7C5CFC');
    expect(isHexColor('#fff')).toBe(false);
    expect(isHexColor('7C5CFC')).toBe(false);
    expect(normalizeHexColor('purple')).toBeNull();
  });

  it('derives a quiet background and readable foreground', () => {
    const tone = deriveColorTone('#7C5CFC');
    expect(tone.base).toBe('#7C5CFC');
    expect(tone.background).toMatch(/^#[0-9A-F]{6}$/);
    expect(tone.foreground).toMatch(/^#[0-9A-F]{6}$/);
    expect(contrastRatio(tone.foreground, tone.background)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('design presets and recent colors', () => {
  it('exposes the design palette as canonical preset values', () => {
    expect(DESIGN_PRESET_VALUES).toEqual(Object.values(DESIGN_COLORS).map((color) => color.toUpperCase()));
  });

  it('never keeps a design preset in the recent list', () => {
    expect(addRecentColor([], DESIGN_COLORS.primary)).toEqual([]);
    expect(addRecentColor(['#7C5CFC'], DESIGN_COLORS.danger)).toEqual(['#7C5CFC']);
  });

  it('deduplicates history and caps it at five, newest first', () => {
    expect(addRecentColor(['#111111', '#222222'], '#111111')).toEqual(['#111111', '#222222']);
    expect(addRecentColor(['#111111', '#222222', '#333333', '#444444', '#555555'], '#666666')).toEqual([
      '#666666', '#111111', '#222222', '#333333', '#444444'
    ]);
  });
});

describe('recent colors', () => {
  it('deduplicates, moves the newest color first, filters invalid values, and keeps five', () => {
    const initial = ['#111111', '#222222', '#333333', '#444444', '#555555'];
    expect(addRecentColor(initial, '#333333')).toEqual([
      '#333333', '#111111', '#222222', '#444444', '#555555'
    ]);
    expect(addRecentColor(initial, '#999999')).toEqual([
      '#999999', '#111111', '#222222', '#333333', '#444444'
    ]);
    expect(sanitizeRecentColors(['bad', '#abcdef', '#ABCDEF', '#123456'])).toEqual(['#ABCDEF', '#123456']);
  });
});
