import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NotesWidget } from './NotesWidget';
import { sampleNotes } from '../lib/sample-data';

const props = { onRetry:vi.fn(), onCreateNote:vi.fn(), onOpenNote:vi.fn(), onViewAll:vi.fn() };
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
});
