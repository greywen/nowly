import { describe, expect, it } from 'vitest';
import { cursorFor, type CursorContext } from './cursor';

function context(overrides: Partial<CursorContext> = {}): CursorContext {
  return {
    ready: true,
    exporting: false,
    phase: 'editing',
    tool: 'select',
    transforming: false,
    movingObject: false,
    handle: null,
    over: 'none',
    ...overrides
  };
}

describe('the capture surface cursor', () => {
  it('aims with a crosshair before a selection exists', () => {
    expect(cursorFor(context({ phase: 'aiming' }))).toBe('crosshair');
    expect(cursorFor(context({ phase: 'dragging' }))).toBe('crosshair');
  });

  it('offers no crosshair before the frame has decoded', () => {
    // A crosshair would invite a drag the surface discards until the frame is up.
    expect(cursorFor(context({ ready: false, phase: 'aiming' }))).toBe('default');
  });

  it('shows a move cursor over a committed object, whichever tool is active', () => {
    // The press picks the object up under any tool, so the cursor has to say so;
    // a crosshair over a draggable shape reads as "draw here".
    for (const tool of ['select', 'rect', 'pen', 'text', 'mosaic'] as const) {
      expect(cursorFor(context({ tool, over: 'object' }))).toBe('move');
    }
  });

  it('shows a move cursor inside a selection that can still be moved', () => {
    expect(cursorFor(context({ tool: 'select', over: 'selection' }))).toBe('move');
  });

  it('falls back to a plain pointer for the select tool over nothing', () => {
    // Nothing to draw and nothing to grab: a crosshair would promise drawing.
    expect(cursorFor(context({ tool: 'select', over: 'none' }))).toBe('default');
  });

  it('keeps the crosshair for the tools that aim at a pixel', () => {
    for (const tool of ['rect', 'ellipse', 'arrow', 'pen', 'mosaic'] as const) {
      expect(cursorFor(context({ tool }))).toBe('crosshair');
    }
  });

  it('shows a caret for the text tool', () => {
    expect(cursorFor(context({ tool: 'text' }))).toBe('text');
  });

  it('holds the grab cursor for the whole gesture, even off the object', () => {
    // The pointer outruns the clamped object at the edge of the selection, and the
    // cursor still belongs to the drag rather than to whatever is underneath.
    expect(cursorFor(context({ movingObject: true, over: 'none' }))).toBe('grabbing');
    expect(cursorFor(context({ transforming: true, over: 'none' }))).toBe('grabbing');
  });

  it('reports a running export rather than looking editable', () => {
    // §8.1 freezes the document for the duration, so the surface must not look
    // like it still takes input.
    expect(cursorFor(context({ exporting: true, over: 'object' }))).toBe('progress');
  });
});
