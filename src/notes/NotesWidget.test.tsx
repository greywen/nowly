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
});
