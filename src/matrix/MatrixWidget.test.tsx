import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MatrixWidget } from './MatrixWidget';
import { sampleTasks } from '../lib/sample-data';

describe('MatrixWidget', () => {
  it('renders all quadrants and uses internal scroll containers', () => {
    render(<MatrixWidget tasks={sampleTasks} onOpenTask={vi.fn()} />);

    expect(screen.getByText('重要且紧急')).toBeInTheDocument();
    expect(screen.getByText('重要不紧急')).toBeInTheDocument();
    expect(screen.getByText('不重要但紧急')).toBeInTheDocument();
    expect(screen.getByText('不重要不紧急')).toBeInTheDocument();
    expect(screen.getByText('发布 v0.1')).toBeInTheDocument();
    expect(screen.getAllByTestId('quadrant-scroll')).toHaveLength(4);
  });
});
