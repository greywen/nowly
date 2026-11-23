import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { convertContent, printDocument } from './content';

const delta = (ops: unknown[]) => JSON.stringify({ v: 1, ops });
// Quill's code serializer reads innerText, which jsdom does not implement.
const innerText = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText');
beforeAll(() => Object.defineProperty(HTMLElement.prototype, 'innerText', {
  configurable: true, get() { return this.textContent; }, set(value) { this.textContent = value; }
}));
afterAll(() => {
  if (innerText) Object.defineProperty(HTMLElement.prototype, 'innerText', innerText);
  else Reflect.deleteProperty(HTMLElement.prototype, 'innerText');
});

describe('note export content', () => {
  it('converts legacy Markdown without exporting the envelope', async () => {
    const result = await convertContent('# 中文标题\n\n**重点**和[官网](https://example.com)');
    expect(result.markdown).toContain('# 中文标题');
    expect(result.markdown).toContain('**重点**');
    expect(result.html).toContain('<h1>');
    expect(result.html).not.toContain('"ops"');
  });

  it('preserves headings, lists, checked tasks, nested items and code', async () => {
    const result = await convertContent(delta([
      { insert: '标题' }, { insert: '\n', attributes: { header: 2 } },
      { insert: '完成' }, { insert: '\n', attributes: { list: 'checked' } },
      { insert: '待办' }, { insert: '\n', attributes: { list: 'unchecked' } },
      { insert: '嵌套' }, { insert: '\n', attributes: { list: 'bullet', indent: 1 } },
      { insert: 'const a = 1;' }, { insert: '\n', attributes: { 'code-block': 'plain' } },
      { insert: 'const b = 2;' }, { insert: '\n', attributes: { 'code-block': 'plain' } }
    ]));
    expect(result.markdown).toContain('## 标题');
    expect(result.markdown).toMatch(/- \[x\] 完成/);
    expect(result.markdown).toMatch(/- \[ \] 待办/);
    expect(result.markdown).toContain('嵌套');
    expect(result.markdown, result.html).toContain('```\nconst a = 1;\nconst b = 2;\n```');
  });

  it('preserves table cells and inline formatting, and retains formula source', async () => {
    const result = await convertContent(delta([
      { insert: '名称', attributes: { bold: true } }, { insert: '\n', attributes: { table: 'r1' } },
      { insert: '数量' }, { insert: '\n', attributes: { table: 'r1' } },
      { insert: '苹果' }, { insert: '\n', attributes: { table: 'r2' } },
      { insert: '3' }, { insert: '\n', attributes: { table: 'r2' } },
      { insert: { formula: 'x^2 + y^2' } }, { insert: '\n' }
    ]));
    expect(result.html).toContain('<table');
    expect(result.html).not.toContain('<th>');
    expect(result.markdown).toContain('苹果');
    expect(result.markdown).toContain('数量');
    expect(result.markdown).toContain('x^2 + y^2');
  });

  it('retains the selected language on Markdown code fences', async () => {
    const result = await convertContent(delta([
      { insert: 'const answer = 42;' },
      { insert: '\n', attributes: { 'code-block': 'typescript' } }
    ]));
    expect(result.markdown).toContain('```typescript\nconst answer = 42;\n```');
  });

  it('preserves nested checklist indentation in Markdown', async () => {
    const result = await convertContent(delta([
      { insert: '父项' }, { insert: '\n', attributes: { list: 'unchecked' } },
      { insert: '子项' }, { insert: '\n', attributes: { list: 'checked', indent: 1 } },
      { insert: '孙项' }, { insert: '\n', attributes: { list: 'unchecked', indent: 2 } },
      { insert: '同级' }, { insert: '\n', attributes: { list: 'unchecked' } }
    ]));
    expect(result.markdown).toMatch(/^- \[ \] 父项\n +\- \[x\] 子项\n {4,}\- \[ \] 孙项\n- \[ \] 同级\n$/);
  });

  it('escapes table-cell pipes without creating extra Markdown columns', async () => {
    const result = await convertContent(delta([
      { insert: 'A|B' }, { insert: '\n', attributes: { table: 'r1' } },
      { insert: 'C' }, { insert: '\n', attributes: { table: 'r1' } },
      { insert: 'x|y', attributes: { code: true } }, { insert: '\n', attributes: { table: 'r2' } },
      { insert: 'z' }, { insert: '\n', attributes: { table: 'r2' } },
      { insert: { formula: '|x|' } }, { insert: '\n', attributes: { table: 'r3' } },
      { insert: '绝对值' }, { insert: '\n', attributes: { table: 'r3' } }
    ]));
    expect(result.markdown).toContain('| A\\|B | C |');
    expect(result.markdown).toContain('| `x\\|y` | z |');
    expect(result.markdown).toContain('| $\\|x\\|$ | 绝对值 |');
  });

  it('remaps attachments, escapes literal HTML, and removes dangerous URLs', async () => {
    const result = await convertContent(delta([
      { insert: '<script>alert(1)</script>' },
      { insert: '链接', attributes: { link: 'javascript:alert(1)' } },
      { insert: { image: 'attachment:abc' }, attributes: { alt: '图片' } },
      { insert: '\n' }
    ]), url => url === 'attachment:abc' ? 'assets/image.png' : url);
    expect(result.html).not.toContain('<script');
    expect(result.html).not.toContain('javascript:');
    expect(result.markdown).toContain('![图片](assets/image.png)');
    expect(result.html).not.toContain('attachment:');
  });

  it('keeps external images and videos as links without network embeds', async () => {
    const result = await convertContent(delta([
      { insert: { image: 'https://example.com/a.png' }, attributes: { alt: '远程图' } },
      { insert: { video: 'https://example.com/v' } }, { insert: '\n' }
    ]));
    expect(result.html).not.toMatch(/<(img|iframe)/);
    expect(result.html).toContain('https://example.com/a.png');
    expect(result.html).toContain('https://example.com/v');
  });

  it('includes print pagination and escaped document metadata', () => {
    const html = printDocument('<p>中文</p>', '<img src=x>', 'zh-CN');
    expect(html).toContain('&lt;img src=x&gt;');
    expect(html).toContain('@page');
    expect(html).toContain('overflow-wrap');
    expect(html).not.toContain('src=x>');
  });
});
