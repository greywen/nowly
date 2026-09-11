import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RepositoryProvider } from '../data/RepositoryContext';
import type { NowlyRepository } from '../data/nowly-repository';
import { NotesWidget } from './NotesWidget';
import { sampleNotes } from '../lib/sample-data';

const props = { onRetry:vi.fn(), onCreateNote:vi.fn(), onOpenNote:vi.fn(), onViewAll:vi.fn() };

const IMAGE_ID = '0123456789abcdef0123456789abcdef.png';
const FILE_ID = 'fedcba9876543210fedcba9876543210.pdf';

/** Stored content the way serializeContent writes it. */
function content(ops: unknown[]): string {
  return JSON.stringify({ v: 1, ops });
}

function attachmentRepository(): NowlyRepository {
  return {
    saveAttachment: vi.fn(),
    listAttachments: vi.fn().mockImplementation((ids: string[]) =>
      Promise.resolve(
        ids.map((id) => ({
          id,
          fileName: id.endsWith('.png') ? '图.png' : '报告.pdf',
          relPath: `attachments/${id}`,
          byteSize: 3,
          mime: id.endsWith('.png') ? 'image/png' : 'application/pdf',
          createdAt: 'x'
        }))
      )
    ),
    readAttachment: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]))
  } as unknown as NowlyRepository;
}

function renderWithAttachments(notes: typeof sampleNotes, view: 'board' | 'list', repo = attachmentRepository()) {
  const result = render(
    <RepositoryProvider repository={repo}>
      <NotesWidget notes={notes} status="ready" view={view} {...props} />
    </RepositoryProvider>
  );
  return { ...result, repo };
}

