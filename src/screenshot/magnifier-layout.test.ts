import { describe, expect, it } from 'vitest';
import {
  cardSize,
  EDGE_MARGIN,
  FULL_GRID_PIXELS,
  GRID_ZOOM,
  magnifierLayout,
  POINTER_GAP,
  REDUCED_GRID_PIXELS
} from './magnifier-layout';

const roomy = { width: 2240, height: 1400 };

/// The card never overlaps the pointer, and stays inside the margin.
function assertSound(
  layout: ReturnType<typeof magnifierLayout>,
  pointer: { x: number; y: number },
  viewport: { width: number; height: number }
) {
  expect(layout.x).toBeGreaterThanOrEqual(EDGE_MARGIN);
  expect(layout.y).toBeGreaterThanOrEqual(EDGE_MARGIN);
  expect(layout.x + layout.width).toBeLessThanOrEqual(viewport.width - EDGE_MARGIN);
  expect(layout.y + layout.height).toBeLessThanOrEqual(viewport.height - EDGE_MARGIN);

  const coversPointer =
    pointer.x >= layout.x &&
    pointer.x <= layout.x + layout.width &&
    pointer.y >= layout.y &&
    pointer.y <= layout.y + layout.height;
  expect(coversPointer).toBe(false);
}

describe('magnifier card geometry', () => {
  it('matches the documented sizes', () => {
    // 21×21 at 8× is 168, plus 12px padding each side, so the card is 192 wide.
    expect(FULL_GRID_PIXELS * GRID_ZOOM).toBe(168);
    expect(cardSize('full')).toEqual({ width: 192, height: 269 });
    expect(cardSize('reduced')).toEqual({ width: 192, height: 189 });
    // Numbers only: coordinates, HEX and the shortcut line.
    expect(cardSize('numbersOnly')).toEqual({ width: 192, height: 93 });
  });

  it('keeps the same width at every tier', () => {
    // The degradation shrinks the preview, never the text or the hit targets.
    const widths = (['full', 'reduced', 'numbersOnly'] as const).map(
      (tier) => cardSize(tier).width
    );

    expect(new Set(widths).size).toBe(1);
  });
});

describe('magnifier placement', () => {
  it('prefers below-right at the documented 16px gap', () => {
    const pointer = { x: 100, y: 100 };

    const layout = magnifierLayout(pointer, roomy);

    expect(layout).toMatchObject({
      tier: 'full',
      x: 100 + POINTER_GAP,
      y: 100 + POINTER_GAP,
      clamped: false
    });
    assertSound(layout, pointer, roomy);
  });

  it('flips to the left near the right edge', () => {
    const pointer = { x: 2200, y: 100 };

    const layout = magnifierLayout(pointer, roomy);

    expect(layout.x).toBe(2200 - POINTER_GAP - layout.width);
    expect(layout.y).toBe(100 + POINTER_GAP);
    assertSound(layout, pointer, roomy);
  });

  it('flips above near the bottom edge', () => {
    const pointer = { x: 100, y: 1380 };

    const layout = magnifierLayout(pointer, roomy);

    expect(layout.y).toBe(1380 - POINTER_GAP - layout.height);
    expect(layout.x).toBe(100 + POINTER_GAP);
    assertSound(layout, pointer, roomy);
  });

  it('flips to the opposite corner in the bottom-right corner', () => {
    const pointer = { x: 2230, y: 1395 };

    const layout = magnifierLayout(pointer, roomy);

    expect(layout.x).toBe(2230 - POINTER_GAP - layout.width);
    expect(layout.y).toBe(1395 - POINTER_GAP - layout.height);
    assertSound(layout, pointer, roomy);
  });

  it.each([
    [{ x: 0, y: 0 }],
    [{ x: 2239, y: 0 }],
    [{ x: 0, y: 1399 }],
    [{ x: 2239, y: 1399 }],
    [{ x: 1120, y: 700 }]
  ])('stays inside the margin and off the pointer at %j', (pointer) => {
    assertSound(magnifierLayout(pointer, roomy), pointer, roomy);
  });
});

describe('magnifier degradation', () => {
  it('drops to 11×11 when the full grid does not fit on either side', () => {
    // 480 high: the 269px card fits neither below nor above, the 189px one does.
    const viewport = { width: 1000, height: 480 };
    const pointer = { x: 100, y: 200 };

    const layout = magnifierLayout(pointer, viewport);

    expect(layout.tier).toBe('reduced');
    expect(layout.gridPixels).toBe(REDUCED_GRID_PIXELS);
    // Still 8×, per §2.3: the zoom does not change, only the source area.
    expect(layout.gridSize).toBe(REDUCED_GRID_PIXELS * GRID_ZOOM);
    assertSound(layout, pointer, viewport);
  });

  it('drops the grid entirely when even 11×11 does not fit', () => {
    const viewport = { width: 1000, height: 300 };
    const pointer = { x: 100, y: 150 };

    const layout = magnifierLayout(pointer, viewport);

    expect(layout).toMatchObject({ tier: 'numbersOnly', gridPixels: 0, gridSize: 0 });
    // Coordinates, HEX and the shortcut are never dropped.
    expect(layout.height).toBe(cardSize('numbersOnly').height);
    assertSound(layout, pointer, viewport);
  });

  it('degrades in order rather than jumping straight to numbers', () => {
    // A viewport where the reduced tier fits must not be served numbers only.
    const layout = magnifierLayout({ x: 100, y: 200 }, { width: 1000, height: 480 });

    expect(layout.tier).not.toBe('numbersOnly');
  });

  it('clamps on screen as a last resort and says so', () => {
    // Smaller than the card in both axes: the pointer may end up covered, which
    // is the documented last resort, but the card must stay on screen.
    const viewport = { width: 200, height: 150 };

    const layout = magnifierLayout({ x: 100, y: 75 }, viewport);

    expect(layout).toMatchObject({ tier: 'numbersOnly', clamped: true });
    expect(layout.x).toBeGreaterThanOrEqual(EDGE_MARGIN);
    expect(layout.y).toBeGreaterThanOrEqual(EDGE_MARGIN);
  });
});
