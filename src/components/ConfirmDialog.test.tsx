import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';

describe('ConfirmDialog', () => {
  it('renders exact discard copy and invokes both actions', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        title="放弃更改？"
        description="未保存的内容将丢失。"
        confirmLabel="放弃更改"
        busyLabel="正在放弃"
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    );

    expect(screen.getByRole('dialog', { name: '放弃更改？' })).toBeInTheDocument();
    expect(screen.getByText('未保存的内容将丢失。')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '取消' }));
    await user.click(screen.getByRole('button', { name: '放弃更改' }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('renders permanent-delete copy, danger tone, and an alert', () => {
    render(
      <ConfirmDialog
        title={'永久删除“设计评审”？'}
        description={<>删除后无法恢复。<br />若存在关联，只解除关联，不删除关联任务。</>}
        tone="danger"
        confirmLabel="永久删除"
        busyLabel="正在删除"
        errorMessage="删除失败，请重试。"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    const dialog = screen.getByRole('dialog', { name: '永久删除“设计评审”？' });
    expect(dialog).toHaveTextContent('删除后无法恢复。');
    expect(dialog).toHaveTextContent('若存在关联，只解除关联，不删除关联任务。');
    expect(screen.getByRole('button', { name: '永久删除' })).toHaveClass('good-button--danger');
    expect(screen.getByRole('alert')).toHaveTextContent('删除失败，请重试。');
  });

  it('disables cancellation and confirmation and uses a static busy label', () => {
    render(
      <ConfirmDialog
        title="永久删除？"
        description="删除后无法恢复。"
        tone="danger"
        busy
        confirmLabel="永久删除"
        busyLabel="正在删除"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '正在删除' })).toBeDisabled();
    expect(document.querySelector('[class*="spinner"], [class*="skeleton"]')).toBeNull();
  });
});
