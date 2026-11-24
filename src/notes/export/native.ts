import type { Note } from '../notes-model';
import type { ExportSource } from './service';
import { invoke, isTauri } from '@tauri-apps/api/core';

export async function exportNotes(notes: readonly Note[], source: ExportSource, progress: (done: number, total: number) => void): Promise<boolean> {
  const { buildNoteExport } = await import('./service');
  const desktop = isTauri();
  const artifact = await buildNoteExport(notes, source, { onProgress: progress });
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
