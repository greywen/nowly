import { describe, expect, it } from 'vitest';
import Quill from 'quill';
import { markdownToDelta, type DeltaOp } from './delta';
import { parseContent, serializeContent } from './content';
import { registerRichTextFormats, richTextFormats, richTextToolbar } from './quill-setup';

// Only the load direction survives: content is stored as Delta JSON now, so
// this converter exists purely so notes written before that change still open.
describe('legacy markdown to delta', () => {
  it('puts block formats on the newline that ends the line', () => {
    expect(markdownToDelta('# 标题')).toEqual([{ insert: '标题' }, { insert: '\n', attributes: { header: 1 } }]);
    expect(markdownToDelta('## 小标题')).toEqual([{ insert: '小标题' }, { insert: '\n', attributes: { header: 2 } }]);
    expect(markdownToDelta('正文')).toEqual([{ insert: '正文' }, { insert: '\n' }]);
  });

  it('emits one code-block newline per line, as Quill requires', () => {
    expect(markdownToDelta('```\na\nb\n```')).toEqual([
      { insert: 'a' },
      { insert: '\n', attributes: { 'code-block': 'plain' } },
      { insert: 'b' },
      { insert: '\n', attributes: { 'code-block': 'plain' } }
    ]);
  });

  it('carries inline marks, links and image alt text', () => {
    expect(markdownToDelta('**粗**')).toEqual([{ insert: '粗', attributes: { bold: true } }, { insert: '\n' }]);
    expect(markdownToDelta('<u>线</u>')).toEqual([
      { insert: '线', attributes: { underline: true } },
      { insert: '\n' }
    ]);
    expect(markdownToDelta('[站点](https://example.com)')).toEqual([
      { insert: '站点', attributes: { link: 'https://example.com' } },
      { insert: '\n' }
    ]);
    expect(markdownToDelta('![图](attachment:a.png)')).toEqual([
      { insert: { image: 'attachment:a.png' }, attributes: { alt: '图' } },
      { insert: '\n' }
    ]);
  });

  it('never produces empty contents, which Quill rejects', () => {
    expect(markdownToDelta('')).toEqual([{ insert: '\n' }]);
  });

  it('maps URLs through the supplied resolver', () => {
    expect(markdownToDelta('![图](attachment:a.png)', () => 'blob:nowly/1')).toEqual([
      { insert: { image: 'blob:nowly/1' }, attributes: { alt: '图' } },
      { insert: '\n' }
    ]);
  });

  it('treats plain text as the Markdown subset it is', () => {
    // Every note predating the editor is plain text, so this is the common case.
    expect(markdownToDelta('就是一句话')).toEqual([{ insert: '就是一句话' }, { insert: '\n' }]);
  });
});

