import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NotesWidget } from './NotesWidget';
import { sampleNotes } from '../lib/sample-data';

describe('NotesWidget', () => {
  it('renders notes in an internal scroll container', () => {
    render(<NotesWidget notes={sampleNotes} onOpenNote={vi.fn()} />);

    expect(screen.getByText('便签')).toBeInTheDocument();
    expect(screen.getByText('产品原则')).toBeInTheDocument();
    expect(screen.getByTestId('notes-scroll')).toHaveClass('overflow-auto');
  });
});
