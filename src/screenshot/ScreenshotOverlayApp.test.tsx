import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { translate } from '../i18n';
import { ScreenshotOverlayApp, ScreenshotSessionApp } from './ScreenshotApp';
import { CONTROL_LABEL_KEYS } from './toolbar-model';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((path: string, protocol?: string) => `${protocol}://localhost/${path}`)
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {}))
}));

// jsdom performs no layout, so the frame's rendered box has to be stubbed. These
// numbers are this machine's: a 2240×1400 display at 150%.
const FRAME = { width: 2240, height: 1400 };
const RENDERED = { width: 1493.3333333333333, height: 933.3333333333334 };

let originalRect: typeof HTMLElement.prototype.getBoundingClientRect;
let originalDecode: typeof HTMLImageElement.prototype.decode | undefined;

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
  vi.mocked(invoke).mockResolvedValue({
    path: '7/1',
    width: FRAME.width,
    height: FRAME.height,
    originX: 0,
    originY: 0,
    windowCandidates: []
  });

  originalRect = HTMLElement.prototype.getBoundingClientRect;
  Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', {
    configurable: true,
    get: () => FRAME.width
  });
  Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', {
    configurable: true,
    get: () => FRAME.height
  });
  originalDecode = HTMLImageElement.prototype.decode;
  HTMLImageElement.prototype.decode = vi.fn().mockResolvedValue(undefined);
  HTMLElement.prototype.getBoundingClientRect = function rect(this: HTMLElement) {
    // The toolbar reports its own measured size; everything else is the frame.
    const isToolbar = this.classList.contains('screenshot-toolbar-anchor');
    const size = isToolbar ? { width: 592, height: 56 } : RENDERED;
    return {
      ...size,
      left: 0,
      top: 0,
      right: size.width,
      bottom: size.height,
      x: 0,
      y: 0,
      toJSON: () => ({})
    } as DOMRect;
  };
  // The magnifier samples through a canvas, which jsdom does not implement.
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    imageSmoothingEnabled: false,
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    getImageData: () => ({ data: Uint8ClampedArray.from([79, 201, 218, 255]) })
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

afterEach(() => {
  vi.unstubAllGlobals();
  HTMLElement.prototype.getBoundingClientRect = originalRect;
  if (originalDecode) HTMLImageElement.prototype.decode = originalDecode;
  else delete (HTMLImageElement.prototype as { decode?: typeof HTMLImageElement.prototype.decode }).decode;
  vi.mocked(invoke).mockReset();
});

async function mountOverlay() {
  render(<ScreenshotOverlayApp />);
  // The frame plan arrives asynchronously. The overlay is usable from then on;
  // its pixels, which only feed the magnifier, load and decode afterwards.
  await waitFor(() => expect(document.querySelector('.screenshot-overlay__frame')).not.toBeNull());
  return {
    overlay: document.querySelector('.screenshot-overlay') as HTMLElement,
    frame: document.querySelector('.screenshot-overlay__frame') as HTMLImageElement
  };
}

async function renderOverlay() {
  const mounted = await mountOverlay();
  fireEvent.load(mounted.frame);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('capture_window_ready'));
  return mounted.overlay;
}

/// A pointer event jsdom will dispatch, since it has no PointerEvent constructor.
function pointerEvent(type: string, x: number, y: number) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0
  });
  return event;
}

