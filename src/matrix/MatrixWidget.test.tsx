import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MatrixWidget } from './MatrixWidget';
import { sampleTasks } from '../lib/sample-data';

describe('MatrixWidget', () => {
  it('renders all quadrants and uses internal scroll containers', () => {
    render(
      <MatrixWidget
        tasks={sampleTasks}
        status="ready"
        onRetry={vi.fn()}
        onCreateTask={vi.fn()}
        onOpenTask={vi.fn()}
      />
    );

    expect(screen.getByText('重要且紧急')).toBeInTheDocument();
    expect(screen.getByText('重要不紧急')).toBeInTheDocument();
    expect(screen.getByText('不重要但紧急')).toBeInTheDocument();
    expect(screen.getByText('不重要不紧急')).toBeInTheDocument();
    expect(screen.getByText('发布 v0.1')).toBeInTheDocument();
    expect(screen.getAllByTestId('quadrant-scroll')).toHaveLength(4);
  });

  it('keeps four quadrants visible when empty and retries module errors', () => {
    const retry = vi.fn();
    const { rerender } = render(
      <MatrixWidget
        tasks={[]}
        status="ready"
        onRetry={retry}
        onCreateTask={vi.fn()}
        onOpenTask={vi.fn()}
      />
    );
    expect(screen.getAllByText('暂无任务')).toHaveLength(4);
    expect(screen.getByRole('button', { name: '新增任务' })).toBeInTheDocument();

    rerender(
      <MatrixWidget
        tasks={[]}
        status="error"
        errorMessage="任务读取失败"
        onRetry={retry}
        onCreateTask={vi.fn()}
        onOpenTask={vi.fn()}
      />
    );
    screen.getByRole('button', { name: '重试读取任务' }).click();
    expect(screen.getByRole('alert')).toHaveTextContent('任务读取失败');
    expect(retry).toHaveBeenCalledOnce();
  });

  it('shows a static loading message without spinners', () => {
    render(
      <MatrixWidget
        tasks={[]}
        status="loading"
        onRetry={vi.fn()}
        onCreateTask={vi.fn()}
        onOpenTask={vi.fn()}
      />
    );

    expect(screen.getByText('正在读取本地任务')).toBeInTheDocument();
  });
});
