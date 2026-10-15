import { useEffect, useSyncExternalStore } from 'react';
import { useNowlyRepository } from '../data/RepositoryContext';
import type { NowlyRepository } from '../data/nowly-repository';
import { t } from '../i18n';
import { validateStickerBoard, type StickerAsset, type StickerBoard, type StickerObject } from './sticker-model';
import { stickerError } from './useStickers';

type PendingImage = { bytes: Uint8Array; fileName: string; url: string; uploaded?: StickerAsset };
type Snapshot = { board: StickerBoard; status: 'saved' | 'pending' | 'saving' | 'error'; error: string | null; cleanupError: boolean; urls: Record<string, string> };
const sessions = new WeakMap<NowlyRepository, StickerAutosave>();

class StickerAutosave {
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private paused = false;
  private blocked = false;
  private overflow = false;
  private dirty = false;
  private generation = 0;
  private pending = new Map<string, PendingImage>();
  private cleanup = new Set<string>();
  private persisted: StickerBoard;
  snapshot: Snapshot;
  constructor(private repository: NowlyRepository, board: StickerBoard) {
    this.persisted = board;
    this.snapshot = { board, status: 'saved', error: null, cleanupError: false, urls: {} };
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;
  private publish(patch: Partial<Snapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach(listener => listener());
  }
  change = (objects: StickerObject[], immediate = false) => {
    this.generation++;
    this.dirty = true;
    this.publish({ board: { ...this.snapshot.board, objects }, status: this.blocked ? 'error' : this.running ? 'saving' : 'pending' });
    this.schedule(immediate);
  };
  addImage = (id: string, image: PendingImage) => {
    this.pending.set(id, image);
    this.publish({ urls: { ...this.snapshot.urls, [id]: image.url } });
  };
  setOverflow = (overflow: boolean) => { this.overflow = overflow; };
  pause = (paused: boolean) => {
    this.paused = paused;
    clearTimeout(this.timer);
    if (!paused) this.schedule(true);
  };
  private schedule(immediate = false) {
    clearTimeout(this.timer);
    if (!this.dirty || this.paused || this.blocked) return;
    this.timer = setTimeout(() => void this.flush(), immediate ? 0 : 500);
  }
  retry = () => {
    this.blocked = false;
    this.publish({ error: null });
    void this.flush();
  };
  private async clean() {
    const referenced = new Set([...this.persisted.objects, ...this.snapshot.board.objects].flatMap(o => o.kind === 'image' ? [o.assetId] : []));
    for (const [id, image] of this.pending) {
      if (referenced.has(id) && image.uploaded) referenced.add(image.uploaded.id);
    }
    const ids = [...this.cleanup].filter(id => !referenced.has(id));
    if (ids.length) {
      if (!this.repository.discardStickerImages) throw new Error(t('stickers.unavailable'));
      await this.repository.discardStickerImages(ids);
      ids.forEach(id => this.cleanup.delete(id));
    }
    const urls = { ...this.snapshot.urls };
    for (const [id, image] of this.pending) {
      if (!referenced.has(id) && (!image.uploaded || !referenced.has(image.uploaded.id))) {
        URL.revokeObjectURL(image.url);
        this.pending.delete(id);
        delete urls[id];
        if (image.uploaded) delete urls[image.uploaded.id];
      }
    }
    this.publish({ urls, cleanupError: false });
  }
  retryCleanup = async () => {
    if (this.running) return;
    this.running = true;
    try { await this.clean(); }
    catch { this.publish({ cleanupError: true }); }
    finally { this.running = false; this.schedule(); }
  };
  private async flush() {
    if (this.running || this.paused || this.blocked || !this.dirty) return;
    clearTimeout(this.timer);
    const draft = this.snapshot.board;
    const generation = this.generation;
    const problem = validateStickerBoard(draft);
    if (problem || this.overflow) {
      this.blocked = true;
      this.publish({ status: 'error', error: t(`stickers.${problem === 'text' ? 'textError' : problem === 'image' ? 'imageError' : problem ?? 'overflow'}`) });
      return;
    }
    this.running = true;
    this.publish({ status: 'saving', error: null });
    try {
      if (!this.repository.saveStickerBoard) throw new Error(t('stickers.unavailable'));
      const objects: StickerObject[] = [];
      const replacements = new Map<string, string>();
      for (const object of draft.objects) {
        if (object.kind !== 'image') { objects.push(object); continue; }
        const image = this.pending.get(object.assetId);
        if (!image) { objects.push(object); continue; }
        if (!this.repository.uploadStickerImage) throw new Error(t('stickers.unavailable'));
        if (!image.uploaded) image.uploaded = await this.repository.uploadStickerImage(image.fileName, image.bytes);
        this.cleanup.add(image.uploaded.id);
        replacements.set(object.assetId, image.uploaded.id);
        objects.push({ ...object, assetId: image.uploaded.id });
      }
      const saved = await this.repository.saveStickerBoard({ ...draft, revision: this.persisted.revision, objects });
      this.persisted.objects.forEach(o => { if (o.kind === 'image') this.cleanup.add(o.assetId); });
      this.persisted = saved;
      this.dirty = generation !== this.generation;
      const latest = this.dirty ? this.snapshot.board.objects.map(o => o.kind === 'image' && replacements.has(o.assetId) ? { ...o, assetId: replacements.get(o.assetId)! } : o) : saved.objects;
      const urls = { ...this.snapshot.urls };
      replacements.forEach((actual, temporary) => { if (urls[temporary]) urls[actual] = urls[temporary]; });
      this.publish({ board: { ...saved, objects: latest }, urls, status: this.dirty ? 'pending' : 'saved' });
      try { await this.clean(); }
      catch { this.publish({ cleanupError: true }); }
    } catch (failure) {
      this.blocked = true;
      const conflict = failure && typeof failure === 'object' && 'code' in failure && failure.code === 'conflict';
      this.publish({ status: 'error', error: conflict ? t('stickers.conflict') : stickerError(failure) });
    } finally {
      this.running = false;
      this.schedule(true);
    }
  }
}

export function useStickerAutosave(board: StickerBoard) {
  const repository = useNowlyRepository();
  let session = sessions.get(repository);
  if (!session) { session = new StickerAutosave(repository, board); sessions.set(repository, session); }
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  useEffect(() => () => session.pause(false), [session]);
  return { ...snapshot, change: session.change, addImage: session.addImage, pause: session.pause,
    setOverflow: session.setOverflow, retry: session.retry, retryCleanup: session.retryCleanup };
}
