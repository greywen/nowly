import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BarButtonSettings } from './BarButtonSettings';

describe('BarButtonSettings', () => {
  it('offers three slots to the right of the Nowly logo, all empty by default', () => {
    const { container } = render(<BarButtonSettings buttons={[]} onChange={vi.fn()} />);
    const rail = container.querySelector('.bar-buttons__rail') as HTMLElement;
    const logo = rail.querySelector('.status-rail__nowly') as HTMLElement;
    const slots = [...rail.querySelectorAll('.bar-buttons__slot-button')];

    expect(slots).toHaveLength(3);
    expect(slots.every(slot => logo.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(slots.every(slot => slot.querySelector('svg')?.getAttribute('width') === '24')).toBe(true);
    expect(screen.getByRole('button', { name: '添加应用按钮到第 1 个位置' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '添加应用按钮到第 2 个位置' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '添加应用按钮到第 3 个位置' })).toBeInTheDocument();
  });

  it('adds the screenshot app from the picker', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<BarButtonSettings buttons={[]} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: '添加应用按钮到第 1 个位置' }));
    const screenshotItem = screen.getByRole('menuitemradio', { name: /截屏/ });
    expect(screenshotItem.querySelector('svg')).toHaveClass('bar-buttons__menu-app-icon');
    expect(screenshotItem.querySelector('svg')).toHaveAttribute('width', '20');
    await user.click(screenshotItem);
    expect(onChange).toHaveBeenCalledWith(['screenshot']);
  });

  it('removes a configured button from the same popover', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<BarButtonSettings buttons={['screenshot']} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: '第 1 个位置：截屏' }));
    const removeItem = screen.getByRole('menuitem', { name: '移除此按钮' });
    expect(removeItem.querySelector('svg')).toHaveAttribute('width', '16');
    await user.click(removeItem);
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('does not offer removal on an empty slot', async () => {
    const user = userEvent.setup();
    render(<BarButtonSettings buttons={[]} onChange={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: '添加应用按钮到第 1 个位置' }));
    expect(screen.queryByRole('menuitem', { name: '移除此按钮' })).not.toBeInTheDocument();
  });

  it('keeps one app in one slot, moving it rather than duplicating it', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<BarButtonSettings buttons={['screenshot']} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: '添加应用按钮到第 2 个位置' }));
    await user.click(screen.getByRole('menuitemradio', { name: /截屏/ }));
    expect(onChange).toHaveBeenCalledWith(['screenshot']);
  });

  it('shows configured buttons in the preview while reserving all three settings slots', () => {
    const { container, rerender } = render(<BarButtonSettings buttons={[]} onChange={vi.fn()} />);
    const rail = container.querySelector('.bar-buttons__rail') as HTMLElement;
    expect(rail.style.getPropertyValue('--app-buttons')).toBe('3');
    expect(container.querySelectorAll('.bar-buttons__slot-button[data-filled="true"]')).toHaveLength(0);

    rerender(<BarButtonSettings buttons={['screenshot']} onChange={vi.fn()} />);
    expect(rail.style.getPropertyValue('--app-buttons')).toBe('3');
    expect(container.querySelectorAll('.bar-buttons__slot-button[data-filled="true"]')).toHaveLength(1);
    expect(container.querySelector('.bar-buttons__slot-button[data-filled="true"] svg')).toHaveAttribute('width', '24');
  });

  it('renders the preview as the collapsed status surface', () => {
    // Without this the live rail's "a panel took over" rules would fade the logo
    // and the buttons out inside the preview.
    const { container } = render(<BarButtonSettings buttons={['screenshot']} onChange={vi.fn()} />);
    expect(container.querySelector('.bar-buttons__rail')).toHaveAttribute('data-surface', 'status');
  });

  it('ignores an unknown persisted id instead of rendering a dead button', () => {
    const { container } = render(
      <BarButtonSettings buttons={['screenshot', 'not-an-app']} onChange={vi.fn()} />
    );
    expect(container.querySelectorAll('.bar-buttons__slot-button[data-filled="true"]')).toHaveLength(1);
  });

  it('closes the picker on Escape without changing the configuration', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<BarButtonSettings buttons={[]} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: '添加应用按钮到第 1 个位置' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('portals the picker outside the dialog clipping boundary and anchors it to the slot', async () => {
    const user = userEvent.setup();
    const original = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function () {
      if (this.getAttribute('aria-label') === '添加应用按钮到第 3 个位置') {
        return { top: 120, bottom: 148, left: 600, right: 628, width: 28, height: 28, x: 600, y: 120, toJSON() {} };
      }
      return original.call(this);
    };

    const { container } = render(<BarButtonSettings buttons={[]} onChange={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: '添加应用按钮到第 3 个位置' }));
    const menu = screen.getByRole('menu');
    expect(container.contains(menu)).toBe(false);
    expect(menu).toHaveStyle({ left: '428px', top: '156px' });

    HTMLElement.prototype.getBoundingClientRect = original;
  });

  it('places the picker above the slot when the dialog body has no room below', async () => {
    const user = userEvent.setup();
    const original = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function () {
      if (this.classList.contains('good-dialog__body')) {
        return { top: 40, bottom: 200, left: 0, right: 700, width: 700, height: 160, x: 0, y: 40, toJSON() {} };
      }
      if (this.getAttribute('aria-label') === '添加应用按钮到第 3 个位置') {
        return { top: 160, bottom: 188, left: 600, right: 628, width: 28, height: 28, x: 600, y: 160, toJSON() {} };
      }
      return original.call(this);
    };

    render(<div className="good-dialog__body"><BarButtonSettings buttons={[]} onChange={vi.fn()} /></div>);
    await user.click(screen.getByRole('button', { name: '添加应用按钮到第 3 个位置' }));
    expect(Number.parseFloat(screen.getByRole('menu').style.top)).toBeLessThan(160);

    HTMLElement.prototype.getBoundingClientRect = original;
  });
});
