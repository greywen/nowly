import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RecurrenceScopeDialog } from './RecurrenceScopeDialog';

function props(overrides: Record<string, unknown> = {}) {
  return {
    action: 'edit' as const,
    isFirstOccurrence: false,
    slotsChanged: false,
    hasLinkedTask: false,
    onCancel: vi.fn(),
    onConfirm: vi.fn(),
    ...overrides
  };
}

const exceptionsNotice = '该日程已有的单次调整将被清除。';
const linkedTaskNotice = '关联的任务将保留在原重复日程。';

describe('RecurrenceScopeDialog', () => {
  it('hides this-and-following when the target is the first occurrence', () => {
    render(<RecurrenceScopeDialog {...props({ action: 'delete', isFirstOccurrence: true })} />);

    expect(screen.getByRole('dialog', { name: '删除重复日程' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: '此后所有' })).toBeNull();
    expect(screen.getByRole('radio', { name: '仅此次' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '全部' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
  });

  it('offers all three scopes when the target is a later occurrence', () => {
    render(<RecurrenceScopeDialog {...props({ action: 'edit', isFirstOccurrence: false })} />);

    expect(screen.getByRole('dialog', { name: '编辑重复日程' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '此后所有' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio').map((radio) => radio.getAttribute('name'))).toEqual([
      'recurrence-scope',
      'recurrence-scope',
      'recurrence-scope'
    ]);
    expect(screen.getByRole('radio', { name: '仅此次' })).toBeChecked();
  });

  it('warns about cleared exceptions only for the whole series with changed slots', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<RecurrenceScopeDialog {...props({ slotsChanged: true })} />);

    expect(screen.queryByText(exceptionsNotice)).toBeNull();
    await user.click(screen.getByRole('radio', { name: '此后所有' }));
    expect(screen.queryByText(exceptionsNotice)).toBeNull();
    await user.click(screen.getByRole('radio', { name: '全部' }));
    expect(screen.getByText(exceptionsNotice)).toBeInTheDocument();

    rerender(<RecurrenceScopeDialog {...props({ slotsChanged: false })} />);
    await user.click(screen.getByRole('radio', { name: '全部' }));
    expect(screen.queryByText(exceptionsNotice)).toBeNull();
  });

  it('explains the linked task only for this-and-following on a linked series', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<RecurrenceScopeDialog {...props({ hasLinkedTask: true })} />);

    expect(screen.queryByText(linkedTaskNotice)).toBeNull();
    await user.click(screen.getByRole('radio', { name: '全部' }));
    expect(screen.queryByText(linkedTaskNotice)).toBeNull();
    await user.click(screen.getByRole('radio', { name: '此后所有' }));
    expect(screen.getByText(linkedTaskNotice)).toBeInTheDocument();

    rerender(<RecurrenceScopeDialog {...props({ hasLinkedTask: false })} />);
    await user.click(screen.getByRole('radio', { name: '此后所有' }));
    expect(screen.queryByText(linkedTaskNotice)).toBeNull();
  });

  it('reports every selected scope literal on confirm', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const { rerender } = render(<RecurrenceScopeDialog {...props({ onConfirm })} />);

    await user.click(screen.getByRole('button', { name: '确定' }));
    expect(onConfirm).toHaveBeenLastCalledWith('occurrence');

    await user.click(screen.getByRole('radio', { name: '此后所有' }));
    await user.click(screen.getByRole('button', { name: '确定' }));
    expect(onConfirm).toHaveBeenLastCalledWith('thisAndFollowing');

    rerender(<RecurrenceScopeDialog {...props({ onConfirm })} />);
    await user.click(screen.getByRole('radio', { name: '全部' }));
    await user.click(screen.getByRole('button', { name: '确定' }));
    expect(onConfirm).toHaveBeenLastCalledWith('all');
    expect(onConfirm).toHaveBeenCalledTimes(3);
  });

  it('cancels from the footer button and from Escape', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<RecurrenceScopeDialog {...props({ onCancel })} />);

    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('focuses the first scope and traps Tab inside the dialog', async () => {
    const user = userEvent.setup();
    render(<RecurrenceScopeDialog {...props()} />);

    const first = screen.getByRole('radio', { name: '仅此次' });
    const last = screen.getByRole('button', { name: '确定' });
    expect(screen.getByRole('dialog', { name: '编辑重复日程' })).toHaveAttribute('aria-modal', 'true');
    expect(first).toHaveFocus();

    last.focus();
    await user.keyboard('{Tab}');
    expect(first).toHaveFocus();
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(last).toHaveFocus();
  });

  it('selects a scope with the keyboard alone', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<RecurrenceScopeDialog {...props({ onConfirm })} />);

    screen.getByRole('radio', { name: '仅此次' }).focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('radio', { name: '此后所有' })).toBeChecked();
    await user.keyboard('{Tab}{Tab}{Enter}');
    expect(onConfirm).toHaveBeenCalledWith('thisAndFollowing');
  });

  it('freezes interaction while busy and surfaces failures as an alert', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <RecurrenceScopeDialog
        {...props({ action: 'delete', busy: true, errorMessage: '删除失败，请重试。', onCancel, onConfirm })}
      />
    );

    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '正在删除' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: '仅此次' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('删除失败，请重试。');
    await user.keyboard('{Escape}');
    expect(onCancel).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(document.querySelector('[class*="spinner"], [class*="skeleton"]')).toBeNull();
  });
});
