import { describe, expect, it } from 'vitest';
import { measureTextBox, resetTextMeasurement } from './text-metrics';

// jsdom's canvas has no text measurement, so these exercise the fallback path.
// That is the path that matters here: it is what the old `length * 0.6` estimate
// was, and it is what a headless export falls back to.

describe('measuring a text annotation box', () => {
  it('bills a CJK glyph as a full em, not 0.6', () => {
    // The bug: 你好世界 at 24px came out 4 * 24 * 0.6 = 57.6px wide, about half its
    // real width, so the right half of the text was outside the object and the
    // pointer found nothing there.
    const { width } = measureTextBox('你好世界', 24);

    expect(width).toBeGreaterThanOrEqual(96);
  });

  it('measures a multi-line string by its widest line, not its total length', () => {
    // Two lines are not one long line: the renderer gives each its own baseline.
    const oneLine = measureTextBox('hello world', 24);
    const twoLines = measureTextBox('hello\nworld', 24);

    expect(twoLines.width).toBeLessThan(oneLine.width);
    expect(twoLines.height).toBeGreaterThan(oneLine.height);
  });

  it('grows the box with the font size', () => {
    const small = measureTextBox('Nowly', 18);
    const large = measureTextBox('Nowly', 32);

    expect(large.width).toBeGreaterThan(small.width);
    expect(large.height).toBeGreaterThan(small.height);
  });

  it('gives a single line the height of one font size, not one and a half', () => {
    // Leading belongs between lines. Counting it on a single line pads the box with
    // dead space below the text, which then swallows presses meant for the frame.
    expect(measureTextBox('Nowly', 24).height).toBe(24);
  });

  it('keeps an empty string empty', () => {
    // An empty text object is deleted rather than committed, but the measurement
    // must not report a phantom box on the way there.
    expect(measureTextBox('', 24).width).toBe(0);
  });

  it('measures mixed scripts as the sum of their parts', () => {
    const mixed = measureTextBox('Nowly 你好', 24);
    const latinOnly = measureTextBox('Nowly ', 24);

    expect(mixed.width).toBeGreaterThan(latinOnly.width + 40);
  });
});

describe('when the canvas is only partly implemented', () => {
  it('falls back instead of throwing during a commit', () => {
    // A stub or polyfill can return a 2D context object with no `measureText`.
    // Calling it threw inside the commit path, which lost the text the user had
    // just typed rather than merely mis-measuring its box.
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = (() => ({ font: '' })) as never;
    resetTextMeasurement();

    try {
      expect(() => measureTextBox('Nowly', 24)).not.toThrow();
      expect(measureTextBox('Nowly', 24).width).toBeGreaterThan(0);
    } finally {
      HTMLCanvasElement.prototype.getContext = original;
      resetTextMeasurement();
    }
  });
});

describe('when the canvas rejects the font string', () => {
  it('falls back rather than measuring at the wrong size', () => {
    // A canvas font is a CSS `font` shorthand. An invalid one is silently ignored
    // and the context keeps its 10px sans-serif default, so the measurement comes
    // back far too small with no error anywhere. This was a real bug: passing
    // `inherit` as the family measured 你好世界 at 40px instead of 96.
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = (() => {
      const context = {
        measureText: (text: string) => ({ width: text.length * 10 })
      };
      // A browser silently discards an invalid font shorthand, leaving the old
      // value. A plain writable property would not reproduce that.
      Object.defineProperty(context, 'font', {
        get: () => '10px sans-serif',
        set: () => {}
      });
      return context;
    }) as never;
    resetTextMeasurement();

    try {
      // 24px was asked for, so a 10px measurement must not be trusted.
      expect(measureTextBox('你好世界', 24).width).toBeGreaterThanOrEqual(96);
    } finally {
      HTMLCanvasElement.prototype.getContext = original;
      resetTextMeasurement();
    }
  });
});
