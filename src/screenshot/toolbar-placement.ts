// Where the editing toolbar sits relative to the selection.
//
// §5.1 of docs/superpowers/specs/2026-09-25-nowly-screenshot-design.md line 101:
// 8px below the selection with its right edge aligned to the selection's right
// edge; flipped above when it does not fit; clamped to 8px inside the current
// display. Only when it fits on neither side may it sit inside the selection, and
// then it must not cover the control point being operated.
//
// It never enters the output pixels, and it never crosses a display boundary,
// because each overlay window covers exactly one display.

/// 8px gap, matching the toolbar's own padding.
const GAP = 8;
/// Minimum distance from the display edge.
const EDGE_MARGIN = 8;

export type ToolbarPlacement = {
  left: number;
  top: number;
  /// Where it ended up, so a test can assert the fallback order was honoured.
  position: 'below' | 'above' | 'inside';
};

export type ToolbarBox = { width: number; height: number };

/// All values in CSS pixels, in the overlay's coordinate space.
export function toolbarPlacement(
  selection: { left: number; top: number; width: number; height: number },
  toolbar: ToolbarBox,
  viewport: { width: number; height: number },
  /// The handle currently being dragged, if any. The inside placement keeps clear
  /// of it, per line 101.
  activeHandle?: 'nw' | 'n' | 'ne' | 'w' | 'e' | 'sw' | 's' | 'se' | null
): ToolbarPlacement {
  // Right-aligned to the selection, then pulled back inside the display.
  const preferredLeft = selection.left + selection.width - toolbar.width;
  const left = Math.max(
    EDGE_MARGIN,
    Math.min(preferredLeft, viewport.width - EDGE_MARGIN - toolbar.width)
  );

  const below = selection.top + selection.height + GAP;
  if (below + toolbar.height <= viewport.height - EDGE_MARGIN) {
    return { left, top: below, position: 'below' };
  }

  const above = selection.top - GAP - toolbar.height;
  if (above >= EDGE_MARGIN) {
    return { left, top: above, position: 'above' };
  }

  // Last resort: inside the selection. It covers content, so it is only used when
  // neither side fits, and it must stay clear of the handle being dragged.
  const bottomInside = Math.max(
    EDGE_MARGIN,
    Math.min(
      selection.top + selection.height - toolbar.height - GAP,
      viewport.height - EDGE_MARGIN - toolbar.height
    )
  );
  const topInside = Math.max(EDGE_MARGIN, selection.top + GAP);
  // A bottom-aligned toolbar would sit on the bottom handles, so a drag on one of
  // those moves it to the top edge instead.
  const draggingBottom =
    activeHandle === 'sw' || activeHandle === 's' || activeHandle === 'se';
  return { left, top: draggingBottom ? topInside : bottomInside, position: 'inside' };
}