describe('NotesWidget', () => {
  it('renders summaries in an internal scroll container with all-notes action', () => {
    render(<NotesWidget notes={sampleNotes} status="ready" {...props} />);
    expect(screen.getByText('产品原则')).toBeInTheDocument();
    expect(screen.getByTestId('notes-scroll')).toBeInTheDocument();
    expect(screen.getByRole('button', {name:'查看全部便签'})).toBeInTheDocument();
  });
  it('shows empty, error retry, and static loading states', () => {
    const {rerender}=render(<NotesWidget notes={[]} status="ready" {...props} />);
    expect(screen.getByText('还没有便签')).toBeInTheDocument();
    rerender(<NotesWidget notes={[]} status="error" errorMessage="便签读取失败" {...props} />);
    screen.getByRole('button',{name:'重试读取便签'}).click();
    expect(screen.getByRole('alert')).toHaveTextContent('便签读取失败');
    rerender(<NotesWidget notes={[]} status="loading" {...props} />);
    expect(screen.getByText('正在读取本地便签')).toBeInTheDocument();
  });
  it('switches between the list and sticky-board views through the settings dialog', async () => {
    const user = userEvent.setup();
    const onSetView = vi.fn();
    const {rerender}=render(<NotesWidget notes={sampleNotes} status="ready" view="list" onSetView={onSetView} {...props} />);
    expect(screen.getByTestId('notes-list')).toBeInTheDocument();
    // The layout choice lives behind the settings gear, not inline toolbar icons.
    expect(screen.queryByRole('radio',{name:'便利贴视图'})).not.toBeInTheDocument();

    await user.click(screen.getByRole('button',{name:'便签显示设置'}));
    expect(screen.getByRole('dialog',{name:'便签设置'})).toBeInTheDocument();
    expect(screen.getByRole('radio',{name:'列表视图'})).toHaveAttribute('aria-checked','true');
    const boardOption = screen.getByRole('radio',{name:'便利贴视图'});
    expect(boardOption).toHaveAttribute('aria-checked','false');

    await user.click(boardOption);
    expect(onSetView).toHaveBeenCalledWith('board');

    rerender(<NotesWidget notes={sampleNotes} status="ready" view="board" onSetView={onSetView} {...props} />);
    expect(screen.getByTestId('notes-board')).toBeInTheDocument();
    expect(screen.queryByTestId('notes-list')).not.toBeInTheDocument();
    expect(screen.getByText('产品原则')).toBeInTheDocument();
    expect(screen.getByText('⭐')).toBeInTheDocument();
    expect(screen.getByRole('button',{name:/产品原则/})).toHaveClass('sticky-note--style-2');
  });
  it('pins board icons to a stable edge anchor for each note style', () => {
    const notes = Array.from({length:9},(_,styleVariant)=>({
      ...sampleNotes[0], id:`note-${styleVariant}`, title:`便签 ${styleVariant}`,
      styleVariant, icon:'star' as const
    }));
    render(<NotesWidget notes={notes} status="ready" view="board" {...props} />);

    expect(screen.getAllByText('⭐').map(icon=>icon.className)).toEqual([
      'sticky-note__icon sticky-note__icon--left-center',
      'sticky-note__icon sticky-note__icon--bottom-right',
      'sticky-note__icon sticky-note__icon--right-top',
      'sticky-note__icon sticky-note__icon--top-right',
      'sticky-note__icon sticky-note__icon--left-center',
      'sticky-note__icon sticky-note__icon--right-top',
      'sticky-note__icon sticky-note__icon--right-bottom',
      'sticky-note__icon sticky-note__icon--top-left',
      'sticky-note__icon sticky-note__icon--bottom-right'
    ]);

    expect(screen.getByRole('button',{name:/便签 0/}).querySelector('.sticky-note__tape')).not.toBeInTheDocument();
  });
  it('keeps the tape when a board note has no icon', () => {
    render(<NotesWidget notes={[{...sampleNotes[0],icon:''}]} status="ready" view="board" {...props} />);
    expect(screen.getByRole('button',{name:/产品原则/}).querySelector('.sticky-note__tape')).toBeInTheDocument();
  });
  it('keeps board notes static and free of folded corners', () => {
    const notes = Array.from({length:9},(_,styleVariant)=>(
      {...sampleNotes[0],id:`style-${styleVariant}`,title:`样式 ${styleVariant}`,styleVariant}
    ));
    render(<NotesWidget notes={notes} status="ready" view="board" {...props} />);

    expect(screen.getAllByRole('button',{name:/样式/}).every(note=>!note.classList.contains('sticky-note--floating'))).toBe(true);
    expect(document.querySelectorAll('.sticky-note__fold')).toHaveLength(0);
  });
  it('hides the settings gear when the host does not support switching', () => {
    render(<NotesWidget notes={sampleNotes} status="ready" {...props} />);
    expect(screen.queryByRole('button',{name:'便签显示设置'})).not.toBeInTheDocument();
  });
  it('shows the note count in the header', () => {
    render(<NotesWidget notes={sampleNotes} status="ready" {...props} />);
    expect(screen.getByText(`${sampleNotes.length} 条便签`)).toBeInTheDocument();
  });

  it('shows an image thumbnail and an attachment count on a board note', async () => {
    const note = {
      ...sampleNotes[0],
      content: content([
        { insert: '见下图：' },
        { insert: { image: `attachment:${IMAGE_ID}` }, attributes: { alt: '图.png' } },
        { insert: '报告', attributes: { link: `attachment:${FILE_ID}` } },
        { insert: '\n' }
      ])
    };
    const { repo } = renderWithAttachments([note], 'board');

    // Both the image and the file are counted, but only the image is fetched:
    // reading a file's bytes would build an object URL nothing ever renders.
    expect(await screen.findByLabelText('2 个附件')).toHaveTextContent('2');
    await waitFor(() => expect(document.querySelector('.sticky-note__thumb')).toBeInTheDocument());
    expect(document.querySelector<HTMLImageElement>('.sticky-note__thumb')!.src).toMatch(/^blob:/);
    expect(repo.listAttachments).toHaveBeenCalledWith([IMAGE_ID]);
    expect(repo.readAttachment).toHaveBeenCalledTimes(1);
  });

  it('shows the thumbnail beside the text in list view', async () => {
    const note = {
      ...sampleNotes[0],
      content: content([{ insert: { image: `attachment:${IMAGE_ID}` } }, { insert: '说明\n' }])
    };
    renderWithAttachments([note], 'list');
    await waitFor(() => expect(document.querySelector('.note-thumb')).toBeInTheDocument());
    expect(await screen.findByLabelText('1 个附件')).toBeInTheDocument();
  });

  it('counts a file-only note but renders no thumbnail', async () => {
    const note = {
      ...sampleNotes[0],
      content: content([{ insert: '报告', attributes: { link: `attachment:${FILE_ID}` } }, { insert: '\n' }])
    };
    const { repo } = renderWithAttachments([note], 'board');
    expect(await screen.findByLabelText('1 个附件')).toBeInTheDocument();
    expect(document.querySelector('.sticky-note__thumb')).toBeNull();
    // Nothing to show, so nothing is read from disk.
    expect(repo.listAttachments).not.toHaveBeenCalled();
  });

  it('adds no paperclip and reads nothing for a plain note', () => {
    const { repo } = renderWithAttachments([{ ...sampleNotes[0], content: '只有文字' }], 'board');
    expect(document.querySelector('.sticky-note__clip')).toBeNull();
    expect(document.querySelector('.sticky-note__thumb')).toBeNull();
    expect(repo.listAttachments).not.toHaveBeenCalled();
  });
});
