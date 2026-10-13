import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WorldClockSettings } from './WorldClockSettings';
import { defaultTimeSettings } from './time-model';

describe('WorldClockSettings appearance', () => {
  it('adds a named clock without hiding its editable label', () => {
    const onChange = vi.fn();
    const { rerender } = render(<WorldClockSettings settings={defaultTimeSettings()} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '添加时钟' }));
    expect(onChange.mock.calls[0][0].clocks[1].showLabel).toBe(true);
    rerender(<WorldClockSettings settings={onChange.mock.calls[0][0]} onChange={onChange} />);
    expect(screen.getByDisplayValue('新时钟')).toBeVisible();
  });

  it('offers a manual font slider using the approved bounds', () => {
    const settings = defaultTimeSettings();
    settings.clocks[0].fontMode = 'manual';
    const onChange = vi.fn();
    render(<WorldClockSettings settings={settings} onChange={onChange} />);
    expect(screen.getByText('字号（32–160px）: 96px')).toBeVisible();
    const slider = screen.getByRole('slider');
    expect(slider).toHaveAttribute('min', '32');
    expect(slider).toHaveAttribute('max', '160');
    fireEvent.change(slider, { target: { value: '128' } });
    expect(onChange.mock.calls[0][0].clocks[0].fontSize).toBe(128);
  });

  it('exposes details with native keyboard-accessible disclosure semantics', () => {
    const { container } = render(<WorldClockSettings settings={defaultTimeSettings()} onChange={vi.fn()} />);
    expect(container.querySelector('details summary')).toHaveTextContent('详细设置');
    expect(screen.getByText('外观')).toBeVisible();
    expect(screen.getByText('布局')).toBeVisible();
    expect(container.querySelector('details')).not.toHaveAttribute('open');
  });
});
