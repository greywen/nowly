import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ModalRoot } from './ModalRoot';
import { sampleEvents, sampleNotes, sampleTasks } from '../lib/sample-data';

describe('ModalRoot', () => {
  it('renders event modal when modal state is event', () => {
    render(<ModalRoot modal={{ type: 'event', event: sampleEvents[0] }} onClose={vi.fn()} />);
    expect(screen.getByText('日程编辑')).toBeInTheDocument();
    expect(screen.getByDisplayValue('站会')).toBeInTheDocument();
  });

  it('renders task modal when modal state is task', () => {
    render(<ModalRoot modal={{ type: 'task', task: sampleTasks[0] }} onClose={vi.fn()} />);
    expect(screen.getByText('任务编辑')).toBeInTheDocument();
    expect(screen.getByDisplayValue('发布 v0.1')).toBeInTheDocument();
  });

  it('renders note modal when modal state is note', () => {
    render(<ModalRoot modal={{ type: 'note', note: sampleNotes[0] }} onClose={vi.fn()} />);
    expect(screen.getByText('便签编辑')).toBeInTheDocument();
    expect(screen.getByDisplayValue('产品原则')).toBeInTheDocument();
  });
});
