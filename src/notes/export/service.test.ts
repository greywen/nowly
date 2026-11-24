import { describe, expect, it, vi } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { buildNoteExport } from './service';
import { safeFileName } from './archive';
import type { Note } from '../notes-model';
import type { Attachment } from '../../lib/attachment';

const note: Note = { id: 'a', content: '# 中文标题\n\n正文', color: '#4F55DA', pinned: false, styleVariant: 0, icon: '', createdAt: '2026-11-23T00:00:00Z', updatedAt: '2026-11-23T00:00:00Z' };
const id = 'a'.repeat(32) + '.png';
const attachment: Attachment = { id, fileName: '../示意 图.png', mime: 'image/png', relPath: 'attachments/x', byteSize: 3, createdAt: note.createdAt };

describe('note export packaging', () => {
  it('sanitizes Windows filenames without erasing Chinese', () => {
    expect(safeFileName('../中文:标题*?. ')).toBe('_中文_标题__');
    expect(safeFileName('CON.txt')).not.toBe('CON.txt');
    expect(safeFileName('   ')).toBe('Note');
    expect(safeFileName('x'.repeat(300)).length).toBeLessThanOrEqual(80);
  });

  it('exports a single standalone Markdown file', async () => {
    const result = await buildNoteExport([note], {});
    expect(result.name).toBe('中文标题.md');
    expect(strFromU8(result.bytes)).toContain('# 中文标题');
  });

  it('packages a batch in distinct directories even when titles match', async () => {
    const onProgress = vi.fn();
    const result = await buildNoteExport([note, { ...note, id: 'b' }], {}, { onProgress });
    expect(result.name).toBe('Nowly-Notes-markdown.zip');
    const files = unzipSync(result.bytes);
    expect(Object.keys(files).filter(path => path.endsWith('.md'))).toEqual(['001-中文标题/中文标题.md', '002-中文标题/中文标题.md']);
    expect(onProgress.mock.calls).toEqual([[0, 2], [1, 2], [2, 2]]);
  });

  it('copies image bytes and uses portable relative URLs', async () => {
    const withImage = { ...note, content: `标题\n\n![图](attachment:${id})` };
    const result = await buildNoteExport([withImage], {
      listAttachments: async () => [attachment],
      readAttachment: async () => new Uint8Array([1, 2, 3])
    });
    const files = unzipSync(result.bytes);
    const md = Object.entries(files).find(([path]) => path.endsWith('.md'))!;
    const imagePath = Object.keys(files).find(path => path.endsWith('.png'))!;
    expect(imagePath).not.toContain('..');
    expect(strFromU8(md[1])).toContain('assets/');
    expect(strFromU8(md[1])).not.toContain('attachment:');
    expect(files[imagePath]).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('fails when attachments are missing instead of exporting broken content', async () => {
    await expect(buildNoteExport([{ ...note, content: `![图](attachment:${id})` }], {
      listAttachments: async () => [],
      readAttachment: async () => new Uint8Array()
    })).rejects.toThrow('attachment');
  });

  it('rejects unresolved local links and images instead of silently discarding them', async () => {
    for (const url of ['attachment:invalid', 'assets/not-in-the-archive.png', 'blob:https://example.com/stale', 'file:///C:/private/photo.png']) {
      for (const insert of ['文件', { image: url }]) {
        const content = JSON.stringify({ v: 1, ops: [{ insert, attributes: { link: url } }, { insert: '\n' }] });
        await expect(buildNoteExport([{ ...note, content }], {})).rejects.toThrow('attachment');
      }
    }
  });

  it('checks attachment size before reading and rejects truncated bytes', async () => {
    const withImage = { ...note, content: `![图](attachment:${id})` };
    const readAttachment = vi.fn(async () => new Uint8Array(2));
    await expect(buildNoteExport([withImage], {
      listAttachments: async () => [{ ...attachment, byteSize: 256 * 1024 * 1024 + 1 }],
      readAttachment
    })).rejects.toThrow('tooLarge');
    expect(readAttachment).not.toHaveBeenCalled();
    await expect(buildNoteExport([withImage], {
      listAttachments: async () => [attachment], readAttachment
    })).rejects.toThrow('attachment');
  });

  it('rejects an empty selection', async () => {
    await expect(buildNoteExport([], {})).rejects.toThrow('empty');
  });
});
