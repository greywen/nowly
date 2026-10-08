import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TopRail } from './StatusIsland';

function renderRail(props: Partial<React.ComponentProps<typeof TopRail>> = {}) {
  return render(
    <TopRail
      open={false}
      source="island"
      surface="status"
      assistantClosing={false}
      statusAnim={null}
      assistantAnim={null}
      mode="idle"
      panel={null}
      assistant={null}
      onActivateNowly={vi.fn()}
      onCollapse={vi.fn()}
      {...props}
    >
      <div />
    </TopRail>
  );
}

describe('the bar button lane', () => {
  it('renders no buttons and the historic width when nothing is configured', () => {
    const { container } = renderRail();
    expect(container.querySelectorAll('.status-rail__app-button')).toHaveLength(0);
    // Zero buttons must reproduce today's geometry exactly.
    expect((container.querySelector('.status-rail') as HTMLElement).style.getPropertyValue('--app-buttons')).toBe('0');
  });

  it('renders one 48px lane per configured button, in order', () => {
    const { container } = renderRail({ barButtons: ['screenshot'] });
    const buttons = container.querySelectorAll('.status-rail__app-button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAttribute('data-app', 'screenshot');
    expect(buttons[0].querySelector('svg')).toHaveAttribute('width', '24');
    // Slot 0 is the lane immediately after the logo.
    expect((buttons[0] as HTMLElement).style.getPropertyValue('--app-slot')).toBe('0');
    expect((container.querySelector('.status-rail') as HTMLElement).style.getPropertyValue('--app-buttons')).toBe('1');
  });

  it('activates the app it belongs to', async () => {
    const user = userEvent.setup();
    const onActivateBarButton = vi.fn();
    renderRail({ barButtons: ['screenshot'], onActivateBarButton });
    await user.click(screen.getByRole('button', { name: '截屏' }));
    expect(onActivateBarButton).toHaveBeenCalledWith('screenshot');
  });

  it('reports a failure on the button that failed', () => {
    renderRail({
      barButtons: ['screenshot'],
      barButtonErrors: { screenshot: '截图功能尚未可用。' }
    });
    const button = screen.getByRole('button', { name: '截屏：截图功能尚未可用。' });
    expect(button).toHaveAttribute('data-error', 'true');
    expect(button).toHaveAttribute('title', '截屏：截图功能尚未可用。');
  });

  it('shows a visible retry command after a failure, without relying on a tooltip', async () => {
    const onActivateBarButton = vi.fn();
    renderRail({
      barButtons: ['screenshot'],
      barButtonErrors: { screenshot: '截图启动超时。' },
      onActivateBarButton
    });
    const button = screen.getByRole('button', { name: '截屏：截图启动超时。' });
    expect(button).toHaveTextContent('重试');
    await userEvent.setup().click(button);
    expect(onActivateBarButton).toHaveBeenCalledWith('screenshot');
  });

  it('leaves the tab order while a panel owns the shell', () => {
    // Same rule as the Nowly logo: the lane is fading out, so it must not be
    // focusable behind the open panel.
    const { container } = renderRail({ barButtons: ['screenshot'], open: true, source: 'island' });
    const button = container.querySelector('.status-rail__app-button') as HTMLElement;
    expect(button).toHaveAttribute('data-available', 'false');
    expect(button).toHaveAttribute('tabindex', '-1');
    expect(button).toHaveAttribute('aria-hidden', 'true');
  });

  it('is focusable while the bar is collapsed', () => {
    const { container } = renderRail({ barButtons: ['screenshot'] });
    const button = container.querySelector('.status-rail__app-button') as HTMLElement;
    expect(button).toHaveAttribute('data-available', 'true');
    expect(button).not.toHaveAttribute('aria-hidden');
  });

  it('tweens the shell only when the configuration actually changes', () => {
    const { container, rerender } = renderRail({ barButtons: [] });
    const rail = () => container.querySelector('.status-rail') as HTMLElement;
    // Nothing animates itself into existence on mount.
    expect(rail()).not.toHaveAttribute('data-lane-anim');

    rerender(
      <TopRail
        open={false}
        source="island"
        surface="status"
        assistantClosing={false}
        statusAnim={null}
        assistantAnim={null}
        mode="idle"
        panel={null}
        assistant={null}
        barButtons={['screenshot']}
        onActivateNowly={vi.fn()}
        onCollapse={vi.fn()}
      >
        <div />
      </TopRail>
    );
    expect(rail()).toHaveAttribute('data-lane-anim', 'grow');
  });

  it('keeps the AI frame separate from the status shell', () => {
    // The status shell is positioned against the constant-width host, not inside
    // the AI frame, so the AI morph cannot slide it.
    const { container } = renderRail({ barButtons: ['screenshot'] });
    const presence = container.querySelector('.status-rail__status-presence') as HTMLElement;
    const frame = container.querySelector('.status-rail__assistant-frame') as HTMLElement;
    expect(frame).toBeInTheDocument();
    expect(frame.contains(presence)).toBe(false);
    expect(frame.querySelector('.status-rail__assistant')).toBeInTheDocument();
  });
});
