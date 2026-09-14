import { describe, expect, it } from 'vitest';
import {
  contentAttachments,
  contentToPlainText,
  deltaOpsAreEmpty,
  isContentEmpty,
  parseContent,
  removeAttachmentFromContent,
  serializeContent,
  stripFormulas
} from './content';
import type { DeltaOp } from './delta';

const envelope = (ops: DeltaOp[]) => JSON.stringify({ v: 1, ops });

describe('the empty document invariant', () => {
  // Drafts start at `content:''` / `description:''` and dirty checks compare whole
  // forms with JSON.stringify, so an envelope here would make every dialog open
  // dirty the moment it mounts.
  it('serialises an empty document to the empty string, not an envelope', () => {
    expect(serializeContent([{ insert: '\n' }])).toBe('');
    expect(serializeContent([])).toBe('');
    expect(serializeContent([{ insert: '   \n\n' }])).toBe('');
  });

  it('still serialises a document holding only an embed', () => {
    // No text, but definitely not empty.
    expect(serializeContent([{ insert: { image: 'attachment:a.png' } }, { insert: '\n' }])).not.toBe('');
  });

  it('ignores block formats when deciding emptiness', () => {
    // An empty heading is still an empty document.
    expect(deltaOpsAreEmpty([{ insert: '\n', attributes: { header: 1 } }])).toBe(true);
    expect(deltaOpsAreEmpty([{ insert: '文' }, { insert: '\n' }])).toBe(false);
  });

  it('reports emptiness for both storage shapes', () => {
    expect(isContentEmpty('')).toBe(true);
    expect(isContentEmpty('   ')).toBe(true);
    expect(isContentEmpty(envelope([{ insert: '\n' }]))).toBe(true);
    expect(isContentEmpty(envelope([{ insert: '文' }, { insert: '\n' }]))).toBe(false);
    expect(isContentEmpty('旧的纯文本')).toBe(false);
  });
});

describe('parsing stored content', () => {
  it('round trips an envelope unchanged', () => {
    const ops: DeltaOp[] = [
      { insert: '文', attributes: { bold: true, color: '#4fc9da' } },
      { insert: '\n', attributes: { header: 2 } }
    ];
    expect(parseContent(envelope(ops))).toEqual(ops);
    expect(serializeContent(ops)).toBe(envelope(ops));
  });

  it('falls back to the legacy converter for plain text and markdown', () => {
    expect(parseContent('就是一句话')).toEqual([{ insert: '就是一句话' }, { insert: '\n' }]);
    expect(parseContent('# 标题')).toEqual([{ insert: '标题' }, { insert: '\n', attributes: { header: 1 } }]);
  });

  it('treats malformed JSON as legacy text rather than throwing', () => {
    expect(parseContent('{not json')).toEqual([{ insert: '{not json' }, { insert: '\n' }]);
    // Valid JSON, but no ops array: not an envelope.
    expect(parseContent('{"a":1}')).toEqual([{ insert: '{"a":1}' }, { insert: '\n' }]);
  });

  it('never returns empty ops, which Quill rejects', () => {
    expect(parseContent(envelope([]))).toEqual([{ insert: '\n' }]);
    expect(parseContent('')).toEqual([{ insert: '\n' }]);
  });

  it('drops ops that are not shaped like ops', () => {
    const stored = JSON.stringify({ v: 1, ops: [{ insert: '好' }, 'junk', { nope: true }, { insert: '\n' }] });
    expect(parseContent(stored)).toEqual([{ insert: '好' }, { insert: '\n' }]);
  });

  it('maps embed and link URLs in both directions', () => {
    const stored = envelope([
      { insert: { image: 'attachment:a.png' } },
      { insert: '名', attributes: { link: 'attachment:b.pdf' } },
      { insert: '\n' }
    ]);
    const loaded = parseContent(stored, (url) => (url.startsWith('attachment:') ? 'blob:x' : url));
    expect(loaded[0]).toEqual({ insert: { image: 'blob:x' } });
    expect(loaded[1]).toEqual({ insert: '名', attributes: { link: 'blob:x' } });

    // And back on save.
    expect(serializeContent(loaded, (url) => (url === 'blob:x' ? 'attachment:a.png' : url))).toContain(
      'attachment:a.png'
    );
  });

  it('does not mutate the ops it maps', () => {
    const ops: DeltaOp[] = [{ insert: { image: 'attachment:a.png' }, attributes: { alt: '图' } }];
    serializeContent(ops, () => 'blob:y');
    expect(ops[0].insert).toEqual({ image: 'attachment:a.png' });
  });
});

