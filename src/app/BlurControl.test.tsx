import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BlurControl } from './BlurControl';

describe('BlurControl', () => {
  it('opens the slider popover and shows the blur amount as a percentage', () => {
    render(<BlurControl blur={0} onChange={() => undefined} />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '调整模糊' }));

    expect(screen.getByRole('dialog', { name: '模糊' })).toBeInTheDocument();
    expect(screen.getByText('0%')).toBeInTheDocument();
    expect(screen.getByRole('slider')).toHaveValue('0');
  });

  it('reflects the current blur amount as a percentage of the maximum', () => {
    render(<BlurControl blur={8} onChange={() => undefined} />);

    fireEvent.click(screen.getByRole('button', { name: '调整模糊' }));
    // 8px of a 20px maximum reads as 40%.
    expect(screen.getByText('40%')).toBeInTheDocument();
    expect(screen.getByRole('slider')).toHaveValue('8');
  });

  it('reports the new blur amount as the slider moves', () => {
    const onChange = vi.fn();
    render(<BlurControl blur={0} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: '调整模糊' }));
    fireEvent.change(screen.getByRole('slider'), { target: { value: '12' } });

    expect(onChange).toHaveBeenCalledWith(12);
  });

  it('explains the blur only applies as a wallpaper', () => {
    render(<BlurControl blur={0} onChange={() => undefined} />);

    fireEvent.click(screen.getByRole('button', { name: '调整模糊' }));
    expect(screen.getByText('模糊效果仅在调整时预览，并在设为壁纸后生效。')).toBeInTheDocument();
  });

  it('closes on Escape', () => {
    render(<BlurControl blur={0} onChange={() => undefined} />);

    fireEvent.click(screen.getByRole('button', { name: '调整模糊' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
