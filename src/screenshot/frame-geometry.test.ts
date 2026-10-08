import { describe, expect, it } from 'vitest';
import {
  framePixelToCss,
  pointerToFramePixel,
  toVirtualDesktop,
  type FrameBox
} from './frame-geometry';

/// This machine: a 2240×1400 display at 150%, so CSS is 1493.33×933.33.
const scaled150: FrameBox = {
  frameWidth: 2240,
  frameHeight: 1400,
  renderedWidth: 1493.3333333333333,
  renderedHeight: 933.3333333333334,
  offsetX: 0,
  offsetY: 0
};

const unscaled: FrameBox = {
  frameWidth: 1920,
  frameHeight: 1080,
  renderedWidth: 1920,
  renderedHeight: 1080,
  offsetX: 0,
  offsetY: 0
};

describe('pointer to physical pixel', () => {
  it('is 1:1 at 100%', () => {
    expect(pointerToFramePixel({ x: 0, y: 0 }, unscaled)).toEqual({ x: 0, y: 0 });
    expect(pointerToFramePixel({ x: 960, y: 540 }, unscaled)).toEqual({ x: 960, y: 540 });
  });

  it('scales by 1.5 at 150% rather than assuming 1:1', () => {
    // The bug this guards: using the CSS position directly would select a
    // rectangle 1.5× too small and offset towards the top-left.
    expect(pointerToFramePixel({ x: 0, y: 0 }, scaled150)).toEqual({ x: 0, y: 0 });
    expect(pointerToFramePixel({ x: 100, y: 100 }, scaled150)).toEqual({ x: 150, y: 150 });
    expect(pointerToFramePixel({ x: 746.6666666666666, y: 0 }, scaled150)).toEqual({
      x: 1120,
      y: 0
    });
  });

  it('names the last physical pixel at the far edge, never one past it', () => {
    // A rounding overshoot here would index outside the image buffer.
    const bottomRight = pointerToFramePixel(
      { x: scaled150.renderedWidth - 0.001, y: scaled150.renderedHeight - 0.001 },
      scaled150
    );

    expect(bottomRight).toEqual({ x: 2239, y: 1399 });
  });

  it('accounts for the rendered box origin', () => {
    const offset: FrameBox = { ...unscaled, offsetX: 40, offsetY: 25 };

    expect(pointerToFramePixel({ x: 40, y: 25 }, offset)).toEqual({ x: 0, y: 0 });
    expect(pointerToFramePixel({ x: 140, y: 125 }, offset)).toEqual({ x: 100, y: 100 });
  });

  it('has no pixel outside the frame instead of clamping', () => {
    // §5.2: the pointer must not read a pixel outside the authorised area.
    const offset: FrameBox = { ...unscaled, offsetX: 40, offsetY: 25 };

    expect(pointerToFramePixel({ x: 39, y: 100 }, offset)).toBeNull();
    expect(pointerToFramePixel({ x: 100, y: 24 }, offset)).toBeNull();
    expect(pointerToFramePixel({ x: 40 + 1920, y: 100 }, offset)).toBeNull();
    expect(pointerToFramePixel({ x: 100, y: 25 + 1080 }, offset)).toBeNull();
  });

  it('has no pixel before the frame has been laid out', () => {
    const unlaid: FrameBox = { ...unscaled, renderedWidth: 0, renderedHeight: 0 };

    expect(pointerToFramePixel({ x: 0, y: 0 }, unlaid)).toBeNull();
  });

  it('maps every pointer in a row to a pixel in range', () => {
    // A sweep, because an off-by-one only shows at specific fractional positions.
    for (let step = 0; step < 200; step += 1) {
      const x = (step / 200) * scaled150.renderedWidth;
      const pixel = pointerToFramePixel({ x, y: 0 }, scaled150);

      expect(pixel).not.toBeNull();
      expect(pixel!.x).toBeGreaterThanOrEqual(0);
      expect(pixel!.x).toBeLessThan(scaled150.frameWidth);
    }
  });
});

describe('physical pixel back to CSS', () => {
  it('is the exact inverse scale', () => {
    // If these two disagreed, the drawn rectangle would drift from the exported
    // pixels.
    const rect = { x: 150, y: 150, width: 300, height: 300 };

    const css = framePixelToCss(rect, scaled150);

    expect(css.left).toBeCloseTo(100, 6);
    expect(css.top).toBeCloseTo(100, 6);
    expect(css.width).toBeCloseTo(200, 6);
    expect(css.height).toBeCloseTo(200, 6);
  });

  it('round-trips a pointer position', () => {
    const pointer = { x: 321, y: 234 };

    const pixel = pointerToFramePixel(pointer, scaled150)!;
    const css = framePixelToCss({ ...pixel, width: 1, height: 1 }, scaled150);

    // Within one CSS pixel, since a physical pixel is smaller than a CSS pixel
    // here and the mapping floors.
    expect(Math.abs(css.left - pointer.x)).toBeLessThan(1);
    expect(Math.abs(css.top - pointer.y)).toBeLessThan(1);
  });
});

describe('virtual desktop coordinates', () => {
  it('offsets by the display origin, including a negative one', () => {
    // A left-hand secondary display has a negative origin, which must survive.
    expect(toVirtualDesktop({ x: 10, y: 20 }, { x: -1920, y: 0 })).toEqual({
      x: -1910,
      y: 20
    });
    expect(toVirtualDesktop({ x: 10, y: 20 }, { x: 0, y: 0 })).toEqual({ x: 10, y: 20 });
  });
});