describe('the overlay end to end', () => {
  it('reports ready and accepts a selection before the frame pixels decode', async () => {
    // The frozen desktop is painted natively beneath this transparent overlay, so
    // waiting for the WebView's own copy would only delay the first interaction.
    const { overlay, frame } = await mountOverlay();
    vi.mocked(frame.decode).mockReturnValue(new Promise<void>(() => {}));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('capture_window_ready'));
    overlay.dispatchEvent(pointerEvent('pointerdown', 100, 100));
    overlay.dispatchEvent(pointerEvent('pointermove', 300, 200));

    await waitFor(() => expect(document.querySelector('.screenshot-selection')).not.toBeNull());
  });

  it('shows the magnifier only once the frame pixels have decoded', async () => {
    let finishDecode: (() => void) | undefined;
    const { overlay, frame } = await mountOverlay();
    vi.mocked(frame.decode).mockReturnValue(
      new Promise<void>((resolve) => {
        finishDecode = resolve;
      })
    );
    fireEvent.load(frame);
    overlay.dispatchEvent(pointerEvent('pointermove', 200, 200));

    // No flash of the "unavailable" readout while the pixels are still on their way.
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('capture_window_ready'));
    expect(document.querySelector('.screenshot-magnifier')).toBeNull();

    finishDecode?.();
    await waitFor(() =>
      expect(document.querySelector('.screenshot-magnifier__hex')?.textContent).toBe('#4FC9DA')
    );
  });

  it('loads the frame pixels at their physical size without painting them', async () => {
    await renderOverlay();

    const frame = document.querySelector('.screenshot-overlay__frame') as HTMLImageElement;

    expect(frame.getAttribute('src')).toBe('nowly-frame://localhost/7/1');
    expect(frame.getAttribute('width')).toBe('2240');
    expect(frame.getAttribute('height')).toBe('1400');
    expect(frame.crossOrigin).toBe('anonymous');
  });

  it('states a failed frame description in place', async () => {
    // The window is transparent, so a silent failure would look like the session
    // did nothing. design.md §11's Error state requires the failure to be stated
    // in place, with Esc still the way out.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(invoke).mockImplementation((command: string) =>
      command === 'describe_capture_frame'
        ? Promise.reject(new Error('截图会话已结束。'))
        : Promise.resolve(undefined)
    );
    render(<ScreenshotOverlayApp />);

    await waitFor(() =>
      expect(document.querySelector('.screenshot-overlay__note')?.textContent).toBe(
        translate('screenshot.overlayFailed')
      )
    );
    expect(invoke).toHaveBeenCalledWith('capture_window_failed');
    expect(invoke).not.toHaveBeenCalledWith('capture_window_ready');
    logged.mockRestore();
  });

  it('keeps the session when the frame pixels fail to load, reporting an unreadable colour', async () => {
    // §4.3: an unreadable pixel says so rather than guessing. The frozen desktop is
    // already on screen and exports read Rust's own copy, so the session stays.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { overlay, frame } = await mountOverlay();
    fireEvent.error(frame);
    overlay.dispatchEvent(pointerEvent('pointermove', 200, 200));

    await waitFor(() =>
      expect(document.querySelector('.screenshot-magnifier__hex')?.textContent).toBe(
        translate('screenshot.magnifier.unavailable')
      )
    );
    expect(invoke).not.toHaveBeenCalledWith('capture_window_failed');
    expect(document.querySelector('.screenshot-overlay__note')).toBeNull();
    logged.mockRestore();
  });

  it('does not sample pixels whose natural size differs from the plan', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { overlay, frame } = await mountOverlay();
    Object.defineProperty(frame, 'naturalWidth', { configurable: true, value: FRAME.width - 1 });

    fireEvent.load(frame);
    overlay.dispatchEvent(pointerEvent('pointermove', 200, 200));

    await waitFor(() =>
      expect(document.querySelector('.screenshot-magnifier__hex')?.textContent).toBe(
        translate('screenshot.magnifier.unavailable')
      )
    );
    expect(invoke).not.toHaveBeenCalledWith('capture_window_failed');
    logged.mockRestore();
  });

  it('dims the whole frame while aiming, before any drag', async () => {
    // Without this the overlay is a pixel-identical copy of the desktop: the bar
    // hides, nothing else changes, and the session looks like it did nothing.
    // §4.2 masks the non-selection area with `--bg-overlay`, and before the first
    // drag the whole frame is non-selection.
    await renderOverlay();

    expect(document.querySelector('.screenshot-overlay__aim-dim')).not.toBeNull();
  });

  it('drops the aiming dim once a selection exists', async () => {
    // The selection layer owns the mask from then on, and two stacked dims would
    // darken the unselected area twice.
    const overlay = await renderOverlay();

    overlay.dispatchEvent(pointerEvent('pointerdown', 100, 100));
    overlay.dispatchEvent(pointerEvent('pointermove', 300, 200));

    await waitFor(() => expect(document.querySelector('.screenshot-selection')).not.toBeNull());
    expect(document.querySelector('.screenshot-overlay__aim-dim')).toBeNull();
  });

  it('shows no selection, toolbar or size readout before a drag', async () => {
    await renderOverlay();

    expect(document.querySelector('.screenshot-selection')).toBeNull();
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
  });

  it('previews and commits the topmost frozen window candidate from hover and click', async () => {
    vi.mocked(invoke).mockResolvedValue({
      path: '7/1',
      width: FRAME.width,
      height: FRAME.height,
      originX: 0,
      originY: 0,
      windowCandidates: [
        { x: 150, y: 150, width: 300, height: 240 },
        { x: 75, y: 75, width: 600, height: 480 }
      ]
    });
    const overlay = await renderOverlay();

    overlay.dispatchEvent(pointerEvent('pointermove', 100, 100));

    await waitFor(() =>
      expect(document.querySelector('.screenshot-selection__frame')).not.toBeNull()
    );
    expect(document.querySelector('.screenshot-selection__handle')).toBeNull();
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();

    overlay.dispatchEvent(pointerEvent('pointerdown', 100, 100));
    overlay.dispatchEvent(pointerEvent('pointerup', 100, 100));

    await waitFor(() => expect(screen.getByRole('toolbar')).toBeInTheDocument());
    expect(document.querySelector('.screenshot-selection__size')?.textContent).toBe('300 × 240');
  });

  it('draws a selection while dragging and reports physical pixels', async () => {
    const overlay = await renderOverlay();

    overlay.dispatchEvent(pointerEvent('pointerdown', 100, 100));
    overlay.dispatchEvent(pointerEvent('pointermove', 300, 200));

    // 1.5×: 200×100 CSS becomes 300×150 physical.
    await waitFor(() =>
      expect(document.querySelector('.screenshot-selection__size')?.textContent).toBe('300 × 150')
    );
    // No handles or toolbar mid-drag.
    expect(document.querySelector('.screenshot-selection__handle')).toBeNull();
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
  });

  it('shows the toolbar once the drag commits', async () => {
    const overlay = await renderOverlay();

    overlay.dispatchEvent(pointerEvent('pointerdown', 100, 100));
    overlay.dispatchEvent(pointerEvent('pointermove', 400, 300));
    overlay.dispatchEvent(pointerEvent('pointerup', 400, 300));

    await waitFor(() => expect(screen.getByRole('toolbar')).toBeInTheDocument());
  });

  it('hides the magnifier once the selection is committed', async () => {
    // §4.2 line 166: the magnifier is for aiming; the toolbar replaces it.
    const overlay = await renderOverlay();

    overlay.dispatchEvent(pointerEvent('pointermove', 200, 200));
    await waitFor(() =>
      expect(document.querySelector('.screenshot-magnifier')).not.toBeNull()
    );

    overlay.dispatchEvent(pointerEvent('pointerdown', 100, 100));
    overlay.dispatchEvent(pointerEvent('pointermove', 400, 300));
    overlay.dispatchEvent(pointerEvent('pointerup', 400, 300));

    await waitFor(() => expect(document.querySelector('.screenshot-magnifier')).toBeNull());
  });

  it('shows the sampled colour while aiming', async () => {
    const overlay = await renderOverlay();

    overlay.dispatchEvent(pointerEvent('pointermove', 200, 200));

    // The stubbed canvas returns --color-primary.
    await waitFor(() =>
      expect(document.querySelector('.screenshot-magnifier__hex')?.textContent).toBe('#4FC9DA')
    );
  });

  it('produces nothing from a click that never moved', async () => {
    // §4.2 line 165.
    const overlay = await renderOverlay();

    overlay.dispatchEvent(pointerEvent('pointerdown', 100, 100));
    overlay.dispatchEvent(pointerEvent('pointerup', 100, 100));

    await waitFor(() => expect(screen.queryByRole('toolbar')).not.toBeInTheDocument());
    expect(document.querySelector('.screenshot-selection')).toBeNull();
  });

  it('repositions the toolbar when selecting a tool opens its property panel', async () => {
    const user = userEvent.setup();
    let notifyResize: (() => void) | undefined;
    const observe = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) {
        notifyResize = () => callback([], this as ResizeObserver);
      }
      observe = observe;
      unobserve = vi.fn();
      disconnect = vi.fn();
    });
    HTMLElement.prototype.getBoundingClientRect = function rect(this: HTMLElement) {
      const isToolbar = this.classList.contains('screenshot-toolbar-anchor');
      const size = isToolbar
        ? { width: 592, height: this.querySelector('.screenshot-properties') ? 120 : 56 }
        : RENDERED;
      return {
        ...size,
        left: 0,
        top: 0,
        right: size.width,
        bottom: size.height,
        x: 0,
        y: 0,
        toJSON: () => ({})
      } as DOMRect;
    };

    const overlay = await renderOverlay();
    overlay.dispatchEvent(pointerEvent('pointerdown', 100, 100));
    overlay.dispatchEvent(pointerEvent('pointermove', 600, 850));
    overlay.dispatchEvent(pointerEvent('pointerup', 600, 850));
    await waitFor(() => expect(screen.getByRole('toolbar')).toBeInTheDocument());
    const anchor = document.querySelector('.screenshot-toolbar-anchor') as HTMLElement;
    await waitFor(() => expect(Number.parseFloat(anchor.style.top)).toBeCloseTo(858));

    await user.click(screen.getByRole('button', { name: '矩形' }));
    expect(document.querySelector('.screenshot-properties')).toBeInTheDocument();
    expect(observe).toHaveBeenCalledWith(anchor);
    notifyResize?.();

    await waitFor(() => expect(Number.parseFloat(anchor.style.top)).toBeLessThan(858));
    expect(Number.parseFloat(anchor.style.top) + 120).toBeLessThanOrEqual(RENDERED.height - 8);
  });

  it('keeps the toolbar inside the display', async () => {
    const overlay = await renderOverlay();

    overlay.dispatchEvent(pointerEvent('pointerdown', 1400, 880));
    overlay.dispatchEvent(pointerEvent('pointermove', 1490, 930));
    overlay.dispatchEvent(pointerEvent('pointerup', 1490, 930));

    await waitFor(() => expect(screen.getByRole('toolbar')).toBeInTheDocument());

    const anchor = document.querySelector('.screenshot-toolbar-anchor') as HTMLElement;
    const left = Number.parseFloat(anchor.style.left);
    const top = Number.parseFloat(anchor.style.top);

    expect(left).toBeGreaterThanOrEqual(8);
    expect(left + 592).toBeLessThanOrEqual(RENDERED.width - 8);
    expect(top + 56).toBeLessThanOrEqual(RENDERED.height - 8);
  });
});

