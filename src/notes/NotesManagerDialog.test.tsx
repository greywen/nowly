import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NotesManagerDialog } from './NotesManagerDialog';

const note = { id:'n1', title:'产品原则', content:'保持简单', color:'purple' as const, pinned:true, createdAt:'x', updatedAt:'x' };

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
});
