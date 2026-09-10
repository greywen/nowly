import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { RepositoryProvider } from '../../data/RepositoryContext';
import type { NowlyRepository } from '../../data/nowly-repository';
import type { Attachment } from '../../lib/attachment';
import { RichEditor } from './RichEditor';

const IMAGE_ID = '0123456789abcdef0123456789abcdef.png';
const FILE_ID = 'fedcba9876543210fedcba9876543210.pdf';

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
function ControlledEditor({ initial, onEmit }: { initial: string; onEmit?(markdown: string): void }) {
  const [value, setValue] = useState(initial);
  return (
    <RepositoryProvider repository={repository()}>
      <label id="editor-label">备注</label>
      <RichEditor
        id="editor"
        labelledBy="editor-label"
        value={value}
        onChange={(markdown) => {
          setValue(markdown);
          onEmit?.(markdown);
        }}
      />
      <output data-testid="markdown">{value}</output>
    </RepositoryProvider>
  );
}

function editorSurface(): HTMLElement {
  const node = document.querySelector('.ql-editor');
  if (!node) throw new Error('editor surface not found');
  return node as HTMLElement;
}

describe('RichEditor', () => {
  it('renders the reference toolbar controls', () => {
    const { container } = renderEditor();
    for (const control of ['ql-bold', 'ql-italic', 'ql-underline', 'ql-image', 'ql-code-block']) {
      expect(container.querySelector(`.ql-toolbar button.${control}`)).not.toBeNull();
    }
    expect(container.querySelector('.ql-toolbar .ql-header')).not.toBeNull();
  });

  it('is reachable by its label and announced as multiline', () => {
    renderEditor();
    const surface = screen.getByLabelText('备注');
    expect(surface).toHaveAttribute('aria-multiline', 'true');
    expect(surface).toHaveAttribute('contenteditable', 'true');
  });

  it('renders stored Markdown as formatted content', () => {
    renderEditor({ value: '# 标题\n\n**粗体**\n\n```\ncode\n```' });
    const surface = editorSurface();
    expect(surface.querySelector('h1')?.textContent).toBe('标题');
    expect(surface.querySelector('strong')?.textContent).toBe('粗体');
    expect(surface.textContent).toContain('code');
  });

  it('does not emit on load, so a dialog never opens pre-dirtied', () => {
    // Loading normalises content (a soft break becomes a paragraph break). If
    // that were reported as a change, every dialog would prompt to discard on
    // close without the user having typed anything.
    const { onChange } = renderEditor({ value: '一行\n二行' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('emits Markdown when the user edits', async () => {
    const user = userEvent.setup();
    const onEmit = vi.fn();
    render(<ControlledEditor initial="" onEmit={onEmit} />);
    await user.click(editorSurface());
    await user.type(editorSurface(), '买牛奶');
    await waitFor(() => expect(onEmit).toHaveBeenCalled());
    expect(screen.getByTestId('markdown').textContent).toContain('买牛奶');
  });

  it('resolves attachment references to displayable blob URLs', async () => {
    // Stored Markdown holds `attachment:<id>`, which no webview can render, so
    // the editor swaps in a session blob URL for display.
    renderEditor({ value: `![报告](attachment:${IMAGE_ID})` });
    await waitFor(() => {
      const image = editorSurface().querySelector('img');
      expect(image?.getAttribute('src')).toMatch(/^blob:/);
    });
    expect(editorSurface().querySelector('img')?.getAttribute('alt')).toBe('报告');
  });

  it('lists referenced attachments with name and size', async () => {
    renderEditor({ value: `![报告](attachment:${IMAGE_ID})` });
    expect(await screen.findByText('报告.png')).toBeInTheDocument();
    expect(screen.getByText('2 KB')).toBeInTheDocument();
  });

  it('uploads a chosen file and references it from the Markdown', async () => {
    const user = userEvent.setup();
    const repo = repository();
    const onEmit = vi.fn();
    render(
      <RepositoryProvider repository={repo}>
        <ControlledEditor initial="" onEmit={onEmit} />
      </RepositoryProvider>
    );
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File([new Uint8Array([1, 2, 3])], '报告.png', { type: 'image/png' }));

    await waitFor(() => expect(onEmit).toHaveBeenCalled());
    // The emitted Markdown must carry the durable `attachment:` reference, not
    // the session blob URL.
    const markdown = screen.getByTestId('markdown').textContent ?? '';
    expect(markdown).toContain(`attachment:${IMAGE_ID}`);
    expect(markdown).not.toContain('blob:');
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
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(['x'], 'big.png', { type: 'image/png' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('文件超过 1 MB 上限');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('removes an attachment reference from the Markdown', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderEditor({ value: `甲\n\n![报告](attachment:${IMAGE_ID})`, onChange });
    await user.click(await screen.findByRole('button', { name: '移除附件“报告.png”' }));
    // Only the reference goes; the file itself is reclaimed later by the
    // backend, so cancelling the dialog cannot orphan anything.
    expect(onChange).toHaveBeenCalledWith('甲');
  });

  it('shows non-image attachments in the strip as links', async () => {
    const repo = repository({
      listAttachments: vi
        .fn()
        .mockResolvedValue([
          attachment({ id: FILE_ID, fileName: '合同.pdf', mime: 'application/pdf', byteSize: 512 })
        ])
    });
    renderEditor({ value: `[合同.pdf](attachment:${FILE_ID})` }, repo);
    expect(await screen.findByText('合同.pdf')).toBeInTheDocument();
    expect(screen.getByText('512 B')).toBeInTheDocument();
  });

  it('hides the attach action when the backend cannot store attachments', () => {
    // Lightweight repositories omit the attachment methods; the editor must stay
    // usable as a text-only field rather than offering a broken button.
    renderEditor({}, {} as NowlyRepository);
    expect(screen.queryByRole('button', { name: '添加附件' })).not.toBeInTheDocument();
  });

  it('disables editing and the attachment actions when disabled', async () => {
    renderEditor({ value: `![报告](attachment:${IMAGE_ID})`, disabled: true });
    expect(editorSurface()).toHaveAttribute('contenteditable', 'false');
    expect(screen.getByRole('button', { name: '添加附件' })).toBeDisabled();
    expect(await screen.findByRole('button', { name: '移除附件“报告.png”' })).toBeDisabled();
  });
});
