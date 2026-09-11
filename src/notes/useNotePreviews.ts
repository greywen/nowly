import { useEffect, useMemo } from 'react';
import { contentAttachments, contentToPlainText } from '../components/rich-text/content';
import { useAttachments } from '../components/rich-text/useAttachments';
import type { Note } from './notes-model';

export type NotePreview = {
  /** Content flattened to text, for the line-clamped body. */
  text: string;
  /** Object URL of the note's first image, once fetched. */
  thumbnailUrl: string | null;
  /** Images plus files, for the paperclip badge. */
  attachmentCount: number;
};

/**
 * Previews for a list of notes: flattened text, a thumbnail, and a count.
 *
 * Shared by the widget and the all-notes dialog so the same note reads the same
 * way in both.
 *
 * Counting is a pure parse, so a board of notes shows its paperclips without
 * touching disk. Only the first image of each note is fetched, since that is all
 * any surface renders — going through `resolve` would also read the bytes of
 * every attached file, up to 1MB each, to build object URLs nothing displays.
 */
export function useNotePreviews(notes: readonly Note[]): ReadonlyMap<string, NotePreview> {
  const { resolveIds, resolved } = useAttachments();

  const parsed = useMemo(() => {
    const map = new Map<string, { text: string; firstImageId: string | null; count: number }>();
    for (const note of notes) {
      const { imageIds, fileIds } = contentAttachments(note.content);
      map.set(note.id, {
        text: contentToPlainText(note.content),
        firstImageId: imageIds[0] ?? null,
        count: imageIds.length + fileIds.length
      });
    }
    return map;
  }, [notes]);

  // A joined string, not the array: its identity changes every render while its
  // contents do not, which would re-run the effect forever.
  const thumbnailKey = useMemo(() => {
    const ids: string[] = [];
    for (const entry of parsed.values()) {
      if (entry.firstImageId && !ids.includes(entry.firstImageId)) ids.push(entry.firstImageId);
    }
    return ids.join(',');
  }, [parsed]);

  useEffect(() => {
    if (!thumbnailKey) return;
    void resolveIds(thumbnailKey.split(','));
  }, [resolveIds, thumbnailKey]);

  return useMemo(() => {
    const map = new Map<string, NotePreview>();
    for (const [id, entry] of parsed) {
      map.set(id, {
        text: entry.text,
        thumbnailUrl: entry.firstImageId ? resolved.get(entry.firstImageId)?.objectUrl ?? null : null,
        attachmentCount: entry.count
      });
    }
    return map;
  }, [parsed, resolved]);
}
