import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MosaicLayer } from './MosaicLayer';
import type { Annotation } from './annotation-document';

const selection = { x: 1, y: 0, width: 3, height: 1 };
const box = { frameWidth: 4, frameHeight: 1, renderedWidth: 8, renderedHeight: 2, offsetX: 0, offsetY: 0 };
const image = document.createElement('img');
const frameRef = { current: image };
const fillStyles: string[] = [];
const fillRect = vi.fn(() => { fillStyles.push(target.fillStyle); });
const source = {
  drawImage: vi.fn(),
  getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([0, 10, 20].flatMap(v => [v, v, v, 255])) }))
};
const target = { clearRect: vi.fn(), fillRect, fillStyle: '', imageSmoothingEnabled: true };
const mosaic: Annotation = {
  id: 'brush', kind: 'mosaic', x: 0, y: 0, width: 4, height: 2,
  color: '#000000', blockSize: 2, blocks: [{ x: 0, y: 0, width: 2, height: 2 }]
};

function layer(objects: readonly Annotation[]) {
  return <MosaicLayer objects={objects} selection={selection} box={box} frameRef={frameRef} />;
}

describe('live mosaic pixels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fillStyles.length = 0;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      return (this.className === 'screenshot-overlay__mosaic' ? target : source) as never;
    });
  });

  it('paints real averaged pixels immediately on press, clipped to the selection', () => {
    const { container } = render(layer([mosaic]));
    expect(source.drawImage).toHaveBeenCalledWith(image, 1, 0, 3, 1, 0, 0, 3, 1);
    expect(fillRect).toHaveBeenCalledWith(0, 0, 1, 1);
    expect(target.fillStyle).toBe('rgb(0, 0, 0)');
    const canvas = container.querySelector('canvas')!;
    expect(canvas.width).toBe(3);
    expect(canvas.style.left).toBe('2px');
    expect(canvas.style.width).toBe('6px');
  });

  it('updates a live stroke and keeps its pixels unchanged when committed', () => {
    const { rerender } = render(layer([mosaic]));
    const extended: Annotation = { ...mosaic, blocks: [...mosaic.blocks, { x: 2, y: 0, width: 2, height: 2 }] };
    rerender(layer([extended]));
    expect(fillRect).toHaveBeenLastCalledWith(2, 0, 1, 1);
    // The image-origin grid splits the second painted block at local x=2.
    expect(target.fillStyle).toBe('rgb(20, 20, 20)');
    expect(source.getImageData).toHaveBeenCalledTimes(1);
    const painted = fillRect.mock.calls.slice(-3);
    rerender(layer([{ ...extended }]));
    expect(fillRect.mock.calls.slice(-3)).toEqual(painted);
  });

  it('clears cancelled strokes and undo without leaving stale pixels', () => {
    const { rerender } = render(layer([mosaic]));
    fillRect.mockClear();
    rerender(layer([]));
    expect(target.clearRect).toHaveBeenLastCalledWith(0, 0, 3, 1);
    expect(fillRect).not.toHaveBeenCalled();
  });

  it('rounds channel means half up and samples overlaps from the original frame', () => {
    const first: Annotation = { ...mosaic, blocks: [{ x: 1, y: 0, width: 2, height: 1 }] };
    const second: Annotation = { ...first, id: 'second', blockSize: 1 };
    render(layer([first, second]));
    expect(fillRect).toHaveBeenNthCalledWith(1, 0, 0, 2, 1);
    expect(fillStyles).toEqual(['rgb(5, 5, 5)', 'rgb(0, 0, 0)', 'rgb(10, 10, 10)']);
  });
});