describe('drawing annotations', () => {
  /// Commits a selection, which is the precondition for any annotation.
  async function withSelection() {
    const overlay = await renderOverlay();
    overlay.dispatchEvent(pointerEvent('pointerdown', 100, 100));
    overlay.dispatchEvent(pointerEvent('pointermove', 600, 500));
    overlay.dispatchEvent(pointerEvent('pointerup', 600, 500));
    await waitFor(() => expect(screen.getByRole('toolbar')).toBeInTheDocument());
    return overlay;
  }

  it('draws nothing with the default select tool', async () => {
    const overlay = await withSelection();

    overlay.dispatchEvent(pointerEvent('pointerdown', 200, 200));
    overlay.dispatchEvent(pointerEvent('pointermove', 300, 300));
    overlay.dispatchEvent(pointerEvent('pointerup', 300, 300));

    expect(document.querySelector('[data-kind="rect"]')).toBeNull();
  });

  it('draws a rectangle once the rectangle tool is chosen', async () => {
    const user = userEvent.setup();
    const overlay = await withSelection();

    await user.click(screen.getByRole('button', { name: '矩形' }));
    overlay.dispatchEvent(pointerEvent('pointerdown', 200, 200));
    overlay.dispatchEvent(pointerEvent('pointermove', 300, 280));
    overlay.dispatchEvent(pointerEvent('pointerup', 300, 280));

    await waitFor(() => expect(document.querySelector('[data-kind="rect"]')).not.toBeNull());
    // 1.5×: a 100×80 CSS drag is 150×120 physical.
    const rect = document.querySelector('[data-kind="rect"]')!;
    expect(rect.getAttribute('width')).toBe('150');
    expect(rect.getAttribute('height')).toBe('120');
  });

  it('enables undo after one drag and removes the shape when used', async () => {
    const user = userEvent.setup();
    const overlay = await withSelection();

    await user.click(screen.getByRole('button', { name: '矩形' }));
    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled();

    overlay.dispatchEvent(pointerEvent('pointerdown', 200, 200));
    overlay.dispatchEvent(pointerEvent('pointermove', 300, 280));
    overlay.dispatchEvent(pointerEvent('pointerup', 300, 280));

    await waitFor(() => expect(screen.getByRole('button', { name: '撤销' })).toBeEnabled());

    await user.click(screen.getByRole('button', { name: '撤销' }));

    // One drag is one undo step, so the shape is gone in a single press.
    await waitFor(() => expect(document.querySelector('[data-kind="rect"]')).toBeNull());
  });


});

