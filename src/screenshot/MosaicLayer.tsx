import { useLayoutEffect, useRef, type RefObject } from 'react';
import type { Annotation } from './annotation-document';
import { framePixelToCss, type FrameBox } from './frame-geometry';
import type { PixelRect } from './screenshot-model';

type Props = {
  objects: readonly Annotation[];
  selection: PixelRect;
  box: FrameBox;
  frameRef: RefObject<HTMLImageElement | null>;
};

export function MosaicLayer({ objects, selection, box, frameRef }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sourceRef = useRef<{
    image: HTMLImageElement;
    src: string;
    geometry: string;
    pixels: Uint8ClampedArray;
  } | null>(null);
  const css = framePixelToCss(selection, box);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const image = frameRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    context.clearRect(0, 0, selection.width, selection.height);
    const mosaics = objects.filter(object => object.kind === 'mosaic');
    if (!image || mosaics.length === 0) return;

    const geometry = `${selection.x},${selection.y},${selection.width},${selection.height}`;
    let source = sourceRef.current;
    if (!source || source.image !== image || source.src !== image.src || source.geometry !== geometry) {
      const sample = document.createElement('canvas');
      sample.width = selection.width;
      sample.height = selection.height;
      const sampler = sample.getContext('2d', { willReadFrequently: true });
      if (!sampler) return;
      sampler.imageSmoothingEnabled = false;
      try {
        sampler.drawImage(image, selection.x, selection.y, selection.width, selection.height,
          0, 0, selection.width, selection.height);
        source = {
          image, src: image.src, geometry,
          pixels: sampler.getImageData(0, 0, selection.width, selection.height).data
        };
      } catch {
        sourceRef.current = null;
        return;
      }
      sourceRef.current = source;
    }

    // Match mosaic.rs: selection-origin grid, clipped intersections, original
    // source for every region, and per-channel integer half-up means.
    for (const mosaic of mosaics) {
      const size = mosaic.blockSize;
      if (size <= 0) continue;
      for (const block of mosaic.blocks) {
        const left = Math.max(0, block.x - selection.x);
        const top = Math.max(0, block.y - selection.y);
        const right = Math.min(selection.width, block.x - selection.x + block.width);
        const bottom = Math.min(selection.height, block.y - selection.y + block.height);
        for (let y = Math.floor(top / size) * size; y < bottom; y += size) {
          for (let x = Math.floor(left / size) * size; x < right; x += size) {
            const fromX = Math.max(x, left);
            const fromY = Math.max(y, top);
            const toX = Math.min(x + size, right);
            const toY = Math.min(y + size, bottom);
            if (fromX >= toX || fromY >= toY) continue;
            const sums = [0, 0, 0];
            const count = (toX - fromX) * (toY - fromY);
            for (let row = fromY; row < toY; row++) {
              for (let column = fromX; column < toX; column++) {
                const index = (row * selection.width + column) * 4;
                for (let channel = 0; channel < 3; channel++) {
                  sums[channel] += source.pixels[index + channel];
                }
              }
            }
            const mean = sums.map(sum => Math.floor((sum + Math.floor(count / 2)) / count));
            context.fillStyle = `rgb(${mean.join(', ')})`;
            context.fillRect(fromX, fromY, toX - fromX, toY - fromY);
          }
        }
      }
    }
  }, [objects, selection, frameRef]);

  return (
    <canvas
      ref={canvasRef}
      className="screenshot-overlay__mosaic"
      width={selection.width}
      height={selection.height}
      style={{ left: css.left, top: css.top, width: css.width, height: css.height }}
      aria-hidden="true"
    />
  );
}