// The storage guarantee that matters now: content survives a real Quill.
describe('round trip through a real Quill instance', () => {
  function editor() {
    registerRichTextFormats();
    const host = document.createElement('div');
    document.body.append(host);
    return new Quill(host, {
      theme: 'snow',
      formats: richTextFormats,
      modules: { toolbar: richTextToolbar as never, table: true }
    });
  }

  /** Load stored content, then serialise what Quill actually holds. */
  function cycle(stored: string): string {
    const quill = editor();
    quill.setContents(parseContent(stored) as never);
    return serializeContent(quill.getContents().ops as DeltaOp[]);
  }

  function store(ops: DeltaOp[]): string {
    return serializeContent(ops);
  }

  it('preserves every inline format through Quill', () => {
    const ops: DeltaOp[] = [
      { insert: '粗', attributes: { bold: true } },
      { insert: '斜', attributes: { italic: true } },
      { insert: '线', attributes: { underline: true } },
      { insert: '删', attributes: { strike: true } },
      { insert: '码', attributes: { code: true } },
      { insert: '色', attributes: { color: '#4fc9da' } },
      { insert: '底', attributes: { background: '#ddf8fc' } },
      { insert: '上', attributes: { script: 'super' } },
      { insert: '下', attributes: { script: 'sub' } },
      { insert: '号', attributes: { size: '1.075rem' } },
      { insert: '宽', attributes: { font: 'mono' } },
      { insert: '\n' }
    ];
    expect(cycle(store(ops))).toBe(store(ops));
  });

  it('preserves every block format through Quill', () => {
    for (const attributes of [
      { header: 1 },
      { header: 4 },
      { blockquote: true },
      { list: 'ordered' },
      { list: 'bullet' },
      { list: 'check' },
      { indent: 1 },
      { align: 'center' },
      { direction: 'rtl' }
    ]) {
      const ops: DeltaOp[] = [{ insert: '行' }, { insert: '\n', attributes }];
      expect(cycle(store(ops)), JSON.stringify(attributes)).toBe(store(ops));
    }
  });

  it('preserves image and video embeds through Quill', () => {
    const ops: DeltaOp[] = [
      { insert: { image: 'attachment:a1b2.png' }, attributes: { alt: '图' } },
      { insert: '\n' },
      { insert: { video: 'https://example.com/embed/1' } },
      { insert: '\n' }
    ];
    expect(cycle(store(ops))).toBe(store(ops));
  });

  it('keeps attachment and blob image URLs, which stock Quill rewrites to //:0', () => {
    for (const url of ['attachment:a1b2.png', 'blob:nowly/abc']) {
      const ops: DeltaOp[] = [{ insert: { image: url } }, { insert: '\n' }];
      expect(cycle(store(ops))).toBe(store(ops));
    }
  });

  it('still rejects dangerous image URLs at the blot boundary', () => {
    const quill = editor();
    quill.setContents([{ insert: { image: 'javascript:alert(1)' } }, { insert: '\n' }] as never);
    expect(quill.root.innerHTML).not.toContain('javascript:');
  });

  it('never lets a blob or data URL reach a video iframe', () => {
    // Video inherits Link.sanitize, which we widened for attachments. An iframe
    // with a blob: src would run script against this page's origin.
    const quill = editor();
    for (const url of ['blob:nowly/abc', 'data:text/html,<script>alert(1)</script>', 'javascript:alert(1)']) {
      quill.setContents([{ insert: { video: url } }, { insert: '\n' }] as never);
      const iframe = quill.root.querySelector('iframe');
      expect(iframe?.getAttribute('src')).toBe('about:blank');
    }
  });

  it('accepts a remote video URL', () => {
    const quill = editor();
    quill.setContents([{ insert: { video: 'https://example.com/e/1' } }, { insert: '\n' }] as never);
    expect(quill.root.querySelector('iframe')?.getAttribute('src')).toBe('https://example.com/e/1');
  });

  it('loads legacy markdown and re-saves it as an envelope', () => {
    const quill = editor();
    quill.setContents(parseContent('# 标题') as never);
    const saved = serializeContent(quill.getContents().ops as DeltaOp[]);
    expect(JSON.parse(saved)).toEqual({ v: 1, ops: [{ insert: '标题' }, { insert: '\n', attributes: { header: 1 } }] });
  });

  it('renders every toolbar control', () => {
    editor();
    const classes = Array.from(document.querySelectorAll('.ql-toolbar button')).map((node) => node.className);
    expect(classes).toEqual(
      expect.arrayContaining([
        'ql-bold',
        'ql-italic',
        'ql-underline',
        'ql-strike',
        'ql-code',
        'ql-blockquote',
        'ql-code-block',
        'ql-link',
        'ql-image',
        'ql-video',
        'ql-formula',
        'ql-table',
        'ql-clean'
      ])
    );
    for (const picker of ['.ql-header', '.ql-font', '.ql-size', '.ql-color', '.ql-background', '.ql-align']) {
      expect(document.querySelector(`.ql-toolbar ${picker}`), picker).not.toBeNull();
    }
  });
});
