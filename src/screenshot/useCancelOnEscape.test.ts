import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useCancelOnEscape } from './useCancelOnEscape';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined)
}));

function pressEscape(init: KeyboardEventInit = {}) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', ...init }));
}

describe('useCancelOnEscape', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockClear();
  });

  it('cancels the session on Escape', () => {
    renderHook(() => useCancelOnEscape());

    pressEscape();

    expect(invoke).toHaveBeenCalledWith('cancel_screen_capture');
  });

  it('leaves an unfinished IME composition alone', () => {
    // §7 gives Esc to the composition first, so it must not end the capture.
    renderHook(() => useCancelOnEscape());

    // jsdom's KeyboardEvent ignores unknown init keys, so isComposing is stubbed
    // on the instance instead.
    const event = new KeyboardEvent('keydown', { key: 'Escape' });
    Object.defineProperty(event, 'isComposing', { value: true });
    window.dispatchEvent(event);

    expect(invoke).not.toHaveBeenCalled();
  });

  it('ignores other keys', () => {
    renderHook(() => useCancelOnEscape());

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));

    expect(invoke).not.toHaveBeenCalled();
  });

  it('stops listening once the window unmounts', () => {
    const { unmount } = renderHook(() => useCancelOnEscape());

    unmount();
    pressEscape();

    expect(invoke).not.toHaveBeenCalled();
  });
});
