import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NotesManagerDialog } from './NotesManagerDialog';

const note = { id:'n1', content:'产品原则\n保持简单', color:'#4F55DA' as const, pinned:true, styleVariant:0, icon:'heart' as const, createdAt:'x', updatedAt:'x' };

describe('NotesManagerDialog', () => {
  it('lists all notes and opens create and edit actions', async () => {
    const user = userEvent.setup(); const create = vi.fn(); const edit = vi.fn();
    render(<NotesManagerDialog notes={[note]} onClose={vi.fn()} onCreate={create} onEdit={edit} />);
    expect(screen.getByRole('dialog', {name:'全部便签'})).toBeInTheDocument();
    expect(screen.getByTestId('notes-manager-scroll')).toBeInTheDocument();
    await user.click(screen.getByRole('button', {name:'新增便签'}));
    await user.click(screen.getByRole('button', {name:'编辑便签：产品原则'}));
    expect(create).toHaveBeenCalled(); expect(edit).toHaveBeenCalledWith(note, expect.anything());
  });

  it('selects individual notes, all and none without editing a note', async () => {
    const user = userEvent.setup();
    const edit = vi.fn();
    render(<NotesManagerDialog notes={[note, {...note, id:'n2', content:'另一条'}]} onClose={vi.fn()} onCreate={vi.fn()} onEdit={edit} />);
    await user.click(screen.getByRole('button', {name:'导出便签'}));
    expect(screen.getByRole('button', {name:'导出所选便签'})).toBeDisabled();
    await user.click(screen.getByRole('checkbox', {name:'选择便签：产品原则'}));
    expect(screen.getByText('已选 1 / 2 条')).toBeInTheDocument();
    const all = screen.getByRole('checkbox', {name:'全选便签'});
    expect(all).toBePartiallyChecked();
    await user.click(all);
    expect(screen.getByText('已选 2 / 2 条')).toBeInTheDocument();
    await user.click(all);
    expect(screen.getByRole('button', {name:'导出所选便签'})).toBeDisabled();
    expect(edit).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', {name:'退出导出'}));
    expect(screen.getByRole('button', {name:'编辑便签：产品原则'})).toBeInTheDocument();
  });
});
