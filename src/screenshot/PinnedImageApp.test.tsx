import { fireEvent, render, screen } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { beforeEach, expect, it, vi } from 'vitest';
import { PinnedImageApp } from './PinnedImageApp';

const native = vi.hoisted(() => ({ close: vi.fn(), startDragging: vi.fn(), startResizeDragging: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => native }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(invoke).mockReset().mockResolvedValue(new Uint8Array([66, 77]));
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:pin'), revokeObjectURL: vi.fn() });
});
it('reads only its binary image and revokes its object URL on cleanup', async () => {
  const { unmount } = render(<PinnedImageApp />);
  expect(await screen.findByRole('img', { name: '钉住的截图' })).toHaveAttribute('src', 'blob:pin');
  expect(invoke).toHaveBeenCalledExactlyOnceWith('capture_pin_image');
  unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:pin');
});
it('keeps close accessible after image loading fails', async () => {
  vi.mocked(invoke).mockRejectedValue(new Error('closed'));
  render(<PinnedImageApp />);
  expect(await screen.findByRole('alert')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '关闭钉图' }));
  expect(native.close).toHaveBeenCalled();
});
it('fits initial image without rounding away pixels at full scale', async () => {
  render(<PinnedImageApp />);
  const image = await screen.findByRole('img');
  Object.defineProperty(image, 'naturalWidth', { value: 240 });
  Object.defineProperty(image, 'naturalHeight', { value: 160 });
  Object.defineProperty(image.parentElement, 'clientWidth', { value: 239 });
  Object.defineProperty(image.parentElement, 'clientHeight', { value: 159 });
  fireEvent.load(image);
  expect(image).not.toHaveAttribute('style');
  expect(screen.queryByText('100%')).not.toBeInTheDocument();
});

it('fits tall initial images to both viewport axes', async () => {
  render(<PinnedImageApp />);
  const image = await screen.findByRole('img');
  Object.defineProperty(image, 'naturalWidth', { value: 1000 });
  Object.defineProperty(image, 'naturalHeight', { value: 10000 });
  Object.defineProperty(image.parentElement, 'clientWidth', { value: 238 });
  Object.defineProperty(image.parentElement, 'clientHeight', { value: 598 });
  fireEvent.load(image);
  expect(image).not.toHaveAttribute('style');
  expect(screen.queryByRole('button', { name: '放大' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '缩小' })).not.toBeInTheDocument();
});

it.each(['North', 'South', 'East', 'West', 'NorthEast', 'NorthWest', 'SouthEast', 'SouthWest'])('resizes through the %s hit area instead of moving the image', async direction => {
  const { container } = render(<PinnedImageApp />);
  await screen.findByRole('img');
  const handle = container.querySelector(`.screenshot-pin__resize--${direction}`)!;
  fireEvent.pointerDown(handle, { button: 2 });
  expect(native.startResizeDragging).not.toHaveBeenCalled();
  fireEvent.pointerDown(handle, { button: 0 });
  expect(native.startResizeDragging).toHaveBeenCalledExactlyOnceWith(direction);
  expect(native.startDragging).not.toHaveBeenCalled();
  expect(screen.getAllByRole('button')).toHaveLength(1);
});

it('drags the window only from the toolbar with the left button', async () => {
  const { container } = render(<PinnedImageApp />);
  await screen.findByRole('img');
  const toolbar = container.querySelector('.screenshot-pin__toolbar')!;
  fireEvent.pointerDown(toolbar, { button: 2 });
  expect(native.startDragging).not.toHaveBeenCalled();
  fireEvent.pointerDown(toolbar, { button: 0 });
  expect(native.startDragging).toHaveBeenCalledTimes(1);
});

it('does not drag from image viewport whitespace', async () => {
  const { container } = render(<PinnedImageApp />);
  await screen.findByRole('img');
  fireEvent.pointerDown(container.querySelector('.screenshot-pin__viewport')!, { button: 0 });
  expect(native.startDragging).not.toHaveBeenCalled();
});

it('does not move the window when pressing close', async () => {
  render(<PinnedImageApp />);
  await screen.findByRole('img');
  fireEvent.pointerDown(screen.getByRole('button', { name: '关闭钉图' }), { button: 0 });
  expect(native.startDragging).not.toHaveBeenCalled();
});

it('does not drag the fitted image or provide manual zoom controls', async () => {
  render(<PinnedImageApp />);
  const image = await screen.findByRole('img');
  fireEvent.pointerDown(image, { button: 0 });
  expect(native.startDragging).not.toHaveBeenCalled();
  expect(screen.getAllByRole('button')).toHaveLength(1);
  expect(invoke).toHaveBeenCalledExactlyOnceWith('capture_pin_image');
});
