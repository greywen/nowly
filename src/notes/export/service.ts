import type { Note } from '../notes-model';
import type { NowlyRepository } from '../../data/nowly-repository';
import { strToU8, zipSync } from 'fflate';
import { attachmentIdsIn } from '../../lib/attachment';
import { noteTitle } from '../note-title';
import { attachmentFileName, portableUrl, safeFileName } from './archive';
import { convertContent } from './content';

export type ExportSource = Pick<NowlyRepository, 'listAttachments' | 'readAttachment'>;
type ExportOptions = {
  onProgress?: (done: number, total: number) => void;
};
export const MAX_EXPORT_BYTES = 256 * 1024 * 1024;
export class NoteExportError extends Error {
  constructor(public readonly reason: 'empty' | 'attachment' | 'tooLarge') { super(reason); }
}

export async function buildNoteExport(notes: readonly Note[], source: ExportSource, options: ExportOptions = {}): Promise<{ name: string; bytes: Uint8Array }> {
  if (!notes.length) throw new NoteExportError('empty');
  const snapshot = notes.map(note => ({ ...note }));
  const bundle = snapshot.length > 1 || snapshot.some(note => attachmentIdsIn(note.content).length);
  const files: Record<string, Uint8Array> = Object.create(null);
  let totalBytes = 0;
  const add = (path: string, bytes: Uint8Array) => {
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_EXPORT_BYTES) throw new NoteExportError('tooLarge');
    files[path] = bytes;
  };
  options.onProgress?.(0, snapshot.length);
  let standaloneName = '';
  for (const [index, note] of snapshot.entries()) {
    const name = safeFileName(noteTitle(note.content));
    const directory = bundle ? `${String(index + 1).padStart(3, '0')}-${name}/` : '';
    const urls = new Map<string, string>();
    const ids = attachmentIdsIn(note.content);
    if (ids.length) {
      if (!source.listAttachments || !source.readAttachment) throw new NoteExportError('attachment');
      const records = await source.listAttachments(ids);
      for (const [attachmentIndex, id] of ids.entries()) {
        const record = records.find(record => record.id === id);
        if (!record) throw new NoteExportError('attachment');
        if (record.byteSize + totalBytes > MAX_EXPORT_BYTES) throw new NoteExportError('tooLarge');
        let bytes: Uint8Array;
        try { bytes = await source.readAttachment(id); } catch { throw new NoteExportError('attachment'); }
        if (bytes.length !== record.byteSize) throw new NoteExportError('attachment');
        const path = `assets/${String(attachmentIndex + 1).padStart(3, '0')}-${attachmentFileName(record.fileName)}`;
        add(directory + path, bytes);
        urls.set(`attachment:${id}`, portableUrl(path));
      }
    }
    const markdown = convertContent(note.content, url => {
      const resolved = urls.get(url);
      if (resolved) return resolved;
      if (/^(attachment:|assets\/|blob:|file:)/i.test(url)) throw new NoteExportError('attachment');
      return url;
    });
    standaloneName = `${name}.md`;
    add(directory + standaloneName, strToU8(markdown));
    options.onProgress?.(index + 1, snapshot.length);
    // Yield between documents so static progress can paint.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  if (!bundle) return { name: standaloneName, bytes: files[standaloneName] };
  const bytes = zipSync(files, { level: 0 });
  if (bytes.byteLength > MAX_EXPORT_BYTES) throw new NoteExportError('tooLarge');
  return { name: 'Nowly-Notes-markdown.zip', bytes };
}
