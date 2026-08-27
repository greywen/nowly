import { describe, expect, it, vi } from 'vitest';
import { combineVisibility, observeVisibility } from './sandbox-visibility';

describe('combineVisibility', () => {
  it('is visible only when on-screen AND the document is foreground', () => {
    expect(combineVisibility(true, 'visible')).toBe(true);
    expect(combineVisibility(false, 'visible')).toBe(false);
    expect(combineVisibility(true, 'hidden')).toBe(false);
    expect(combineVisibility(false, 'hidden')).toBe(false);
  });
});

describe('observeVisibility', () => {
  it('sends the initial state and cleans up its listeners', () => {
    // jsdom lacks IntersectionObserver; provide a minimal stub that records the
    // observed target and lets the test drive intersection changes.
    const observed: Element[] = [];
    type IOCallback = (entries: Array<{ isIntersecting: boolean }>) => void;
    const triggerRef: { current: IOCallback | null } = { current: null };
    const disconnect = vi.fn();
    class IO {
      constructor(cb: IOCallback) {
        triggerRef.current = cb;
      }
      observe(el: Element) {
        observed.push(el);
      }
      disconnect() {
        disconnect();
      }
    }
    vi.stubGlobal('IntersectionObserver', IO as unknown as typeof IntersectionObserver);

    const el = document.createElement('div');
    const send = vi.fn();
    const cleanup = observeVisibility(el, send);

    // Observed the element and delivered an initial reading.
    expect(observed).toEqual([el]);
    expect(send).toHaveBeenCalledTimes(1);

    // A change to off-screen relays false (document is 'visible' in jsdom).
    triggerRef.current?.([{ isIntersecting: false }]);
    expect(send).toHaveBeenLastCalledWith(false);

    // Back on-screen relays true.
    triggerRef.current?.([{ isIntersecting: true }]);
    expect(send).toHaveBeenLastCalledWith(true);

    cleanup();
    expect(disconnect).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
