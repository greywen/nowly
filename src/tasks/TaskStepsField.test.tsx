import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { TaskStepsField, type TaskStepItem } from './TaskStepsField';

function item(key: string, title: string, completed = false): TaskStepItem {
  return { key, id: key, title, completed };
}

function Harness({ initial = [], onChange = vi.fn() }: {
  initial?: TaskStepItem[];
  onChange?: (steps: TaskStepItem[]) => void;
}) {
  const [steps, setSteps] = useState(initial);
  const [input, setInput] = useState('');
  return (
    <TaskStepsField steps={steps} input={input} disabled={false} onInputChange={setInput}
      onStepsChange={(next) => { setSteps(next); onChange(next); }} />
  );
}

const titles = () => screen.queryAllByRole('button', { name: /^编辑步骤：/ }).map((button) => button.textContent);

// jsdom has neither DragEvent nor DataTransfer, so drags use a stub transfer
// and set clientY by hand. jsdom rects are all zero, so any positive clientY is
// the lower half of a row.
function transfer() {
  return { effectAllowed: '', dropEffect: '', setData: vi.fn(), setDragImage: vi.fn() };
}

function dragOver(target: Element, dataTransfer: object, clientY: number) {
  const event = createEvent.dragOver(target, { dataTransfer });
  Object.defineProperty(event, 'clientY', { value: clientY });
  fireEvent(target, event);
}

describe('TaskStepsField', () => {
  it('adds trimmed steps with Enter or the add button and keeps focus in the input', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole('textbox', { name: '新步骤' });
    const add = screen.getByRole('button', { name: '添加' });
    expect(add).toBeDisabled();
    await user.type(input, '  起草  ');
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(titles()).toEqual([]);
    await user.keyboard('{Enter}');
    expect(titles()).toEqual(['起草']);
    expect(input).toHaveValue('');
    expect(input).toHaveFocus();
    await user.type(input, '评审');
    await user.click(add);
    expect(titles()).toEqual(['起草', '评审']);
    expect(input).toHaveFocus();
    expect(screen.getByRole('progressbar', { name: '步骤' })).toHaveAttribute('aria-valuetext', '已完成 0/2 个步骤');
  });

  it('toggles, renames in place and deletes steps', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial={[item('s1', '起草'), item('s2', '评审')]} onChange={onChange} />);
    await user.click(screen.getByRole('checkbox', { name: '完成步骤：起草' }));
    expect(screen.getByRole('checkbox', { name: '标记步骤为未完成：起草' })).toBeChecked();

    await user.click(screen.getByRole('button', { name: '编辑步骤：评审' }));
    const field = screen.getByRole('textbox', { name: '步骤内容' });
    expect(field).toHaveFocus();
    await user.clear(field);
    await user.type(field, '  终审 {Enter}');
    expect(titles()).toEqual(['起草', '终审']);
    expect(screen.getByRole('button', { name: '编辑步骤：终审' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: '编辑步骤：终审' }));
    await user.clear(screen.getByRole('textbox', { name: '步骤内容' }));
    await user.keyboard('{Enter}');
    expect(titles()).toEqual(['起草', '终审']);

    await user.click(screen.getByRole('button', { name: '删除步骤：起草' }));
    expect(titles()).toEqual(['终审']);
    expect(screen.getByRole('textbox', { name: '新步骤' })).toHaveFocus();
    expect(onChange).toHaveBeenLastCalledWith([{ key: 's2', id: 's2', title: '终审', completed: false }]);
  });

  it('cancels an edit with Escape and marks the key as handled so the dialog stays open', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[item('s1', '起草')]} />);
    await user.click(screen.getByRole('button', { name: '编辑步骤：起草' }));
    const field = screen.getByRole('textbox', { name: '步骤内容' });
    await user.type(field, '改');
    const escape = createEvent.keyDown(field, { key: 'Escape' });
    fireEvent(field, escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(titles()).toEqual(['起草']);
    expect(screen.getByRole('button', { name: '编辑步骤：起草' })).toHaveFocus();
  });

  it('moves a step with the arrow keys, keeps focus on its handle and announces the position', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[item('s1', '一'), item('s2', '二'), item('s3', '三')]} />);
    const handle = screen.getByRole('button', { name: '调整步骤顺序：一' });
    expect(handle).toHaveAccessibleDescription('拖动，或使用上下方向键移动');
    handle.focus();
    await user.keyboard('{ArrowDown}');
    expect(titles()).toEqual(['二', '一', '三']);
    expect(screen.getByRole('button', { name: '调整步骤顺序：一' })).toHaveFocus();
    expect(screen.getByText('“一”已移到第 2 步')).toBeInTheDocument();
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(titles()).toEqual(['一', '二', '三']);
  });

  it('reorders live while dragging and keeps the order on drop', () => {
    render(<Harness initial={[item('s1', '一'), item('s2', '二'), item('s3', '三')]} />);
    const dataTransfer = transfer();
    const handle = screen.getByRole('button', { name: '调整步骤顺序：一' });
    fireEvent.dragStart(handle, { dataTransfer });
    expect(dataTransfer.setDragImage).toHaveBeenCalled();
    dragOver(screen.getAllByRole('listitem')[1], dataTransfer, 10);
    expect(titles()).toEqual(['二', '一', '三']);
    fireEvent.drop(screen.getByRole('list'), { dataTransfer });
    fireEvent.dragEnd(handle, { dataTransfer });
    expect(titles()).toEqual(['二', '一', '三']);
  });

  it('restores the original order when a drag ends without a drop', () => {
    render(<Harness initial={[item('s1', '一'), item('s2', '二')]} />);
    const dataTransfer = transfer();
    const handle = screen.getByRole('button', { name: '调整步骤顺序：一' });
    fireEvent.dragStart(handle, { dataTransfer });
    dragOver(screen.getAllByRole('listitem')[1], dataTransfer, 10);
    expect(titles()).toEqual(['二', '一']);
    fireEvent.dragEnd(handle, { dataTransfer });
    expect(titles()).toEqual(['一', '二']);
  });

  it('disables every control while the task saves', () => {
    render(<TaskStepsField steps={[item('s1', '一')]} input="二" disabled onStepsChange={vi.fn()} onInputChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: '调整步骤顺序：一' })).toHaveAttribute('draggable', 'false');
    for (const control of [...screen.getAllByRole('button'), screen.getByRole('textbox'), screen.getByRole('checkbox')]) {
      expect(control).toBeDisabled();
    }
  });
});