describe('editing a committed annotation', () => {
  async function withRectangle() {
    const user = userEvent.setup();
    const overlay = await renderOverlay();
    overlay.dispatchEvent(pointerEvent('pointerdown', 100, 100));
    overlay.dispatchEvent(pointerEvent('pointermove', 600, 500));
    overlay.dispatchEvent(pointerEvent('pointerup', 600, 500));
    await waitFor(() => expect(screen.getByRole('toolbar')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: '矩形' }));
    overlay.dispatchEvent(pointerEvent('pointerdown', 200, 200));
    overlay.dispatchEvent(pointerEvent('pointermove', 300, 280));
    overlay.dispatchEvent(pointerEvent('pointerup', 300, 280));
    await waitFor(() => expect(document.querySelector('[data-kind="rect"]')).not.toBeNull());
    // Back to the select tool, which is the one that picks objects up.
    await user.click(screen.getByRole('button', { name: '选择' }));
    return { overlay, user };
  }
  /// The rectangle's position in the layer, which is selection-relative physical
  /// pixels: the drag above starts at CSS 200,200 inside a selection at CSS
  /// 100,100, so 100 CSS × 1.5 = 150.
  function rectangleAt() {
    const rect = document.querySelector('[data-kind="rect"]')!;
    return { x: rect.getAttribute('x'), y: rect.getAttribute('y') };
  }

  it('selects a committed shape by pressing on its edge', async () => {
    const { overlay } = await withRectangle();

    overlay.dispatchEvent(pointerEvent('pointerdown', 200, 240));

    await waitFor(() =>
      expect(document.querySelector('[data-selected-for]')).not.toBeNull()
    );
  });

  it('shows a move cursor over a shape and a crosshair over empty frame', async () => {
    // The annotation layer takes no pointer events, so the surface's own cursor is
    // the only hint that a committed shape can be grabbed at all.
    const user = userEvent.setup();
    const { overlay } = await withRectangle();

    overlay.dispatchEvent(pointerEvent('pointermove', 200, 240));
    await waitFor(() => expect(overlay.style.cursor).toBe('move'));

    // Inside the selection but off the shape, with the select tool: nothing to
    // draw and nothing to grab except the rectangle itself.
    overlay.dispatchEvent(pointerEvent('pointermove', 250, 240));
    await waitFor(() => expect(overlay.style.cursor).toBe('move'));

    await user.click(screen.getByRole('button', { name: '矩形' }));
    overlay.dispatchEvent(pointerEvent('pointermove', 250, 240));
    await waitFor(() => expect(overlay.style.cursor).toBe('crosshair'));
    // Back over the shape, the move cursor wins over the active drawing tool,
    // because the press would pick the shape up rather than draw.
    overlay.dispatchEvent(pointerEvent('pointermove', 200, 240));
    await waitFor(() => expect(overlay.style.cursor).toBe('move'));
  });

  it('drags a committed shape to a new position', async () => {
    const { overlay } = await withRectangle();
    expect(rectangleAt()).toEqual({ x: '150', y: '150' });

    overlay.dispatchEvent(pointerEvent('pointerdown', 200, 240));
    overlay.dispatchEvent(pointerEvent('pointermove', 240, 240));
    overlay.dispatchEvent(pointerEvent('pointerup', 240, 240));

    // 40 CSS pixels right is 60 physical.
    await waitFor(() => expect(rectangleAt()).toEqual({ x: '210', y: '150' }));
  });

  it('picks a shape up without first switching back to the select tool', async () => {
    // The tool stays on "rectangle" after a drag. Requiring a trip to the select
    // button first is what made a drawn shape look permanent: the next press on it
    // drew a second rectangle on top instead of moving the first.
    const user = userEvent.setup();
    const overlay = await renderOverlay();
    overlay.dispatchEvent(pointerEvent('pointerdown', 100, 100));
    overlay.dispatchEvent(pointerEvent('pointermove', 600, 500));
    overlay.dispatchEvent(pointerEvent('pointerup', 600, 500));
    await waitFor(() => expect(screen.getByRole('toolbar')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: '矩形' }));
    overlay.dispatchEvent(pointerEvent('pointerdown', 200, 200));
    overlay.dispatchEvent(pointerEvent('pointermove', 300, 280));
    overlay.dispatchEvent(pointerEvent('pointerup', 300, 280));
    await waitFor(() => expect(document.querySelector('[data-kind="rect"]')).not.toBeNull());

    // Straight onto the shape's edge, with the rectangle tool still active.
    overlay.dispatchEvent(pointerEvent('pointerdown', 200, 240));
    overlay.dispatchEvent(pointerEvent('pointermove', 240, 240));
    overlay.dispatchEvent(pointerEvent('pointerup', 240, 240));

    await waitFor(() => expect(rectangleAt()).toEqual({ x: '210', y: '150' }));
    // Moved, not duplicated.
    expect(document.querySelectorAll('[data-kind="rect"]')).toHaveLength(1);
    // The toolbar reports the switch, so the next drag is a move rather than a
    // surprise rectangle.
    expect(screen.getByRole('button', { name: '选择' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('still draws a new shape beside an existing one', async () => {
    // Grabbing must not swallow every press: only the object's own geometry is a
    // hit, so the empty space next to it still belongs to the drawing tool.
    const user = userEvent.setup();
    const overlay = await renderOverlay();
    overlay.dispatchEvent(pointerEvent('pointerdown', 100, 100));
    overlay.dispatchEvent(pointerEvent('pointermove', 600, 500));
    overlay.dispatchEvent(pointerEvent('pointerup', 600, 500));
    await waitFor(() => expect(screen.getByRole('toolbar')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: '矩形' }));
    overlay.dispatchEvent(pointerEvent('pointerdown', 200, 200));
    overlay.dispatchEvent(pointerEvent('pointermove', 300, 280));
    overlay.dispatchEvent(pointerEvent('pointerup', 300, 280));
    await waitFor(() => expect(document.querySelectorAll('[data-kind="rect"]')).toHaveLength(1));

    overlay.dispatchEvent(pointerEvent('pointerdown', 400, 400));
    overlay.dispatchEvent(pointerEvent('pointermove', 450, 450));
    overlay.dispatchEvent(pointerEvent('pointerup', 450, 450));

    await waitFor(() => expect(document.querySelectorAll('[data-kind="rect"]')).toHaveLength(2));
  });

  it('undoes a move in one step, leaving the shape itself committed', async () => {
    const user = userEvent.setup();
    const { overlay } = await withRectangle();
    overlay.dispatchEvent(pointerEvent('pointerdown', 200, 240));
    overlay.dispatchEvent(pointerEvent('pointermove', 220, 240));
    overlay.dispatchEvent(pointerEvent('pointermove', 240, 240));
    overlay.dispatchEvent(pointerEvent('pointerup', 240, 240));
    await waitFor(() => expect(rectangleAt()).toEqual({ x: '210', y: '150' }));

    await user.click(screen.getByRole('button', { name: '撤销' }));

    await waitFor(() => expect(rectangleAt()).toEqual({ x: '150', y: '150' }));
    expect(document.querySelector('[data-kind="rect"]')).not.toBeNull();
  });

  it('deletes the selected shape with Delete', async () => {
    const { overlay } = await withRectangle();
    overlay.dispatchEvent(pointerEvent('pointerdown', 200, 240));
    await waitFor(() =>
      expect(document.querySelector('[data-selected-for]')).not.toBeNull()
    );

    fireEvent.keyDown(window, { key: 'Delete' });

    await waitFor(() => expect(document.querySelector('[data-kind="rect"]')).toBeNull());
    expect(invoke).not.toHaveBeenCalledWith('cancel_screen_capture');
  });

  it('nudges the selected shape with an arrow key instead of moving the selection', async () => {
    const { overlay } = await withRectangle();
    const before = document.querySelector('.screenshot-selection__frame')!.getAttribute('style');
    overlay.dispatchEvent(pointerEvent('pointerdown', 200, 240));
    await waitFor(() =>
      expect(document.querySelector('[data-selected-for]')).not.toBeNull()
    );

    fireEvent.keyDown(window, { key: 'ArrowRight', shiftKey: true });

    await waitFor(() => expect(rectangleAt()).toEqual({ x: '160', y: '150' }));
    // The capture rectangle is untouched: one key, one owner.
    expect(document.querySelector('.screenshot-selection__frame')!.getAttribute('style')).toBe(
      before
    );
  });

  it('clears the selection on Esc without cancelling the session', async () => {
    const { overlay } = await withRectangle();
    overlay.dispatchEvent(pointerEvent('pointerdown', 200, 240));
    await waitFor(() =>
      expect(document.querySelector('[data-selected-for]')).not.toBeNull()
    );

    fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => expect(document.querySelector('[data-selected-for]')).toBeNull());
    expect(invoke).not.toHaveBeenCalledWith('cancel_screen_capture');
    expect(document.querySelector('[data-kind="rect"]')).not.toBeNull();
  });

  it('rolls a move back on Esc without an undo entry', async () => {
    // §5 of the amendment: a cancelled transform creates no undo entry.
    const { overlay } = await withRectangle();

    overlay.dispatchEvent(pointerEvent('pointerdown', 200, 240));
    overlay.dispatchEvent(pointerEvent('pointermove', 240, 240));
    await waitFor(() => expect(rectangleAt()).toEqual({ x: '210', y: '150' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    overlay.dispatchEvent(pointerEvent('pointerup', 240, 240));

    await waitFor(() => expect(rectangleAt()).toEqual({ x: '150', y: '150' }));
    // Only the shape's own creation is in the history.
    await waitFor(() => expect(screen.getByRole('button', { name: '撤销' })).toBeEnabled());
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await waitFor(() => expect(document.querySelector('[data-kind="rect"]')).toBeNull());
  });

  it('re-edits a text annotation on double-click instead of finishing', async () => {
    const user = userEvent.setup();
    const overlay = await renderOverlay();
    overlay.dispatchEvent(pointerEvent('pointerdown', 100, 100));
    overlay.dispatchEvent(pointerEvent('pointermove', 600, 500));
    overlay.dispatchEvent(pointerEvent('pointerup', 600, 500));
    await waitFor(() => expect(screen.getByRole('toolbar')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: '文字' }));
    overlay.dispatchEvent(pointerEvent('pointerdown', 200, 200));
    const editor = await screen.findByRole('textbox', { name: '标注文字' });
    await user.type(editor, 'before');
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true });
    const text = await waitFor(() => {
      const node = document.querySelector('[data-kind="text"]');
      expect(node).not.toBeNull();
      return node!;
    });
    const id = text.getAttribute('data-id');
    await user.click(screen.getByRole('button', { name: '选择' }));

    fireEvent.dblClick(overlay, { clientX: 210, clientY: 210 });

    const reopened = await screen.findByRole('textbox', { name: '标注文字' });
    expect(reopened).toHaveValue('before');
    // A re-edit is not an export.
    expect(invoke).not.toHaveBeenCalledWith('copy_capture_to_clipboard', expect.anything());

    await user.clear(reopened);
    await user.type(reopened, 'after');
    fireEvent.keyDown(reopened, { key: 'Enter', ctrlKey: true });

    await waitFor(() =>
      expect(document.querySelector('[data-kind="text"]')!.textContent).toBe('after')
    );
    // The same object, updated in place, rather than a second one beside it.
    expect(document.querySelectorAll('[data-kind="text"]')).toHaveLength(1);
    expect(document.querySelector('[data-kind="text"]')!.getAttribute('data-id')).toBe(id);
  });
});

describe('the overlay keyboard', () => {
  function key(init: KeyboardEventInit) {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    window.dispatchEvent(event);
    return event;
  }

  async function withSelection() {
    const overlay = await renderOverlay();
    overlay.dispatchEvent(pointerEvent('pointerdown', 100, 100));
    overlay.dispatchEvent(pointerEvent('pointermove', 600, 500));
    overlay.dispatchEvent(pointerEvent('pointerup', 600, 500));
    await waitFor(() => expect(screen.getByRole('toolbar')).toBeInTheDocument());
    return overlay;
  }

  it('cancels the session on Esc before the frame is described', async () => {
    vi.mocked(invoke).mockImplementation((command: string) =>
      command === 'describe_capture_frame' ? new Promise(() => {}) : Promise.resolve(undefined)
    );
    render(<ScreenshotOverlayApp />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('describe_capture_frame'));

    key({ key: 'Escape' });

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('cancel_screen_capture'));
    expect(invoke).not.toHaveBeenCalledWith('capture_window_ready');
  });

  it('cancels the session on Esc while aiming', async () => {
    // The overlay no longer uses the Esc-only listener, so this is the only thing
    // keeping a full-screen overlay escapable.
    await renderOverlay();

    key({ key: 'Escape' });

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('cancel_screen_capture'));
  });

  it('cancels the session on Esc after a selection exists', async () => {
    await withSelection();

    key({ key: 'Escape' });

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('cancel_screen_capture'));
  });

  it('does not cancel during an IME composition', async () => {
    // §7: an unfinished composition owns Esc.
    await renderOverlay();

    key({ key: 'Escape', isComposing: true });

    expect(invoke).not.toHaveBeenCalledWith('cancel_screen_capture');
  });

  it('moves the selection with an arrow key', async () => {
    await withSelection();

    const sizeBefore = document.querySelector('.screenshot-selection__size')!.textContent;
    const leftBefore = Number.parseFloat(
      (document.querySelector('.screenshot-selection__frame') as HTMLElement).style.left
    );

    key({ key: 'ArrowRight' });

    // One physical pixel right, which is 1/1.5 CSS pixels at this scale. Compared
    // against the measured start value, so the assertion cannot pass without the
    // move actually happening.
    await waitFor(() => {
      const frame = document.querySelector('.screenshot-selection__frame') as HTMLElement;
      expect(Number.parseFloat(frame.style.left)).toBeGreaterThan(leftBefore);
    });
    // Moving does not resize.
    expect(document.querySelector('.screenshot-selection__size')!.textContent).toBe(sizeBefore);
  });

  it('undoes an annotation with Ctrl+Z', async () => {
    const user = userEvent.setup();
    const overlay = await withSelection();

    await user.click(
      screen.getByRole('button', { name: translate(CONTROL_LABEL_KEYS.rect) })
    );
    overlay.dispatchEvent(pointerEvent('pointerdown', 200, 200));
    overlay.dispatchEvent(pointerEvent('pointermove', 300, 280));
    overlay.dispatchEvent(pointerEvent('pointerup', 300, 280));
    await waitFor(() => expect(document.querySelector('[data-kind="rect"]')).not.toBeNull());

    key({ key: 'z', ctrlKey: true });

    await waitFor(() => expect(document.querySelector('[data-kind="rect"]')).toBeNull());
  });

  it('stops moving the selection once an annotation locks it', async () => {
    // §5.3: the first committed annotation locks the capture rectangle.
    const user = userEvent.setup();
    const overlay = await withSelection();

    await user.click(
      screen.getByRole('button', { name: translate(CONTROL_LABEL_KEYS.rect) })
    );
    overlay.dispatchEvent(pointerEvent('pointerdown', 200, 200));
    overlay.dispatchEvent(pointerEvent('pointermove', 300, 280));
    overlay.dispatchEvent(pointerEvent('pointerup', 300, 280));
    await waitFor(() => expect(document.querySelector('[data-kind="rect"]')).not.toBeNull());

    const frame = document.querySelector('.screenshot-selection__frame') as HTMLElement;
    const before = frame.style.left;
    key({ key: 'ArrowRight' });

    expect((document.querySelector('.screenshot-selection__frame') as HTMLElement).style.left).toBe(
      before
    );
  });
});

