import { describe, expect, it } from 'vitest';
import { holdPart, holdSpec } from './voice-settings';

describe('hold key specs', () => {
  it('accepts the same shapes as the native parser, in canonical order', () => {
    expect(holdSpec(['Super', 'Ctrl'])).toBe('Ctrl+Super');
    expect(holdSpec(['V', 'Alt', 'Ctrl'])).toBe('Ctrl+Alt+V');
    expect(holdSpec(['Shift', 'Space'])).toBe('Shift+Space');
    expect(holdSpec(['F8'])).toBe('F8');
  });

  it('rejects a lone modifier, a lone regular key and two regular keys', () => {
    expect(holdSpec(['Ctrl'])).toBeNull();
    expect(holdSpec(['A'])).toBeNull();
    expect(holdSpec(['Ctrl', 'A', 'B'])).toBeNull();
  });

  it('names keys by their physical code so layouts and Shift do not change them', () => {
    expect(holdPart({ key: 'Meta', code: 'MetaLeft' })).toBe('Super');
    expect(holdPart({ key: '!', code: 'Digit1' })).toBe('1');
    expect(holdPart({ key: 'й', code: 'KeyQ' })).toBe('Q');
    expect(holdPart({ key: 'F12', code: 'F12' })).toBe('F12');
    expect(holdPart({ key: 'ArrowUp', code: 'ArrowUp' })).toBeNull();
  });
});