describe('flattening to plain text for previews', () => {
  it('concatenates text and drops block formats', () => {
    const stored = envelope([
      { insert: '标题' },
      { insert: '\n', attributes: { header: 1 } },
      { insert: '正文' },
      { insert: '\n' }
    ]);
    expect(contentToPlainText(stored)).toBe('标题\n正文');
  });

  it('drops images, keeping the alt file name out of the preview', () => {
    // An image is shown as a thumbnail, so repeating its file name in the body
    // is noise: the card description read '预览图.png 附件清单' before this.
    const stored = envelope([
      { insert: '完成了初稿。\n' },
      { insert: { image: 'attachment:a.png' }, attributes: { alt: '预览图.png' } },
      { insert: '\n' }
    ]);
    expect(contentToPlainText(stored)).toBe('完成了初稿。');

    // An inline image between words leaves the prose joined as written.
    const inline = envelope([
      { insert: '见' },
      { insert: { image: 'attachment:a.png' }, attributes: { alt: '报告.png' } },
      { insert: '下图\n' }
    ]);
    expect(contentToPlainText(inline)).toBe('见下图');
  });

  it('renders an image-only note as empty text, though it still has content', () => {
    // The thumbnail carries it, so there is nothing to say. It must not count as
    // an empty document, or the note would be discarded unsaved.
    const stored = envelope([
      { insert: { image: 'attachment:a.png' }, attributes: { alt: '图.png' } },
      { insert: '\n' }
    ]);
    expect(contentToPlainText(stored)).toBe('');
    expect(isContentEmpty(stored)).toBe(false);
  });

  it('keeps a formula source, separated from the prose beside it', () => {
    // Unlike an image there is nothing else to show for a formula, and its
    // source is text the user typed.
    const stored = envelope([
      { insert: '质能等价：' },
      { insert: { formula: 'e=mc^2' } },
      { insert: '就是它\n' }
    ]);
    expect(contentToPlainText(stored)).toBe('质能等价： e=mc^2 就是它');
  });

  it('adds no separator where one already exists', () => {
    // A newline or existing space is separation enough; adding another would
    // waste a line of a two-line clamp.
    const afterNewline = envelope([
      { insert: '上文\n' },
      { insert: { formula: 'x^2' } },
      { insert: '\n' }
    ]);
    expect(contentToPlainText(afterNewline)).toBe('上文\nx^2');

    const alreadySpaced = envelope([
      { insert: '前 ' },
      { insert: { formula: 'x^2' } },
      { insert: ' 后\n' }
    ]);
    expect(contentToPlainText(alreadySpaced)).toBe('前 x^2 后');
  });

  it('collapses blank lines so a clamped preview is not mostly whitespace', () => {
    expect(contentToPlainText(envelope([{ insert: '甲\n\n\n乙' }, { insert: '\n' }]))).toBe('甲\n乙');
  });

  it('falls back to the markdown flattener for legacy content', () => {
    expect(contentToPlainText('# 标题\n\n正文')).toBe('标题\n正文');
    expect(contentToPlainText('**粗**')).toBe('粗');
  });

  it('renders nothing for an empty document', () => {
    expect(contentToPlainText('')).toBe('');
    expect(contentToPlainText(envelope([{ insert: '\n' }]))).toBe('');
  });
});

