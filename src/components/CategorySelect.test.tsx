import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Category } from '../calendar/calendar-model';
import { CategorySelect } from './CategorySelect';

const category: Category = {
  id: 'work', name: '工作', color: '#4F55DA', position: 0, createdAt: '', updatedAt: ''
};

function props() {
  return {
    id: 'test-category', label: '分类', categories: [category], value: category.id,
    onChange: vi.fn(), onCreate: vi.fn().mockResolvedValue(category),
    onUpdate: vi.fn().mockResolvedValue(category), onDelete: vi.fn().mockResolvedValue(undefined)
  };
}

function openSelector() {
  fireEvent.click(screen.getByRole('combobox', { name: '分类' }));
}

function createInline() {
  openSelector();
  fireEvent.click(screen.getByRole('button', { name: '新增分类' }));
  fireEvent.change(screen.getByPlaceholderText('分类名称'), { target: { value: '新分类' } });
  fireEvent.click(within(screen.getByRole('group', { name: '新增分类' })).getByRole('button', { name: '新增分类' }));
}

describe('CategorySelect selection records', () => {
  it('passes the existing category together with its id', () => {
    const p = props();
    render(<CategorySelect {...p} />);
    openSelector();
    fireEvent.click(screen.getByRole('option', { name: '工作' }));
    expect(p.onChange).toHaveBeenCalledWith(category.id, category);
  });

  it('passes null when choosing no category', () => {
    const p = props();
    render(<CategorySelect {...p} />);
    openSelector();
    fireEvent.click(screen.getByRole('option', { name: '无分类' }));
    expect(p.onChange).toHaveBeenCalledWith('', null);
  });

  it('uses the returned record when the new category is absent from props', async () => {
    const created: Category = { ...category, id: 'new', name: '新分类', color: '#F06445' };
    const p = props();
    p.onCreate.mockResolvedValue(created);
    render(<CategorySelect {...p} />);
    createInline();
    await waitFor(() => expect(p.onChange).toHaveBeenCalledWith(created.id, created));
    expect(screen.getByRole('combobox', { name: '分类' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('preserves selection and reports a failed category creation', async () => {
    const p = props();
    p.onCreate.mockRejectedValue(new Error('分类保存失败。'));
    render(<CategorySelect {...p} />);
    createInline();
    expect(await screen.findByRole('alert')).toHaveTextContent('分类保存失败。');
    expect(p.onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('combobox', { name: '分类' })).toHaveTextContent('工作');
  });

  it('clears both selection arguments after deleting the selected category', async () => {
    const p = props();
    render(<CategorySelect {...p} />);
    openSelector();
    fireEvent.click(screen.getByRole('button', { name: '删除分类“工作”' }));
    const confirmation = screen.getByRole('dialog');
    fireEvent.click(within(confirmation).getByRole('button', { name: '删除' }));
    await waitFor(() => expect(p.onChange).toHaveBeenCalledWith('', null));
    expect(p.onDelete).toHaveBeenCalledWith(category.id);
  });
});
