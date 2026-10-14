import { useCallback, useEffect, useRef, useState } from 'react';
import { useNowlyRepository } from '../data/RepositoryContext';
import { t } from '../i18n';
import { emptyStickerBoard, validateStickerBoard, type StickerBoard, type StickerObject } from './sticker-model';
import { validateStickerImage } from './sticker-image';

export function stickerError(error: unknown): string {
  return error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
    ? error.message : t('stickers.operationError');
}

export function useStickers() {
  const repository = useNowlyRepository();
  const [state, setState] = useState<{ status: 'loading' | 'ready' | 'error'; board: StickerBoard; error?: string }>({ status: 'loading', board: emptyStickerBoard() });
  const request = useRef(0);
  const load = useCallback(async () => {
    const id = ++request.current;
    setState(current => ({ ...current, status: 'loading', error: undefined }));
    try {
      if (!repository.getStickerBoard) throw new Error(t('stickers.unavailable'));
      const board = await repository.getStickerBoard();
      if (validateStickerBoard(board)) throw new Error(t('stickers.invalid'));
      if (id === request.current) setState({ status: 'ready', board });
    } catch (error) {
      if (id === request.current) setState(current => ({ ...current, status: 'error', error: stickerError(error) }));
    }
  }, [repository]);
  useEffect(() => { void load(); return () => { request.current++; }; }, [load]);
  const saved = (board: StickerBoard) => setState({ status: 'ready', board });
  return { state, load, saved };
}

export function useStickerImages(objects: StickerObject[], localUrls: Record<string, string> = {}) {
  const repository = useNowlyRepository();
  const assetIds = [...new Set(objects.flatMap(o => o.kind === 'image' && !localUrls[o.assetId] ? [o.assetId] : []))].sort().join(',');
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    const allocated: string[] = [];
    setUrls({});
    setFailures({});
    const ids = assetIds ? assetIds.split(',') : [];
    void Promise.all(ids.map(async id => {
      try {
        if (!repository.readStickerImage) throw new Error(t('stickers.unavailable'));
        const bytes = await repository.readStickerImage(id);
        // Stored images are authoritative; derive MIME from their signature, not a file URL.
        const extension = bytes[0] === 137 ? 'png' : bytes[0] === 0xff ? 'jpg' : 'webp';
        const { mime } = await validateStickerImage(bytes, `image.${extension}`);
        if (!active) return;
        const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mime }));
        allocated.push(url);
        setUrls(current => ({ ...current, [id]: url }));
      } catch (error) {
        if (active) setFailures(current => ({ ...current, [id]: stickerError(error) }));
      }
    }));
    return () => { active = false; allocated.forEach(url => URL.revokeObjectURL(url)); };
  }, [repository, assetIds, attempt]);
  return { urls: { ...urls, ...localUrls }, failures, retry: () => setAttempt(current => current + 1) };
}
