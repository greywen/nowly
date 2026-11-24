import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { convertContent } from './content';

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
  it('converts legacy Markdown without exporting the envelope', () => {
    const markdown = convertContent('# 中文标题\n\n**重点**和[官网](https://example.com)');
    expect(markdown).toContain('# 中文标题');
    expect(markdown).toContain('**重点**');
    expect(markdown).toContain('[官网](https://example.com/)');
    expect(markdown).not.toContain('"ops"');
  });

  it('preserves headings, lists, checked tasks, nested items and code', () => {
    const markdown = convertContent(delta([
      { insert: '标题' }, { insert: '\n', attributes: { header: 2 } },
      { insert: '完成' }, { insert: '\n', attributes: { list: 'checked' } },
      { insert: '待办' }, { insert: '\n', attributes: { list: 'unchecked' } },
      { insert: '嵌套' }, { insert: '\n', attributes: { list: 'bullet', indent: 1 } },
      { insert: 'const a = 1;' }, { insert: '\n', attributes: { 'code-block': 'plain' } },
      { insert: 'const b = 2;' }, { insert: '\n', attributes: { 'code-block': 'plain' } }
    ]));
    expect(markdown).toContain('## 标题');
    expect(markdown).toMatch(/- \[x\] 完成/);
    expect(markdown).toMatch(/- \[ \] 待办/);
    expect(markdown).toContain('嵌套');
    expect(markdown).toContain('```\nconst a = 1;\nconst b = 2;\n```');
  });

  it('preserves table cells and inline formatting, and retains formula source', () => {
    const markdown = convertContent(delta([
      { insert: '名称', attributes: { bold: true } }, { insert: '\n', attributes: { table: 'r1' } },
      { insert: '数量' }, { insert: '\n', attributes: { table: 'r1' } },
      { insert: '苹果' }, { insert: '\n', attributes: { table: 'r2' } },
      { insert: '3' }, { insert: '\n', attributes: { table: 'r2' } },
      { insert: { formula: 'x^2 + y^2' } }, { insert: '\n' }
    ]));
    expect(markdown).toContain('| **名称** | 数量 |');
    expect(markdown).toContain('| 苹果 | 3 |');
    expect(markdown).toContain('$x^2 + y^2$');
  });

  it('retains the selected language on Markdown code fences', () => {
    const markdown = convertContent(delta([
      { insert: 'const answer = 42;' },
      { insert: '\n', attributes: { 'code-block': 'typescript' } }
    ]));
    expect(markdown).toContain('```typescript\nconst answer = 42;\n```');
  });

  it('preserves nested checklist indentation in Markdown', () => {
    const markdown = convertContent(delta([
      { insert: '父项' }, { insert: '\n', attributes: { list: 'unchecked' } },
      { insert: '子项' }, { insert: '\n', attributes: { list: 'checked', indent: 1 } },
      { insert: '孙项' }, { insert: '\n', attributes: { list: 'unchecked', indent: 2 } },
      { insert: '同级' }, { insert: '\n', attributes: { list: 'unchecked' } }
    ]));
    expect(markdown).toMatch(/^- \[ \] 父项\n +\- \[x\] 子项\n {4,}\- \[ \] 孙项\n- \[ \] 同级\n$/);
  });

  it('escapes table-cell pipes without creating extra Markdown columns', () => {
    const markdown = convertContent(delta([
      { insert: 'A|B' }, { insert: '\n', attributes: { table: 'r1' } },
      { insert: 'C' }, { insert: '\n', attributes: { table: 'r1' } },
      { insert: 'x|y', attributes: { code: true } }, { insert: '\n', attributes: { table: 'r2' } },
      { insert: 'z' }, { insert: '\n', attributes: { table: 'r2' } },
      { insert: { formula: '|x|' } }, { insert: '\n', attributes: { table: 'r3' } },
      { insert: '绝对值' }, { insert: '\n', attributes: { table: 'r3' } }
    ]));
    expect(markdown).toContain('| A\\|B | C |');
    expect(markdown).toContain('| `x\\|y` | z |');
    expect(markdown).toContain('| $\\|x\\|$ | 绝对值 |');
  });

  it('remaps image attachments and removes dangerous link URLs', () => {
    const markdown = convertContent(delta([
      { insert: '链接', attributes: { link: 'javascript:alert(1)' } },
      { insert: { image: 'attachment:abc' }, attributes: { alt: '图片' } },
      { insert: '\n' }
    ]), url => url === 'attachment:abc' ? 'assets/image.png' : url);
    expect(markdown).not.toContain('javascript:');
    expect(markdown).toContain('![图片](assets/image.png)');
    expect(markdown).not.toContain('attachment:');
  });

  it('keeps external images and videos as links without network embeds', () => {
    const markdown = convertContent(delta([
      { insert: { image: 'https://example.com/a.png' }, attributes: { alt: '远程图' } },
      { insert: { video: 'https://example.com/v' } }, { insert: '\n' }
    ]));
    expect(markdown).not.toMatch(/!\[|<(img|iframe)/);
    expect(markdown).toContain('[远程图](https://example.com/a.png)');
    expect(markdown).toContain('](https://example.com/v)');
  });
});
