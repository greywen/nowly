import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Select } from './Select';

const options = [
  { value: 'high', label: '高' },
  { value: 'medium', label: '中' }
];

function Harness({ searchable = false, disabled = false, source = options }: { searchable?: boolean; disabled?: boolean; source?: typeof options }) {
  const [value, setValue] = useState(source[0]?.value ?? '');
  return (
    <Select
      id="priority"
      name="priority"
      label="优先级"
      options={source}
      value={value}
      onChange={setValue}
      searchable={searchable}
      disabled={disabled}
    />
  );
}

describe('Select', () => {
  it('exposes combobox semantics and submits the controlled value', () => {
    const { container } = render(<Harness />);
    const trigger = screen.getByRole('combobox', { name: '优先级' });
    expect(trigger).toHaveTextContent('高');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(container.querySelector('input[name="priority"]')).toHaveValue('high');
  });

  it('opens a listbox and selects an option with the pointer', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole('combobox', { name: '优先级' });
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('option', { name: '高' })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('option', { name: '中' }));
    expect(trigger).toHaveTextContent('中');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('filters searchable options and reports no matches', async () => {
    const user = userEvent.setup();
    render(<Harness searchable />);
    await user.click(screen.getByRole('combobox', { name: '优先级' }));
    const search = screen.getByRole('searchbox', { name: '搜索优先级' });
    await user.type(search, '中');
    expect(screen.queryByRole('option', { name: '高' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: '中' })).toBeInTheDocument();
    await user.clear(search);
    await user.type(search, '不存在');
    expect(screen.getByText('未找到匹配项')).toBeInTheDocument();
  });

  it('reports an empty option source', async () => {
    const user = userEvent.setup();
    render(<Harness source={[]} />);
    await user.click(screen.getByRole('combobox', { name: '优先级' }));
    expect(screen.getByText('暂无可选项')).toBeInTheDocument();
  });

  it('supports keyboard navigation and restores focus on Escape', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole('combobox', { name: '优先级' });
    trigger.focus();
    await user.keyboard('{ArrowDown}{End}{Enter}');
    expect(trigger).toHaveTextContent('中');
    await user.keyboard(' ');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{Home}{Escape}');
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes when clicking outside', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole('combobox', { name: '优先级' });
    await user.click(trigger);
    await user.click(document.body);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('does not open while disabled', async () => {
    const user = userEvent.setup();
    render(<Harness disabled />);
    const trigger = screen.getByRole('combobox', { name: '优先级' });
    expect(trigger).toBeDisabled();
    await user.click(trigger);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('provides stable Good component classes', async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness searchable />);
    expect(container.querySelector('.select-field')).toBeInTheDocument();
    const trigger = screen.getByRole('combobox', { name: '优先级' });
    expect(trigger).toHaveClass('select-trigger');
    await user.click(trigger);
    expect(screen.getByRole('listbox')).toHaveClass('select-listbox');
    expect(screen.getByRole('searchbox')).toHaveClass('select-search');
    expect(screen.getByRole('option', { name: '高' })).toHaveClass('select-option');
    expect(container.querySelector('.select-popup')).toBeInTheDocument();
  });

  it('places the popup above when there is more room above the trigger', async () => {
    const user = userEvent.setup();
    const original = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function () {
      if (this.getAttribute('role') === 'combobox') {
        return { top: 700, bottom: 748, left: 20, right: 320, width: 300, height: 48, x: 20, y: 700, toJSON() {} };
      }
      return original.call(this);
    };
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 });
    const { container } = render(<Harness />);
    await user.click(screen.getByRole('combobox', { name: '优先级' }));
    expect(container.querySelector('.select-popup')).toHaveClass('select-popup--above');
    HTMLElement.prototype.getBoundingClientRect = original;
  });

  it('limits popup height to the modal body boundary', async () => {
    const user = userEvent.setup();
    const original = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function () {
      if (this.classList.contains('good-modal-body')) {
        return { top: 100, bottom: 500, left: 0, right: 400, width: 400, height: 400, x: 0, y: 100, toJSON() {} };
      }
      if (this.getAttribute('role') === 'combobox') {
        return { top: 300, bottom: 348, left: 20, right: 320, width: 300, height: 48, x: 20, y: 300, toJSON() {} };
      }
      return original.call(this);
    };
    const { container } = render(<div className="good-modal-body"><Harness /></div>);
    await user.click(screen.getByRole('combobox', { name: '优先级' }));
    expect(container.querySelector('.select-popup')).toHaveClass('select-popup--above');
    expect(container.querySelector('.select-popup')).toHaveStyle({ maxHeight: '192px' });
    HTMLElement.prototype.getBoundingClientRect = original;
  });
});
