import type { Note } from '../notes-model';
import type { ExportSource, NoteExportFormat } from './service';
import { invoke, isTauri } from '@tauri-apps/api/core';

export async function exportNotes(notes: readonly Note[], format: NoteExportFormat, source: ExportSource, progress: (done: number, total: number) => void): Promise<boolean> {
  const { buildNoteExport } = await import('./service');
  const desktop = isTauri();
  const artifact = await buildNoteExport(notes, format, source, {
    onProgress: progress,
    renderPdf: desktop ? async html => new Uint8Array(await invoke<ArrayBuffer>('render_note_pdf', { html })) : undefined
  });
  if (desktop) return invoke<boolean>('save_note_export', artifact.bytes, {
    headers: { 'x-export-name': encodeURIComponent(artifact.name) }
  });
  const blob = new Blob([new Uint8Array(artifact.bytes)], { type: artifact.name.endsWith('.zip') ? 'application/zip' : 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = artifact.name;
  anchor.click();
  // Keep the object alive long enough for the browser to consume the download.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}
