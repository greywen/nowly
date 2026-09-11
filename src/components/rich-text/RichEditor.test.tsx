import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { RepositoryProvider } from '../../data/RepositoryContext';
import type { NowlyRepository } from '../../data/nowly-repository';
import type { Attachment } from '../../lib/attachment';
import type { DeltaOp } from './delta';
import { RichEditor } from './RichEditor';

const IMAGE_ID = '0123456789abcdef0123456789abcdef.png';
const FILE_ID = 'fedcba9876543210fedcba9876543210.pdf';

/** Build stored content the way serializeContent does. */
const envelope = (ops: DeltaOp[]) => JSON.stringify({ v: 1, ops });

function attachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: IMAGE_ID,
    fileName: '报告.png',
    relPath: `attachments/${IMAGE_ID}`,
    byteSize: 2048,
    mime: 'image/png',
    createdAt: '2026-07-20T00:00:00.000Z',
    ...overrides
  };
}

function repository(overrides: Partial<NowlyRepository> = {}) {
  return {
    saveAttachment: vi.fn().mockResolvedValue(attachment()),
    readAttachment: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    listAttachments: vi.fn().mockResolvedValue([attachment()]),
    ...overrides
  } as unknown as NowlyRepository;
}

function renderEditor(
  props: Partial<React.ComponentProps<typeof RichEditor>> = {},
  repo: NowlyRepository = repository()
) {
  const onChange = props.onChange ?? vi.fn();
  const result = render(
    <RepositoryProvider repository={repo}>
      <label id="editor-label">备注</label>
      <RichEditor id="editor" labelledBy="editor-label" value="" onChange={onChange} {...props} />
    </RepositoryProvider>
  );
  return { ...result, onChange };
}

/** Controlled host mirroring how the dialogs use the editor. */
function ControlledEditor({ initial, onEmit }: { initial: string; onEmit?(content: string): void }) {
  const [value, setValue] = useState(initial);
  return (
    <RepositoryProvider repository={repository()}>
      <label id="editor-label">备注</label>
      <RichEditor
        id="editor"
        labelledBy="editor-label"
        value={value}
        onChange={(content) => {
          setValue(content);
          onEmit?.(content);
        }}
      />
      <output data-testid="stored">{value}</output>
    </RepositoryProvider>
  );
}

/**
 * Wait for the editing surface.
 *
 * Construction is deferred until KaTeX and highlight.js have loaded, so nothing
 * Quill owns exists on the first paint.
 */
async function editorSurface(): Promise<HTMLElement> {
  return waitFor(() => {
    const node = document.querySelector('.ql-editor');
    if (!node) throw new Error('editor surface not found');
    return node as HTMLElement;
  });
}

