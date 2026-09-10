import { describe, expect, it } from 'vitest';
import { markdownToHtml, markdownToPlainText, parseMarkdown, safeUrl } from './markdown';

describe('markdown to html', () => {
  it('renders the closed block and inline subset', () => {
    expect(markdownToHtml('# 标题')).toBe('<h1>标题</h1>');
    expect(markdownToHtml('## 小标题')).toBe('<h2>小标题</h2>');
    expect(markdownToHtml('正文')).toBe('<p>正文</p>');
    expect(markdownToHtml('**粗** *斜* <u>下划线</u>')).toBe('<p><strong>粗</strong> <em>斜</em> <u>下划线</u></p>');
    expect(markdownToHtml('```\ncode\n```')).toBe('<pre>code</pre>');
    expect(markdownToHtml('第一段\n\n第二段')).toBe('<p>第一段</p><p>第二段</p>');
    // A soft break still renders as <br> so legacy multi-line plain text keeps
    // its shape when displayed, even though editing normalises it.
    expect(markdownToHtml('一行\n二行')).toBe('<p>一行<br>二行</p>');
    expect(markdownToHtml('   ')).toBe('');
  });

  it('clamps headings deeper than h2 so hand-edited content degrades predictably', () => {
    expect(markdownToHtml('### 三级')).toBe('<h2>三级</h2>');
    expect(markdownToHtml('###### 六级')).toBe('<h2>六级</h2>');
  });

  it('keeps attacker-controlled markup out of the output', () => {
    // A literal script tag is text, never an element.
    expect(markdownToHtml('<script>alert(1)</script>')).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
    // Inline HTML other than <u> is not honoured.
    expect(markdownToHtml('<img src=x onerror=alert(1)>')).toBe('<p>&lt;img src=x onerror=alert(1)&gt;</p>');
    // Dangerous URL schemes collapse to their visible text.
    expect(markdownToHtml('[点我](javascript:alert(1))')).toBe('<p>点我</p>');
    expect(markdownToHtml('![图](vbscript:x)')).toBe('<p>图</p>');
    expect(markdownToHtml('![图](file:///etc/passwd)')).toBe('<p>图</p>');
    // SVG can carry script, so it is excluded from the data: allow-list.
    expect(markdownToHtml('![图](data:image/svg+xml;base64,PHN2Zz4=)')).toBe('<p>图</p>');
    // Quotes in a URL cannot break out of the attribute.
    expect(markdownToHtml('![](https://e.com/a"onload="x)')).toContain('&quot;');
  });

  it('allows only the schemes attachments and previews rely on', () => {
    expect(safeUrl('attachment:abc.png')).toBe('attachment:abc.png');
    expect(safeUrl('blob:nowly/1')).toBe('blob:nowly/1');
    expect(safeUrl('https://example.com')).toBe('https://example.com');
    expect(safeUrl('./relative.png')).toBe('./relative.png');
    expect(safeUrl('data:image/png;base64,iVBORw0KGgo=')).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(safeUrl('javascript:alert(1)')).toBe('');
    expect(safeUrl('JAVASCRIPT:alert(1)')).toBe('');
    expect(safeUrl('data:text/html;base64,x')).toBe('');
    expect(markdownToHtml('![图](attachment:abc.png)')).toBe('<p><img src="attachment:abc.png" alt="图"></p>');
  });

  it('reads balanced parentheses inside URLs the way CommonMark does', () => {
    expect(markdownToHtml('[条目](https://ex.com/Foo_(bar))')).toBe('<p><a href="https://ex.com/Foo_(bar)">条目</a></p>');
    // A rejected scheme must consume the whole link, leaving no stray `)`.
    expect(markdownToHtml('[点我](javascript:alert(1))')).toBe('<p>点我</p>');
    // Incomplete syntax stays literal instead of half-parsing.
    expect(markdownToHtml('[未闭合](https://ex.com')).toBe('<p>[未闭合](https://ex.com</p>');
  });

  it('honours backslash escapes instead of re-parsing them as syntax', () => {
    expect(markdownToHtml('\\*不是斜体\\*')).toBe('<p>*不是斜体*</p>');
    expect(markdownToHtml('\\# 不是标题')).toBe('<p># 不是标题</p>');
  });
});

describe('parseMarkdown', () => {
  it('tokenises blocks with semantic, unescaped text', () => {
    expect(parseMarkdown('# 标题')).toEqual([{ kind: 'heading', level: 1, inline: [{ kind: 'text', text: '标题' }] }]);
    expect(parseMarkdown('```\na\nb\n```')).toEqual([{ kind: 'code', code: 'a\nb' }]);
    expect(parseMarkdown('\\*x\\*')).toEqual([{ kind: 'paragraph', inline: [{ kind: 'text', text: '*x*' }] }]);
    expect(parseMarkdown('![图](attachment:a.png)')).toEqual([
      { kind: 'paragraph', inline: [{ kind: 'image', alt: '图', url: 'attachment:a.png' }] }
    ]);
    expect(parseMarkdown('')).toEqual([]);
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

  it('leaves legacy plain text untouched, which is why Markdown needs no migration', () => {
    expect(markdownToPlainText('买牛奶')).toBe('买牛奶');
    expect(markdownToHtml('买牛奶')).toBe('<p>买牛奶</p>');
    expect(markdownToPlainText('第一行\n第二行')).toBe('第一行\n第二行');
  });
});
