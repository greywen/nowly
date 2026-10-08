// Sampling a single pixel's colour from the frozen frame.
//
// §4.3 of docs/superpowers/specs/2026-09-25-nowly-screenshot-design.md: the sample
// must come from the frozen base image's original pixels, not from the scaled
// canvas, the mask or the crosshair. Drawing the one pixel 1:1 with smoothing
// disabled and reading it back gives exactly those bytes, because the frame is
// delivered as lossless PNG.
//
// This value is for display. The HEX that Ctrl+C puts on the clipboard comes from
// Rust's own sample of the same buffer, because §5.3 requires the authoritative
// value to agree with the exported image byte for byte, and a WebView canvas could
// in principle apply colour management.

/// A 7-character uppercase HEX string, per §4.3.
export function toHex(rgb: { r: number; g: number; b: number }): string {
  const channel = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value))).toString(16).toUpperCase().padStart(2, '0');
  return `#${channel(rgb.r)}${channel(rgb.g)}${channel(rgb.b)}`;
}

/// Reads one pixel from a loaded frame image.
///
/// Returns `null` when the pixel is outside the image or the canvas is
/// unavailable: §4.3 requires an explicit invalid state rather than a guessed
/// colour.
export function samplePixel(
  image: HTMLImageElement,
  pixel: { x: number; y: number },
  createCanvas: () => HTMLCanvasElement = () => document.createElement('canvas')
): { r: number; g: number; b: number } | null {
  if (
    pixel.x < 0 ||
    pixel.y < 0 ||
    pixel.x >= image.naturalWidth ||
    pixel.y >= image.naturalHeight
  ) {
    return null;
  }

  const canvas = createCanvas();
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext('2d');
  if (!context) return null;

  context.imageSmoothingEnabled = false;
  context.drawImage(image, pixel.x, pixel.y, 1, 1, 0, 0, 1, 1);
  try {
    const { data } = context.getImageData(0, 0, 1, 1);
    return { r: data[0], g: data[1], b: data[2] };
  } catch {
    // A tainted canvas would throw. The frame comes from our own scheme so this
    // should not happen, but a thrown error must not take the overlay down.
    return null;
  }
}
