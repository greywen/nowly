import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import { Combobox } from './Combobox';

function Harness({ onChange = vi.fn(), loading = false }: { onChange?: (value: string) => void; loading?: boolean }) {
  const [value, setValue] = useState('');
  return <Combobox id="model" label="Model" value={value} options={['gpt-4o', 'gpt-4o-mini', 'claude']} loading={loading}
    loadingText="Loading" emptyText="No match" toggleLabel="Show models"
    onChange={next => { setValue(next); onChange(next); }} />;
}

it('filters while typing, keeps free text and picks with the keyboard', () => {
  const onChange = vi.fn();
  render(<Harness onChange={onChange} />);
  const input = screen.getByRole('combobox', { name: 'Model' });
  fireEvent.change(input, { target: { value: 'mini' } });
  expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['gpt-4o-mini']);
  fireEvent.change(input, { target: { value: 'custom-model' } });
  expect(screen.queryAllByRole('option')).toHaveLength(0);
  expect(screen.getByText('No match')).toBeInTheDocument();
  expect(input).toHaveValue('custom-model');

  fireEvent.keyDown(input, { key: 'Escape' });
  expect(input).toHaveAttribute('aria-expanded', 'false');
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  expect(screen.getAllByRole('option')).toHaveLength(3);
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  expect(input).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: 'gpt-4o-mini' }).id);
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onChange).toHaveBeenLastCalledWith('gpt-4o-mini');
  expect(input).toHaveAttribute('aria-expanded', 'false');
});

it('shows the loading text instead of options', () => {
  render(<Harness loading />);
  fireEvent.click(screen.getByRole('button', { name: 'Show models' }));
  expect(screen.getByText('Loading')).toBeInTheDocument();
  expect(screen.queryAllByRole('option')).toHaveLength(0);
});
