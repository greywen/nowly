import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Tip } from './Tip';

describe('Tip', () => {
  it('shows an accessible compact tip on hover and focus, then hides it', () => {
    render(<Tip content="打开设置"><button aria-label="设置">设置</button></Tip>);
    const trigger = screen.getByRole('button', { name: '设置' });

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    fireEvent.mouseEnter(trigger);
    const tooltip = screen.getByRole('tooltip', { name: '打开设置' });
    expect(tooltip).toHaveClass('tip__bubble');
    expect(trigger).toHaveAttribute('aria-describedby', tooltip.id);

    fireEvent.mouseLeave(trigger);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    fireEvent.focus(trigger);
    expect(screen.getByRole('tooltip', { name: '打开设置' })).toBeInTheDocument();
    fireEvent.blur(trigger);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('preserves an existing description and Escape dismisses the tip', () => {
    render(<Tip content="编辑布局"><button aria-label="编辑" aria-describedby="existing-help">编辑</button></Tip>);
    const trigger = screen.getByRole('button', { name: '编辑' });

    fireEvent.focus(trigger);
    const tooltip = screen.getByRole('tooltip', { name: '编辑布局' });
    expect(trigger.getAttribute('aria-describedby')).toContain('existing-help');
    expect(trigger.getAttribute('aria-describedby')).toContain(tooltip.id);

    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});
