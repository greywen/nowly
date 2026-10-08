import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from '../i18n';
import type { FrameBox } from './frame-geometry';
import {
  GRID_ZOOM,
  magnifierLayout,
  type MagnifierLayout
} from './magnifier-layout';
import { samplePixel, toHex } from './pixel-color';

// The aiming magnifier.
//
// §4.3 of docs/superpowers/specs/2026-09-25-nowly-screenshot-design.md: the
// sample comes from the frozen frame's original pixels, never from the scaled
// canvas, the mask or the crosshair. So it draws from the loaded image at 1:1 and
// scales with nearest-neighbour, rather than reading back what is on screen.

export type MagnifierProps = {
  /// The pixel under the pointer, in the frame's physical pixels.
  pixel: { x: number; y: number } | null;
  /// The pointer in CSS pixels, for placing the card.
  pointer: { x: number; y: number } | null;
  box: FrameBox;
  /// The loaded frame image, sampled directly.
  image: HTMLImageElement | null;
  /// §4.1 line 160: the hint line carries the copy's outcome. `copied` reverts to the
  /// plain hint on the next pointer move; `failed` keeps the session.
  copyState?: 'idle' | 'copied' | 'failed';
};

export function Magnifier({ pixel, pointer, box, image, copyState = 'idle' }: MagnifierProps) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const layout: MagnifierLayout | null =
    pointer && pixel
      ? magnifierLayout(pointer, { width: box.renderedWidth, height: box.renderedHeight })
      : null;

  // Sampled from the frame's own pixels, per §4.3.
  const hex = useMemo(() => {
    if (!image || !pixel) return null;
    const rgb = samplePixel(image, pixel);
    return rgb ? toHex(rgb) : null;
  }, [image, pixel]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !layout || !image || !pixel || layout.gridPixels === 0) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const half = Math.floor(layout.gridPixels / 2);
    context.imageSmoothingEnabled = false;
    // Outside the image there is no pixel to show, so the backdrop stays the
    // surface colour rather than inventing black.
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(
      image,
      pixel.x - half,
      pixel.y - half,
      layout.gridPixels,
      layout.gridPixels,
      0,
      0,
      canvas.width,
      canvas.height
    );
  }, [layout, image, pixel]);

  if (!layout || !pixel) return null;

  return (
    // Decorative as a whole: the readouts below are the accessible content, and a
    // live region here would announce on every pointer move.
    <div
      className="screenshot-magnifier"
      style={{ left: layout.x, top: layout.y, width: layout.width }}
      aria-hidden="true"
    >
      {layout.gridPixels > 0 ? (
        <canvas
          ref={canvasRef}
          className="screenshot-magnifier__grid"
          // Physical pixels of the rendered grid, so nearest-neighbour lands on
          // whole pixels.
          width={layout.gridPixels * GRID_ZOOM}
          height={layout.gridPixels * GRID_ZOOM}
          style={{ width: layout.gridSize, height: layout.gridSize }}
        />
      ) : null}
      <p className="screenshot-magnifier__line">
        {pixel.x}, {pixel.y}
      </p>
      <p className="screenshot-magnifier__line screenshot-magnifier__hex">
        {/* An unreadable pixel says so rather than showing a plausible wrong
            colour, per §4.3's invalid state. */}
        {hex ?? t('screenshot.magnifier.unavailable')}
      </p>
      <p className="screenshot-magnifier__line screenshot-magnifier__hint">
        {copyState === 'copied'
          ? t('screenshot.magnifier.copied')
          : copyState === 'failed'
            ? t('screenshot.magnifier.copyFailed')
            : t('screenshot.magnifier.copyHint')}
      </p>
    </div>
  );
}
