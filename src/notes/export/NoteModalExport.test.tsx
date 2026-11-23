import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { NoteModal } from '../../modals/NoteModal';
import { contentToPlainText } from '../../components/rich-text/content';
import { exportNotes } from './native';

vi.mock('./native', () => ({ exportNotes: vi.fn(async () => true) }));
it('exports the current edit draft without saving it or closing the editor', async () => {
  const user = userEvent.setup();
  const save = vi.fn();
  const note = {id:'n1',content:'原文',color:'#4F55DA' as const,pinned:false,styleVariant:0,icon:'' as const,createdAt:'x',updatedAt:'x'};
  render(<NoteModal mode={{type:'edit',note}} onClose={vi.fn()} onSaved={vi.fn()} onDeleted={vi.fn()} createNote={vi.fn()} updateNote={save} deleteNote={vi.fn()} />);
  const editor = await screen.findByLabelText('便签内容');
  await user.type(editor, '新增内容');
  await user.click(screen.getByRole('button',{name:'导出便签'}));
  expect(screen.getByText('导出当前内容，不会自动保存对便签的修改。')).toBeInTheDocument();
  await user.click(screen.getByRole('button',{name:'导出所选便签'}));
  expect(await screen.findByRole('status')).toHaveTextContent('已导出');
  expect(contentToPlainText(vi.mocked(exportNotes).mock.calls[0][0][0].content)).toContain('新增内容');
  expect(save).not.toHaveBeenCalled();
});
