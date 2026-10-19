import { describe, expect, it } from 'vitest';
import { acceptScrollUpdate, describeScrollError, hintPlacement, previewPlacement, PREVIEW_WIDTH, type ScrollState } from './scroll-model';

const base: ScrollState = {
  sessionId: '1',
  revision: 1,
  sequence: 4,
  phase: 'capturing',
  width: 300,
  height: 400,
  region: { x: 0, y: 0, width: 300, height: 400 },
  hint: null
};

describe('scroll model', () => {
  it('keeps the latest update when events and command results race', () => {
    const later = { ...base, sequence: 6, revision: 2, height: 520 };
    expect(acceptScrollUpdate(later, base)).toBe(later);
    expect(acceptScrollUpdate(base, later)).toBe(later);
    expect(acceptScrollUpdate(null, base)).toBe(base);
  });

  it('places the preview beside the selection, never over it', () => {
    const viewport = { width: 1000, height: 800 };
    const left = previewPlacement({ left: 400, top: 100, width: 300, height: 500 }, viewport);
    expect(left).toEqual({ left: 400 - 8 - PREVIEW_WIDTH, top: 100, width: PREVIEW_WIDTH, height: 500 });
    const right = previewPlacement({ left: 20, top: 100, width: 300, height: 500 }, viewport);
    expect(right).toEqual({ left: 328, top: 100, width: PREVIEW_WIDTH, height: 500 });
    expect(previewPlacement({ left: 20, top: 0, width: 960, height: 800 }, viewport)).toBeNull();
  });

  it('puts the hint above the selection, or below it at the top of the screen', () => {
    expect(hintPlacement({ left: 50, top: 100, width: 300, height: 200 })).toEqual({ left: 50, top: 72 });
    expect(hintPlacement({ left: 50, top: 0, width: 300, height: 200 })).toEqual({ left: 50, top: 208 });
  });

  it('explains known failures in its own words and keeps user-facing messages', () => {
    expect(describeScrollError({ code: 'scroll_nothing_yet', message: 'Nothing captured yet' }, 'x')).toEqual({ key: 'screenshot.auto.nothingYet' });
    expect(describeScrollError({ code: 'system_error', message: 'The clipboard is busy.' }, 'x')).toEqual({ message: 'The clipboard is busy.' });
    expect(describeScrollError(new Error('internal'), 'fallback')).toEqual({ key: 'fallback' });
  });
});
