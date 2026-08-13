import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TransparencyControl } from './TransparencyControl';

describe('TransparencyControl', () => {
  it('opens the slider popover and shows transparency as a percentage', () => {
    render(<TransparencyControl opacity={1} onChange={() => undefined} />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '调整透明度' }));

    expect(screen.getByRole('dialog', { name: '透明度' })).toBeInTheDocument();
    // Fully opaque content reads as 0% transparency.
    expect(screen.getByText('0%')).toBeInTheDocument();
    expect(screen.getByRole('slider')).toHaveValue('0');
  });

  it('reflects the current opacity as its transparency complement', () => {
    render(<TransparencyControl opacity={0.6} onChange={() => undefined} />);

    fireEvent.click(screen.getByRole('button', { name: '调整透明度' }));
    expect(screen.getByText('40%')).toBeInTheDocument();
    expect(screen.getByRole('slider')).toHaveValue('40');
  });

  it('reports a lower opacity as the slider moves toward more transparent', () => {
    const onChange = vi.fn();
    render(<TransparencyControl opacity={1} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: '调整透明度' }));
    fireEvent.change(screen.getByRole('slider'), { target: { value: '30' } });

    // 30% transparency -> 0.7 opacity.
    expect(onChange).toHaveBeenCalledWith(0.7);
  });

  it('shows 100% transparency for fully faded content', () => {
    render(<TransparencyControl opacity={0} onChange={() => undefined} />);

    fireEvent.click(screen.getByRole('button', { name: '调整透明度' }));
    // 0 opacity reads as 100% transparency.
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.getByRole('slider')).toHaveValue('100');
  });

  it('allows dragging all the way to fully transparent', () => {
    const onChange = vi.fn();
    render(<TransparencyControl opacity={1} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: '调整透明度' }));
    fireEvent.change(screen.getByRole('slider'), { target: { value: '100' } });

    // 100% transparency -> 0 opacity.
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it('closes on Escape', () => {
    render(<TransparencyControl opacity={1} onChange={() => undefined} />);

    fireEvent.click(screen.getByRole('button', { name: '调整透明度' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
