import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { newTextSticker } from '../stickers/sticker-model';
import * as imageValidation from '../stickers/sticker-image';
import { getBrowserStickerBoard, saveBrowserStickerBoard, uploadBrowserStickerImage, readBrowserStickerImage, discardBrowserStickerImages } from './browser-sticker-store';

afterEach(() => vi.restoreAllMocks());

beforeEach(async () => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('nowly-stickers');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
});
it('persists a board across database connections and protects revisions', async () => {
  const board = await getBrowserStickerBoard();
  expect(board.objects).toEqual([]);
  const saved = await saveBrowserStickerBoard({ ...board, objects: [newTextSticker('one', '保持专注')] });
  expect(saved.revision).toBe(1);
  expect((await getBrowserStickerBoard()).objects).toEqual(saved.objects);
  await expect(saveBrowserStickerBoard(board)).rejects.toMatchObject({ code: 'conflict' });
});
it('rejects invalid data and missing assets without changing the saved board', async () => {
  const board = await getBrowserStickerBoard();
  await expect(saveBrowserStickerBoard({ ...board, objects: [{ ...newTextSticker('one', ''), x: NaN }] })).rejects.toMatchObject({ code: 'validation_error' });
  await expect(readBrowserStickerImage('a'.repeat(32))).rejects.toMatchObject({ code: 'not_found' });
  await expect(readBrowserStickerImage('../anything')).rejects.toMatchObject({ code: 'validation_error' });
  await expect(discardBrowserStickerImages(['../anything'])).rejects.toMatchObject({ code: 'validation_error' });
  expect((await getBrowserStickerBoard()).revision).toBe(0);
});

it('preserves shared image bytes until the final reference is saved away', async () => {
  vi.spyOn(imageValidation, 'validateStickerImage').mockResolvedValueOnce({ mime: 'image/png', width: 1, height: 1 });
  const bytes = new Uint8Array([137, 80, 78, 71]);
  const asset = await uploadBrowserStickerImage('sticker.png', bytes);
  const image = {
    id: 'first', kind: 'image' as const, assetId: asset.id, style: 'original' as const,
    x: 200, y: 200, width: 200, height: 200, rotation: 0, opacity: 100, locked: false
  };
  let board = await saveBrowserStickerBoard({ ...await getBrowserStickerBoard(), objects: [image, { ...image, id: 'copy' }] });
  await discardBrowserStickerImages([asset.id]);
  expect(Array.from(await readBrowserStickerImage(asset.id))).toEqual(Array.from(bytes));
  board = await saveBrowserStickerBoard({ ...board, objects: [image] });
  await discardBrowserStickerImages([asset.id]);
  expect(Array.from(await readBrowserStickerImage(asset.id))).toEqual(Array.from(bytes));
  await saveBrowserStickerBoard({ ...board, objects: [] });
  await discardBrowserStickerImages([asset.id]);
  await expect(readBrowserStickerImage(asset.id)).rejects.toMatchObject({ code: 'not_found' });
});

it('reports storage quota errors without claiming that an upload succeeded', async () => {
  vi.spyOn(imageValidation, 'validateStickerImage').mockResolvedValueOnce({ mime: 'image/png', width: 1, height: 1 });
  await getBrowserStickerBoard();
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); });
  await expect(uploadBrowserStickerImage('sticker.png', new Uint8Array([137, 80]))).rejects.toMatchObject({ name: 'QuotaExceededError' });
  expect((await getBrowserStickerBoard()).revision).toBe(0);
});
