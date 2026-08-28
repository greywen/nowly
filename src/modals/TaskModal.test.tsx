import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { MatrixTask } from '../matrix/matrix-model';
import { TaskModal } from './TaskModal';

const existing: MatrixTask = {
  id: 't1', title: '发布 Nowly', quadrant: 'important_urgent', dueAt: '2026-07-23', priority: 1,
  completed: false, note: '发布前检查', tags: [], createdAt: 'x', updatedAt: 'x'
};

function props(overrides: Record<string, unknown> = {}) {
  return {
    mode: { type: 'create' as const, dueDate: '2026-07-23' },
    onClose: vi.fn(), onSaved: vi.fn(), onDeleted: vi.fn(),
    createTask: vi.fn().mockResolvedValue(existing),
    updateTask: vi.fn().mockResolvedValue(existing),
    deleteTask: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

describe('TaskModal', () => {
  it('renders approved create defaults with native Good controls and offline inputs', () => {
    const { container } = render(<TaskModal {...props()} />);
    expect(screen.getByRole('dialog', { name: '新建任务' })).toBeInTheDocument();
    expect(screen.getByLabelText('任务标题')).toHaveValue('');
    expect(screen.getByRole('radio', { name: '重要且紧急' })).toBeChecked();
    expect(screen.getAllByRole('radio').map((radio) => radio.getAttribute('name'))).toEqual([
      'task-quadrant', 'task-quadrant', 'task-quadrant', 'task-quadrant'
    ]);
    expect(screen.getByRole('button', { name: '截止日期' })).toHaveTextContent('2026 年 7 月 23 日');
    expect(screen.getByRole('combobox', { name: '优先级' })).toHaveTextContent('中');
    expect(screen.getByRole('checkbox', { name: '已完成' })).not.toBeChecked();
    expect(screen.queryByRole('button', { name: '删除任务' })).not.toBeInTheDocument();
    expect(container.querySelector('input[type="date"],select')).toBeNull();
  });

  it('validates title and maps server field errors while preserving the draft', async () => {
    const user = userEvent.setup();
    const createTask = vi.fn().mockRejectedValue({
      code: 'validation_error', field: 'title', message: '标题重复'
    });
    render(<TaskModal {...props({ createTask })} />);

    await user.click(screen.getByRole('button', { name: '保存任务' }));
    expect(screen.getByText('请输入任务标题。')).toHaveAttribute('id', 'task-title-error');
    expect(screen.getByLabelText('任务标题')).toHaveAttribute('aria-describedby', 'task-title-error');
    expect(createTask).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('任务标题'), '保留草稿');
    await user.click(screen.getByRole('button', { name: '保存任务' }));
    expect(await screen.findByText('标题重复')).toBeInTheDocument();
    expect(screen.getByLabelText('任务标题')).toHaveValue('保留草稿');
    expect(screen.getByRole('dialog', { name: '新建任务' })).toBeInTheDocument();
  });

  it('saves an edit in static busy order', async () => {
    const user = userEvent.setup();
    let resolve!: (task: MatrixTask) => void;
    const updateTask = vi.fn(() => new Promise<MatrixTask>((done) => { resolve = done; }));
    const onSaved = vi.fn();
    const onClose = vi.fn();
    render(<TaskModal {...props({ mode: { type: 'edit', task: existing }, updateTask, onSaved, onClose })} />);

    expect(screen.getByRole('dialog', { name: '编辑任务' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('任务标题'), '改');
    await user.click(screen.getByRole('button', { name: '保存任务' }));
    expect(screen.getByRole('button', { name: '正在保存' })).toBeDisabled();
    expect(updateTask).toHaveBeenCalledWith(existing, expect.objectContaining({ title: '发布 Nowly改' }));
    resolve(existing);
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(existing));
    expect(onClose).toHaveBeenCalled();
  });

  it('Escape closes an open date picker without opening discard confirmation', async () => {
    const user = userEvent.setup();
    render(<TaskModal {...props()} />);
    await user.type(screen.getByLabelText('任务标题'), '草稿');
    await user.click(screen.getByRole('button', { name:'截止日期' }));
    expect(screen.getByRole('dialog', { name:'选择截止日期' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name:'选择截止日期' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name:'放弃更改？' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name:'新建任务' })).toBeInTheDocument();
  });

  it('confirms dirty close and permanent deletion while retaining delete failures', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { unmount } = render(<TaskModal {...props({ onClose })} />);
    await user.type(screen.getByLabelText('任务标题'), '草稿');
    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.getByRole('dialog', { name: '放弃更改？' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: '新建任务' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '取消' }));
    await user.click(screen.getByRole('button', { name: '放弃更改' }));
    expect(onClose).toHaveBeenCalled();
    unmount();

    const deleteTask = vi.fn().mockRejectedValue({ message: '删除失败。' });
    render(<TaskModal {...props({ mode: { type: 'edit', task: existing }, deleteTask })} />);
    await user.click(screen.getByRole('button', { name: '删除任务' }));
    await user.click(screen.getByRole('button', { name: '永久删除' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('删除失败。');
    expect(screen.getByRole('dialog', { name: '编辑任务' })).toBeInTheDocument();
  });
});
