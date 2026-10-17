import { fireEvent, render, screen } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { beforeEach, expect, it, vi } from 'vitest';
import { PinnedImageApp } from './PinnedImageApp';

const native = vi.hoisted(() => ({ close: vi.fn(), startDragging: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => native }));
beforeEach(() => {
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

it('drags the fitted image without providing manual zoom controls', async () => {
  render(<PinnedImageApp />);
  const image = await screen.findByRole('img');
  fireEvent.pointerDown(image, { button: 0 });
  expect(native.startDragging).toHaveBeenCalled();
  expect(screen.getAllByRole('button')).toHaveLength(1);
  expect(invoke).toHaveBeenCalledExactlyOnceWith('capture_pin_image');
});
