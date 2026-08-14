import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TransparencyControl } from './TransparencyControl';

describe('TransparencyControl', () => {
  it('opens the blur slider popover', () => {
    render(<TransparencyControl blurRadius={0} onChange={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: '调整模糊' }));
    expect(screen.getByRole('dialog', { name: '模糊' })).toBeInTheDocument();
    expect(screen.getByText('0px')).toBeInTheDocument();
    expect(screen.getByRole('slider')).toHaveValue('0');
    expect(screen.getByRole('slider')).toHaveAttribute('min', '0');
    expect(screen.getByRole('slider')).toHaveAttribute('max', '24');
  });

  it('reflects the current blur radius', () => {
    render(<TransparencyControl blurRadius={8} onChange={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: '调整模糊' }));
    expect(screen.getByText('8px')).toBeInTheDocument();
    expect(screen.getByRole('slider')).toHaveValue('8');
  });

  it('reports the blur radius as the slider moves', () => {
    const onChange = vi.fn();
    render(<TransparencyControl blurRadius={0} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '调整模糊' }));
    fireEvent.change(screen.getByRole('slider'), { target: { value: '12' } });
    expect(onChange).toHaveBeenCalledWith(12);
  });

  it('closes on Escape', () => {
    render(<TransparencyControl blurRadius={0} onChange={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: '调整模糊' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
