import { act, fireEvent, render, screen } from '@testing-library/react';
import { Profiler } from 'react';
import { expect, it, vi } from 'vitest';
import { StickerCanvas } from './StickerCanvas';
import { geometryFits, newTextSticker, type StickerObject } from './sticker-model';

it('detects overflowing inline text instead of only measuring its fixed-size parent', () => {
  const overflow = vi.fn();
  const object = newTextSticker('text', 'short');
  const { rerender } = render(<StickerCanvas objects={[object]} urls={{}} editingId="text" onChange={() => undefined} onOverflow={overflow} />);
  const input = screen.getByRole('textbox');
  Object.defineProperties(input, { clientHeight: { value: 160 }, scrollHeight: { value: 240 } });
  rerender(<StickerCanvas objects={[{ ...object, text: 'long\ntext' }]} urls={{}} editingId="text" onChange={() => undefined} onOverflow={overflow} />);
  expect(overflow).toHaveBeenLastCalledWith(['text']);
});
it('allows resize handles while text is being edited', () => {
  const gesture = vi.fn();
  const change = vi.fn();
  const { container } = render(<StickerCanvas objects={[newTextSticker('text', 'text')]} urls={{}} editingId="text" selectedId="text" onChange={change} onGesture={gesture} />);
  fireEvent.pointerDown(container.querySelector('.sticker-object__handle--resize')!, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
  expect(gesture).toHaveBeenCalledWith(true);
});
it('previews movement without publishing every pointer event and commits the final position on release', () => {
  const object = newTextSticker('text', 'text');
  const change = vi.fn(), overflow = vi.fn();
  render(<StickerCanvas objects={[object]} urls={{}} onSelect={() => undefined} onChange={change} onOverflow={overflow} />);
  overflow.mockClear();
  const measure = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect');
  const canvas = screen.getByTestId('sticker-canvas');
  fireEvent.pointerDown(screen.getByTestId('sticker-object'), { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
  measure.mockClear();
  fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 130, clientY: 120 });
  fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 150, clientY: 140 });
  expect(change).not.toHaveBeenCalled();
  expect(overflow).not.toHaveBeenCalled();
  expect(measure).not.toHaveBeenCalled();
  measure.mockRestore();
  fireEvent.pointerUp(canvas, { pointerId: 1 });
  expect(change).toHaveBeenCalledExactlyOnceWith({ ...object, x: object.x + 50, y: object.y + 40 });
});
it('fits the text box to measured content when text or font size changes', () => {
  const object = newTextSticker('text', 'short');
  const change = vi.fn();
  const { container, rerender } = render(<StickerCanvas objects={[object]} urls={{}} onChange={change} />);
  const text = container.querySelector('.sticker-object__text')!;
  const measure = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return { width: this.classList.contains('sticker-object__measure') ? 240 : 0, height: this.classList.contains('sticker-object__measure') ? 96 : 0 } as DOMRect;
  });
  rerender(<StickerCanvas objects={[{ ...object, text: 'longer text', fontSize: 64 }]} urls={{}} onChange={change} />);
  expect(text).toBeInTheDocument();
  expect(change).toHaveBeenLastCalledWith(expect.objectContaining({ width: 242, height: 96, fontSize: 64 }));
  measure.mockRestore();
});
it('offers keyboard movement rotation and sizing without numeric geometry fields', () => {
  const object = newTextSticker('text', 'text');
  const change = vi.fn();
  render(<StickerCanvas objects={[object]} urls={{}} onSelect={() => undefined} onChange={change} />);
  const element = screen.getByTestId('sticker-object');
  fireEvent.keyDown(element, { key: 'ArrowRight', shiftKey: true });
  expect(change).toHaveBeenLastCalledWith({ ...object, x: object.x + 10 });
  fireEvent.keyDown(element, { key: 'ArrowLeft', altKey: true });
  expect(change).toHaveBeenLastCalledWith({ ...object, rotation: -1 });
  fireEvent.keyDown(element, { key: 'ArrowUp', altKey: true });
  expect(change).toHaveBeenLastCalledWith(expect.objectContaining({ fontSize: object.fontSize + 1 }));
});
it('starts editing text with one click', () => {
  const edit = vi.fn();
  render(<StickerCanvas objects={[newTextSticker('text', 'text')]} urls={{}} onSelect={() => undefined} onEditText={edit} />);
  fireEvent.click(screen.getByTestId('sticker-object'));
  expect(edit).toHaveBeenCalledWith('text');
});
it('restores the original geometry and finishes once on a cancelled drag', () => {
  const object = newTextSticker('text', 'text');
  const change = vi.fn(), gesture = vi.fn(), blank = vi.fn();
  render(<StickerCanvas objects={[object]} urls={{}} onSelect={() => undefined} onChange={change} onGesture={gesture} onBlank={blank} />);
  const canvas = screen.getByTestId('sticker-canvas');
  fireEvent.pointerDown(screen.getByTestId('sticker-object'), { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
  fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 150, clientY: 150 });
  fireEvent.pointerCancel(canvas, { pointerId: 1 });
  fireEvent.click(canvas);
  expect(change).toHaveBeenLastCalledWith(object);
  expect(gesture).toHaveBeenLastCalledWith(false);
  expect(blank).not.toHaveBeenCalled();
});
it('moves only the active object once per frame without rerendering the board', () => {
  const frame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 42);
  const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
  try {
    const object = newTextSticker('text', 'text');
    const change = vi.fn(), renderBoard = vi.fn();
    render(<Profiler id="canvas" onRender={renderBoard}><StickerCanvas objects={[object, newTextSticker('other', 'other')]} urls={{}} onSelect={() => undefined} onChange={change} /></Profiler>);
    const canvas = screen.getByTestId('sticker-canvas');
    const element = screen.getAllByTestId('sticker-object')[0];
    fireEvent.pointerDown(element, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    renderBoard.mockClear();
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 130, clientY: 120 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 150, clientY: 140 });
    expect(renderBoard).not.toHaveBeenCalled();
    expect(frame).toHaveBeenCalledTimes(1);
    act(() => frame.mock.calls[0][0](0));
    expect(element.style.left).toBe(`${object.x}px`);
    expect(element.style.top).toBe(`${object.y}px`);
    expect(element.style.transform).toContain('translate(50px, 40px)');
    expect(screen.getAllByTestId('sticker-object')[1].style.transform).toBe('rotate(0deg)');
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 160, clientY: 145 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    expect(change).toHaveBeenCalledExactlyOnceWith({ ...object, x: object.x + 60, y: object.y + 45 });
    expect(element.style.transform).toBe('rotate(0deg)');
    expect(cancelFrame).toHaveBeenCalled();
  } finally { frame.mockRestore(); cancelFrame.mockRestore(); }
});
it('slides along the canvas edge instead of freezing when a drag overshoots the bounds', () => {
  const frame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 42);
  const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
  try {
    const image: StickerObject = { id: 'image', kind: 'image', assetId: 'a'.repeat(32), style: 'original', locked: false,
      x: 700, y: 100, width: 80, height: 60, rotation: 0, opacity: 100 };
    const rotated: StickerObject = { ...image, id: 'rotated', x: 20, y: 400, rotation: 90 };
    const change = vi.fn();
    render(<StickerCanvas objects={[image, rotated]} urls={{}} onSelect={() => undefined} onChange={change} />);
    const canvas = screen.getByTestId('sticker-canvas');
    const [element, rotatedElement] = screen.getAllByTestId('sticker-object');
    fireEvent.pointerDown(element, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 150, clientY: 130 });
    act(() => frame.mock.calls[0][0](0));
    expect(element.style.transform).toContain('translate(20px, 30px)');
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    expect(change).toHaveBeenLastCalledWith({ ...image, x: 720, y: 130 });
    fireEvent.pointerDown(rotatedElement, { button: 0, pointerId: 2, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(canvas, { pointerId: 2, clientX: 40, clientY: 80 });
    fireEvent.pointerUp(canvas, { pointerId: 2 });
    const moved = change.mock.lastCall![0] as StickerObject;
    expect(moved.x).toBeCloseTo(-10);
    expect(moved.y).toBe(380);
    expect(geometryFits(moved)).toBe(true);
  } finally { frame.mockRestore(); cancelFrame.mockRestore(); }
});
it('lets objects use the whole visible module beyond the 4:3 stage and keeps stored objects in view', () => {
  const frame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 42);
  const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
  const measure = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return (this.classList.contains('sticker-canvas') ? { left: 0, top: 0, width: 1600, height: 600 } : { left: 400, top: 0, width: 800, height: 600 }) as DOMRect;
  });
  try {
    const image: StickerObject = { id: 'image', kind: 'image', assetId: 'a'.repeat(32), style: 'original', locked: false,
      x: 700, y: 100, width: 80, height: 60, rotation: 0, opacity: 100 };
    const far: StickerObject = { ...image, id: 'far', x: -3000, y: 100 };
    const change = vi.fn(), bounds = vi.fn();
    render(<StickerCanvas objects={[image, far]} urls={{}} onSelect={() => undefined} onChange={change} onBounds={bounds} />);
    expect(bounds).toHaveBeenLastCalledWith({ left: -400, top: 0, right: 1200, bottom: 600 });
    const canvas = screen.getByTestId('sticker-canvas');
    const [element, farElement] = screen.getAllByTestId('sticker-object');
    expect(farElement.style.left).toBe('-400px');
    fireEvent.pointerDown(element, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 400, clientY: 100 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    expect(change).toHaveBeenLastCalledWith({ ...image, x: 1000 });
    fireEvent.pointerDown(element, { button: 0, pointerId: 2, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(canvas, { pointerId: 2, clientX: -2000, clientY: 100 });
    fireEvent.pointerUp(canvas, { pointerId: 2 });
    expect(change).toHaveBeenLastCalledWith({ ...image, x: -400 });
  } finally { measure.mockRestore(); frame.mockRestore(); cancelFrame.mockRestore(); }
});
it('preserves rotation when releasing without moving', () => {
  const object = { ...newTextSticker('text', 'text'), rotation: 30 };
  render(<StickerCanvas objects={[object]} urls={{}} onChange={() => undefined} />);
  const canvas = screen.getByTestId('sticker-canvas');
  const element = screen.getByTestId('sticker-object');
  fireEvent.pointerDown(element, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
  fireEvent.pointerUp(canvas, { pointerId: 1 });
  expect(element.style.transform).toBe('rotate(30deg)');
});
it('cancels a queued move on Escape and prevents a late frame from restoring it', () => {
  const frame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 42);
  const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
  try {
    const object = { ...newTextSticker('text', 'text'), rotation: 30 };
    const change = vi.fn();
    render(<StickerCanvas objects={[object]} urls={{}} onChange={change} />);
    const canvas = screen.getByTestId('sticker-canvas');
    const element = screen.getByTestId('sticker-object');
    fireEvent.pointerDown(element, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 150, clientY: 140 });
    fireEvent.keyDown(canvas, { key: 'Escape' });
    expect(cancelFrame).toHaveBeenCalledWith(42);
    act(() => frame.mock.calls[0][0](0));
    expect(element.style.transform).toBe('rotate(30deg)');
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    expect(change).toHaveBeenCalledExactlyOnceWith(object);
  } finally { frame.mockRestore(); cancelFrame.mockRestore(); }
});
