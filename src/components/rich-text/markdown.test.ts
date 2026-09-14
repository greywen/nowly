import { describe, expect, it } from 'vitest';
import { markdownToPlainText, parseMarkdown, safeUrl } from './markdown';
import { markdownToDelta } from './delta';

// This parser now only reads legacy content: notes written before Delta storage,
// and the plain text every note held before there was an editor. Its output is
// asserted through the two things that actually consume it — the token stream and
// the Delta ops built from it — rather than through the old HTML renderer, which
// went away with the Markdown storage format.

describe('parsing blocks', () => {
  it('reads the closed set of block kinds', () => {
    expect(parseMarkdown('# 标题')).toEqual([{ kind: 'heading', level: 1, inline: [{ kind: 'text', text: '标题' }] }]);
    expect(parseMarkdown('## 小标题')).toEqual([
      { kind: 'heading', level: 2, inline: [{ kind: 'text', text: '小标题' }] }
    ]);
    expect(parseMarkdown('正文')).toEqual([{ kind: 'paragraph', inline: [{ kind: 'text', text: '正文' }] }]);
    expect(parseMarkdown('```\na\nb\n```')).toEqual([{ kind: 'code', code: 'a\nb' }]);
    expect(parseMarkdown('第一段\n\n第二段')).toEqual([
      { kind: 'paragraph', inline: [{ kind: 'text', text: '第一段' }] },
      { kind: 'paragraph', inline: [{ kind: 'text', text: '第二段' }] }
    ]);
    expect(parseMarkdown('')).toEqual([]);
    expect(parseMarkdown('   ')).toEqual([]);
  });

  it('reads the inline marks the old editor could produce', () => {
    expect(parseMarkdown('**粗** *斜* <u>下划线</u>')[0]).toEqual({
      kind: 'paragraph',
      inline: [
        { kind: 'strong', children: [{ kind: 'text', text: '粗' }] },
        { kind: 'text', text: ' ' },
        { kind: 'em', children: [{ kind: 'text', text: '斜' }] },
        { kind: 'text', text: ' ' },
        { kind: 'underline', children: [{ kind: 'text', text: '下划线' }] }
      ]
    });
  });

  it('keeps a single newline as a soft break', () => {
    expect(parseMarkdown('一行\n二行')[0]).toEqual({
      kind: 'paragraph',
      inline: [{ kind: 'text', text: '一行' }, { kind: 'break' }, { kind: 'text', text: '二行' }]
    });
  });

  it('clamps headings deeper than h2, which is all the old format had', () => {
    expect(parseMarkdown('### 三级')[0]).toMatchObject({ kind: 'heading', level: 2 });
    expect(parseMarkdown('###### 六级')[0]).toMatchObject({ kind: 'heading', level: 2 });
  });

  it('honours backslash escapes instead of re-parsing them as syntax', () => {
    expect(parseMarkdown('\\*不是斜体\\*')).toEqual([
      { kind: 'paragraph', inline: [{ kind: 'text', text: '*不是斜体*' }] }
    ]);
    expect(parseMarkdown('\\# 不是标题')).toEqual([
      { kind: 'paragraph', inline: [{ kind: 'text', text: '# 不是标题' }] }
    ]);
  });
});

describe('URL handling', () => {
  it('allows only the schemes attachments and previews rely on', () => {
    expect(safeUrl('attachment:abc.png')).toBe('attachment:abc.png');
    expect(safeUrl('blob:nowly/1')).toBe('blob:nowly/1');
    expect(safeUrl('https://example.com')).toBe('https://example.com');
    expect(safeUrl('./relative.png')).toBe('./relative.png');
    expect(safeUrl('data:image/png;base64,iVBORw0KGgo=')).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(safeUrl('javascript:alert(1)')).toBe('');
    expect(safeUrl('JAVASCRIPT:alert(1)')).toBe('');
    expect(safeUrl('data:text/html;base64,x')).toBe('');
    // SVG is excluded even as an image: it can carry script.
    expect(safeUrl('data:image/svg+xml;base64,PHN2Zz4=')).toBe('');
  });

  it('carries an attachment reference through to the Delta ops', () => {
    expect(markdownToDelta('![图](attachment:abc.png)')).toEqual([
      { insert: { image: 'attachment:abc.png' }, attributes: { alt: '图' } },
      { insert: '\n' }
    ]);
  });

  it('reads balanced parentheses inside URLs the way CommonMark does', () => {
    expect(parseMarkdown('[条目](https://ex.com/Foo_(bar))')[0]).toEqual({
      kind: 'paragraph',
      inline: [{ kind: 'link', url: 'https://ex.com/Foo_(bar)', children: [{ kind: 'text', text: '条目' }] }]
    });
    // A rejected scheme must consume the whole link, leaving no stray `)`.
    expect(markdownToPlainText('[点我](javascript:alert(1))')).toBe('点我');
    // Incomplete syntax stays literal instead of half-parsing.
    expect(markdownToPlainText('[未闭合](https://ex.com')).toBe('[未闭合](https://ex.com');
  });

  it('drops an embed with a rejected scheme but keeps its label', () => {
    for (const source of ['![图](vbscript:x)', '![图](file:///etc/passwd)', '![图](data:image/svg+xml;base64,PHN2Zz4=)']) {
      // No image op survives, so nothing reaches a src attribute.
      expect(markdownToDelta(source), source).toEqual([{ insert: '图' }, { insert: '\n' }]);
    }
  });
});

describe('markup in legacy content stays inert', () => {
  it('treats raw HTML as text, never as markup', () => {
    // There is no HTML rendering path left in the app: content goes
    // Markdown -> Delta -> Quill's own DOM, and Quill inserts text as text. So
    // the guarantee is that a script tag stays a single text token.
    expect(parseMarkdown('<script>alert(1)</script>')).toEqual([
      { kind: 'paragraph', inline: [{ kind: 'text', text: '<script>alert(1)</script>' }] }
    ]);
    expect(parseMarkdown('<img src=x onerror=alert(1)>')).toEqual([
      { kind: 'paragraph', inline: [{ kind: 'text', text: '<img src=x onerror=alert(1)>' }] }
    ]);
    // `<u>` is the one exception, because the old editor's underline needed it.
    expect(parseMarkdown('<u>线</u>')[0]).toMatchObject({
      inline: [{ kind: 'underline', children: [{ kind: 'text', text: '线' }] }]
    });
  });
});

describe('markdown to plain text', () => {
  it('flattens formatting for list previews', () => {
    expect(markdownToPlainText('# 标题\n\n正文')).toBe('标题\n正文');
    expect(markdownToPlainText('**粗** *斜* <u>线</u>')).toBe('粗 斜 线');
    expect(markdownToPlainText('![说明](attachment:a.png)')).toBe('说明');
    expect(markdownToPlainText('[站点](https://example.com)')).toBe('站点');
    expect(markdownToPlainText('```\ncode\n```')).toBe('code');
    expect(markdownToPlainText('2 \\* 3')).toBe('2 * 3');
    expect(markdownToPlainText('   ')).toBe('');
  });

  it('leaves legacy plain text untouched, which is why no migration is needed', () => {
    expect(markdownToPlainText('买牛奶')).toBe('买牛奶');
    expect(markdownToPlainText('第一行\n第二行')).toBe('第一行\n第二行');
    expect(markdownToDelta('买牛奶')).toEqual([{ insert: '买牛奶' }, { insert: '\n' }]);
  });
});
