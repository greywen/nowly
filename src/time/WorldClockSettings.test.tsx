import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WorldClockSettings } from './WorldClockSettings';
import { defaultTimeSettings } from './time-model';

describe('WorldClockSettings global appearance', () => {
  it('adds cities without duplicating appearance controls or changing appearance', () => {
    const settings = defaultTimeSettings();
    const onChange = vi.fn();
    const { rerender } = render(<WorldClockSettings settings={settings} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '添加时钟' }));
    const next = onChange.mock.calls[0][0];
    expect(next.appearance).toEqual(settings.appearance);
    expect(Object.keys(next.clocks[1]).sort()).toEqual(['id', 'label', 'timeZone']);
    rerender(<WorldClockSettings settings={next} onChange={onChange} />);
    expect(screen.getAllByRole('combobox', { name: '显示模式' })).toHaveLength(1);
    expect(screen.getAllByRole('combobox', { name: '时区' })).toHaveLength(2);
  });

  it('updates one global font slider using the approved bounds', () => {
    const settings = defaultTimeSettings();
    settings.appearance = { ...settings.appearance, fontMode: 'manual' };
    const onChange = vi.fn();
    render(<WorldClockSettings settings={settings} onChange={onChange} />);
    const slider = screen.getByRole('slider');
    expect(slider).toHaveAttribute('min', '32');
    expect(slider).toHaveAttribute('max', '160');
    expect(slider).toHaveAttribute('aria-valuetext', '96px');
    fireEvent.change(slider, { target: { value: '128' } });
    expect(onChange.mock.calls[0][0].appearance.fontSize).toBe(128);
  });

  it('disables numeric layout and font controls for analog clocks', () => {
    const settings = defaultTimeSettings();
    settings.appearance = { ...settings.appearance, mode: 'analog' };
    render(<WorldClockSettings settings={settings} onChange={vi.fn()} />);
    expect(screen.getByRole('combobox', { name: '布局' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: '字号模式' })).toBeDisabled();
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  });
});
