import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Slider } from './Slider';

describe('Slider', () => {
  it('exposes a native accessible range and emits numeric values', () => {
    const onChange = vi.fn();
    render(<Slider label="Font size" min={32} max={160} step={1} value={96} valueText="96px" onChange={onChange} />);
    const slider = screen.getByRole('slider', { name: 'Font size' });
    expect(slider).toHaveAttribute('type', 'range');
    expect(slider).toHaveAttribute('min', '32');
    expect(slider).toHaveAttribute('max', '160');
    expect(slider).toHaveAttribute('step', '1');
    expect(slider).toHaveAttribute('aria-valuetext', '96px');
    expect(slider).toHaveValue('96');
    fireEvent.change(slider, { target: { value: '128' } });
    expect(onChange).toHaveBeenCalledWith(128);
  });
});
