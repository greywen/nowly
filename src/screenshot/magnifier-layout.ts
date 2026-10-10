// Where the magnifier card goes, and how much of it survives a cramped display.
//
// §2.3 of docs/superpowers/specs/2026-09-25-nowly-screenshot-design.md fixes the
// geometry; the placement rules are:
//
// - 16px from the pointer, preferring below-right, flipping to another side when
//   that does not fit.
// - At least 8px from the visible display edge.
// - Never covering the target pixel, which the 16px gap guarantees as long as the
//   card is never nudged across the pointer. So a placement either fits whole or
//   is rejected: nothing is clamped over the pointer.
// - If no side fits, the preview degrades 21×21 → 11×11 → numbers only. The
//   degradation applies to the preview alone: no font or hit target ever shrinks.

/// Source pixels per side of the grid, shown at 8×.
export const FULL_GRID_PIXELS = 21;
export const REDUCED_GRID_PIXELS = 11;
export const GRID_ZOOM = 8;

const CARD_WIDTH = 192;
const CARD_PADDING = 12;
/// Coordinates, HEX and the shortcut line: three lines at 0.95rem with a 1.5
/// line-height, rounded up to whole pixels.
const INFO_HEIGHT = 69;
const GRID_INFO_GAP = 8;
/// Distance kept from the pointer, so the sampled pixel stays visible.
export const POINTER_GAP = 16;
/// Minimum distance from the visible display edge.
export const EDGE_MARGIN = 8;

export type MagnifierTier = 'full' | 'reduced' | 'numbersOnly';

export type Viewport = { width: number; height: number };

export type MagnifierLayout = {
  tier: MagnifierTier;
  /// Grid side in source pixels, or 0 when the grid is dropped.
  gridPixels: number;
  /// CSS pixels of the rendered grid: `gridPixels * GRID_ZOOM`.
  gridSize: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /// True when the card had to be clamped because nothing fit. The pointer may
  /// then be covered, which is the documented last resort.
  clamped: boolean;
};

const TIERS: readonly MagnifierTier[] = ['full', 'reduced', 'numbersOnly'];

function gridPixelsFor(tier: MagnifierTier): number {
  if (tier === 'full') return FULL_GRID_PIXELS;
  if (tier === 'reduced') return REDUCED_GRID_PIXELS;
  return 0;
}

export function cardSize(tier: MagnifierTier): { width: number; height: number } {
  const gridSize = gridPixelsFor(tier) * GRID_ZOOM;
  const height =
    CARD_PADDING * 2 + INFO_HEIGHT + (gridSize > 0 ? gridSize + GRID_INFO_GAP : 0);
  return { width: CARD_WIDTH, height };
}

/// Below-right first, then the three other corners.
const PLACEMENTS = [
  { right: true, below: true },
  { right: false, below: true },
  { right: true, below: false },
  { right: false, below: false }
] as const;

/// Places the magnifier for a pointer position inside the overlay.
///
/// `pointer` is in the overlay's CSS pixels; the overlay covers one display, so
/// the viewport is that display's visible area.
export function magnifierLayout(
  pointer: { x: number; y: number },
  viewport: Viewport
): MagnifierLayout {
  for (const tier of TIERS) {
    const { width, height } = cardSize(tier);
    for (const placement of PLACEMENTS) {
      const x = placement.right ? pointer.x + POINTER_GAP : pointer.x - POINTER_GAP - width;
      const y = placement.below ? pointer.y + POINTER_GAP : pointer.y - POINTER_GAP - height;
      if (
        x >= EDGE_MARGIN &&
        y >= EDGE_MARGIN &&
        x + width <= viewport.width - EDGE_MARGIN &&
        y + height <= viewport.height - EDGE_MARGIN
      ) {
        const gridPixels = gridPixelsFor(tier);
        return {
          tier,
          gridPixels,
          gridSize: gridPixels * GRID_ZOOM,
          x,
          y,
          width,
          height,
          clamped: false
        };
      }
    }
  }

  // Nothing fit on any side at any tier: keep the smallest card on screen and
  // report that the pointer may be covered, rather than placing it off-screen.
  const { width, height } = cardSize('numbersOnly');
  return {
    tier: 'numbersOnly',
    gridPixels: 0,
    gridSize: 0,
    x: Math.max(EDGE_MARGIN, Math.min(pointer.x + POINTER_GAP, viewport.width - EDGE_MARGIN - width)),
    y: Math.max(EDGE_MARGIN, Math.min(pointer.y + POINTER_GAP, viewport.height - EDGE_MARGIN - height)),
    width,
    height,
    clamped: true
  };
}
