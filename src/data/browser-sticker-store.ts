import { t } from '../i18n';
import { emptyStickerBoard, validateStickerBoard, type StickerAsset, type StickerBoard } from '../stickers/sticker-model';
import { validateStickerImage } from '../stickers/sticker-image';

type StoredImage = { asset: StickerAsset; bytes: Uint8Array };
const error = (code: 'validation_error' | 'not_found' | 'conflict' | 'database_error', message: string) => ({ code, message });
const validId = (id: string) => /^[a-f0-9]{32}$/.test(id);

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(error('database_error', request.error?.message ?? t('common.opFailed')));
  });
}

async function transaction<T>(mode: IDBTransactionMode, operation: (tx: IDBTransaction) => Promise<T>): Promise<T> {
  const request = indexedDB.open('nowly-stickers', 1);
  request.onupgradeneeded = () => {
    request.result.createObjectStore('boards');
    request.result.createObjectStore('images', { keyPath: 'asset.id' });
  };
  const db = await requestValue(request);
  try {
    const tx = db.transaction(['boards', 'images'], mode);
    const completed = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(error('database_error', tx.error?.message ?? t('common.opFailed')));
      tx.onerror = () => reject(error('database_error', tx.error?.message ?? t('common.opFailed')));
    });
    try {
      const result = await operation(tx);
      await completed;
      return result;
    } catch (failure) {
      try { tx.abort(); } catch (abortError) {
        if (!(abortError instanceof DOMException) || abortError.name !== 'InvalidStateError') throw abortError;
      }
      await completed.catch(() => undefined);
      throw failure;
    }
  } finally { db.close(); }
}

async function boardIn(tx: IDBTransaction): Promise<StickerBoard> {
  const raw: unknown = await requestValue(tx.objectStore('boards').get('stickers'));
  if (raw === undefined) return emptyStickerBoard();
  if (validateStickerBoard(raw)) throw error('database_error', t('stickers.invalid'));
  return raw as StickerBoard;
}

export function getBrowserStickerBoard() {
  return transaction('readonly', boardIn);
}

export async function saveBrowserStickerBoard(board: StickerBoard) {
  const problem = validateStickerBoard(board);
  if (problem) throw error('validation_error', t(`stickers.${problem === 'text' ? 'textError' : problem === 'image' ? 'imageError' : problem}`));
  return transaction('readwrite', async tx => {
    const current = await boardIn(tx);
    if (current.revision !== board.revision) throw error('conflict', t('stickers.conflict'));
    for (const object of board.objects) {
      if (object.kind === 'image' && !await requestValue(tx.objectStore('images').get(object.assetId))) {
        throw error('not_found', t('stickers.missingImage'));
      }
    }
    const saved = { ...board, revision: board.revision + 1 };
    await requestValue(tx.objectStore('boards').put(saved, 'stickers'));
    return saved;
  });
}

export async function uploadBrowserStickerImage(fileName: string, bytes: Uint8Array): Promise<StickerAsset> {
  const header = await validateStickerImage(bytes, fileName);
  const asset: StickerAsset = { ...header, id: crypto.randomUUID().replace(/-/g, ''), fileName: fileName.split(/[\\/]/).pop() ?? fileName, byteSize: bytes.length };
  await transaction('readwrite', async tx => { await requestValue(tx.objectStore('images').put({ asset, bytes } satisfies StoredImage)); });
  return asset;
}

export async function readBrowserStickerImage(id: string): Promise<Uint8Array> {
  if (!validId(id)) throw error('validation_error', t('stickers.invalid'));
  return transaction('readonly', async tx => {
    const record: StoredImage | undefined = await requestValue(tx.objectStore('images').get(id));
    if (!record) throw error('not_found', t('stickers.missingImage'));
    return record.bytes;
  });
}

export async function discardBrowserStickerImages(ids: string[]): Promise<void> {
  if (!ids.every(validId)) throw error('validation_error', t('stickers.invalid'));
  await transaction('readwrite', async tx => {
    const board = await boardIn(tx);
    const referenced = new Set(board.objects.flatMap(o => o.kind === 'image' ? [o.assetId] : []));
    for (const id of ids) {
      if (!referenced.has(id)) await requestValue(tx.objectStore('images').delete(id));
    }
  });
}
