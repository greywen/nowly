import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NoteModal } from './NoteModal';

const note={id:'n1',content:'产品原则\n简单',color:'#4F55DA' as const,pinned:true,styleVariant:1,icon:'smile' as const,createdAt:'x',updatedAt:'x'};
const base={onClose:vi.fn(),onSaved:vi.fn(),onDeleted:vi.fn(),createNote:vi.fn(),updateNote:vi.fn(),deleteNote:vi.fn()};
describe('NoteModal',()=>{
 it('creates a title-free note using compact existing controls',async()=>{
  const user=userEvent.setup();const create=vi.fn().mockResolvedValue(note);
  render(<NoteModal mode={{type:'create'}} {...base} createNote={create}/>);
  expect(screen.queryByLabelText('便签标题')).not.toBeInTheDocument();
  expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button',{name:'保存便签'}));
  expect(screen.getByText('请输入便笺内容。')).toBeInTheDocument();
  await user.type(await screen.findByLabelText('便签内容'),'产品原则');
  await user.click(screen.getByRole('combobox',{name:'便签图标'}));
  await user.click(screen.getByRole('option',{name:'⭐ 星标'}));
  await user.click(screen.getByRole('checkbox',{name:'置顶便签'}));
  await user.click(screen.getByRole('button',{name:'保存便签'}));
  await waitFor(()=>expect(create).toHaveBeenCalledWith({content:expect.any(String),color:'#E8C444',pinned:true,icon:'star'}));
  expect(JSON.parse(create.mock.calls[0][0].content).ops[0].insert).toContain('产品原则');
 });
 it('closes the existing color picker with Escape without closing the note',async()=>{
  const user=userEvent.setup();const close=vi.fn();
  render(<NoteModal mode={{type:'create'}} {...base} onClose={close}/>);
  await user.click(screen.getByRole('button',{name:'便签颜色'}));
  expect(screen.getByRole('dialog',{name:'自定义颜色'})).toBeInTheDocument();
  expect(document.querySelector('.note-dialog .color-picker__popover')).toBeInTheDocument();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog',{name:'自定义颜色'})).not.toBeInTheDocument();
  expect(close).not.toHaveBeenCalled();
 });
 it('confirms dirty close and permanent deletion',async()=>{const user=userEvent.setup();const remove=vi.fn().mockResolvedValue(undefined);render(<NoteModal mode={{type:'edit',note}} {...base} deleteNote={remove}/>);await user.type(await screen.findByLabelText('便签内容'),'更多');await user.click(screen.getByRole('button',{name:'关闭'}));expect(screen.getByRole('dialog',{name:'放弃更改？'})).toBeInTheDocument();await user.click(screen.getByRole('dialog',{name:'放弃更改？'}).querySelector('button')!);await user.click(screen.getByRole('button',{name:'删除便签'}));expect(screen.getByRole('dialog',{name:'永久删除“产品原则”？'})).toBeInTheDocument();await user.click(screen.getByRole('button',{name:'永久删除'}));await waitFor(()=>expect(remove).toHaveBeenCalledWith(note));});
});