describe('the capture session placeholder', () => {
  it('acknowledges again when its prewarmed session begins', async () => {
    // Rust ignores the load-time acknowledgement of a window built before its
    // session existed, so the begin event must produce a fresh one.
    let begin: (() => void) | undefined;
    vi.mocked(listen).mockImplementationOnce((_event, handler) => {
      begin = handler as unknown as () => void;
      return Promise.resolve(() => {});
    });
    render(<ScreenshotSessionApp />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('capture_window_ready'));
    expect(vi.mocked(listen)).toHaveBeenCalledWith('screenshot-capture-begin', expect.any(Function));

    begin?.();

    await waitFor(() =>
      expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === 'capture_window_ready'))
        .toHaveLength(2)
    );
  });

  it('reports ready after its static privacy surface mounts', async () => {
    render(<ScreenshotSessionApp />);

    expect(document.querySelector('.screenshot-session')).not.toBeNull();
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('capture_window_ready'));
  });
});

describe('the text tool end to end', () => {
  async function withSelection() {
    const overlay = await renderOverlay();
    overlay.dispatchEvent(pointerEvent('pointerdown', 100, 100));
    overlay.dispatchEvent(pointerEvent('pointermove', 600, 500));
    overlay.dispatchEvent(pointerEvent('pointerup', 600, 500));
    await waitFor(() => expect(screen.getByRole('toolbar')).toBeInTheDocument());
    return overlay;
  }

  it('opens an editor on click and commits the text as an annotation', async () => {
    const user = userEvent.setup();
    const overlay = await withSelection();

    await user.click(screen.getByRole('button', { name: translate(CONTROL_LABEL_KEYS.text) }));
    const acceptedDefaultFocus = overlay.dispatchEvent(pointerEvent('pointerdown', 250, 250));

    const editor = await screen.findByRole('textbox');
    expect(acceptedDefaultFocus).toBe(false);
    await user.type(editor, 'note');
    await user.keyboard('{Control>}{Enter}{/Control}');

    await waitFor(() => expect(document.querySelector('[data-kind="text"]')).not.toBeNull());
    expect(document.querySelector('[data-kind="text"]')!.textContent).toBe('note');
    // The editor closes once committed.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('creates no object for an empty editor', async () => {
    // §5.3: text with no visible content is not an object.
    const user = userEvent.setup();
    const overlay = await withSelection();

    await user.click(screen.getByRole('button', { name: translate(CONTROL_LABEL_KEYS.text) }));
    overlay.dispatchEvent(pointerEvent('pointerdown', 250, 250));

    const editor = await screen.findByRole('textbox');
    await user.keyboard('{Control>}{Enter}{/Control}');
    void editor;

    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument());
    expect(document.querySelector('[data-kind="text"]')).toBeNull();
    // An empty commit is not a transaction either.
    expect(screen.getByRole('button', { name: translate(CONTROL_LABEL_KEYS.undo) })).toBeDisabled();
  });

  it('does not cancel the whole session when Esc closes the editor', async () => {
    // §7's Esc ladder: the editor is the innermost layer, so Esc takes only that.
    const user = userEvent.setup();
    const overlay = await withSelection();

    await user.click(screen.getByRole('button', { name: translate(CONTROL_LABEL_KEYS.text) }));
    overlay.dispatchEvent(pointerEvent('pointerdown', 250, 250));

    const editor = await screen.findByRole('textbox');
    await user.type(editor, 'draft');
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument());
    expect(invoke).not.toHaveBeenCalledWith('cancel_screen_capture');
    expect(document.querySelector('[data-kind="text"]')).toBeNull();
  });
});

