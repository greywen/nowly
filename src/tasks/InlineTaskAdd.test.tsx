import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { InlineTaskAdd } from './InlineTaskAdd';

function setup(onCreate = vi.fn().mockResolvedValue(undefined)) {
  const user = userEvent.setup();
  render(<><InlineTaskAdd label="在待处理添加任务" onCreate={onCreate} /><button type="button">外部</button></>);
  return { user, onCreate };
}

describe('InlineTaskAdd', () => {
  it('saves on Enter, clears the input and keeps it open for the next task', async () => {
    const { user, onCreate } = setup();
    await user.click(screen.getByRole('button', { name: '在待处理添加任务' }));
    const input = screen.getByRole('textbox', { name: '在待处理添加任务' });
    expect(input).toHaveFocus();
    await user.type(input, '  买咖啡豆  {Enter}');
    expect(onCreate).toHaveBeenCalledWith('买咖啡豆');
    expect(input).toHaveValue('');
    expect(input).toHaveFocus();
    expect(screen.getByText('Enter 添加并继续 · Esc 收起')).toBeInTheDocument();
  });

  it('collapses on Escape without saving and returns focus to the trigger', async () => {
    const { user, onCreate } = setup();
    await user.click(screen.getByRole('button', { name: '在待处理添加任务' }));
    await user.type(screen.getByRole('textbox', { name: '在待处理添加任务' }), '草稿{Escape}');
    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    const trigger = screen.getByRole('button', { name: '在待处理添加任务' });
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(trigger).toHaveClass('inline-add__trigger--quiet');
    await user.tab();
    expect(trigger).not.toHaveClass('inline-add__trigger--quiet');
  });

  it('collapses when an empty input loses focus and saves a non-empty one first', async () => {
    const { user, onCreate } = setup();
    await user.click(screen.getByRole('button', { name: '在待处理添加任务' }));
    await user.click(screen.getByRole('button', { name: '外部' }));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(onCreate).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '在待处理添加任务' }));
    await user.type(screen.getByRole('textbox', { name: '在待处理添加任务' }), '预约体检');
    await user.click(screen.getByRole('button', { name: '外部' }));
    expect(onCreate).toHaveBeenCalledWith('预约体检');
    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument());
  });

  it('ignores Enter while an IME composition is active', async () => {
    const { user, onCreate } = setup();
    await user.click(screen.getByRole('button', { name: '在待处理添加任务' }));
    const input = screen.getByRole('textbox', { name: '在待处理添加任务' });
    fireEvent.change(input, { target: { value: 'mai' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(onCreate).not.toHaveBeenCalled();
    expect(input).toHaveValue('mai');
  });

  it('keeps the text and shows the error when saving fails', async () => {
    const { user } = setup(vi.fn().mockRejectedValue(new Error('标题过长。')));
    await user.click(screen.getByRole('button', { name: '在待处理添加任务' }));
    const input = screen.getByRole('textbox', { name: '在待处理添加任务' });
    await user.type(input, '写周报{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('标题过长。');
    expect(input).toHaveValue('写周报');
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });
});