describe('removing an attachment reference', () => {
  const id = '0123456789abcdef0123456789abcdef.png';

  it('removes the embed but keeps surrounding text', () => {
    const stored = envelope([
      { insert: '前' },
      { insert: { image: `attachment:${id}` }, attributes: { alt: '图' } },
      { insert: '后\n' }
    ]);
    const next = removeAttachmentFromContent(stored, id);
    expect(next).not.toContain('attachment:');
    expect(contentToPlainText(next)).toBe('前后');
  });

  it('unlinks a file link but keeps the label the user wrote', () => {
    const stored = envelope([
      { insert: '报告', attributes: { link: `attachment:${id}`, bold: true } },
      { insert: '\n' }
    ]);
    const next = removeAttachmentFromContent(stored, id);
    expect(next).not.toContain('attachment:');
    // The label is the user's words, so it survives — with its other formats.
    expect(JSON.parse(next).ops[0]).toEqual({ insert: '报告', attributes: { bold: true } });
  });

  it('leaves other attachments alone', () => {
    const other = 'fedcba9876543210fedcba9876543210.png';
    const stored = envelope([
      { insert: { image: `attachment:${id}` } },
      { insert: { image: `attachment:${other}` } },
      { insert: '\n' }
    ]);
    const next = removeAttachmentFromContent(stored, id);
    expect(next).toContain(other);
    expect(next).not.toContain(id);
  });

  it('rejects a malformed id rather than editing content', () => {
    const stored = envelope([{ insert: { image: 'attachment:../etc/passwd' } }, { insert: '\n' }]);
    expect(removeAttachmentFromContent(stored, '../etc/passwd')).toBe(stored);
  });

  it('still handles legacy markdown content', () => {
    expect(removeAttachmentFromContent(`![图](attachment:${id})`, id)).toBe('');
  });
});

describe('degrading formulas when KaTeX is unavailable', () => {
  it('replaces a formula embed with its source', () => {
    // Quill's formula blot throws without KaTeX, which would take the dialog
    // down, so a failed lazy load degrades to the LaTeX source instead.
    expect(stripFormulas([{ insert: { formula: 'e=mc^2' } }, { insert: '\n' }])).toEqual([
      { insert: 'e=mc^2' },
      { insert: '\n' }
    ]);
  });

  it('leaves everything else untouched', () => {
    const ops: DeltaOp[] = [{ insert: { image: 'a.png' } }, { insert: '文', attributes: { bold: true } }];
    expect(stripFormulas(ops)).toEqual(ops);
  });
});

describe('finding the attachments a preview needs', () => {
  const IMAGE = '0123456789abcdef0123456789abcdef.png';
  const FILE = 'fedcba9876543210fedcba9876543210.pdf';

  it('separates image embeds from file links', () => {
    const content = envelope([
      { insert: '见下图：' },
      { insert: { image: `attachment:${IMAGE}` }, attributes: { alt: '报告.png' } },
      { insert: '明细' , attributes: { link: `attachment:${FILE}` } },
      { insert: '\n' }
    ]);
    expect(contentAttachments(content)).toEqual({ imageIds: [IMAGE], fileIds: [FILE] });
  });

  it('reads legacy Markdown too, so old notes still show their images', () => {
    // Content written before the Delta format is never migrated, so previews
    // have to find attachments through the Markdown path as well.
    expect(contentAttachments(`![图](attachment:${IMAGE})`)).toEqual({ imageIds: [IMAGE], fileIds: [] });
    expect(contentAttachments(`[报告](attachment:${FILE})`)).toEqual({ imageIds: [], fileIds: [FILE] });
  });

  it('dedupes repeats and keeps document order', () => {
    const content = envelope([
      { insert: { image: `attachment:${IMAGE}` } },
      { insert: 'x', attributes: { link: `attachment:${FILE}` } },
      { insert: { image: `attachment:${IMAGE}` } },
      { insert: '\n' }
    ]);
    expect(contentAttachments(content)).toEqual({ imageIds: [IMAGE], fileIds: [FILE] });
  });

  it('ignores remote URLs and plain text', () => {
    const content = envelope([
      { insert: { image: 'https://example.com/a.png' } },
      { insert: { video: 'https://example.com/v' } },
      { insert: '外链', attributes: { link: 'https://example.com' } },
      { insert: '没有附件\n' }
    ]);
    expect(contentAttachments(content)).toEqual({ imageIds: [], fileIds: [] });
    expect(contentAttachments('')).toEqual({ imageIds: [], fileIds: [] });
  });
});
