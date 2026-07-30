import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Dialog } from './Dialog';

function renderDialog({
  isTopLayer = true,
  onRequestClose = vi.fn(),
  restoreFocusRef
}: {
  isTopLayer?: boolean;
  onRequestClose?: () => void;
  restoreFocusRef?: { current: HTMLElement | null };
} = {}) {
  return render(
    <Dialog
      title="编辑日程"
      ariaLabelledBy="event-dialog-title"
      isTopLayer={isTopLayer}
      restoreFocusRef={restoreFocusRef}
      onRequestClose={onRequestClose}
      headerActions={<button type="button">关闭</button>}
      footer={<button type="button">保存</button>}
    >
      <button type="button">第一个操作</button>
      <input aria-label="标题" />
    </Dialog>
  );
}

describe('Dialog', () => {
  it('exposes modal semantics and focuses the first focusable child', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog', { name: '编辑日程' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('button', { name: '关闭' })).toHaveFocus();
  });

  it('uses an explicit initial focus target when supplied', () => {
    const initialFocusRef = createRef<HTMLInputElement>();
    render(
      <Dialog
        title="编辑日程"
        ariaLabelledBy="event-dialog-title"
        initialFocusRef={initialFocusRef}
        onRequestClose={vi.fn()}
      >
        <button type="button">第一个操作</button>
        <input ref={initialFocusRef} aria-label="标题" />
      </Dialog>
    );
    expect(screen.getByRole('textbox', { name: '标题' })).toHaveFocus();
  });

  it('wraps Tab and Shift+Tab inside the top dialog', async () => {
    const user = userEvent.setup();
    renderDialog();
    const first = screen.getByRole('button', { name: '关闭' });
    const last = screen.getByRole('button', { name: '保存' });

    last.focus();
    await user.keyboard('{Tab}');
    expect(first).toHaveFocus();
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(last).toHaveFocus();
  });

  it('handles Escape only while it is the top layer', async () => {
    const user = userEvent.setup();
    const closeTop = vi.fn();
    const { rerender } = render(
      <Dialog title="编辑日程" ariaLabelledBy="event-dialog-title" isTopLayer onRequestClose={closeTop}>
        <button type="button">操作</button>
      </Dialog>
    );
    await user.keyboard('{Escape}');
    expect(closeTop).toHaveBeenCalledOnce();

    const closeLower = vi.fn();
    rerender(
      <Dialog title="编辑日程" ariaLabelledBy="event-dialog-title" isTopLayer={false} onRequestClose={closeLower}>
        <button type="button">操作</button>
      </Dialog>
    );
    await user.keyboard('{Escape}');
    expect(closeLower).not.toHaveBeenCalled();
  });

  it('restores focus to the supplied trigger when unmounted', () => {
    const trigger = document.createElement('button');
    trigger.textContent = '打开日程';
    document.body.append(trigger);
    const restoreFocusRef = { current: trigger };
    const { unmount } = renderDialog({ restoreFocusRef });

    unmount();
    expect(trigger).toHaveFocus();
    trigger.remove();
  });
});
