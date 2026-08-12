import { describe, expect, it } from 'vitest';
import {
  addRecentColor,
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

describe('recent colors', () => {
  it('deduplicates, moves the newest color first, filters invalid values, and keeps eight', () => {
    const initial = ['#111111', '#222222', '#333333', '#444444', '#555555', '#666666', '#777777', '#888888'];
    expect(addRecentColor(initial, '#333333')).toEqual([
      '#333333', '#111111', '#222222', '#444444', '#555555', '#666666', '#777777', '#888888'
    ]);
    expect(addRecentColor(initial, '#999999')).toEqual([
      '#999999', '#111111', '#222222', '#333333', '#444444', '#555555', '#666666', '#777777'
    ]);
    expect(sanitizeRecentColors(['bad', '#abcdef', '#ABCDEF', '#123456'])).toEqual(['#ABCDEF', '#123456']);
  });
});
