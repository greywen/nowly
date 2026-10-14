import { t } from '../i18n';
import { MAX_STICKER_BYTES } from './sticker-model';

export const STICKER_IMAGE_ACCEPT = '.png,.jpg,.jpeg,.webp';

export function stickerImageHeader(bytes: Uint8Array, fileName: string) {
  if (!bytes.length || bytes.length > MAX_STICKER_BYTES) throw new Error(t('stickers.fileSize'));
  const fail = () => new Error(t('stickers.imageError'));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  const extension = fileName.split('.').pop()?.toLowerCase();
  let width = 0;
  let height = 0;
  let mime = '';
  if (bytes.length >= 33 && bytes.subarray(0, 8).every((value, i) => value === [137, 80, 78, 71, 13, 10, 26, 10][i])) {
    if (extension !== 'png' || tag(12) !== 'IHDR') throw fail();
    mime = 'image/png';
    width = view.getUint32(16); height = view.getUint32(20);
    let ended = false;
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const size = view.getUint32(offset);
      if (offset + 12 + size > bytes.length) throw fail();
      const name = tag(offset + 4);
      if (name === 'acTL') throw fail();
      if (name === 'IEND') { ended = true; break; }
      offset += size + 12;
    }
    if (!ended) throw fail();
  } else if (bytes.length >= 12 && tag(0) === 'RIFF' && tag(8) === 'WEBP') {
    if (extension !== 'webp' || view.getUint32(4, true) + 8 !== bytes.length) throw fail();
    mime = 'image/webp';
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const size = view.getUint32(offset + 4, true);
      const name = tag(offset);
      const start = offset + 8;
      if (start + size > bytes.length) throw fail();
      if (name === 'ANIM' || name === 'ANMF') throw fail();
      if (name === 'VP8X' && size >= 10) {
        if (bytes[start] & 2) throw fail();
        width = 1 + bytes[start + 4] + (bytes[start + 5] << 8) + (bytes[start + 6] << 16);
        height = 1 + bytes[start + 7] + (bytes[start + 8] << 8) + (bytes[start + 9] << 16);
      } else if (name === 'VP8 ' && size >= 10 && !width) {
        if (bytes[start + 3] !== 0x9d || bytes[start + 4] !== 1 || bytes[start + 5] !== 0x2a) throw fail();
        width = view.getUint16(start + 6, true) & 0x3fff;
        height = view.getUint16(start + 8, true) & 0x3fff;
      } else if (name === 'VP8L' && size >= 5 && !width) {
        if (bytes[start] !== 0x2f) throw fail();
        const bits = view.getUint32(start + 1, true);
        width = (bits & 0x3fff) + 1;
        height = ((bits >>> 14) & 0x3fff) + 1;
      }
      offset = start + size + (size % 2);
    }
  } else if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    if (extension !== 'jpg' && extension !== 'jpeg') throw fail();
    mime = 'image/jpeg';
    for (let offset = 2; offset + 4 <= bytes.length;) {
      if (bytes[offset++] !== 0xff) throw fail();
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 1 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) throw fail();
      const size = view.getUint16(offset);
      if (size < 2 || offset + size > bytes.length) throw fail();
      if ([0xc0, 0xc1, 0xc2].includes(marker) && size >= 8) {
        height = view.getUint16(offset + 3); width = view.getUint16(offset + 5);
        break;
      }
      offset += size;
    }
  } else throw fail();
  if (width < 1 || height < 1 || width > 4096 || height > 4096 || width * height > 16_000_000) throw fail();
  return { mime, width, height };
}

export async function validateStickerImage(bytes: Uint8Array, fileName: string) {
  const header = stickerImageHeader(bytes, fileName);
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: header.mime }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (image.naturalWidth < 1 || image.naturalHeight < 1 || image.naturalWidth > 4096 ||
      image.naturalHeight > 4096 || image.naturalWidth * image.naturalHeight > 16_000_000) throw new Error(t('stickers.imageError'));
    return { ...header, width: image.naturalWidth, height: image.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}
