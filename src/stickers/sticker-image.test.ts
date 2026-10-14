import { expect, it } from 'vitest';
import { stickerImageHeader } from './sticker-image';

it('rejects empty, oversized and script-capable input', () => {
  expect(() => stickerImageHeader(new Uint8Array(), 'empty.png')).toThrow();
  expect(() => stickerImageHeader(new Uint8Array(10 * 1024 * 1024 + 1), 'large.png')).toThrow();
  expect(() => stickerImageHeader(new TextEncoder().encode('<svg/>'), 'bad.svg')).toThrow();
});
it('checks PNG dimensions before decoding and rejects animated PNG', () => {
  const bytes = new Uint8Array(57);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13); bytes.set(new TextEncoder().encode('IHDR'), 12);
  view.setUint32(16, 4000); view.setUint32(20, 4000);
  view.setUint32(33, 0); bytes.set(new TextEncoder().encode('IEND'), 37);
  expect(stickerImageHeader(bytes, 'valid.png')).toMatchObject({ width: 4000, height: 4000, mime: 'image/png' });
  view.setUint32(16, 4097);
  expect(() => stickerImageHeader(bytes, 'too-wide.png')).toThrow();
  view.setUint32(16, 4000);
  bytes.set(new TextEncoder().encode('acTL'), 37);
  expect(() => stickerImageHeader(bytes, 'animated.png')).toThrow();
});
