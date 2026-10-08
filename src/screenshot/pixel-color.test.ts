import { describe, expect, it, vi } from 'vitest';
import { samplePixel, toHex } from './pixel-color';

describe('HEX formatting', () => {
  it('is always 7 uppercase characters', () => {
    // §4.3 fixes the format, so a short or lowercase value is a bug.
    expect(toHex({ r: 0, g: 0, b: 0 })).toBe('#000000');
    expect(toHex({ r: 255, g: 255, b: 255 })).toBe('#FFFFFF');
    expect(toHex({ r: 79, g: 201, b: 218 })).toBe('#4FC9DA');
    expect(toHex({ r: 1, g: 2, b: 3 })).toBe('#010203');
  });

  it('pads every single-digit channel', () => {
    const hex = toHex({ r: 10, g: 11, b: 12 });

    expect(hex).toBe('#0A0B0C');
    expect(hex).toHaveLength(7);
  });

  it('clamps and rounds out-of-range input instead of emitting rubbish', () => {
    expect(toHex({ r: -5, g: 300, b: 127.6 })).toBe('#00FF80');
  });
});

/// A stub canvas returning one known pixel.
function stubCanvas(rgb: [number, number, number, number], options: { fail?: boolean } = {}) {
  const drawImage = vi.fn();
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({
      imageSmoothingEnabled: true,
      drawImage,
      getImageData: () => {
        if (options.fail) throw new Error('tainted');
        return { data: Uint8ClampedArray.from(rgb) };
      }
    })
  } as unknown as HTMLCanvasElement;
  return { canvas, drawImage };
}

function stubImage(width = 100, height = 50): HTMLImageElement {
  return { naturalWidth: width, naturalHeight: height } as HTMLImageElement;
}

describe('sampling one pixel', () => {
  it('reads the pixel from the original image at 1:1', () => {
    const { canvas, drawImage } = stubCanvas([79, 201, 218, 255]);
    const image = stubImage();

    const rgb = samplePixel(image, { x: 12, y: 34 }, () => canvas);

    expect(rgb).toEqual({ r: 79, g: 201, b: 218 });
    // 1:1, so no scaling can shift the sampled colour.
    expect(drawImage).toHaveBeenCalledWith(image, 12, 34, 1, 1, 0, 0, 1, 1);
  });

  it('has no colour outside the image rather than guessing one', () => {
    // §4.3 requires an explicit invalid state.
    const { canvas } = stubCanvas([0, 0, 0, 255]);
    const image = stubImage(100, 50);

    expect(samplePixel(image, { x: -1, y: 0 }, () => canvas)).toBeNull();
    expect(samplePixel(image, { x: 0, y: -1 }, () => canvas)).toBeNull();
    expect(samplePixel(image, { x: 100, y: 0 }, () => canvas)).toBeNull();
    expect(samplePixel(image, { x: 0, y: 50 }, () => canvas)).toBeNull();
  });

  it('accepts the last pixel in each axis', () => {
    const { canvas } = stubCanvas([1, 2, 3, 255]);

    expect(samplePixel(stubImage(100, 50), { x: 99, y: 49 }, () => canvas)).toEqual({
      r: 1,
      g: 2,
      b: 3
    });
  });

  it('survives a read that throws', () => {
    const { canvas } = stubCanvas([0, 0, 0, 255], { fail: true });

    expect(samplePixel(stubImage(), { x: 1, y: 1 }, () => canvas)).toBeNull();
  });

  it('produces a HEX the magnifier can show directly', () => {
    const { canvas } = stubCanvas([240, 100, 69, 255]);

    const rgb = samplePixel(stubImage(), { x: 1, y: 1 }, () => canvas)!;

    // --color-danger, so a known token round-trips.
    expect(toHex(rgb)).toBe('#F06445');
  });
});
