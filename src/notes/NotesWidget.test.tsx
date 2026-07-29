import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NotesWidget } from './NotesWidget';
import { sampleNotes } from '../lib/sample-data';

describe('NotesWidget', () => {
  it('renders notes in an internal scroll container', () => {
    render(
      <NotesWidget
        notes={sampleNotes}
        status="ready"
        onRetry={vi.fn()}
        onCreateNote={vi.fn()}
        onOpenNote={vi.fn()}
      />
    );

    expect(screen.getByText('便签')).toBeInTheDocument();
    expect(screen.getByText('产品原则')).toBeInTheDocument();
    expect(screen.getByTestId('notes-scroll')).toBeInTheDocument();
  });

  it('shows a create action when empty and retries module errors', () => {
    const retry = vi.fn();
    const { rerender } = render(
      <NotesWidget
        notes={[]}
        status="ready"
        onRetry={retry}
        onCreateNote={vi.fn()}
        onOpenNote={vi.fn()}
      />
    );
    expect(screen.getByText('还没有便签')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新建便签' })).toBeInTheDocument();

    rerender(
      <NotesWidget
        notes={[]}
        status="error"
        errorMessage="便签读取失败"
        onRetry={retry}
        onCreateNote={vi.fn()}
        onOpenNote={vi.fn()}
      />
    );
    screen.getByRole('button', { name: '重试读取便签' }).click();
    expect(screen.getByRole('alert')).toHaveTextContent('便签读取失败');
    expect(retry).toHaveBeenCalledOnce();
  });

  it('shows a static loading message without spinners', () => {
    render(
      <NotesWidget
        notes={[]}
        status="loading"
        onRetry={vi.fn()}
        onCreateNote={vi.fn()}
        onOpenNote={vi.fn()}
      />
    );

    expect(screen.getByText('正在读取本地便签')).toBeInTheDocument();
  });
});
