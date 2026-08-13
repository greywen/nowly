import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ColorPicker } from './ColorPicker';

const presets = [
  { value: '#4FC9DA', label: '青绿' },
  { value: '#F06445', label: '珊瑚红' }
] as const;

function mockPalette() {
  const palette = screen.getByRole('slider', { name: '饱和度和亮度' });
  vi.spyOn(palette, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 240, bottom: 200, width: 240, height: 200, toJSON: () => ({}) });
  return palette;
}

describe('ColorPicker', () => {
  it('renders one radio per preset plus a custom trigger without exposing HEX text', () => {
    render(<ColorPicker legend="颜色" name="test-color" value="#4FC9DA" presets={presets} recentColors={['#7C5CFC', '#4FC9DA']} onChange={vi.fn()} />);
    expect(screen.getAllByRole('radio')).toHaveLength(presets.length);
    expect(screen.getByRole('radio', { name: '青绿' })).toBeChecked();
    expect(screen.queryByText('#7C5CFC')).not.toBeInTheDocument();
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toHaveClass('form-check-input');
      expect(radio.closest('label')).toBeTruthy();
    }
  });

  it('shows a plus icon for the custom trigger when the value is a preset', () => {
    const { rerender } = render(<ColorPicker legend="颜色" name="test-color" value="#4FC9DA" presets={presets} recentColors={[]} onChange={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: '选择自定义颜色' });
    expect(trigger.querySelector('svg')).toBeInTheDocument();
    expect(trigger).toHaveClass('color-picker__trigger');
    expect(trigger.querySelector('span')).not.toBeInTheDocument();
    rerender(<ColorPicker legend="颜色" name="test-color" value="#F06445" presets={presets} recentColors={[]} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: '选择自定义颜色' }).querySelector('svg')).toBeInTheDocument();
  });

  it('marks the custom trigger active and shows a swatch when the value is not a preset', () => {
    render(<ColorPicker legend="颜色" name="test-color" value="#7C5CFC" presets={presets} recentColors={['#7C5CFC']} onChange={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: '选择自定义颜色' });
    expect(trigger).toHaveAttribute('aria-pressed', 'true');
    expect(trigger.querySelector('svg')).not.toBeInTheDocument();
    expect(trigger.querySelector('span')).toBeInTheDocument();
    expect(screen.queryByRole('radio', { checked: true })).not.toBeInTheDocument();
  });

  it('commits a custom color only when the picker closes and remembers it', () => {
    const onChange = vi.fn();
    const onRememberColor = vi.fn();
    render(<ColorPicker legend="颜色" name="test-color" value="#4FC9DA" presets={presets} recentColors={[]} onChange={onChange} onRememberColor={onRememberColor} />);
    fireEvent.click(screen.getByRole('button', { name: '选择自定义颜色' }));
    const palette = mockPalette();
    fireEvent.pointerDown(palette, { clientX: 120, clientY: 100, pointerId: 1 });
    expect(onChange).not.toHaveBeenCalled();
    expect(onRememberColor).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onChange).toHaveBeenCalledWith(expect.stringMatching(/^#[0-9A-F]{6}$/));
    expect(onRememberColor).toHaveBeenCalledWith(onChange.mock.calls[0][0]);
  });

  it('portals a minimal picker above dialogs with a hex input and no native color/range controls', () => {
    render(<ColorPicker legend="颜色" name="test-color" value="#4FC9DA" presets={presets} recentColors={[]} onChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '选择自定义颜色' }));

    const popover = screen.getByRole('dialog', { name: '自定义颜色' });
    expect(popover.parentElement).toBe(document.body);
    expect(popover).toHaveClass('color-picker__popover');
    expect(popover).toHaveStyle({ position: 'fixed' });
    expect(screen.getByRole('slider', { name: '饱和度和亮度' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: '色相' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '十六进制颜色值' })).toBeInTheDocument();
    expect(document.querySelector('input[type="color"], input[type="range"]')).toBeNull();
  });

  it('shows custom history inside the popover, excluding presets', () => {
    render(<ColorPicker legend="颜色" name="test-color" value="#4FC9DA" presets={presets} recentColors={['#7C5CFC', '#FF8800', '#F06445']} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '选择自定义颜色' }));
    const historyButtons = screen.getAllByRole('button', { name: /历史颜色/ });
    expect(historyButtons).toHaveLength(2);
    expect(screen.getByRole('button', { name: '历史颜色 #7C5CFC' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '历史颜色 #F06445' })).not.toBeInTheDocument();
  });

  it('keeps the freshly picked custom color visible in history', () => {
    render(<ColorPicker legend="颜色" name="test-color" value="#7C5CFC" presets={presets} recentColors={['#7C5CFC']} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '选择自定义颜色' }));
    expect(screen.getByRole('button', { name: '历史颜色 #7C5CFC' })).toBeInTheDocument();
  });

  it('shows an empty-history hint when there are no custom colors', () => {
    render(<ColorPicker legend="颜色" name="test-color" value="#4FC9DA" presets={presets} recentColors={[]} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '选择自定义颜色' }));
    expect(screen.getByText('暂无历史颜色')).toBeInTheDocument();
    expect(screen.queryAllByRole('button', { name: /历史颜色/ })).toHaveLength(0);
  });

  it('selects a history color immediately on click and remembers it', () => {
    const onChange = vi.fn();
    const onRememberColor = vi.fn();
    render(<ColorPicker legend="颜色" name="test-color" value="#4FC9DA" presets={presets} recentColors={['#7C5CFC']} onChange={onChange} onRememberColor={onRememberColor} />);
    fireEvent.click(screen.getByRole('button', { name: '选择自定义颜色' }));
    fireEvent.click(screen.getByRole('button', { name: '历史颜色 #7C5CFC' }));
    expect(onChange).toHaveBeenCalledWith('#7C5CFC');
    expect(onRememberColor).toHaveBeenCalledWith('#7C5CFC');
  });

  it('accepts a typed hex value and applies it on close', () => {
    const onChange = vi.fn();
    render(<ColorPicker legend="颜色" name="test-color" value="#4FC9DA" presets={presets} recentColors={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '选择自定义颜色' }));
    const hex = screen.getByRole('textbox', { name: '十六进制颜色值' });
    fireEvent.change(hex, { target: { value: '#7C5CFC' } });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onChange).toHaveBeenCalledWith('#7C5CFC');
  });

  it('emits an uppercase HEX color from the visual palette and reopens for editing', () => {
    const onChange = vi.fn();
    const { rerender } = render(<ColorPicker legend="颜色" name="test-color" value="#7C5CFC" presets={presets} recentColors={['#7C5CFC']} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: '选择自定义颜色' }));
    const palette = mockPalette();
    fireEvent.pointerDown(palette, { clientX: 120, clientY: 100, pointerId: 1 });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onChange).toHaveBeenCalledWith(expect.stringMatching(/^#[0-9A-F]{6}$/));

    const changed = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] ?? '#7C5CFC';
    rerender(<ColorPicker legend="颜色" name="test-color" value={changed} presets={presets} recentColors={[changed]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '选择自定义颜色' }));
    expect(screen.getByRole('dialog', { name: '自定义颜色' })).toBeInTheDocument();
  });
});
