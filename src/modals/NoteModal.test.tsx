import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NoteModal } from './NoteModal';

const note={id:'n1',title:'产品原则',content:'简单',color:'#4F55DA' as const,pinned:true,styleVariant:1,icon:'smile' as const,createdAt:'x',updatedAt:'x'};
const base={onClose:vi.fn(),onSaved:vi.fn(),onDeleted:vi.fn(),createNote:vi.fn(),updateNote:vi.fn(),deleteNote:vi.fn()};
describe('NoteModal',()=>{
 it('validates and creates a fixed-color pinned note',async()=>{const user=userEvent.setup();const create=vi.fn().mockResolvedValue(note);render(<NoteModal mode={{type:'create'}} {...base} createNote={create}/>);expect(screen.getAllByRole('radio')).toHaveLength(4);await user.click(screen.getByRole('button',{name:'保存便签'}));expect(screen.getByText('请输入便签标题。')).toBeInTheDocument();await user.type(screen.getByLabelText('便签标题'),'产品原则');await user.click(screen.getByRole('radio',{name:'暖黄'}));await user.click(screen.getByRole('combobox',{name:'便签图标'}));await user.click(screen.getByRole('option',{name:'⭐ 星标'}));await user.click(screen.getByRole('checkbox',{name:'置顶便签'}));await user.click(screen.getByRole('button',{name:'保存便签'}));await waitFor(()=>expect(create).toHaveBeenCalledWith({title:'产品原则',content:'',color:'#E8C444',pinned:true,icon:'star'}));});
 it('confirms dirty close and permanent deletion',async()=>{const user=userEvent.setup();const remove=vi.fn().mockResolvedValue(undefined);render(<NoteModal mode={{type:'edit',note}} {...base} deleteNote={remove}/>);await user.type(screen.getByLabelText('便签内容'),'更多');await user.click(screen.getByRole('button',{name:'关闭'}));expect(screen.getByRole('dialog',{name:'放弃更改？'})).toBeInTheDocument();await user.click(screen.getByRole('dialog',{name:'放弃更改？'}).querySelector('button')!);await user.click(screen.getByRole('button',{name:'删除便签'}));expect(screen.getByRole('dialog',{name:'永久删除“产品原则”？'})).toBeInTheDocument();await user.click(screen.getByRole('button',{name:'永久删除'}));await waitFor(()=>expect(remove).toHaveBeenCalledWith(note));});
});