describe('copying the capture', () => {
  async function withSelection() {
    const overlay = await renderOverlay();
    overlay.dispatchEvent(pointerEvent('pointerdown', 100, 100));
    overlay.dispatchEvent(pointerEvent('pointermove', 600, 500));
    overlay.dispatchEvent(pointerEvent('pointerup', 600, 500));
    await waitFor(() => expect(screen.getByRole('toolbar')).toBeInTheDocument());
    return overlay;
  }

  it('sends the selection in physical pixels and stages nothing without annotations', async () => {
    const user = userEvent.setup();
    await withSelection();

    await user.click(screen.getByRole('button', { name: translate(CONTROL_LABEL_KEYS.done) }));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('copy_capture_to_clipboard', {
        geometry: {
          // 1.5×: the 100,100 → 600,500 CSS drag is 150,150 → 900,750 physical.
          x: 150,
          y: 150,
          width: 750,
          height: 600,
          mosaics: [],
          version: 0,
          hasOverlay: false
        }
      })
    );
    // No annotations, so no overlay is rasterised or staged.
    expect(invoke).not.toHaveBeenCalledWith('stage_capture_overlay', expect.anything(), expect.anything());
  });

  it('shows a static failure line and keeps the session when the copy fails', async () => {
    // §8.1: a failure keeps the selection and every annotation, and the message sits
    // beside the control rather than in a toast.
    const user = userEvent.setup();
    await withSelection();
    vi.mocked(invoke).mockImplementation((command: string) => {
      if (command === 'copy_capture_to_clipboard') {
        return Promise.reject(new Error('剪贴板被占用，请重试或保存图片。'));
      }
      return Promise.resolve({ path: '7/1', width: FRAME.width, height: FRAME.height });
    });

    await user.click(screen.getByRole('button', { name: translate(CONTROL_LABEL_KEYS.done) }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('复制失败，请重试或保存图片。');
    // The editor is still there.
    expect(screen.getByRole('toolbar')).toBeInTheDocument();
    expect(document.querySelector('.screenshot-selection')).not.toBeNull();
  });

  it('freezes the finishing controls during the copy but never cancel', async () => {
    // §8.1: the version is frozen, repeat finishing is disabled, and cancel stays
    // reachable so a stuck export cannot trap the session.
    const user = userEvent.setup();
    await withSelection();
    let settle: (() => void) | undefined;
    vi.mocked(invoke).mockImplementation((command: string) => {
      if (command === 'copy_capture_to_clipboard') {
        return new Promise<void>((resolve) => {
          settle = resolve;
        });
      }
      return Promise.resolve({ path: '7/1', width: FRAME.width, height: FRAME.height });
    });

    await user.click(screen.getByRole('button', { name: translate(CONTROL_LABEL_KEYS.done) }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: translate(CONTROL_LABEL_KEYS.done) })).toBeDisabled()
    );
    expect(screen.getByRole('button', { name: translate(CONTROL_LABEL_KEYS.save) })).toBeDisabled();
    expect(screen.getByRole('button', { name: translate(CONTROL_LABEL_KEYS.cancel) })).toBeEnabled();
    // The static status, not a spinner.
    expect(document.querySelector('.screenshot-export-status')?.textContent).toBe('正在处理…');

    settle?.();
  });

  it('copies on Enter from the canvas', async () => {
    await withSelection();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('copy_capture_to_clipboard', expect.anything())
    );
  });

  it('lets a focused toolbar button own Enter without exporting', async () => {
    const user = userEvent.setup();
    await withSelection();
    const rectangle = screen.getByRole('button', {
      name: translate(CONTROL_LABEL_KEYS.rect)
    });

    rectangle.focus();
    await user.keyboard('{Enter}');

    expect(rectangle).toHaveAttribute('aria-pressed', 'true');
    expect(invoke).not.toHaveBeenCalledWith('copy_capture_to_clipboard', expect.anything());
  });
});