describe('RichEditor', () => {
  it('shows a placeholder until the lazy dependencies arrive', async () => {
    renderEditor();
    // KaTeX must exist before Quill is constructed, so there is a real gap.
    expect(screen.getByText('正在加载编辑器…')).toBeInTheDocument();
    await editorSurface();
    expect(screen.queryByText('正在加载编辑器…')).not.toBeInTheDocument();
  });

  it('renders a control for every format it accepts', async () => {
    const { container } = renderEditor();
    await editorSurface();
    for (const control of [
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
    ]) {
      expect(container.querySelector(`.ql-toolbar button.${control}`), control).not.toBeNull();
    }
    for (const picker of ['.ql-header', '.ql-font', '.ql-size', '.ql-color', '.ql-background', '.ql-align']) {
      expect(container.querySelector(`.ql-toolbar ${picker}`), picker).not.toBeNull();
    }
  });

  it('gives every control a localised accessible name', async () => {
    // Quill labels its own buttons with the English format name, which a zh-CN
    // screen reader user would hear for the entire toolbar.
    const { container } = renderEditor();
    await editorSurface();
    expect(container.querySelector('button.ql-bold')).toHaveAttribute('aria-label', '粗体');
    expect(container.querySelector('button.ql-formula')).toHaveAttribute('aria-label', '公式');
    expect(container.querySelector('button.ql-list[value="check"]')).toHaveAttribute('aria-label', '任务列表');
    expect(container.querySelector('.ql-toolbar')).toHaveAttribute('aria-label', '格式工具栏');
  });

  it('offers only design system values in its colour, size and font pickers', async () => {
    // design.md §2 forbids near-miss colours and §3.3 forbids absolute px, so
    // Quill's stock palettes and small/large/huge sizes are replaced.
    const { container } = renderEditor();
    await editorSurface();

    const sizes = Array.from(container.querySelectorAll('.ql-size .ql-picker-item')).map(
      (node) => node.getAttribute('data-value')
    );
    expect(sizes).toEqual(['0.85rem', '0.95rem', null, '1.075rem', '1.75rem']);

    const fonts = Array.from(container.querySelectorAll('.ql-font .ql-picker-item')).map(
      (node) => node.getAttribute('data-value')
    );
    expect(fonts).toEqual([null, 'mono']);

    const colours = Array.from(container.querySelectorAll('.ql-color .ql-picker-item')).map(
      (node) => node.getAttribute('data-value')
    );
    expect(colours).toContain('#4fc9da');
    expect(colours).not.toContain('#e60000'); // one of Quill's stock reds
    // Every swatch has to be a token from design.md's palette.
    for (const value of colours) expect(value).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('labels picker options through the mechanism snow supports', async () => {
    // snow.css hardcodes English per value but reads `attr(data-label)` at higher
    // specificity, so setting that attribute is the supported relabelling route.
    const { container } = renderEditor();
    await editorSurface();
    const item = container.querySelector('.ql-header .ql-picker-item[data-value="1"]');
    expect(item).toHaveAttribute('data-label', '标题 1');
  });

  it('localises the collapsed picker labels at first paint', async () => {
    // `picker.js` only copies an item's data-label onto the collapsed label inside
    // `selectItem`, which Quill last ran during construction — before our labels
    // existed. Without seeding, all three read snow.css's English until the user
    // picks something, and two of them read the same word.
    const { container } = renderEditor();
    await editorSurface();
    expect(container.querySelector('.ql-size .ql-picker-label')).toHaveAttribute('data-label', '默认');
    expect(container.querySelector('.ql-font .ql-picker-label')).toHaveAttribute('data-label', '无衬线');
    expect(container.querySelector('.ql-header .ql-picker-label')).toHaveAttribute('data-label', '正文');
  });

  it('is reachable by its label and announced as multiline', async () => {
    renderEditor();
    const surface = await screen.findByLabelText('备注');
    expect(surface).toHaveAttribute('aria-multiline', 'true');
    expect(surface).toHaveAttribute('contenteditable', 'true');
  });

  it('renders stored content as formatted output', async () => {
    renderEditor({
      value: envelope([
        { insert: '标题' },
        { insert: '\n', attributes: { header: 1 } },
        { insert: '粗体', attributes: { bold: true } },
        { insert: '\n' },
        { insert: '删除', attributes: { strike: true } },
        { insert: '\n' },
        { insert: '引用' },
        { insert: '\n', attributes: { blockquote: true } }
      ])
    });
    const surface = await editorSurface();
    await waitFor(() => expect(surface.querySelector('h1')?.textContent).toBe('标题'));
    expect(surface.querySelector('strong')?.textContent).toBe('粗体');
    expect(surface.querySelector('s')?.textContent).toBe('删除');
    expect(surface.querySelector('blockquote')?.textContent).toBe('引用');
  });

  it('still opens content written before Delta storage', async () => {
    // Every note predating this format is plain text or Markdown; there is no
    // migration step, so the editor has to read it directly.
    renderEditor({ value: '# 标题\n\n**粗体**' });
    const surface = await editorSurface();
    await waitFor(() => expect(surface.querySelector('h1')?.textContent).toBe('标题'));
    expect(surface.querySelector('strong')?.textContent).toBe('粗体');
  });

  it('does not emit on load, so a dialog never opens pre-dirtied', async () => {
    // Loading legacy content normalises it (a soft break becomes a paragraph
    // break). If that were reported as a change, every dialog would prompt to
    // discard on close without the user having typed anything.
    const { onChange } = renderEditor({ value: '一行\n二行' });
    await editorSurface();
    await waitFor(() => expect(document.querySelector('.ql-editor p')).not.toBeNull());
    expect(onChange).not.toHaveBeenCalled();
  });

  it('stores a Delta envelope when the user edits', async () => {
    const user = userEvent.setup();
    const onEmit = vi.fn();
    render(<ControlledEditor initial="" onEmit={onEmit} />);
    const surface = await editorSurface();
    await user.click(surface);
    await user.type(surface, '买牛奶');
    await waitFor(() => expect(onEmit).toHaveBeenCalled());

    const stored = screen.getByTestId('stored').textContent ?? '';
    expect(JSON.parse(stored)).toMatchObject({ v: 1 });
    expect(JSON.parse(stored).ops[0].insert).toContain('买牛奶');
  });

  it('stores the empty string for an empty document', async () => {
    // Drafts start at '' and dirty checks stringify the whole form, so an
    // envelope holding a lone newline would make every dialog open dirty.
    const user = userEvent.setup();
    const onEmit = vi.fn();
    render(<ControlledEditor initial="" onEmit={onEmit} />);
    const surface = await editorSurface();
    await user.click(surface);
    await user.type(surface, 'x');
    await waitFor(() => expect(onEmit).toHaveBeenCalled());
    await user.clear(surface);
    await waitFor(() => expect(screen.getByTestId('stored').textContent).toBe(''));
  });

  it('resolves attachment references to displayable blob URLs', async () => {
    // Stored content holds `attachment:<id>`, which no webview can render, so
    // the editor swaps in a session blob URL for display.
    renderEditor({ value: envelope([{ insert: { image: `attachment:${IMAGE_ID}` }, attributes: { alt: '报告' } }, { insert: '\n' }]) });
    const surface = await editorSurface();
    await waitFor(() => {
      expect(surface.querySelector('img')?.getAttribute('src')).toMatch(/^blob:/);
    });
    expect(surface.querySelector('img')?.getAttribute('alt')).toBe('报告');
  });

  it('lists referenced attachments with name and size', async () => {
    renderEditor({ value: envelope([{ insert: { image: `attachment:${IMAGE_ID}` } }, { insert: '\n' }]) });
    expect(await screen.findByText('报告.png')).toBeInTheDocument();
    expect(screen.getByText('2 KB')).toBeInTheDocument();
  });

  it('uploads a chosen file and references it durably', async () => {
    const user = userEvent.setup();
    const onEmit = vi.fn();
    render(<ControlledEditor initial="" onEmit={onEmit} />);
    await editorSurface();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File([new Uint8Array([1, 2, 3])], '报告.png', { type: 'image/png' }));

    await waitFor(() => expect(onEmit).toHaveBeenCalled());
    // The stored content must carry the durable `attachment:` reference, not the
    // session blob URL, which dies with the window.
    const stored = screen.getByTestId('stored').textContent ?? '';
    expect(stored).toContain(`attachment:${IMAGE_ID}`);
    expect(stored).not.toContain('blob:');
  });

  it('reports an upload failure without inserting anything', async () => {
    const user = userEvent.setup();
    const repo = repository({
      saveAttachment: vi.fn().mockRejectedValue({
        code: 'validation_error',
        field: 'file',
        message: '文件超过 1 MB 上限，请压缩后重试。'
      })
    });
    const { onChange } = renderEditor({}, repo);
    await editorSurface();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(['x'], 'big.png', { type: 'image/png' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('文件超过 1 MB 上限');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('removes an attachment reference from the content', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderEditor({
      value: envelope([{ insert: '甲' }, { insert: { image: `attachment:${IMAGE_ID}` } }, { insert: '\n' }]),
      onChange
    });
    await editorSurface();
    await user.click(await screen.findByRole('button', { name: '移除附件“报告.png”' }));
    // Only the reference goes; the file itself is reclaimed on the next launch,
    // so cancelling the dialog cannot orphan anything.
    const stored = onChange.mock.calls[0][0] as string;
    expect(stored).not.toContain('attachment:');
    expect(stored).toContain('甲');
  });

  it('shows non-image attachments in the strip', async () => {
    const repo = repository({
      listAttachments: vi
        .fn()
        .mockResolvedValue([
          attachment({ id: FILE_ID, fileName: '合同.pdf', mime: 'application/pdf', byteSize: 512 })
        ])
    });
    renderEditor(
      { value: envelope([{ insert: '合同.pdf', attributes: { link: `attachment:${FILE_ID}` } }, { insert: '\n' }]) },
      repo
    );
    expect(await screen.findByText('合同.pdf')).toBeInTheDocument();
    expect(screen.getByText('512 B')).toBeInTheDocument();
  });

  it('hides the attach action when the backend cannot store attachments', async () => {
    // Lightweight repositories omit the attachment methods; the editor must stay
    // usable as a text-only field rather than offering a broken button.
    renderEditor({}, {} as NowlyRepository);
    await editorSurface();
    expect(screen.queryByRole('button', { name: '添加附件' })).not.toBeInTheDocument();
  });

  it('disables editing and the attachment actions when disabled', async () => {
    renderEditor({
      value: envelope([{ insert: { image: `attachment:${IMAGE_ID}` } }, { insert: '\n' }]),
      disabled: true
    });
    const surface = await editorSurface();
    await waitFor(() => expect(surface).toHaveAttribute('contenteditable', 'false'));
    expect(screen.getByRole('button', { name: '添加附件' })).toBeDisabled();
    expect(await screen.findByRole('button', { name: '移除附件“报告.png”' })).toBeDisabled();
  });

  it('shows table controls only while the caret sits inside a table', async () => {
    // Quill ships the table model but no UI for it, so this bar is ours.
    const user = userEvent.setup();
    render(<ControlledEditor initial="" />);
    const surface = await editorSurface();
    expect(screen.queryByRole('group', { name: '表格操作' })).not.toBeInTheDocument();

    await user.click(surface);
    await user.click(document.querySelector('button.ql-table') as HTMLElement);
    expect(await screen.findByRole('group', { name: '表格操作' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '在上方插入行' })).toBeInTheDocument();
    expect(surface.querySelector('table')).not.toBeNull();
  });
});
