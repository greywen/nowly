import { render, screen } from '@testing-library/react';
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
  it('switches between the list and sticky-board views', () => {
    const onSetView = vi.fn();
    const {rerender}=render(<NotesWidget notes={sampleNotes} status="ready" view="list" onSetView={onSetView} {...props} />);
    expect(screen.getByRole('button',{name:'列表视图'})).toHaveAttribute('aria-pressed','true');
    const boardButton = screen.getByRole('button',{name:'便利贴视图'});
    expect(boardButton).toHaveAttribute('aria-pressed','false');
    expect(screen.getByTestId('notes-list')).toBeInTheDocument();

    boardButton.click();
    expect(onSetView).toHaveBeenCalledWith('board');

    rerender(<NotesWidget notes={sampleNotes} status="ready" view="board" onSetView={onSetView} {...props} />);
    expect(screen.getByTestId('notes-board')).toBeInTheDocument();
    expect(screen.queryByTestId('notes-list')).not.toBeInTheDocument();
    expect(screen.getByRole('button',{name:'便利贴视图'})).toHaveAttribute('aria-pressed','true');
    expect(screen.getByText('产品原则')).toBeInTheDocument();
  });
  it('hides the view switch when the host does not support switching', () => {
    render(<NotesWidget notes={sampleNotes} status="ready" {...props} />);
    expect(screen.queryByRole('button',{name:'便利贴视图'})).not.toBeInTheDocument();
  });
});
