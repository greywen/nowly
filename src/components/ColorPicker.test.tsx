import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ColorPicker } from './ColorPicker';

const presets = [
  { value: '#4FC9DA', label: '青绿' },
  { value: '#F06445', label: '珊瑚红' }
] as const;

describe('ColorPicker', () => {
  it('renders accessible preset and recent radios without exposing HEX text', () => {
    render(<ColorPicker legend="颜色" name="test-color" value="#4FC9DA" presets={presets} recentColors={['#7C5CFC', '#4FC9DA']} onChange={vi.fn()} />);
    expect(screen.getAllByRole('radio').some((radio) => (radio as HTMLInputElement).checked)).toBe(true);
    expect(screen.getAllByRole('radio')).toHaveLength(6);
    expect(screen.queryByText('#7C5CFC')).not.toBeInTheDocument();
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toHaveClass('form-check-input');
      expect(radio.closest('label')).toBeTruthy();
    }
  });

  it('keeps the custom control as a fixed-size plus icon instead of mirroring the selected color', () => {
    const { rerender } = render(<ColorPicker legend="颜色" name="test-color" value="#4FC9DA" presets={presets} recentColors={[]} onChange={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: '选择自定义颜色' });
    expect(trigger.querySelector('svg')).toBeInTheDocument();
    expect(trigger).toHaveClass('color-picker__trigger');
    expect(trigger.querySelector('span')).not.toBeInTheDocument();
    rerender(<ColorPicker legend="颜色" name="test-color" value="#DC3545" presets={presets} recentColors={[]} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: '选择自定义颜色' }).querySelector('svg')).toBeInTheDocument();
  });

  it('commits a custom color only when the picker closes', () => {
    const onChange = vi.fn();
    const onRememberColor = vi.fn();
    render(<ColorPicker legend="颜色" name="test-color" value="#4FC9DA" presets={presets} recentColors={[]} onChange={onChange} onRememberColor={onRememberColor} />);
    fireEvent.click(screen.getByRole('button', { name: '选择自定义颜色' }));
    const palette = screen.getByRole('slider', { name: '饱和度和亮度' });
    vi.spyOn(palette, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 240, bottom: 200, width: 240, height: 200, toJSON: () => ({}) });
    fireEvent.pointerDown(palette, { clientX: 120, clientY: 100, pointerId: 1 });
    expect(onChange).not.toHaveBeenCalled();
    expect(onRememberColor).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onChange).toHaveBeenCalledWith(expect.stringMatching(/^#[0-9A-F]{6}$/));
    expect(onRememberColor).toHaveBeenCalledWith(onChange.mock.calls[0][0]);
    expect(screen.getByRole('button', { name: '选择自定义颜色' }).querySelector('svg')).toBeInTheDocument();
  });

  it('portals a minimal picker above dialogs without value controls', () => {
    render(<ColorPicker legend="颜色" name="test-color" value="#4FC9DA" presets={presets} recentColors={[]} onChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '选择自定义颜色' }));

    const popover = screen.getByRole('dialog', { name: '自定义颜色' });
    expect(popover.parentElement).toBe(document.body);
    expect(popover).toHaveClass('color-picker__popover');
    expect(popover).toHaveStyle({ position: 'fixed' });
    expect(screen.getByRole('slider', { name: '饱和度和亮度' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: '色相' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: '最近使用颜色' })).toBeInTheDocument();
    expect(screen.queryAllByRole('button', { name: /历史颜色/ })).toHaveLength(0);
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(document.querySelector('input[type="color"], input[type="range"]')).toBeNull();
  });

  it('keeps five defaults outside and shows only custom history inside', () => {
    render(<ColorPicker legend="颜色" name="test-color" value="#4FC9DA" presets={presets} recentColors={['#7C5CFC', '#FF8800']} onChange={vi.fn()} />);
    expect(screen.getAllByRole('radio')).toHaveLength(6);
    expect(screen.getByRole('radio', { name: '青色' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: '最近颜色 1' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '选择自定义颜色' }));
    expect(screen.getAllByRole('button', { name: /历史颜色/ })).toHaveLength(2);
    expect(screen.getByRole('button', { name: '历史颜色 #7C5CFC' })).toBeInTheDocument();
  });

  it('emits an uppercase HEX color from the visual palette and remains editable', () => {
    const onChange = vi.fn();
    const { rerender } = render(<ColorPicker legend="颜色" name="test-color" value="#7C5CFC" presets={presets} recentColors={['#7C5CFC']} onChange={onChange} />);
    expect(screen.getAllByRole('radio')).toHaveLength(6);

    fireEvent.click(screen.getByRole('button', { name: '选择自定义颜色' }));
    const palette = screen.getByRole('slider', { name: '饱和度和亮度' });
    vi.spyOn(palette, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 240, bottom: 200, width: 240, height: 200, toJSON: () => ({}) });
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
