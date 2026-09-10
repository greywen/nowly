import { describe, expect, it } from 'vitest';
import {
  attachmentIdFromUrl,
  attachmentIdsIn,
  attachmentUrl,
  formatByteSize,
  isAttachmentId,
  isDisplayableImage,
  removeAttachmentReference
} from './attachment';

const id = '0123456789abcdef0123456789abcdef';

describe('attachment ids', () => {
  it('accepts only the form the backend generates', () => {
    expect(isAttachmentId(id)).toBe(true);
    expect(isAttachmentId(`${id}.png`)).toBe(true);
    // Anything that could escape the attachments directory must be refused, so
    // the frontend and Rust agree on what an id is.
    expect(isAttachmentId('../secret')).toBe(false);
    expect(isAttachmentId(`${id}/../x`)).toBe(false);
    expect(isAttachmentId(`${id}.PNG`)).toBe(false);
    expect(isAttachmentId(`${id}.`)).toBe(false);
    expect(isAttachmentId(`${id}.tar.gz`)).toBe(false);
    expect(isAttachmentId('short.png')).toBe(false);
    expect(isAttachmentId('')).toBe(false);
  });

  it('round-trips the url form used inside Markdown', () => {
    expect(attachmentUrl(`${id}.png`)).toBe(`attachment:${id}.png`);
    expect(attachmentIdFromUrl(`attachment:${id}.png`)).toBe(`${id}.png`);
    expect(attachmentIdFromUrl('attachment:../escape')).toBeNull();
    expect(attachmentIdFromUrl('https://example.com/a.png')).toBeNull();
    expect(attachmentIdFromUrl('blob:nowly/1')).toBeNull();
  });

  it('finds every referenced id, deduped and in order', () => {
    const other = 'fedcba9876543210fedcba9876543210';
    expect(attachmentIdsIn(`![a](attachment:${id}.png) [b](attachment:${other}.pdf)`)).toEqual([
      `${id}.png`,
      `${other}.pdf`
    ]);
    expect(attachmentIdsIn(`![a](attachment:${id}.png) ![b](attachment:${id}.png)`)).toEqual([`${id}.png`]);
    expect(attachmentIdsIn('没有附件')).toEqual([]);
    expect(attachmentIdsIn('attachment:../escape')).toEqual([]);
  });
});

describe('removeAttachmentReference', () => {
  it('removes both the image and link forms', () => {
    expect(removeAttachmentReference(`![图](attachment:${id}.png)`, `${id}.png`)).toBe('');
    expect(removeAttachmentReference(`[报告](attachment:${id}.pdf)`, `${id}.pdf`)).toBe('');
    expect(removeAttachmentReference(`前 ![图](attachment:${id}.png) 后`, `${id}.png`)).toBe('前  后');
  });

  it('keeps other attachments and surrounding content intact', () => {
    const other = 'fedcba9876543210fedcba9876543210';
    const markdown = `# 标题\n\n![a](attachment:${id}.png)\n\n![b](attachment:${other}.png)`;
    expect(removeAttachmentReference(markdown, `${id}.png`)).toBe(`# 标题\n\n![b](attachment:${other}.png)`);
  });

  it('collapses the blank lines the removal leaves behind', () => {
    expect(removeAttachmentReference(`甲\n\n![图](attachment:${id}.png)\n\n乙`, `${id}.png`)).toBe('甲\n\n乙');
  });

  it('handles escaped brackets in the label', () => {
    expect(removeAttachmentReference(`![图\\[1\\]](attachment:${id}.png)`, `${id}.png`)).toBe('');
  });

  it('ignores invalid ids rather than mangling content', () => {
    const markdown = `![图](attachment:${id}.png)`;
    expect(removeAttachmentReference(markdown, '../escape')).toBe(markdown);
  });
});

describe('display helpers', () => {
  it('recognises the image types the editor can show inline', () => {
    expect(isDisplayableImage('image/png')).toBe(true);
    expect(isDisplayableImage('image/jpeg')).toBe(true);
    // SVG can carry script, so it is never shown inline.
    expect(isDisplayableImage('image/svg+xml')).toBe(false);
    expect(isDisplayableImage('application/pdf')).toBe(false);
  });

  it('formats sizes the way the attachment strip shows them', () => {
    expect(formatByteSize(0)).toBe('0 B');
    expect(formatByteSize(512)).toBe('512 B');
    expect(formatByteSize(1024)).toBe('1 KB');
    expect(formatByteSize(1536)).toBe('1.5 KB');
    expect(formatByteSize(1024 * 1024)).toBe('1 MB');
    expect(formatByteSize(1024 * 1024 * 2.5)).toBe('2.5 MB');
  });
});
