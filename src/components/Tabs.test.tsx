import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { TabPanel, Tabs } from './Tabs';

const items = [
  { id: 'one', label: '第一项' },
  { id: 'two', label: '第二项', count: 3 },
  { id: 'three', label: '第三项' }
] as const;

function Harness({ onChange }: { onChange?: (id: string) => void }) {
  const [value, setValue] = useState<string>('one');
  return (
    <>
      <Tabs
        idPrefix="demo"
        label="演示"
        items={items}
        value={value}
        onChange={(next) => {
          setValue(next);
          onChange?.(next);
        }}
      />
      {items.map((item) => (
        <TabPanel key={item.id} idPrefix="demo" tabId={item.id} active={value === item.id}>
          {item.label}内容
        </TabPanel>
      ))}
    </>
  );
}

describe('Tabs', () => {
  it('marks only the active tab as selected and shows its count suffix', () => {
    render(<Harness />);
    expect(screen.getByRole('tablist', { name: '演示' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '第一项' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: '第二项(3)' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('第一项');
  });

  it('switches panels on click', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(screen.getByRole('tab', { name: '第三项' }));
    expect(onChange).toHaveBeenCalledWith('three');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('第三项内容');
  });

  it('moves between tabs with arrow, Home and End keys', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    screen.getByRole('tab', { name: '第一项' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: '第二项(3)' })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(screen.getByRole('tab', { name: '第三项' })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: '第一项' })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: '第三项' })).toHaveAttribute('aria-selected', 'true');
  });

  it('keeps only the active tab in the sequential focus order', () => {
    render(<Harness />);
    expect(screen.getByRole('tab', { name: '第一项' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: '第三项' })).toHaveAttribute('tabindex', '-1');
  });
});
