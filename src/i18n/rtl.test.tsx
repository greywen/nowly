import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { useState } from 'react';
import { Tabs } from '../components/Tabs';
import { DatePicker } from '../components/DatePicker';
import { setLanguage } from './store';

afterEach(() => { cleanup(); setLanguage('zh'); });

it('moves tabs in visual order in RTL', () => {
  setLanguage('ar');
  const onChange = vi.fn();
  render(<Tabs idPrefix="rtl" label="tabs" items={[{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }]} value="a" onChange={onChange} />);
  fireEvent.keyDown(screen.getByRole('tab', { name: 'A' }), { key: 'ArrowLeft' });
  expect(onChange).toHaveBeenLastCalledWith('b');
  fireEvent.keyDown(screen.getByRole('tab', { name: 'A' }), { key: 'ArrowRight' });
  expect(onChange).toHaveBeenLastCalledWith('c');
});

it('uses visual left as next day in the mirrored RTL date picker', () => {
  setLanguage('ar');
  const changed = vi.fn();
  function Harness() {
    const [open, setOpen] = useState(true);
    return <DatePicker id="date" label="Date" value="2026-10-21" open={open} today={new Date(2026, 9, 21)} onOpenChange={setOpen} onChange={changed} />;
  }
  const { container } = render(<Harness />);
  const date = container.querySelector<HTMLButtonElement>('[data-date="2026-10-21"]')!;
  fireEvent.keyDown(date, { key: 'ArrowLeft' });
  fireEvent.keyDown(date, { key: 'Enter' });
  expect(changed).toHaveBeenCalledWith('2026-10-22');
});