describe('saving the capture', () => {
  async function withSelection() {
    const overlay = await renderOverlay();
    overlay.dispatchEvent(pointerEvent('pointerdown', 100, 100));
    overlay.dispatchEvent(pointerEvent('pointermove', 600, 500));
    overlay.dispatchEvent(pointerEvent('pointerup', 600, 500));
    await waitFor(() => expect(screen.getByRole('toolbar')).toBeInTheDocument());
    return overlay;
  }

  it('sends the same geometry as the copy path', async () => {
    // §8.1: the file and the clipboard must be built from one description, so a
    // future change cannot make them disagree.
    const user = userEvent.setup();
    await withSelection();

    await user.click(screen.getByRole('button', { name: translate(CONTROL_LABEL_KEYS.save) }));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('save_capture_to_file', {
        geometry: {
          x: 150,
          y: 150,
          width: 750,
          height: 600,
          mosaics: [],
          version: 0,
          hasOverlay: false
        }
      })
    );
  });

  it('returns the controls when the dialog is cancelled', async () => {
    // A cancelled Save As is a normal outcome, not a failure: §8.2 keeps the session
    // exactly as it was, so the editor must come back rather than show an error.
    const user = userEvent.setup();
    await withSelection();
    vi.mocked(invoke).mockImplementation((command: string) => {
      if (command === 'save_capture_to_file') return Promise.resolve(false);
      return Promise.resolve({ path: '7/1', width: FRAME.width, height: FRAME.height });
    });

    await user.click(screen.getByRole('button', { name: translate(CONTROL_LABEL_KEYS.save) }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: translate(CONTROL_LABEL_KEYS.save) })).toBeEnabled()
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.querySelector('.screenshot-export-status')).toBeNull();
  });

  it('shows the message Rust sent rather than a generic one', async () => {
    // A Rust rejection is a serialised CommandError whose message is already
    // localised and phrased per §8.3. Replacing it with a generic line would lose the
    // specific next step it tells the user to take.
    const user = userEvent.setup();
    await withSelection();
    vi.mocked(invoke).mockImplementation((command: string) => {
      if (command === 'save_capture_to_file') {
        return Promise.reject({ code: 'system_error', message: '保存位置已变化，请重新选择。', field: null });
      }
      return Promise.resolve({ path: '7/1', width: FRAME.width, height: FRAME.height });
    });

    await user.click(screen.getByRole('button', { name: translate(CONTROL_LABEL_KEYS.save) }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('保存位置已变化，请重新选择。');
  });

  it('falls back to a localised line when the failure is local', async () => {
    // A local throw carries developer-facing English, which must never reach the user.
    const user = userEvent.setup();
    await withSelection();
    vi.mocked(invoke).mockImplementation((command: string) => {
      if (command === 'save_capture_to_file') {
        return Promise.reject(new Error('the annotation layer is not rendered'));
      }
      return Promise.resolve({ path: '7/1', width: FRAME.width, height: FRAME.height });
    });

    await user.click(screen.getByRole('button', { name: translate(CONTROL_LABEL_KEYS.save) }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('保存失败，请重试或复制图片。');
  });
});

describe('the mosaic preview', () => {
  async function withMosaic() {
    const overlay = await renderOverlay();
    overlay.dispatchEvent(pointerEvent('pointerdown', 100, 100));
    overlay.dispatchEvent(pointerEvent('pointermove', 600, 500));
    overlay.dispatchEvent(pointerEvent('pointerup', 600, 500));
    await waitFor(() => expect(screen.getByRole('toolbar')).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: translate(CONTROL_LABEL_KEYS.mosaic) }));
    // One drag inside the selection commits one mosaic object.
    overlay.dispatchEvent(pointerEvent('pointerdown', 200, 200));
    overlay.dispatchEvent(pointerEvent('pointermove', 300, 260));
    overlay.dispatchEvent(pointerEvent('pointerup', 300, 260));
    return overlay;
  }

  it('paints on pointer down and retains the canvas through release', async () => {
    const overlay = await renderOverlay();
    overlay.dispatchEvent(pointerEvent('pointerdown', 100, 100));
    overlay.dispatchEvent(pointerEvent('pointermove', 600, 500));
    overlay.dispatchEvent(pointerEvent('pointerup', 600, 500));
    await waitFor(() => expect(screen.getByRole('toolbar')).toBeInTheDocument());
    await userEvent.setup().click(screen.getByRole('button', { name: translate(CONTROL_LABEL_KEYS.mosaic) }));
    overlay.dispatchEvent(pointerEvent('pointerdown', 200, 200));
    const preview = await waitFor(() => {
      const canvas = document.querySelector('canvas.screenshot-overlay__mosaic');
      expect(canvas).not.toBeNull();
      return canvas as HTMLCanvasElement;
    });
    expect(document.querySelector('[data-kind="mosaic"]')).toBeNull();
    overlay.dispatchEvent(pointerEvent('pointermove', 300, 260));
    overlay.dispatchEvent(pointerEvent('pointerup', 300, 260));
    await waitFor(() => expect(document.querySelector('canvas.screenshot-overlay__mosaic')).toBe(preview));
    expect(invoke).not.toHaveBeenCalledWith('render_mosaic_preview', expect.anything());
  });

  it('positions the live pixels over the physical selection', async () => {
    await withMosaic();
    const preview = await waitFor(() => {
      const found = document.querySelector('canvas.screenshot-overlay__mosaic');
      expect(found).not.toBeNull();
      return found as HTMLCanvasElement;
    });
    expect(preview.width).toBe(750);
    expect(preview.height).toBe(600);
    expect(parseFloat(preview.style.left)).toBeCloseTo(100, 6);
    expect(parseFloat(preview.style.top)).toBeCloseTo(100, 6);
    expect(parseFloat(preview.style.width)).toBeCloseTo(500, 6);
  });

  it('does not render a preview when there are no mosaics', async () => {
    // Otherwise every session would pay for an encode it does not need.
    const overlay = await renderOverlay();
    overlay.dispatchEvent(pointerEvent('pointerdown', 100, 100));
    overlay.dispatchEvent(pointerEvent('pointermove', 600, 500));
    overlay.dispatchEvent(pointerEvent('pointerup', 600, 500));
    await waitFor(() => expect(screen.getByRole('toolbar')).toBeInTheDocument());

    expect(invoke).not.toHaveBeenCalledWith('render_mosaic_preview', expect.anything());
    expect(document.querySelector('.screenshot-overlay__mosaic')).toBeNull();
  });


});



