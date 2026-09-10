// Bridges stored `attachment:<id>` references and the `blob:` URLs a webview can
// actually display.
//
// Stored Markdown never contains a blob URL: blob URLs are per-session and would
// be dead on next launch. The editor therefore holds blob URLs while open, and
// the two `map*` helpers translate at the load and save boundaries. Both are
// synchronous so the Delta converters stay pure; anything needing I/O happens in
// `resolve` beforehand.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNowlyRepository } from '../../data/RepositoryContext';
import {
  attachmentIdFromUrl,
  attachmentIdsIn,
  attachmentUrl,
  isDisplayableImage,
  type Attachment
} from '../../lib/attachment';

/** Metadata plus the session URL an attachment is currently displayed under. */
export type ResolvedAttachment = Attachment & {
  /** Blob URL for display, or null when the bytes could not be read. */
  objectUrl: string | null;
};

export type AttachmentBridge = {
  /** True when the backend supports attachments at all. */
  supported: boolean;
  /** Everything resolved this session, keyed by attachment id. */
  resolved: ReadonlyMap<string, ResolvedAttachment>;
  /** Fetch and cache every attachment referenced by this Markdown. */
  resolve(markdown: string): Promise<void>;
  /** Upload one file and cache it, returning its record. */
  upload(file: File): Promise<Attachment>;
  /** Storage form -> display form, for loading into the editor. */
  mapToDisplay(url: string): string;
  /** Display form -> storage form, for saving out of the editor. */
  mapToStorage(url: string): string;
};

export function useAttachments(): AttachmentBridge {
  const repository = useNowlyRepository();
  const supported = typeof repository.saveAttachment === 'function';

  const [resolved, setResolved] = useState<ReadonlyMap<string, ResolvedAttachment>>(new Map());
  // Mirrors `resolved` for synchronous reads from the map helpers, which run
  // inside Quill callbacks where React state may be a render behind.
  const cache = useRef(new Map<string, ResolvedAttachment>());
  const objectToId = useRef(new Map<string, string>());
  const inFlight = useRef(new Set<string>());
  const ownedUrls = useRef(new Set<string>());

  // Revoke on unmount only. Revoking per value change would break images that
  // are still on screen in another dialog opened from this one.
  useEffect(
    () => () => {
      for (const url of ownedUrls.current) URL.revokeObjectURL(url);
      ownedUrls.current.clear();
    },
    []
  );

  const remember = useCallback((record: Attachment, objectUrl: string | null) => {
    const entry: ResolvedAttachment = { ...record, objectUrl };
    cache.current.set(record.id, entry);
    if (objectUrl) {
      objectToId.current.set(objectUrl, record.id);
      ownedUrls.current.add(objectUrl);
    }
    setResolved(new Map(cache.current));
  }, []);

  const resolve = useCallback(
    async (markdown: string) => {
      if (!repository.listAttachments || !repository.readAttachment) return;
      const pending = attachmentIdsIn(markdown).filter(
        (id) => !cache.current.has(id) && !inFlight.current.has(id)
      );
      if (!pending.length) return;
      for (const id of pending) inFlight.current.add(id);

      try {
        const records = await repository.listAttachments(pending);
        await Promise.all(
          records.map(async (record) => {
            try {
              const bytes = await repository.readAttachment!(record.id);
              // Copy into a fresh buffer: the IPC reply may be a view over a
              // larger transfer buffer.
              const blob = new Blob([new Uint8Array(bytes)], { type: record.mime });
              remember(record, URL.createObjectURL(blob));
            } catch {
              // Row exists but bytes are unreadable. Cache the failure so the
              // UI can show it as broken instead of retrying forever.
              remember(record, null);
            }
          })
        );
      } catch {
        // Listing failed wholesale; leave the ids unresolved so a later attempt
        // can retry them.
      } finally {
        for (const id of pending) inFlight.current.delete(id);
      }
    },
    [remember, repository]
  );

  const upload = useCallback(
    async (file: File) => {
      if (!repository.saveAttachment) throw new Error('attachments unsupported');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const record = await repository.saveAttachment(file.name, bytes);
      // Reuse the bytes already in hand rather than reading them back.
      const objectUrl = isDisplayableImage(record.mime)
        ? URL.createObjectURL(new Blob([bytes], { type: record.mime }))
        : null;
      remember(record, objectUrl);
      return record;
    },
    [remember, repository]
  );

  const mapToDisplay = useCallback((url: string) => {
    const id = attachmentIdFromUrl(url);
    if (!id) return url;
    return cache.current.get(id)?.objectUrl ?? url;
  }, []);

  const mapToStorage = useCallback((url: string) => {
    const id = objectToId.current.get(url);
    return id ? attachmentUrl(id) : url;
  }, []);

  return useMemo(
    () => ({ supported, resolved, resolve, upload, mapToDisplay, mapToStorage }),
    [supported, resolved, resolve, upload, mapToDisplay, mapToStorage]
  );
}
