import { describe, expect, it } from 'vitest';
import Quill from 'quill';
import { deltaToMarkdown, markdownToDelta, type DeltaOp } from './delta';
import { registerRichTextFormats, richTextToolbar } from './quill-setup';

describe('markdown to delta', () => {
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
    expect(markdownToDelta('**粗**')).toEqual([
      { insert: '粗', attributes: { bold: true } },
      { insert: '\n' }
    ]);
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
});

describe('delta to markdown', () => {
  it('reads block formats off the closing newline', () => {
    expect(deltaToMarkdown([{ insert: '标题' }, { insert: '\n', attributes: { header: 1 } }])).toBe('# 标题');
    expect(deltaToMarkdown([{ insert: '正文' }, { insert: '\n' }])).toBe('正文');
  });

  it('drops the trailing newline Quill always keeps', () => {
    expect(deltaToMarkdown([{ insert: '正文' }, { insert: '\n' }, { insert: '\n' }])).toBe('正文');
    expect(deltaToMarkdown([{ insert: '\n' }])).toBe('');
  });

  it('stores code verbatim without Markdown escaping', () => {
    const ops: DeltaOp[] = [
      { insert: 'a * b [c]' },
      { insert: '\n', attributes: { 'code-block': 'plain' } }
    ];
    expect(deltaToMarkdown(ops)).toBe('```\na * b [c]\n```');
  });

  it('factors shared formats out around a group of runs', () => {
    // Serialising each run alone would yield `**粗 ****斜***** 粗**`.
    const ops: DeltaOp[] = [
      { insert: '粗 ', attributes: { bold: true } },
      { insert: '斜', attributes: { bold: true, italic: true } },
      { insert: ' 粗', attributes: { bold: true } },
      { insert: '\n' }
    ];
    expect(deltaToMarkdown(ops)).toBe('**粗 *斜* 粗**');
  });

  it('keeps emphasis markers off whitespace', () => {
    expect(deltaToMarkdown([{ insert: '粗 ', attributes: { bold: true } }, { insert: '\n' }])).toBe('**粗** ');
  });

  it('drops embeds whose URL is rejected but keeps their alt text', () => {
    const ops: DeltaOp[] = [
      { insert: { image: 'javascript:alert(1)' }, attributes: { alt: '图' } },
      { insert: '\n' }
    ];
    expect(deltaToMarkdown(ops)).toBe('图');
  });
});

describe('round trip through the converters', () => {
  const stable = [
    '# 标题',
    '## 小标题',
    '正文一句话',
    '**粗体**',
    '*斜体*',
    '<u>下划线</u>',
    '**粗 *斜* 粗**',
    '**粗** 和 *斜* 和 <u>线</u>',
    '```\nconst a = 1;\n```',
    '```\na\nb\n```',
    '![图](attachment:a1b2.png)',
    '![图\\[1\\]](attachment:a.png)',
    '[站点](https://example.com)',
    '[条目](https://ex.com/Foo_(bar))',
    '甲\n\n乙',
    '# 标题\n\n正文\n\n```\ncode\n```',
    '2 \\* 3',
    '\\#hashtag'
  ];

  for (const source of stable) {
    it(`preserves ${JSON.stringify(source)}`, () => {
      expect(deltaToMarkdown(markdownToDelta(source))).toBe(source);
    });
  }

  it('normalises a soft break into a paragraph break, because Quill has no soft break', () => {
    expect(deltaToMarkdown(markdownToDelta('一行\n二行'))).toBe('一行\n\n二行');
  });

  it('normalises headings deeper than h2', () => {
    expect(deltaToMarkdown(markdownToDelta('### 三级'))).toBe('## 三级');
  });
});

describe('round trip through a real Quill instance', () => {
  function editor() {
    registerRichTextFormats();
    const host = document.createElement('div');
    document.body.append(host);
    return new Quill(host, { theme: 'snow', modules: { toolbar: richTextToolbar as never } });
  }

  function cycle(markdown: string): string {
    const quill = editor();
    quill.setContents(markdownToDelta(markdown));
    return deltaToMarkdown(quill.getContents().ops as DeltaOp[]);
  }

  const stable = [
    '# 标题',
    '## 小标题',
    '正文',
    '**粗体**',
    '*斜体*',
    '<u>下划线</u>',
    '**粗 *斜* 粗**',
    '```\nconst a = 1;\n```',
    '```\na\nb\n```',
    '甲\n\n乙',
    '# 标题\n\n正文\n\n```\ncode\n```',
    '[站点](https://example.com)'
  ];

  for (const source of stable) {
    it(`survives Quill for ${JSON.stringify(source)}`, () => {
      expect(cycle(source)).toBe(source);
    });
  }

  it('keeps attachment and blob image URLs, which stock Quill rewrites to //:0', () => {
    expect(cycle('![图](attachment:a1b2.png)')).toBe('![图](attachment:a1b2.png)');
    expect(cycle('![图](blob:nowly/abc)')).toBe('![图](blob:nowly/abc)');
  });

  it('still rejects dangerous image URLs at the blot boundary', () => {
    const quill = editor();
    quill.setContents([{ insert: { image: 'javascript:alert(1)' } }, { insert: '\n' }]);
    expect(quill.root.innerHTML).not.toContain('javascript:');
  });

  it('renders the reference toolbar controls', () => {
    editor();
    const classes = Array.from(document.querySelectorAll('.ql-toolbar button')).map((node) => node.className);
    expect(classes).toEqual(
      expect.arrayContaining(['ql-bold', 'ql-italic', 'ql-underline', 'ql-image', 'ql-code-block'])
    );
    expect(document.querySelector('.ql-toolbar .ql-header')).not.toBeNull();
  });
});