describe('copying the colour under the pointer', () => {
  it('asks Rust for the colour at the pointer pixel', async () => {
    // §4.1 line 157: the sample comes from the frozen base image's own pixels, so the
    // coordinate travels and Rust reads the frame. Sending a hex string derived from the
    // canvas could differ from the pixel the file contains.
    const overlay = await renderOverlay();
    overlay.dispatchEvent(pointerEvent('pointermove', 200, 160));

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true, cancelable: true })
    );

    // 200,160 CSS at 1.5× is 300,240 physical.
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('copy_capture_color', { x: 300, y: 240 })
    );
  });

  it('reports a successful copy in the magnifier hint', async () => {
    vi.mocked(invoke).mockImplementation((command: string) => {
      if (command === 'copy_capture_color') return Promise.resolve(true);
      return Promise.resolve({ path: '7/1', width: FRAME.width, height: FRAME.height });
    });
    const overlay = await renderOverlay();
    overlay.dispatchEvent(pointerEvent('pointermove', 200, 160));

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true, cancelable: true })
    );

    await waitFor(() => expect(screen.getByText('色值已复制')).toBeInTheDocument());
  });

  it('does not claim a colour was copied from a desktop gap', async () => {
    // §4.1 line 159: the clipboard is left alone there, so the hint must not say the
    // value was copied. Rust reports false rather than throwing.
    vi.mocked(invoke).mockImplementation((command: string) => {
      if (command === 'copy_capture_color') return Promise.resolve(false);
      return Promise.resolve({ path: '7/1', width: FRAME.width, height: FRAME.height });
    });
    const overlay = await renderOverlay();
    overlay.dispatchEvent(pointerEvent('pointermove', 200, 160));

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true, cancelable: true })
    );

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('copy_capture_color', expect.anything())
    );
    expect(screen.queryByText('色值已复制')).toBeNull();
  });

  it('shows a retry hint when the copy fails and keeps the session', async () => {
    vi.mocked(invoke).mockImplementation((command: string) => {
      if (command === 'copy_capture_color') return Promise.reject(new Error('busy'));
      return Promise.resolve({ path: '7/1', width: FRAME.width, height: FRAME.height });
    });
    const overlay = await renderOverlay();
    overlay.dispatchEvent(pointerEvent('pointermove', 200, 160));

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true, cancelable: true })
    );

    await waitFor(() => expect(screen.getByText('复制失败，请重试')).toBeInTheDocument());
    // The overlay is still here: §4.1 line 160 keeps the session on failure.
    expect(document.querySelector('.screenshot-overlay')).not.toBeNull();
  });

  it('restores the plain hint on the next pointer move', async () => {
    // §4.1 line 160: the result is transient, so the next move returns to the
    // instruction rather than leaving a stale "copied" on screen.
    vi.mocked(invoke).mockImplementation((command: string) => {
      if (command === 'copy_capture_color') return Promise.resolve(true);
      return Promise.resolve({ path: '7/1', width: FRAME.width, height: FRAME.height });
    });
    const overlay = await renderOverlay();
    overlay.dispatchEvent(pointerEvent('pointermove', 200, 160));
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true, cancelable: true })
    );
    await waitFor(() => expect(screen.getByText('色值已复制')).toBeInTheDocument());

    overlay.dispatchEvent(pointerEvent('pointermove', 210, 170));

    await waitFor(() => expect(screen.queryByText('色值已复制')).toBeNull());
  });
});



describe('editing a committed object through the property panel', () => {
  async function withShape(toolName: string) {
    const user = userEvent.setup();
    const overlay = await renderOverlay();
    overlay.dispatchEvent(pointerEvent('pointerdown', 100, 100));
    overlay.dispatchEvent(pointerEvent('pointermove', 600, 500));
    overlay.dispatchEvent(pointerEvent('pointerup', 600, 500));
    await waitFor(() => expect(screen.getByRole('toolbar')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: toolName }));
    overlay.dispatchEvent(pointerEvent('pointerdown', 200, 200));
    overlay.dispatchEvent(pointerEvent('pointermove', 300, 280));
    overlay.dispatchEvent(pointerEvent('pointerup', 300, 280));
    return { overlay, user };
  }

  it('recolours a committed rectangle instead of only the next one', async () => {
    // Reported as "circles, arrows, rectangles and lines cannot be edited
    // afterwards": the panel existed, but it only ever set defaults for the shape
    // about to be drawn, so a committed shape's colour was frozen.
    const { overlay, user } = await withShape('矩形');
    const shape = await waitFor(() => {
      const node = document.querySelector('[data-kind="rect"]');
      expect(node).not.toBeNull();
      return node!;
    });
    const drawnWith = shape.getAttribute('stroke');

    overlay.dispatchEvent(pointerEvent('pointerdown', 200, 240));
    overlay.dispatchEvent(pointerEvent('pointerup', 200, 240));
    await waitFor(() =>
      expect(document.querySelector('[data-selected-for]')).not.toBeNull()
    );

    const swatches = screen.getAllByRole('radio', { name: /颜色/ });
    const other = swatches.find(
      swatch => swatch.getAttribute('data-value') !== drawnWith
    );
    await user.click(other!);

    await waitFor(() => {
      const node = document.querySelector('[data-kind="rect"]');
      expect(node!.getAttribute('stroke')).not.toBe(drawnWith);
    });
    // Restyled, not redrawn.
    expect(document.querySelectorAll('[data-kind="rect"]')).toHaveLength(1);
  });

  it('shows the selected object own properties, not the tool defaults', async () => {
    const { overlay } = await withShape('矩形');
    await waitFor(() => expect(document.querySelector('[data-kind="rect"]')).not.toBeNull());

    overlay.dispatchEvent(pointerEvent('pointerdown', 200, 240));
    overlay.dispatchEvent(pointerEvent('pointerup', 200, 240));

    // The panel stays on the object's kind even though the active tool is now
    // "select" after the grab.
    await waitFor(() =>
      expect(screen.getAllByRole('radio', { name: /线宽/ }).length).toBeGreaterThan(0)
    );
  });
});

describe('a committed text object', () => {
  it('can be grabbed anywhere across its measured width', async () => {
    // Reported as "after typing text, the cursor does not become a move cursor at
    // its edge": the box came from `content.length * fontSize * 0.6`, which bills a
    // CJK glyph at 0.6em, so the right half of 你好世界 was outside the object.
    const user = userEvent.setup();
    const overlay = await renderOverlay();
    overlay.dispatchEvent(pointerEvent('pointerdown', 100, 100));
    overlay.dispatchEvent(pointerEvent('pointermove', 600, 500));
    overlay.dispatchEvent(pointerEvent('pointerup', 600, 500));
    await waitFor(() => expect(screen.getByRole('toolbar')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: '文字' }));
    overlay.dispatchEvent(pointerEvent('pointerdown', 200, 200));
    const editor = await screen.findByRole('textbox', { name: '标注文字' });
    await user.type(editor, '你好世界');
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true });

    const text = await waitFor(() => {
      const node = document.querySelector('[data-kind="text"]');
      expect(node).not.toBeNull();
      return node!;
    });
    const width = Number(text.getAttribute('data-width'));
    const fontSize = Number(text.getAttribute('data-font-size'));

    // Four full-width glyphs are four ems wide, not 2.4.
    expect(width).toBeGreaterThanOrEqual(fontSize * 4);
  });
});
