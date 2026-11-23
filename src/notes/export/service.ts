import type { Note } from '../notes-model';
import type { NowlyRepository } from '../../data/nowly-repository';
import { strToU8, zipSync } from 'fflate';
import { attachmentIdsIn } from '../../lib/attachment';
import { noteTitle } from '../note-title';
import { getLocale, t } from '../../i18n';
import { attachmentFileName, portableUrl, safeFileName } from './archive';
import { convertContent, escapeHtml, printDocument } from './content';

export type NoteExportFormat = 'pdf' | 'markdown';
export type ExportSource = Pick<NowlyRepository, 'listAttachments' | 'readAttachment'>;
export type ExportOptions = {
  renderPdf?: (html: string) => Promise<Uint8Array>;
  onProgress?: (done: number, total: number) => void;
};
export const MAX_EXPORT_BYTES = 256 * 1024 * 1024;
export class NoteExportError extends Error {
  constructor(public readonly reason: 'empty' | 'attachment' | 'tooLarge' | 'desktopOnly') { super(reason); }
}

function dataUrl(bytes: Uint8Array, mime: string): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return `data:${mime};base64,${btoa(binary)}`;
}

export async function buildNoteExport(notes: readonly Note[], format: NoteExportFormat, source: ExportSource, options: ExportOptions = {}): Promise<{ name: string; bytes: Uint8Array }> {
  if (!notes.length) throw new NoteExportError('empty');
  if (format === 'pdf' && !options.renderPdf) throw new NoteExportError('desktopOnly');
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
    const title = noteTitle(note.content);
    const name = safeFileName(title);
    const directory = bundle ? `${String(index + 1).padStart(3, '0')}-${name}/` : '';
    const urls = new Map<string, string>();
    const pdfImages = new Map<string, string>();
    const attachmentNames: string[] = [];
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
        const url = portableUrl(path);
        urls.set(`attachment:${id}`, url);
        attachmentNames.push(`${record.fileName} → ${path}`);
        if (/^image\/(png|jpe?g|gif|webp|bmp)$/.test(record.mime)) pdfImages.set(url, dataUrl(bytes, record.mime));
      }
    }
    const converted = await convertContent(note.content, url => {
      const resolved = urls.get(url);
      if (resolved) return resolved;
      if (/^(attachment:|assets\/|blob:|file:)/i.test(url)) throw new NoteExportError('attachment');
      return url;
    });
    let bytes: Uint8Array;
    if (format === 'pdf') {
      const doc = document.createElement('div');
      doc.innerHTML = converted.html;
      for (const image of doc.querySelectorAll('img')) {
        const url = image.getAttribute('src') ?? '';
        if (url.startsWith('assets/')) {
          const embedded = pdfImages.get(url);
          if (!embedded) throw new NoteExportError('attachment');
          image.setAttribute('src', embedded);
        }
      }
      // Relative file hyperlinks would bake the renderer's private temp path
      // into the PDF. Keep readable labels and the portable attachment list.
      doc.querySelectorAll('a[href^="assets/"]').forEach(anchor => anchor.removeAttribute('href'));
      const appendix = attachmentNames.length
        ? `<section class="note-export-attachments"><h2>${escapeHtml(t('noteExport.attachments'))}</h2><ul>${attachmentNames.map(name => `<li>${escapeHtml(name)}</li>`).join('')}</ul></section>` : '';
      bytes = await options.renderPdf!(printDocument(doc.innerHTML + appendix, title, getLocale()));
    } else bytes = strToU8(converted.markdown);
    standaloneName = `${name}.${format === 'pdf' ? 'pdf' : 'md'}`;
    add(directory + standaloneName, bytes);
    options.onProgress?.(index + 1, snapshot.length);
    // Yield between documents so static progress can paint.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  if (!bundle) return { name: standaloneName, bytes: files[standaloneName] };
  const bytes = zipSync(files, { level: 0 });
  if (bytes.byteLength > MAX_EXPORT_BYTES) throw new NoteExportError('tooLarge');
  return { name: `Nowly-Notes-${format}.zip`, bytes };
}
